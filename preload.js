// preload.js

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startAutomation: (data) => ipcRenderer.invoke('start-automation', data),
  loginAndOpenPortal: (data) => ipcRenderer.invoke('login-and-open-portal', data),
  stopAutomation: () => ipcRenderer.invoke('stop-automation'),
  playSound: (type) => ipcRenderer.invoke('play-sound', type),
  setSoundEnabled: (enabled) => ipcRenderer.invoke('set-sound-enabled', enabled),
  onStatusUpdate: (callback) => ipcRenderer.on('status-update', callback),
  onCourseRegistered: (callback) => ipcRenderer.on('course-registered', callback),
  onCourseBlocked: (callback) => ipcRenderer.on('course-blocked', callback),
  onError: (callback) => ipcRenderer.on('automation-error', callback),
  onDone: (callback) => ipcRenderer.on('automation-done', callback),
});
