const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('curtainUpdater', {
  platform: 'windows',
  installUpdate: (payload) => ipcRenderer.invoke('desktop-update:install', payload),
});

window.addEventListener('DOMContentLoaded', () => {
  const replaceText = (selector, text) => {
    const element = document.getElementById(selector);
    if (element) element.innerText = text;
  };

  for (const type of ['chrome', 'node', 'electron']) {
    replaceText(`${type}-version`, process.versions[type]);
  }
});
