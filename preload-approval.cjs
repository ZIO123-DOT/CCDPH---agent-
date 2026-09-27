// CCDPH-FIX(R3-P3-15): 审批小窗的最小 preload。小窗唯一需要的能力就是提交一次审批决定
//（approval-action）。此前它复用主窗的 preload.cjs，等于把主窗全套桥（toggleFullscreen /
// quitForUpdate / approvalResolved / 事件订阅）都暴露给了这个用 data: URL 载入的窗口。
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("workbenchApproval", {
  submit: (payload) => ipcRenderer.send("approval-action", payload),
});
