const { contextBridge, ipcRenderer } = require("electron");

// CCDPH-FIX(NIT-1): on* 注册的 ipcRenderer.on 监听器原来没有任何取消手段 —— 渲染层只要在
// 某条热路径上重新注册一次（重新初始化、重新挂载），同一个事件就会被处理 N 次。
// 这里用 channel -> (回调 -> 真实监听器) 的映射记住包装函数，并为每个 on* 配一个对应的
// off*；on* 的调用方式和返回值语义不变（返回值仍未被使用），新增的 off* 是纯增量 API。
const listenersByChannel = new Map();
function subscribe(channel, callback) {
  if (typeof callback !== "function") return;
  const wrapped = (_event, ...args) => callback(...args);
  let byCallback = listenersByChannel.get(channel);
  if (!byCallback) {
    byCallback = new WeakMap();
    listenersByChannel.set(channel, byCallback);
  }
  // 同一个回调重复注册时先移除旧的，避免叠加
  const previous = byCallback.get(callback);
  if (previous) ipcRenderer.removeListener(channel, previous);
  byCallback.set(callback, wrapped);
  ipcRenderer.on(channel, wrapped);
}
function unsubscribe(channel, callback) {
  const byCallback = listenersByChannel.get(channel);
  const wrapped = byCallback?.get(callback);
  if (!wrapped) return;
  ipcRenderer.removeListener(channel, wrapped);
  byCallback.delete(callback);
}

contextBridge.exposeInMainWorld("workbenchDesktop", {
  toggleFullscreen: () => ipcRenderer.invoke("toggle-fullscreen"),
  approvalResolved: (requestId) =>
    ipcRenderer.send("approval-resolved", requestId),
  onFullscreenChange: (callback) => subscribe("fullscreen-change", callback),
  offFullscreenChange: (callback) => unsubscribe("fullscreen-change", callback),
  onNativeApproval: (callback) => subscribe("native-approval", callback),
  offNativeApproval: (callback) => unsubscribe("native-approval", callback),
  onNativeApprovalResolved: (callback) =>
    subscribe("native-approval-resolved", callback),
  offNativeApprovalResolved: (callback) =>
    unsubscribe("native-approval-resolved", callback),
  quitForUpdate: () => ipcRenderer.send("quit-for-update"),
});
contextBridge.exposeInMainWorld("workbenchApproval", {
  submit: (payload) => ipcRenderer.send("approval-action", payload),
});
