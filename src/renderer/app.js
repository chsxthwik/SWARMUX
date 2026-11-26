'use strict';
// SWARMUX renderer: tabs of split panes, each pane a real terminal. Built for many agents running for hours.
(() => {
  const H = window.swarmux;
  const pick = (g, n) => (g && g[n]) || g;
  const Terminal = pick(window.Terminal, 'Terminal');
  const FitAddon = pick(window.FitAddon, 'FitAddon');
  const WebglAddon = pick(window.WebglAddon, 'WebglAddon');
  const WebLinksAddon = pick(window.WebLinksAddon, 'WebLinksAddon');
  const SearchAddon = pick(window.SearchAddon, 'SearchAddon');
  const SerializeAddon = pick(window.SerializeAddon, 'SerializeAddon');

  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  const THEME = {
    background: '#111316', foreground: '#e6e9ec', cursor: '#3DF28C', cursorAccent: '#111316', selectionBackground: '#2b4a3a',
    black: '#1b1e22', red: '#ff6b6b', green: '#3DF28C', yellow: '#f5b84b', blue: '#6aa8ff', magenta: '#c49bff', cyan: '#4fd6d0', white: '#d7dbe0',
    brightBlack: '#5c636c', brightRed: '#ff8a8a', brightGreen: '#7af7b0', brightYellow: '#ffd27a', brightBlue: '#94c1ff', brightMagenta: '#d8bcff', brightCyan: '#7fe7e2', brightWhite: '#ffffff',
  };
  const PICON = {
    shell: '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="#1f6feb"/><path d="M4.5 6l2 2-2 2M8 10h3.5" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    cmd: '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="#2b2f34" stroke="#8b949e"/><path d="M4.5 6l2 2-2 2M8 10h3.5" fill="none" stroke="#e6e9ec" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    wsl: '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="#e95420"/><path d="M4.5 6l2 2-2 2M8 10h3.5" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    gitbash: '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="#f05032"/><path d="M4.5 6l2 2-2 2M8 10h3.5" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    agent: '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="#0f2a1c" stroke="#3DF28C"/><circle cx="6" cy="8" r="1.4" fill="#3DF28C"/><circle cx="10" cy="8" r="1.4" fill="#3DF28C"/></svg>',
  };
  const picon = (prof) => !prof ? PICON.shell : prof.kind === 'agent' ? PICON.agent : PICON[prof.id] || (/^wsl/.test(prof.id) ? PICON.wsl : prof.id === 'cmd' ? PICON.cmd : PICON.shell);
  const ICON = {
    right: '<svg viewBox="0 0 16 16" width="13" height="13"><rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 2.5v11" stroke="currentColor" stroke-width="1.3"/></svg>',
    down: '<svg viewBox="0 0 16 16" width="13" height="13"><rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M1.5 8h13" stroke="currentColor" stroke-width="1.3"/></svg>',
    zoom: '<svg viewBox="0 0 16 16" width="13" height="13"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    close: '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  };

  // ---------- state ----------
  let profiles = [];
  let fontSize = 14;
  const tabs = [];          // { id, title, custom, root, focus, zoom, broadcast, el }
  let active = null;
  const panes = new Map();  // paneId -> pane object

  const profile = (id) => profiles.find((p) => p.id === id) || profiles[0];

  // ---------- panes ----------
  function makePane(profileId, cwd, restore) {
    const id = uid();
    const prof = profile(profileId);
    const root = el('section', 'pane');
    root.dataset.id = id;
    const head = el('div', 'ph');
    const dot = el('span', 'dot');
    const name = el('span', 'nm', esc(prof ? prof.name : 'Shell'));
    const tag = el('span', 'tag', ''); tag.hidden = true;
    const bc = el('span', 'bc', 'broadcast'); bc.hidden = true;
    const cwdEl = el('span', 'cwd', '');
    const acts = el('div', 'acts');
    const btn = (icon, title, fn) => { const b = el('button', 'ib', icon); b.title = title; b.setAttribute('aria-label', title); b.onclick = (e) => { e.stopPropagation(); fn(); }; return b; };
    acts.append(btn(ICON.right, 'Split right (Ctrl+Shift+D)', () => split(id, 'row')), btn(ICON.down, 'Split down (Ctrl+Shift+E)', () => split(id, 'col')), btn(ICON.zoom, 'Zoom (Ctrl+Shift+Z)', () => toggleZoom()), btn(ICON.close, 'Close pane (Ctrl+Shift+W)', () => closePane(id)));
    head.append(el('span', 'pi', picon(prof)), name, dot, tag, bc, cwdEl, acts);
    const body = el('div', 'term');
    root.append(head, body);

    const term = new Terminal({
      fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace', fontSize, lineHeight, letterSpacing: 0,
      cursorBlink: true, cursorStyle: 'bar', scrollback: 20000, allowProposedApi: true, theme: THEME,
      macOptionIsMeta: true, rightClickSelectsWord: false, smoothScrollDuration: 0, minimumContrastRatio: 1,
      windowsPty: { backend: 'conpty' },
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    const ser = new SerializeAddon();
    term.loadAddon(fit); term.loadAddon(search); term.loadAddon(ser);
    term.loadAddon(new WebLinksAddon((e, uri) => { if (e.ctrlKey) H.open(uri); }));

    const p = { id, profileId: prof ? prof.id : 'powershell', cwd: cwd || '', root, head, dot, name, cwdEl, bc, term, fit, search, ser, restore: restore || null, alive: false, opened: false, state: 'idle', lastOut: 0, quietTimer: null, webgl: null, tabId: null, spawned: false };
    panes.set(id, p);

    root.addEventListener('mousedown', () => focusPane(id));
    term.onData((d) => {
      const t = tabOf(p);
      if (t && t.broadcast) { for (const q of panesIn(t.root)) if (q.alive) H.write(q.id, d); }
      else if (p.alive) H.write(id, d);
    });
    term.onBell(() => { if (!isVisibleFocus(p)) setState(p, 'blocked'); });
    const setCwd = (d) => { if (!d) return; p.cwd = d; p.cwdEl.textContent = d; p.cwdEl.title = d; save(); };
    term.parser.registerOscHandler(7, (data) => { try { const u = new URL(data); let d = decodeURIComponent(u.pathname); if (/^\/[A-Za-z]:/.test(d)) d = d.slice(1).replace(/\//g, '\\'); setCwd(d); } catch {} return true; });
    term.parser.registerOscHandler(9, (data) => { if (data.startsWith('9;')) setCwd(data.slice(2).replace(/^"|"$/g, '')); return false; });
    term.onTitleChange((t) => { if (t && !/(^[A-Za-z]:\\.*\.exe$|^(wsl|powershell|cmd|pwsh|bash)(\.exe)?$)/i.test(t)) { p.name.textContent = t.length > 60 ? t.slice(0, 60) + '…' : t; const tb = tabOf(p); if (tb && !tb.custom && tb.focus === p.id) renderTabs(); } });
    term.attachCustomKeyEventHandler((e) => handleTermKey(e, p));
    root.addEventListener('contextmenu', (e) => { e.preventDefault(); if (term.hasSelection()) { H.copy(term.getSelection()); term.clearSelection(); } else { const t = H.paste(); if (t) term.paste(t); } });
    return p;
  }

  function openPane(p) {
    if (p.opened) return;
    p.opened = true;
    p.term.open(p.root.querySelector('.term'));
    try {
      const gl = new WebglAddon();
      gl.onContextLoss(() => { try { gl.dispose(); } catch {} p.webgl = null; });
      p.term.loadAddon(gl); p.webgl = gl;
    } catch { p.webgl = null; }
    const ro = new ResizeObserver(() => scheduleFit(p));
    ro.observe(p.root.querySelector('.term'));
    p.ro = ro;
  }

  async function spawn(p) {
    if (p.spawned) return;
    p.spawned = true;
    safeFit(p);
    const rs = p.restore; p.restore = null;
    if (rs && rs.buffer) p.term.write(rs.buffer + '\r\n\x1b[2m\u2500\u2500 restored ' + new Date(rs.at || Date.now()).toLocaleString() + ' \u2500\u2500 scroll up for earlier output\x1b[0m' + '\r\n'.repeat(Math.max(1, p.term.rows - 1)));
    const r = await H.create({ id: p.id, profileId: p.profileId, cwd: p.cwd, cols: p.term.cols, rows: p.term.rows });
    if (!r || !r.ok) { p.term.write(`\r\n\x1b[31mCould not start: ${(r && r.error) || 'unknown error'}\x1b[0m\r\n`); setState(p, 'exit'); return; }
    p.alive = true; p.bornAt = Date.now(); p.cwd = r.cwd; p.cwdEl.textContent = r.cwd; p.cwdEl.title = r.cwd;
    H.resize(p.id, p.term.cols, p.term.rows);
    save();
  }

  let fitQueue = new Set(), fitRaf = 0;
  function scheduleFit(p) { fitQueue.add(p); if (!fitRaf) fitRaf = requestAnimationFrame(() => { fitRaf = 0; const q = [...fitQueue]; fitQueue.clear(); q.forEach(safeFit); }); }
  function safeFit(p) {
    if (!p.opened || !p.root.isConnected || p.root.offsetParent === null) return;
    try {
      const before = p.term.cols + 'x' + p.term.rows;
      p.fit.fit();
      if (p.alive && before !== p.term.cols + 'x' + p.term.rows) H.resize(p.id, p.term.cols, p.term.rows);
    } catch {}
  }

  // Activity: output marks a pane busy; 4s of quiet after real work marks it done and, if you are not looking, notifies.
  function onOutput(p, len) {
    const now = Date.now();
    p.lastOut = now;
    if (now - (p.bornAt || 0) < 5000) return; // start-up banner and first prompt are not work
    if (p.state !== 'busy' && len > 0) { p.busyFrom = p.state === 'busy' ? p.busyFrom : now; setState(p, 'busy'); }
    clearTimeout(p.quietTimer);
    p.quietTimer = setTimeout(() => {
      if (!p.alive) return;
      const worked = Date.now() - (p.busyFrom || now) > 3000;
      if (needsInput(p) && !isVisibleFocus(p)) {
        setState(p, 'blocked');
        if (notifyOn) { H.notify(`${p.name.textContent} needs your input`, tabOf(p) ? `In tab "${tabOf(p).title}"` : 'Swarmux'); ding(); }
        return;
      }
      if (worked && !isVisibleFocus(p)) {
        setState(p, 'done');
        const t = tabOf(p);
        if (notifyOn) ding();
        if (notifyOn) H.notify(`${p.name.textContent} finished`, t ? `In tab "${t.title}"` : 'SWARMUX');
      } else setState(p, 'idle');
    }, 4000);
  }
  // Looks at the last lines on screen for a question the program is waiting on.
  const ASK = /(\(y\/n\)|\[y\/n\]|\by\/N\b|do you want to|allow (this|once)|approve|press enter to continue|waiting for (your )?(input|approval)|\b1\. yes\b|continue\?)/i;
  function needsInput(p) {
    try {
      const b = p.term.buffer.active; let txt = '';
      for (let y = Math.max(0, b.baseY + b.cursorY - 8); y <= b.baseY + b.cursorY; y++) { const l = b.getLine(y); if (l) txt += l.translateToString(true) + '\n'; }
      return ASK.test(txt);
    } catch { return false; }
  }
  let audio = null;
  function ding() {
    if (!soundOn) return;
    try { audio = audio || new AudioContext(); const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = 880; g.gain.setValueAtTime(0.06, audio.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.25); o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.26); } catch {}
  }
  function setState(p, s) {
    p.state = s;
    p.dot.className = 'dot' + (s === 'idle' ? '' : ' ' + s);
    const t = tabOf(p); if (t) updateTabDot(t);
    renderStatus();
  }
  const isVisibleFocus = (p) => document.hasFocus() && active && tabOf(p) === active && active.focus === p.id;

  H.onData((id, d) => {
    const p = panes.get(id); if (!p) return;
    p.term.write(d);
    if (d.length > 2 || /[^\r\n\s]/.test(d)) onOutput(p, d.length);
  });
  H.onExit((id, code) => {
    const p = panes.get(id); if (!p) return;
    p.alive = false; clearTimeout(p.quietTimer);
    setState(p, 'exit');
    const bar = el('div', 'ended', `Process ended${code ? ` with code ${code}` : ''}.`);
    const again = el('button', '', 'Restart'); again.onclick = () => { bar.remove(); p.spawned = false; p.term.reset(); spawn(p); setState(p, 'idle'); focusPane(p.id); };
    const close = el('button', '', 'Close'); close.onclick = () => closePane(p.id);
    bar.append(again, close); p.root.append(bar);
  });

  // ---------- layout tree ----------
  // node: { t:'pane', id } | { t:'split', dir:'row'|'col', a, b, r }
  function panesIn(node, out = []) { if (!node) return out; if (node.t === 'pane') { const p = panes.get(node.id); if (p) out.push(p); } else { panesIn(node.a, out); panesIn(node.b, out); } return out; }
  function tabOf(p) { return tabs.find((t) => panesIn(t.root).includes(p)); }
  function findParent(node, id, parent = null) {
    if (!node) return null;
    if (node.t === 'pane') return node.id === id ? { node, parent } : null;
    return findParent(node.a, id, node) || findParent(node.b, id, node);
  }

  function renderTab(t) {
    t.el.textContent = '';
    if (t.zoom && panes.get(t.zoom)) { const p = panes.get(t.zoom); p.root.classList.add('zoom'); t.el.append(p.root); }
    else { t.zoom = null; t.el.append(renderNode(t.root, t)); }
    for (const p of panesIn(t.root)) { p.root.classList.toggle('zoom', t.zoom === p.id); openPane(p); }
    requestAnimationFrame(() => { for (const p of panesIn(t.root)) { safeFit(p); spawn(p); } focusPane(t.focus, true); });
  }
  function renderNode(node, t) {
    if (node.t === 'pane') { const p = panes.get(node.id); p.root.classList.toggle('focus', t.focus === p.id); return p.root; }
    const box = el('div', 'split ' + node.dir);
    const a = renderNode(node.a, t), b = renderNode(node.b, t);
    const wrap = (child) => { const w = el('div', 'split'); w.style.flex = '1 1 0'; w.append(child); return w; };
    const wa = wrap(a), wb = wrap(b);
    wa.style.flex = `${node.r} 1 0`; wb.style.flex = `${1 - node.r} 1 0`;
    const gut = el('div', 'gut');
    gut.addEventListener('mousedown', (e) => {
      e.preventDefault(); gut.classList.add('drag');
      const rect = box.getBoundingClientRect();
      const move = (ev) => {
        const r = node.dir === 'row' ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height;
        node.r = Math.min(0.9, Math.max(0.1, r));
        wa.style.flex = `${node.r} 1 0`; wb.style.flex = `${1 - node.r} 1 0`;
      };
      const up = () => { gut.classList.remove('drag'); removeEventListener('mousemove', move); removeEventListener('mouseup', up); save(); };
      addEventListener('mousemove', move); addEventListener('mouseup', up);
    });
    gut.addEventListener('dblclick', () => { node.r = 0.5; renderTab(t); save(); });
    box.append(wa, gut, wb);
    return box;
  }

  function split(paneId, dir, profileId) {
    const t = active; if (!t) return;
    const found = findParent(t.root, paneId); if (!found) return;
    const src = panes.get(paneId);
    const np = makePane(profileId || src.profileId, src.cwd);
    const newSplit = { t: 'split', dir, a: { t: 'pane', id: paneId }, b: { t: 'pane', id: np.id }, r: 0.5 };
    if (!found.parent) t.root = newSplit;
    else if (found.parent.a === found.node) found.parent.a = newSplit; else found.parent.b = newSplit;
    t.zoom = null; t.focus = np.id;
    renderTab(t); save();
  }

  function closePane(paneId) {
    const t = tabs.find((x) => panesIn(x.root).some((p) => p.id === paneId)); if (!t) return;
    const p = panes.get(paneId);
    H.kill(paneId); clearTimeout(p.quietTimer); try { p.ro && p.ro.disconnect(); p.term.dispose(); } catch {}
    panes.delete(paneId); p.root.remove();
    const found = findParent(t.root, paneId);
    if (!found.parent) { closeTab(t, true); return; }
    const grand = findParentOfSplit(t.root, found.parent);
    const sibling = found.parent.a === found.node ? found.parent.b : found.parent.a;
    if (!grand) t.root = sibling; else if (grand.a === found.parent) grand.a = sibling; else grand.b = sibling;
    if (t.zoom === paneId) t.zoom = null;
    t.focus = panesIn(sibling)[0].id;
    renderTab(t); renderTabs(); save();
  }
  function findParentOfSplit(node, target) {
    if (!node || node.t !== 'split') return null;
    if (node.a === target || node.b === target) return node;
    return findParentOfSplit(node.a, target) || findParentOfSplit(node.b, target);
  }

  function focusPane(id, quiet) {
    const t = active; if (!t) return;
    const p = panes.get(id) || panesIn(t.root)[0]; if (!p) return;
    t.focus = p.id;
    for (const q of panesIn(t.root)) q.root.classList.toggle('focus', q === p);
    if (p.state === 'done' || p.state === 'blocked') setState(p, 'idle');
    p.term.focus();
    if (!quiet) renderTabs();
    renderStatus();
  }

  function moveFocus(dir) {
    const t = active; if (!t) return;
    const cur = panes.get(t.focus); if (!cur) return;
    const r0 = cur.root.getBoundingClientRect();
    const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    let best = null, bd = Infinity;
    for (const p of panesIn(t.root)) {
      if (p === cur) continue;
      const r = p.root.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const ok = dir === 'left' ? r.right <= r0.left + 2 : dir === 'right' ? r.left >= r0.right - 2 : dir === 'up' ? r.bottom <= r0.top + 2 : r.top >= r0.bottom - 2;
      if (!ok) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) focusPane(best.id);
  }

  function toggleZoom() { const t = active; if (!t) return; t.zoom = t.zoom ? null : t.focus; renderTab(t); }

  // ---------- tabs ----------
  function newTab(profileId, opts = {}) {
    const pid = profileId || defaultProfile || (profiles[0] && profiles[0].id);
    const cur = active && panes.get(active.focus);
    const cwd = opts.cwd || (cur && cur.profileId === pid ? cur.cwd : '');
    const p = makePane(pid, cwd);
    const t = { id: uid(), title: opts.title || (profile(p.profileId) || {}).name || 'Shell', custom: !!opts.title, root: { t: 'pane', id: p.id }, focus: p.id, zoom: null, broadcast: false, el: el('div', 'ws') };
    t.el.hidden = true;
    $('#stage').append(t.el);
    tabs.push(t);
    activate(t);
    save();
    return t;
  }
  function activate(t) {
    active = t;
    for (const x of tabs) x.el.hidden = x !== t;
    renderTab(t); renderTabs();
  }
  function closeTab(t, already) {
    if (!already) for (const p of panesIn(t.root)) { H.kill(p.id); clearTimeout(p.quietTimer); try { p.ro && p.ro.disconnect(); p.term.dispose(); } catch {} panes.delete(p.id); }
    const i = tabs.indexOf(t); tabs.splice(i, 1); t.el.remove();
    if (!tabs.length) { newTab(); return; }
    if (active === t) activate(tabs[Math.min(i, tabs.length - 1)]);
    renderTabs(); save();
  }
  function tabState(t) {
    const st = panesIn(t.root).map((p) => p.state);
    return st.includes('blocked') ? 'blocked' : st.includes('done') ? 'done' : st.includes('busy') ? 'busy' : st.every((s) => s === 'exit') ? 'exit' : 'idle';
  }
  function updateTabDot(t) { const d = $(`#tabs [data-id="${t.id}"] .dot`); if (d) { const s = tabState(t); d.className = 'dot' + (s === 'idle' ? '' : ' ' + s); } }
  function renderTabs() {
    renderSide();
    const bar = $('#tabs'); bar.textContent = '';
    tabs.forEach((t, i) => {
      const b = el('button', 'tab');
      b.dataset.id = t.id; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(t === active));
      b.title = `${t.title}  (Ctrl+${i + 1})`;
      const s = tabState(t);
      const fp = panes.get(t.focus); b.append(el('span', 'pi', picon(profile(fp ? fp.profileId : null))), el('span', 't', esc(t.title)), el('span', 'dot' + (s === 'idle' ? '' : ' ' + s)));
      const n = panesIn(t.root).length; if (n > 1) b.append(el('span', 'k', `<small style="color:var(--fg3)">${n}</small>`));
      const x = el('span', 'x', ICON.close); x.title = 'Close tab'; x.onclick = (e) => { e.stopPropagation(); closeTab(t); };
      b.append(x);
      b.onclick = () => activate(t);
      b.ondblclick = () => rename(t);
      b.onauxclick = (e) => { if (e.button === 1) closeTab(t); };
      bar.append(b);
    });
  }
  function rename(t) {
    const b = $(`#tabs [data-id="${t.id}"]`); if (!b) return;
    const inp = el('input'); inp.value = t.title; b.querySelector('.t').replaceWith(inp); inp.focus(); inp.select();
    const done = (ok) => { if (ok && inp.value.trim()) { t.title = inp.value.trim().slice(0, 40); t.custom = true; } renderTabs(); save(); focusPane(t.focus); };
    inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); };
    inp.onblur = () => done(true);
  }

  // ---------- status ----------
  // Sidebar: every pane in every tab, grouped by what it needs from you.
  let sideOn = true;
  const LABEL = { blocked: 'Needs you', busy: 'Working', done: 'Done', idle: 'Idle', exit: 'Ended' };
  let sideRaf = 0;
  function renderSide() {
    if (sideRaf) return;
    sideRaf = requestAnimationFrame(() => {
      sideRaf = 0;
      const box = $('#side'); box.hidden = !sideOn; document.body.classList.toggle('side-on', sideOn);
      if (!sideOn) return;
      const list = $('#sideList'); list.textContent = '';
      const q = ($('#sideQ').value || '').toLowerCase().trim();
      const all = []; tabs.forEach((t) => panesIn(t.root).forEach((p) => { if (!q || (p.name.textContent + ' ' + t.title + ' ' + (p.cwd || '')).toLowerCase().includes(q)) all.push({ t, p }); }));
      const cnt = (st) => all.filter((x) => (x.p.state === 'bell' ? 'blocked' : x.p.state) === st).length;
      $('#sideSum').innerHTML = `<span class="chip warn">${cnt('blocked')} need you</span><span class="chip busy">${cnt('busy')} working</span><span class="chip ok">${cnt('done')} done</span>`;
      if (!all.length) list.append(el('p', 'side-empty', q ? 'No pane matches.' : 'No panes yet.'));
      for (const st of ['blocked', 'busy', 'done', 'idle', 'exit']) {
        const g = all.filter((x) => (x.p.state === 'bell' ? 'blocked' : x.p.state) === st); if (!g.length) continue;
        list.append(el('h4', '', `${LABEL[st]} <span>${g.length}</span>`));
        for (const { t, p } of g) {
          const b = el('button', 'si' + (active === t && t.focus === p.id ? ' cur' : ''), `<span class="dot ${st === 'idle' ? '' : st}"></span><span class="sn">${esc(p.name.textContent)}</span><span class="st">${esc(t.title)}</span>`);
          b.title = p.cwd || ''; b.onclick = () => { activate(t); focusPane(p.id); };
          list.append(b);
        }
      }
    });
  }
  function renderStatus() {
    renderSide();
    const s = $('#status'); if (!active) return;
    const p = panes.get(active.focus);
    const all = [...panes.values()];
    const busy = all.filter((x) => x.state === 'busy').length, done = all.filter((x) => x.state === 'done').length;
    s.innerHTML = `<b>${esc(p ? p.name.textContent : '')}</b><span>${p && p.term ? `${p.term.cols}×${p.term.rows}` : ''}</span>` +
      (active.broadcast ? '<span class="bcast">Broadcast on: typing goes to every pane in this tab</span>' : '') +
      `<span class="sp"></span><span>${all.length} pane${all.length === 1 ? '' : 's'}</span><span>${busy} working</span><span>${done} finished</span>`;
  }

  // ---------- keys ----------
  function handleTermKey(e, p) {
    if (e.type !== 'keydown') return true;
    const k = e.key;
    if (e.ctrlKey && e.shiftKey && (k === 'C' || k === 'c')) { if (p.term.hasSelection()) H.copy(p.term.getSelection()); return false; }
    if (e.ctrlKey && e.shiftKey && (k === 'V' || k === 'v')) { const t = H.paste(); if (t) p.term.paste(t); return false; }
    if (e.ctrlKey && !e.shiftKey && (k === 'v' || k === 'V')) { const t = H.paste(); if (t) p.term.paste(t); return false; }
    if (e.ctrlKey && !e.shiftKey && (k === 'c' || k === 'C') && p.term.hasSelection()) { H.copy(p.term.getSelection()); p.term.clearSelection(); return false; }
    return !globalKey(e);
  }
  function globalKey(e) {
    const k = e.key, c = e.ctrlKey, s = e.shiftKey, a = e.altKey;
    const t = active;
    const run = (f) => { e.preventDefault(); f(); return true; };
    if (c && s && (k === 'T' || k === 't')) return run(() => newTab(t ? panes.get(t.focus)?.profileId : undefined));
    if (c && s && (k === 'D' || k === 'd')) return run(() => t && split(t.focus, 'row'));
    if (c && s && (k === 'E' || k === 'e')) return run(() => t && split(t.focus, 'col'));
    if (c && s && (k === 'W' || k === 'w')) return run(() => t && closePane(t.focus));
    if (c && s && (k === 'Z' || k === 'z')) return run(toggleZoom);
    if (c && s && (k === 'B' || k === 'b')) return run(() => { if (!t) return; t.broadcast = !t.broadcast; for (const p of panesIn(t.root)) p.bc.hidden = !t.broadcast; renderStatus(); });
    if (c && s && (k === 'F' || k === 'f')) return run(openFind);
    if (c && s && /^Digit[1-9]$/.test(e.code)) return run(() => { const p = profiles[+e.code.slice(5) - 1]; if (p) newTab(p.id); });
    if (c && s && (k === 'P' || k === 'p')) return run(openPalette);
    if (c && s && (k === 'S' || k === 's')) return run(() => $('#sideBtn').click());
    if (c && !s && k === ',') return run(openSettings);
    if (c && k === 'Tab') return run(() => { if (tabs.length > 1) activate(tabs[(tabs.indexOf(t) + (s ? tabs.length - 1 : 1)) % tabs.length]); });
    if (c && !s && !a && /^[1-9]$/.test(k)) return run(() => { const x = tabs[Math.min(+k - 1, tabs.length - 1)]; if (x) activate(x); });
    if (c && !s && (k === '=' || k === '+')) return run(() => setFont(fontSize + 1));
    if (c && !s && k === '-') return run(() => setFont(fontSize - 1));
    if (c && !s && k === '0') return run(() => setFont(14));
    if (a && !c && k.startsWith('Arrow')) return run(() => moveFocus(k.slice(5).toLowerCase()));
    if (k === 'F1') return run(() => toggle($('#help')));
    if (k === 'F2') return run(() => t && rename(t));
    return false;
  }
  addEventListener('keydown', (e) => { if (e.target.closest && e.target.closest('.xterm')) return; if (/INPUT|SELECT/.test(e.target.tagName)) return; globalKey(e); });
  function setFont(n) { fontSize = Math.min(28, Math.max(9, n)); for (const p of panes.values()) { p.term.options.fontSize = fontSize; safeFit(p); } save(); }
  const toggle = (n) => { n.hidden = !n.hidden; };

  // ---------- find ----------
  function openFind() {
    const box = $('#find'), inp = $('#findInput'); box.hidden = false; inp.focus(); inp.select();
    const p = () => active && panes.get(active.focus);
    const opts = { decorations: { matchOverviewRuler: '#f5b84b', activeMatchColorOverviewRuler: '#3DF28C', matchBackground: '#4a3d1c', activeMatchBackground: '#1f5a3b' } };
    inp.oninput = () => { const q = p(); if (q) q.search.findNext(inp.value, { ...opts, incremental: true }); };
    inp.onkeydown = (e) => {
      const q = p(); if (!q) return;
      if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? q.search.findPrevious(inp.value, opts) : q.search.findNext(inp.value, opts); }
      if (e.key === 'Escape') { box.hidden = true; q.search.clearDecorations(); q.term.focus(); }
    };
  }

  // ---------- new-tab menu ----------
  function showMenu(anchor) {
    const m = $('#menu'); m.textContent = '';
    profiles.forEach((p, i) => {
      const b = el('button', '', `<span class="pi">${picon(p)}</span><span>${i === 0 ? '<b>' + esc(p.name) + '</b>' : esc(p.name)}</span>${i < 9 ? `<span class="k">Ctrl+Shift+${i + 1}</span>` : ''}`);
      b.onclick = () => { m.hidden = true; newTab(p.id); }; m.append(b);
    });
    m.append(el('hr'));
    const item = (icon, label, key, fn) => { const b = el('button', '', `<span class="pi">${icon}</span><span>${label}</span><span class="k">${key}</span>`); b.onclick = () => { m.hidden = true; fn(); }; m.append(b); };
    item('<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>', 'Settings', 'Ctrl+,', openSettings);
    item('<svg viewBox="0 0 16 16" width="14" height="14"><path d="M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>', 'Command palette', 'Ctrl+Shift+P', openPalette);
    item('<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 7.5V11M8 5v.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>', 'Shortcuts', 'F1', () => toggle($('#help')));
    const r = anchor.getBoundingClientRect();
    m.style.left = Math.min(r.left, innerWidth - 300) + 'px'; m.style.top = r.bottom + 4 + 'px'; m.hidden = false;
    m.querySelector('button')?.focus();
  }

  // ---------- command palette ----------
  function commands() {
    const t = active, f = t && t.focus;
    return [
      ...profiles.map((p) => ({ name: `New tab: ${p.name}`, key: '', run: () => newTab(p.id) })),
      { name: 'Split pane right', key: 'Ctrl+Shift+D', run: () => f && split(f, 'row') },
      { name: 'Split pane down', key: 'Ctrl+Shift+E', run: () => f && split(f, 'col') },
      { name: 'Close pane', key: 'Ctrl+Shift+W', run: () => f && closePane(f) },
      { name: 'Zoom pane', key: 'Ctrl+Shift+Z', run: toggleZoom },
      { name: 'Toggle broadcast input', key: 'Ctrl+Shift+B', run: () => globalKey(new KeyboardEvent('keydown', { key: 'B', ctrlKey: true, shiftKey: true })) },
      { name: 'Find in pane', key: 'Ctrl+Shift+F', run: openFind },
      { name: 'Rename tab', key: 'F2', run: () => t && rename(t) },
      { name: 'Clear pane', key: '', run: () => { const p = f && panes.get(f); if (p) p.term.clear(); } },
      { name: 'Toggle sidebar', key: 'Ctrl+Shift+S', run: () => $('#sideBtn').click() },
      { name: 'Settings', key: 'Ctrl+,', run: openSettings },
      { name: 'Quit and end all terminals', key: '', run: () => { try { saveFull(true); } catch {} H.quit(); } },
      { name: 'Shortcuts', key: 'F1', run: () => toggle($('#help')) },
    ];
  }
  function openPalette() {
    const box = $('#palette'), inp = $('#palInput'), list = $('#palList');
    let sel = 0, shown = [];
    const draw = () => {
      const q = inp.value.toLowerCase().trim();
      shown = commands().filter((c) => !q || q.split(/\s+/).every((w) => c.name.toLowerCase().includes(w)));
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      list.innerHTML = shown.map((c, i) => `<div role="option" aria-selected="${i === sel}" data-i="${i}"><span>${esc(c.name)}</span><small>${esc(c.key)}</small></div>`).join('');
    };
    const run = (i) => { const c = shown[i]; close(); if (c) c.run(); };
    const close = () => { box.hidden = true; const p = active && panes.get(active.focus); if (p) p.term.focus(); };
    inp.value = ''; sel = 0; draw(); box.hidden = false; inp.focus();
    inp.oninput = () => { sel = 0; draw(); };
    inp.onkeydown = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    };
    list.onclick = (e) => { const d = e.target.closest('[data-i]'); if (d) run(+d.dataset.i); };
    inp.onblur = () => setTimeout(() => { if (!box.contains(document.activeElement)) box.hidden = true; }, 120);
  }

  // ---------- settings ----------
  let notifyOn = true, defaultProfile = null, soundOn = true, lineHeight = 1.15;
  async function openSettings() {
    const st = await H.settings();
    $('#ver').textContent = 'Version ' + st.version;
    $('#optStartup').checked = !!st.startup;
    $('#optFont').value = fontSize;
    $('#optNotify').checked = notifyOn;
    $('#optSound').checked = soundOn; $('#optLine').value = lineHeight;
    $('#optBg').checked = st.background; $('#optUpd').checked = st.updates;
    const sel = $('#optDefault'); sel.innerHTML = profiles.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    sel.value = defaultProfile || (profiles[0] && profiles[0].id);
    $('#settings').hidden = false;
  }
  function closeSettings() { $('#settings').hidden = true; const p = active && panes.get(active.focus); if (p) p.term.focus(); }

  addEventListener('mousedown', (e) => {
    const m = $('#menu'); if (!m.hidden && !m.contains(e.target) && e.target.id !== 'newMenuBtn') m.hidden = true;
    const h = $('#help'); if (!h.hidden && !h.contains(e.target) && !e.target.closest('#menu')) h.hidden = true;
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('#menu').hidden = true; $('#help').hidden = true; if (!$('#settings').hidden) closeSettings(); } });

  // ---------- persistence ----------
  let saveTimer = 0, reviveAt = 0;
  function serialize(node, buf) {
    if (node.t === 'split') return { t: 'split', dir: node.dir, r: node.r, a: serialize(node.a, buf), b: serialize(node.b, buf) };
    const p = panes.get(node.id); const o = { t: 'pane', profileId: p.profileId, cwd: p.cwd };
    if (buf && p.opened) { try { o.buffer = p.ser.serialize({ scrollback: 1500 }); } catch {} }
    return o;
  }
  const snapshot = (withBuffers) => ({ v: 1, fontSize, notifyOn, defaultProfile, soundOn, lineHeight, sideOn, active: tabs.indexOf(active), tabs: tabs.map((t) => ({ title: t.title, custom: t.custom, root: serialize(t.root, withBuffers) })) });
  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { saveFull(false); } catch {} }, 600); }
  // Terminal contents are saved when the window closes and every 2 minutes, so a crash loses little.
  const saveFull = (sync) => { const s = snapshot(true); s.at = Date.now(); sync ? H.saveSessionNow(s) : H.saveSession(s); };
  addEventListener('beforeunload', () => { try { saveFull(true); } catch {} });
  addEventListener('blur', () => { try { saveFull(false); } catch {} });
  setInterval(() => { try { saveFull(false); } catch {} }, 30000);
  function revive(node) {
    if (node.t === 'pane') { const p = makePane(node.profileId, node.cwd, { buffer: typeof node.buffer === 'string' ? node.buffer : '', at: reviveAt }); return { t: 'pane', id: p.id }; }
    return { t: 'split', dir: node.dir === 'col' ? 'col' : 'row', r: Math.min(0.9, Math.max(0.1, +node.r || 0.5)), a: revive(node.a), b: revive(node.b) };
  }

  // ---------- boot ----------
  async function boot() {
    profiles = await H.profiles();
    $('#newTab').onclick = () => newTab();
    $('#newMenuBtn').onclick = (e) => showMenu(e.currentTarget);
    $('#setClose').onclick = closeSettings;
    $('#sideQ').oninput = () => renderSide();
    $('#settings').addEventListener('mousedown', (e) => { if (e.target.id === 'settings') closeSettings(); });
    $('#optStartup').onchange = async (e) => { e.target.checked = await H.setStartup(e.target.checked); };
    $('#optFont').onchange = (e) => setFont(+e.target.value || 14);
    $('#optNotify').onchange = (e) => { notifyOn = e.target.checked; save(); };
    $('#optSound').onchange = (e) => { soundOn = e.target.checked; save(); };
    $('#optLine').onchange = (e) => { lineHeight = Math.min(1.6, Math.max(1, +e.target.value || 1.15)); for (const p of panes.values()) { p.term.options.lineHeight = lineHeight; safeFit(p); } save(); };
    $('#optBg').onchange = async (e) => { e.target.checked = await H.setSetting('background', e.target.checked); };
    $('#optUpd').onchange = async (e) => { e.target.checked = await H.setSetting('updates', e.target.checked); };
    $('#sideBtn').onclick = () => { sideOn = !sideOn; renderSide(); save(); setTimeout(() => { if (active) panesIn(active.root).forEach(scheduleFit); }, 30); };
    H.onUpdate((v) => { const s = $('#upd'); s.hidden = false; s.querySelector('b').textContent = v; });
    $('#updBtn').onclick = () => { try { saveFull(true); } catch {} H.restartToUpdate(); };
    $('#optDefault').onchange = (e) => { defaultProfile = e.target.value; save(); };
    $('#repoLink').onclick = (e) => { e.preventDefault(); H.open('https://github.com/chsxthwik/SWARMUX'); };
    H.onSaveNow(() => { try { saveFull(true); } catch {} });
    addEventListener('resize', () => { if (active) for (const p of panesIn(active.root)) scheduleFit(p); });
    window.addEventListener('focus', () => { if (active) focusPane(active.focus, true); });
    const s = await H.loadSession();
    if (s && s.v === 1 && Array.isArray(s.tabs) && s.tabs.length) {
      fontSize = Math.min(28, Math.max(9, +s.fontSize || 14)); reviveAt = s.at; if (s.notifyOn === false) notifyOn = false; if (s.soundOn === false) soundOn = false; if (s.sideOn === false) sideOn = false; if (+s.lineHeight) lineHeight = Math.min(1.6, Math.max(1, +s.lineHeight)); if (s.defaultProfile && profiles.some((p) => p.id === s.defaultProfile)) defaultProfile = s.defaultProfile;
      for (const st of s.tabs) {
        try {
          const root = revive(st.root);
          const t = { id: uid(), title: st.title || 'Shell', custom: !!st.custom, root, focus: panesIn(root)[0].id, zoom: null, broadcast: false, el: el('div', 'ws') };
          t.el.hidden = true; $('#stage').append(t.el); tabs.push(t);
        } catch {}
      }
      if (tabs.length) { activate(tabs[Math.min(Math.max(0, s.active | 0), tabs.length - 1)]); for (const t of tabs) if (t !== active) { renderTab(t); } activate(active); setTimeout(() => { focusPane(active.focus); renderStatus(); }, 300); return; }
    }
    newTab();
  }
  boot().catch((e) => console.error("BOOT", e.stack));
})();
