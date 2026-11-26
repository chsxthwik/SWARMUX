'use strict';
// SWARMUX main process: windows, real ConPTY shells (node-pty), settings and notifications.
const { app, BrowserWindow, ipcMain, Notification, shell, Menu, powerMonitor, Tray, nativeImage } = require('electron');
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
let tray = null;
let quitting = false;
const bgOn = () => readState().background !== false; // keep terminals running when the window closes

// ---------- profiles: the shells and WSL distributions on this PC ----------
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
  if (which('wsl.exe')) {
    // One profile per installed Linux distribution (wsl -l -q prints UTF-16).
    let distros = [];
    try { distros = execFileSync('wsl.exe', ['-l', '-q'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString('utf16le').replace(/\0/g, '').split(/\r?\n/).map(x => x.trim()).filter(x => x && !/^docker-desktop/i.test(x)); } catch {}
    if (!distros.length) out.push({ id: 'wsl', name: 'WSL', kind: 'shell', file: 'wsl.exe', args: ['~'] });
    for (const d of distros) out.push({ id: 'wsl:' + d, name: d.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), kind: 'shell', file: 'wsl.exe', args: ['-d', d, '--cd', '~'] });
  }
  const gitBash = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'].find(p => fs.existsSync(p));
  if (gitBash) out.push({ id: 'gitbash', name: 'Git Bash', kind: 'shell', file: gitBash, args: ['--login', '-i'] });
  // SSH machines from your SSH config (plain Host entries, no wildcards).
  try {
    const cfg = fs.readFileSync(path.join(os.homedir(), '.ssh', 'config'), 'utf8');
    const ssh = which('ssh.exe') || 'ssh.exe';
    const seen = new Set();
    for (const m of cfg.matchAll(/^\s*Host\s+(.+)$/gim)) for (const h of m[1].trim().split(/\s+/)) {
      if (!h || /[*?!]/.test(h) || seen.has(h)) continue; seen.add(h);
      out.push({ id: 'ssh:' + h, name: 'SSH: ' + h, kind: 'ssh', file: ssh, args: [h] });
    }
  } catch {}
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
    try { if (process.env.SWARMUX_KEYS) for (const k of process.env.SWARMUX_KEYS.split(',').filter(Boolean)) { const [mods, key] = k.includes('+') ? [k.split('+').slice(0, -1).map(m => m.toLowerCase()), k.split('+').pop()] : [[], k]; win.webContents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: mods }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: mods }); await new Promise(r => setTimeout(r, 900)); }
      await new Promise(r => setTimeout(r, 2500));
      fs.writeFileSync(process.env.SWARMUX_SHOT, (await win.webContents.capturePage()).toPNG()); } catch (e) { console.error(e); }
    quitting = true; win.close();
  }, 2500));
  win.webContents.on('console-message', (e) => { if (process.env.SWARMUX_SHOT && e.level !== 'info' && e.level !== 'debug') console.error('renderer:', e.message); });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  const saveBounds = () => { if (!win || win.isDestroyed()) return; const s = readState(); s.maximized = win.isMaximized(); if (!s.maximized && !win.isMinimized()) s.bounds = win.getBounds(); writeState(s); };
  win.on('close', (e) => {
    saveBounds();
    if (!quitting && bgOn() && ptys.size) { e.preventDefault(); win.hide(); ensureTray(); }
  });
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
ipcMain.handle('pty:create', (e, { id, profileId, cwd, cols, rows }) => {
  const prof = PROFILES.find(p => p.id === profileId) || PROFILES[0];
  const dir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'SWARMUX' };
  let proc;
  try {
    proc = pty.spawn(prof.file, prof.args, { name: 'xterm-256color', cols: Math.max(2, cols | 0), rows: Math.max(2, rows | 0), cwd: dir, env, useConpty: true });
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
  return { ok: true, name: prof.name, kind: prof.kind, cwd: prof.file === 'wsl.exe' ? '~' : dir, pid: proc.pid };
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
ipcMain.handle('settings:get', () => { const st = readState(); return { startup: app.isPackaged ? app.getLoginItemSettings().openAtLogin : !!st.startup, background: st.background !== false, updates: st.updates !== false, version: app.getVersion() }; });
ipcMain.handle('settings:set', (_e, key, val) => { if (!['background', 'updates'].includes(key)) return; const st = readState(); st[key] = !!val; writeState(st); return !!val; });
ipcMain.on('app:quit', () => { quitting = true; app.quit(); });
ipcMain.handle('settings:startup', (_e, on) => { const st = readState(); st.startup = !!on; st.startupSet = true; writeState(st); if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!on, args: ['--restore'] }); return !!on; });
ipcMain.on('app:restart-update', () => { quitting = true; try { require('electron-updater').autoUpdater.quitAndInstall(); } catch { app.quit(); } });
ipcMain.on('app:open', (_e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });

app.on('second-instance', () => showWin());
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  PROFILES = detectProfiles();
  // Opens with Windows by default (turn off in Settings), so a restart brings your tabs back.
  const st = readState();
  if (app.isPackaged && !st.startupSet) { app.setLoginItemSettings({ openAtLogin: true, args: ['--restore'] }); st.startupSet = true; st.startup = true; writeState(st); }
  createWindow();
  if (app.isPackaged && readState().updates !== false) {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.autoDownload = true; autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.on('update-downloaded', (i) => { if (win && !win.isDestroyed()) win.webContents.send('app:update', i.version); });
      autoUpdater.on('error', () => {});
      const check = () => autoUpdater.checkForUpdates().catch(() => {});
      setTimeout(check, 15000); setInterval(check, 4 * 3600 * 1000);
    } catch {}
  }
  // Windows shutdown or sign-out: save terminal contents before the session ends.
  const flush = () => { try { if (win && !win.isDestroyed()) win.webContents.send('app:save-now'); } catch {} };
  powerMonitor.on('shutdown', flush);
  powerMonitor.on('suspend', flush);
  powerMonitor.on('lock-screen', flush);
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { quitting = true; });
function showWin() { if (!win) return createWindow(); if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
function ensureTray() {
  if (tray) return;
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.ico')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Swarmux: terminals still running');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Swarmux', click: showWin }, { type: 'separator' }, { label: 'Quit and end all terminals', click: () => { quitting = true; app.quit(); } }]));
  tray.on('click', showWin);
}
app.on('session-end', () => { try { if (win && !win.isDestroyed()) win.webContents.send('app:save-now'); } catch {} });
