const { contextBridge, ipcRenderer } = require("electron");

// CCDPH-FIX(NIT-1): on* 注册的 ipcRenderer.on 监听器原来没有任何取消手段 —— 渲染层只要在
// 某条热路径上重新注册一次（重新初始化、重新挂载），同一个事件就会被处理 N 次。
//
// CCDPH-FIX(P2-11): 原来用 WeakMap<回调, 包装函数> 去重，但 contextBridge **每次跨桥传递的
// 回调在渲染层不保证是同一个对象**（身份可能不同），于是 off* 取不到包装函数而**静默失效**，
// bfcache 恢复后监听器叠加、同一条指令被处理多次。
// 改为**每个 channel 只保留一个包装监听器**：subscribe 先移除旧的，off* 按 channel 移除。
// 应用实际就是每通道一个处理器（handleAppCommand / setFullscreen / …），语义与用法一致。
const wrappedByChannel = new Map();
function subscribe(channel, callback) {
  if (typeof callback !== "function") return;
  unsubscribe(channel);
  const wrapped = (_event, ...args) => callback(...args);
  wrappedByChannel.set(channel, wrapped);
  ipcRenderer.on(channel, wrapped);
}
function unsubscribe(channel) {
  const wrapped = wrappedByChannel.get(channel);
  if (!wrapped) return;
  ipcRenderer.removeListener(channel, wrapped);
  wrappedByChannel.delete(channel);
}

contextBridge.exposeInMainWorld("workbenchDesktop", {
  toggleFullscreen: () => ipcRenderer.invoke("toggle-fullscreen"),
  approvalResolved: (requestId) =>
    ipcRenderer.send("approval-resolved", requestId),
  onFullscreenChange: (callback) => subscribe("fullscreen-change", callback),
  offFullscreenChange: () => unsubscribe("fullscreen-change"),
  onAppCommand: (callback) => subscribe("app-command", callback),
  offAppCommand: () => unsubscribe("app-command"),
  onNativeApproval: (callback) => subscribe("native-approval", callback),
  offNativeApproval: () => unsubscribe("native-approval"),
  onNativeApprovalResolved: (callback) =>
    subscribe("native-approval-resolved", callback),
  offNativeApprovalResolved: () => unsubscribe("native-approval-resolved"),
  quitForUpdate: () => ipcRenderer.send("quit-for-update"),
});
contextBridge.exposeInMainWorld("workbenchApproval", {
  submit: (payload) => ipcRenderer.send("approval-action", payload),
});
