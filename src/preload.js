const { contextBridge, ipcRenderer } = require('electron');

const SEND = new Set(['state:set', 'cmd', 'overlay:status', 'library', 'models']);
const RECEIVE = new Set(['state', 'status', 'cmd', 'locked', 'timer', 'models']);

contextBridge.exposeInMainWorld('ontop', {
  platform: process.platform,
  send(channel, data) {
    if (SEND.has(channel)) ipcRenderer.send(channel, data);
  },
  on(channel, cb) {
    if (RECEIVE.has(channel)) ipcRenderer.on(channel, (_e, data) => cb(data));
  },
});
