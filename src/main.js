'use strict';
// SWARMUX main process: windows, real ConPTY shells (node-pty), settings and notifications.
const { app, BrowserWindow, ipcMain, Notification, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const pty = require('node-pty');

app.setAppUserModelId('com.quantum.swarmux');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
if (!app.requestSingleInstanceLock()) { app.quit(); }

const STATE = () => path.join(app.getPath('userData'), 'state.json');
const ptys = new Map(); // id -> { proc, buf, timer, owner }
let win = null;

// ---------- profiles: shells and agents found on this PC ----------
function which(cmd) {
  try { return execFileSync('where.exe', [cmd], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/)[0].trim() || null; }
  catch { return null; }
}
function detectProfiles() {
  const out = [];
  const pwsh = which('pwsh.exe');
  if (pwsh) out.push({ id: 'pwsh', name: 'PowerShell 7', kind: 'shell', file: pwsh, args: ['-NoLogo'] });
  out.push({ id: 'powershell', name: 'Windows PowerShell', kind: 'shell', file: 'powershell.exe', args: ['-NoLogo'] });
  out.push({ id: 'cmd', name: 'Command Prompt', kind: 'shell', file: 'cmd.exe', args: [] });
  if (which('wsl.exe')) out.push({ id: 'wsl', name: 'WSL', kind: 'shell', file: 'wsl.exe', args: ['~'] });
  const gitBash = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'].find(p => fs.existsSync(p));
  if (gitBash) out.push({ id: 'gitbash', name: 'Git Bash', kind: 'shell', file: gitBash, args: ['--login', '-i'] });
  const host = pwsh ? { file: pwsh, args: ['-NoLogo', '-NoExit', '-Command'] } : { file: 'powershell.exe', args: ['-NoLogo', '-NoExit', '-Command'] };
  // resume: the command that picks the agent's last conversation in this folder back up, falling back to a new one.
  for (const [id, name, cmd, resume] of [
    ['claude', 'Claude Code', 'claude', 'claude --continue; if ($LASTEXITCODE) { claude }'],
    ['codex', 'Codex', 'codex', 'codex resume --last; if ($LASTEXITCODE) { codex }'],
    ['opencode', 'OpenCode', 'opencode', 'opencode --continue; if ($LASTEXITCODE) { opencode }'],
    ['gemini', 'Gemini CLI', 'gemini', 'gemini'],
  ]) {
    if (which(cmd) || which(cmd + '.cmd') || which(cmd + '.exe')) out.push({ id, name, kind: 'agent', file: host.file, args: [...host.args, cmd], resumeArgs: [...host.args, resume] });
  }
  return out;
}
let PROFILES = [];

// ---------- window ----------
function createWindow() {
  const st = readState();
  const b = st.bounds || { width: 1280, height: 800 };
  win = new BrowserWindow({
    ...b, minWidth: 640, minHeight: 400, show: false, backgroundColor: '#0b0c0e',
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#0b0c0e', symbolColor: '#a9b1ba', height: 40 },
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false, nodeIntegration: false, spellcheck: false, backgroundThrottling: false },
  });
  if (st.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  // Dev check: SWARMUX_SHOT=<file.png> captures the window after start-up, then quits.
  if (process.env.SWARMUX_SHOT) win.webContents.once('did-finish-load', () => setTimeout(async () => {
    try { if (process.env.SWARMUX_KEYS) for (const k of process.env.SWARMUX_KEYS.split(',')) { const [mods, key] = k.includes('+') ? [k.split('+').slice(0, -1).map(m => m.toLowerCase()), k.split('+').pop()] : [[], k]; win.webContents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: mods }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: mods }); await new Promise(r => setTimeout(r, 900)); }
      await new Promise(r => setTimeout(r, 2500));
      fs.writeFileSync(process.env.SWARMUX_SHOT, (await win.webContents.capturePage()).toPNG()); } catch (e) { console.error(e); }
    win.close();
  }, 2500));
  win.webContents.on('console-message', (e) => { if (process.env.SWARMUX_SHOT && e.level !== 'info' && e.level !== 'debug') console.error('renderer:', e.message); });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  const saveBounds = () => { if (!win || win.isDestroyed()) return; const s = readState(); s.maximized = win.isMaximized(); if (!s.maximized && !win.isMinimized()) s.bounds = win.getBounds(); writeState(s); };
  win.on('close', saveBounds);
  win.on('closed', () => { win = null; for (const id of [...ptys.keys()]) killPty(id); });
}

// ---------- state ----------
function readState() { try { return JSON.parse(fs.readFileSync(STATE(), 'utf8')); } catch { return {}; } }
function writeState(s) {
  try { const f = STATE(); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(s)); fs.renameSync(f + '.tmp', f); } catch {}
}

// ---------- pty ----------
function killPty(id) {
  const p = ptys.get(id); if (!p) return;
  clearTimeout(p.timer); ptys.delete(id);
  try { p.proc.kill(); } catch {}
}
ipcMain.handle('pty:create', (e, { id, profileId, cwd, cols, rows, resume }) => {
  const prof = PROFILES.find(p => p.id === profileId) || PROFILES[0];
  const dir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'SWARMUX' };
  let proc;
  try {
    proc = pty.spawn(prof.file, resume && prof.resumeArgs ? prof.resumeArgs : prof.args, { name: 'xterm-256color', cols: Math.max(2, cols | 0), rows: Math.max(2, rows | 0), cwd: dir, env, useConpty: true });
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
  const sender = e.sender;
  const entry = { proc, buf: '', timer: null };
  ptys.set(id, entry);
  // Batch output: one IPC message per ~8ms per pane keeps long, chatty agent sessions smooth.
  proc.onData((d) => {
    entry.buf += d;
    if (!entry.timer) entry.timer = setTimeout(() => { entry.timer = null; if (!sender.isDestroyed()) sender.send('pty:data', id, entry.buf); entry.buf = ''; }, 8);
  });
  proc.onExit(({ exitCode }) => {
    if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; if (entry.buf && !sender.isDestroyed()) sender.send('pty:data', id, entry.buf); }
    ptys.delete(id);
    if (!sender.isDestroyed()) sender.send('pty:exit', id, exitCode);
  });
  return { ok: true, name: prof.name, kind: prof.kind, cwd: dir, pid: proc.pid };
});
ipcMain.on('pty:write', (_e, id, data) => { const p = ptys.get(id); if (p) try { p.proc.write(data); } catch {} });
ipcMain.on('pty:resize', (_e, id, cols, rows) => { const p = ptys.get(id); if (p && cols > 1 && rows > 1) try { p.proc.resize(cols | 0, rows | 0); } catch {} });
ipcMain.on('pty:kill', (_e, id) => killPty(id));

ipcMain.handle('app:profiles', () => PROFILES);
ipcMain.handle('state:get', () => readState().session || null);
ipcMain.on('state:set', (_e, session) => { const s = readState(); s.session = session; writeState(s); });
ipcMain.on('state:set-sync', (e, session) => { const s = readState(); s.session = session; writeState(s); e.returnValue = true; });
ipcMain.on('app:notify', (_e, title, body) => {
  if (!Notification.isSupported() || (win && win.isFocused())) return;
  const n = new Notification({ title, body, silent: false });
  n.on('click', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  n.show();
  if (win && !win.isFocused()) win.flashFrame(true);
});
ipcMain.on('app:open', (_e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  PROFILES = detectProfiles();
  createWindow();
});
app.on('window-all-closed', () => app.quit());
