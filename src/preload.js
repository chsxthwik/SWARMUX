'use strict';
const { contextBridge, ipcRenderer, clipboard } = require('electron');
const dataSubs = new Set(), exitSubs = new Set();
ipcRenderer.on('pty:data', (_e, id, d) => { for (const f of dataSubs) f(id, d); });
ipcRenderer.on('pty:exit', (_e, id, c) => { for (const f of exitSubs) f(id, c); });
contextBridge.exposeInMainWorld('swarmux', {
  create: (o) => ipcRenderer.invoke('pty:create', o),
  write: (id, d) => ipcRenderer.send('pty:write', id, d),
  resize: (id, c, r) => ipcRenderer.send('pty:resize', id, c, r),
  kill: (id) => ipcRenderer.send('pty:kill', id),
  onData: (f) => { dataSubs.add(f); },
  onExit: (f) => { exitSubs.add(f); },
  profiles: () => ipcRenderer.invoke('app:profiles'),
  loadSession: () => ipcRenderer.invoke('state:get'),
  saveSession: (s) => ipcRenderer.send('state:set', s),
  saveSessionNow: (s) => ipcRenderer.sendSync('state:set-sync', s),
  notify: (t, b) => ipcRenderer.send('app:notify', t, b),
  open: (u) => ipcRenderer.send('app:open', u),
  settings: () => ipcRenderer.invoke('settings:get'),
  setStartup: (on) => ipcRenderer.invoke('settings:startup', on),
  onSaveNow: (f) => { ipcRenderer.on('app:save-now', () => f()); },
  copy: (t) => clipboard.writeText(t),
  paste: () => clipboard.readText(),
});
