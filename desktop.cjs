const {
  app,
  BrowserWindow,
  dialog,
  Menu,
  Notification,
  nativeTheme,
  shell,
  session,
  ipcMain,
  screen,
  Tray,
  nativeImage,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const { createHash, timingSafeEqual } = require("node:crypto");
const ICON_DIR = path.join(__dirname, "build");
let window,
  engine,
  server,
  tray,
  quitting = false,
  trustedOrigin = "";
let fatalMainProcessError = false;
function handleFatalMainProcessError(kind, error) {
  console.error(`[ccdph] 主进程${kind}:`, error?.stack || error);
  if (fatalMainProcessError) return;
  fatalMainProcessError = true;
  process.exitCode = 1;
  try {
    app.quit();
  } catch {
    process.exit(1);
  }
  setTimeout(() => process.exit(1), 5000).unref?.();
}
process.on("uncaughtException", (error) =>
  handleFatalMainProcessError("未捕获异常", error),
);
process.on("unhandledRejection", (reason) =>
  handleFatalMainProcessError("未处理 Promise 拒绝", reason),
);
const approvalWindows = new Map();
// CCDPH-FIX(ELE-2): 已经做出决定（按钮提交 / 渲染层自己处理 / 应用退出）的审批小窗。
// 小窗关闭时只有不在这里的窗口才需要把审批权交还渲染层，避免审批完成后卡片又被弹回来。
const settledApprovalWindows = new WeakSet();
// IPC 发送方校验：只接受主窗口（受信 origin）或审批小窗（data:text/html 页面）。
// 审批小窗本身就是用 data: URL 载入的，必须仍然能提交。
function trustedSender(event) {
  const url = event.senderFrame?.url || "";
  // 1) 主窗口 / 本地服务同源页面
  try {
    if (new URL(url).origin === trustedOrigin) return true;
  } catch {}
  // CCDPH-FIX(D4): 原实现只判断 URL 是否以 "data:text/html" 开头，等于放行渲染层自己
  // window.open 出来的任意 data: 页面。收紧为：必须是**已登记的审批小窗**且在 mainFrame
  //（小窗在 showApprovalWindow 创建时写入 approvalWindows）。
  if (event.senderFrame !== event.sender.mainFrame) return false;
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow) return false;
  for (const win of approvalWindows.values()) if (win === senderWindow) return true;
  return false;
}
// Keep the portable app's user data next to the executable, inside the app folder.
const portableRoot = app.isPackaged
  ? path.dirname(process.execPath)
  : __dirname;
async function verifyPackagedRuntime() {
  if (!app.isPackaged) return true;
  const manifestFile = path.join(__dirname, "runtime-integrity.json");
  try {
    const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
    if (!Array.isArray(manifest.files) || !manifest.files.length)
      throw new Error("完整性清单为空");
    for (const item of manifest.files) {
      const relative = String(item?.path || "").replace(/\\/g, "/");
      if (!relative || relative.startsWith("/") || relative.split("/").includes(".."))
        throw new Error("完整性清单包含非法路径");
      const expectedHex = String(item?.sha256 || "");
      if (!/^[0-9a-f]{64}$/i.test(expectedHex))
        throw new Error(`完整性清单哈希无效：${relative}`);
      const actual = createHash("sha256")
        .update(await fs.readFile(path.join(__dirname, relative)))
        .digest();
      const expected = Buffer.from(expectedHex, "hex");
      if (!timingSafeEqual(actual, expected))
        throw new Error(`运行时文件校验失败：${relative}`);
    }
    return true;
  } catch (error) {
    console.error("[ccdph] 运行时完整性校验失败:", error?.message || error);
    return false;
  }
}
app.setPath("userData", path.join(portableRoot, ".desktop-data"));
process.env.WORKBENCH_DATA_DIR = path.join(portableRoot, ".data");
// 让本地服务知道自己在桌面版里运行（自动更新等能力依赖此标记）
process.env.WORKBENCH_DESKTOP = "1";

if (!app.requestSingleInstanceLock()) app.quit();
else {
  ipcMain.handle("toggle-fullscreen", (event) => {
    if (!trustedSender(event)) return false;
    if (!window || window.isDestroyed()) return false;
    const enabled = !window.isFullScreen();
    window.setFullScreen(enabled);
    return enabled;
  });
  ipcMain.on("quit-for-update", (event) => {
    if (!trustedSender(event)) return;
    // 自动更新：bat 脚本会等进程退出后替换文件并重启
    quitting = true;
    app.quit();
  });
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      if (!(await verifyPackagedRuntime())) {
        dialog.showErrorBox("CCDPH 启动被阻止", "运行时文件完整性校验失败，程序文件可能已损坏或被篡改。\n请重新部署最新版本。");
        app.quit();
        return;
      }
      // 桌面快捷方式自维护：每次启动用 Electron 原生接口确保桌面有正确的 CCDPH.lnk
      // （target 指向本 exe、图标用 ccdph.ico；手写/第三方创建的坏快捷方式会被自动修正）
      try {
        const desktopDir = app.getPath("desktop");
        shell.writeShortcutLink(path.join(desktopDir, "CCDPH.lnk"), "create", {
          target: process.execPath,
          cwd: portableRoot,
          icon: fsSync.existsSync(path.join(portableRoot, "ccdph.ico"))
            ? path.join(portableRoot, "ccdph.ico")
            : path.join(ICON_DIR, "icon.ico"),
          iconIndex: 0,
          description: "CCDPH Claude Code 工作台",
        });
      } catch (error) {
        console.error("[ccdph] 创建桌面快捷方式失败：", error.message);
      }
      engine = await import("./server.mjs");
      server = await engine.start();
      // CCDPH-FIX(BR-5): 启动时清扫上一次**异常退出**（崩溃 / 被任务管理器强杀 / 关机）残留的
      // 专用 Edge —— 那种情况下退出流程没有机会执行，带着登录态的 profile 和无鉴权的调试端口
      // 会一直活着，而新一次启动用同一个 profileDir 只会把命令行转发给它然后自己退出，
      // 于是「已启动」的浏览器其实监听在旧端口上，状态页只会显示未连接。
      // 放在 start() 之后：此时 WORKBENCH_DATA_DIR 已由本文件设好，与 server.mjs 同目录。
      try {
        const browserService = await import("./browser/service.mjs");
        await browserService.sweepStaleDedicatedEdge();
      } catch (error) {
        console.error("[ccdph] 专用浏览器残留清扫失败：", error.message);
      }
      const darkWindow = nativeTheme.shouldUseDarkColors;
      window = new BrowserWindow({
        width: 1440,
        height: 940,
        minWidth: 800,
        minHeight: 620,
        title: "CCDPH",
        icon: path.join(ICON_DIR, "icon.ico"),
        // 隐藏原生标题栏，用 titleBarOverlay 保留 Windows 原生窗口按钮，
        // 页面顶部栏作为拖拽区（见 style.css 的 body.electron 规则）。
        titleBarStyle: "hidden",
        titleBarOverlay: {
          color: darkWindow ? "#1a1a19" : "#f5f5f4",
          symbolColor: darkWindow ? "#f1f1ef" : "#181817",
          height: 36,
        },
        // 与页面首帧主题底色一致（style.css --bg），避免启动时白→米色闪屏
        backgroundColor: darkWindow ? "#161310" : "#f7f5f0",
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
        },
      });
      const syncOverlayTheme = () => {
        if (!window || window.isDestroyed()) return;
        const dark = nativeTheme.shouldUseDarkColors;
        try {
          window.setTitleBarOverlay({
            color: dark ? "#1a1a19" : "#f5f5f4",
            symbolColor: dark ? "#f1f1ef" : "#181817",
          });
        } catch {}
        window.setBackgroundColor(dark ? "#161310" : "#f7f5f0");
      };
      nativeTheme.on("updated", syncOverlayTheme);
      // CCDPH-FIX(ELE-7): 这个监听器原来永不解除。今天窗口只创建一次，所以只是潜在泄漏；
      // 但一旦窗口被销毁（closeToTray=false 退出，或将来支持重建窗口），监听器仍会持有已
      // 销毁的窗口并每次主题变化白跑一遍。这里跟窗口生命周期绑定：窗口关闭即解绑。
      window.once("closed", () => {
        try {
          nativeTheme.removeListener("updated", syncOverlayTheme);
        } catch { }
      });
      const showMainWindow = () => {
        if (!window || window.isDestroyed()) return;
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
      };
      // 托盘用应用自带的高分辨率透明 PNG（圆角外全透明，不会出现白色一圈），
      // 文件缺失时退回系统从 exe 提取的图标。
      const trayImage = nativeImage.createFromPath(
        path.join(ICON_DIR, "tray.png"),
      );
      tray = new Tray(
        trayImage.isEmpty()
          ? await app.getFileIcon(process.execPath, { size: "small" })
          : trayImage,
      );
      tray.setToolTip("CCDPH");
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: "打开 CCDPH", click: showMainWindow },
          { type: "separator" },
          {
            label: "退出",
            click: () => {
              quitting = true;
              app.quit();
            },
          },
        ]),
      );
      tray.on("double-click", showMainWindow);
      trustedOrigin = new URL(engine.getRuntime().url).origin;
      // D-01 修复：Electron 把 navigator.clipboard.writeText() 的授权走这两个处理器的
      // clipboard-sanitized-write 权限。原来无条件 callback(false) / 返回 false，
      // 等于连本应用自己的受信页面也拒绝，导致桌面版所有「复制」入口永久失效
      //（实测真实 Electron 下 writeText 抛 NotAllowedError，系统剪贴板无变化）。
      // 只放行来自 trustedOrigin 的剪贴板写入，其余（含剪贴板读取等）一律拒绝。
      const allowClipboardWrite = (wc, permission) =>
        permission === "clipboard-sanitized-write" &&
        (() => {
          try {
            return new URL(wc?.getURL?.() || "").origin === trustedOrigin;
          } catch {
            return false;
          }
        })();
      session.defaultSession.setPermissionRequestHandler((wc, permission, callback) =>
        callback(allowClipboardWrite(wc, permission)),
      );
      session.defaultSession.setPermissionCheckHandler((wc, permission) =>
        allowClipboardWrite(wc, permission),
      );
      window.webContents.setWindowOpenHandler(({ url }) => {
        // Only normal web links can leave the desktop window.
        try {
          if (/^https?:\/\//i.test(url) && new URL(url).origin !== trustedOrigin)
            void shell.openExternal(url);
        } catch {
          // 畸形 URL：new URL 会抛，保持 deny，绝不放行
        }
        return { action: "deny" };
      });
      // CCDPH-FIX(ELE-6): 顶层导航守卫抽成一个函数，will-navigate（页面发起的导航）和
      // will-redirect（主框架 3xx 重定向）都要过同一道 origin 校验。
      // 原实现只挂了 will-navigate，而主框架的 HTTP 3xx 走的是 will-redirect —— 一次重定向
      // 就能把这个无边框、无标题栏的窗口换成任意 https 页面（可信 origin 之外的钓鱼面）。
      const guardTopLevelNavigation = (event, url) => {
        try {
          if (new URL(url).origin !== trustedOrigin) event.preventDefault();
        } catch {
          // 畸形 URL：new URL 会抛，此时也必须拦截导航
          event.preventDefault();
        }
      };
      window.webContents.on("will-navigate", guardTopLevelNavigation);
      window.webContents.on("will-redirect", guardTopLevelNavigation);
      engine.setFolderPicker(async () => {
        const result = await dialog.showOpenDialog(window, {
          title: "选择项目文件夹",
          properties: ["openDirectory"],
        });
        return result.canceled ? "" : result.filePaths[0];
      });
      engine.setFilePicker(async () => {
        const result = await dialog.showOpenDialog(window, {
          title: "选择 Claude Code 可执行文件",
          properties: ["openFile"],
          filters: [{ name: "Claude Code", extensions: ["exe", "cmd", "bat"] }],
        });
        return result.canceled ? "" : result.filePaths[0];
      });
      engine.setPathOpener(async (target) => {
        let stat;
        try { stat = await fs.stat(target); } catch { return; }
        if (stat.isDirectory()) return shell.openPath(target);
        shell.showItemInFolder(target);
      });
      // CCDPH-FIX(F2): 浏览器内部 URL（edge://inspect）必须走 openExternal，
      // 不能塞进上面的文件系统 opener（会 ENOENT），故单独提供一个外部协议 opener。
      engine.setExternalOpener(async (url) => shell.openExternal(url));
      const showApprovalWindow = (payload) => {
        if (!payload?.requestId || approvalWindows.has(payload.requestId))
          return;
        const popup = new BrowserWindow({
          width: 340,
          height: payload.tool === "AskUserQuestion" ? 380 : 205,
          resizable: true,
          frame: false,
          transparent: true,
          alwaysOnTop: true,
          skipTaskbar: true,
          show: false,
          backgroundColor: "#00000000",
          webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          },
        });
        approvalWindows.set(payload.requestId, popup);
        const loadTimeout = setTimeout(() => {
          // CCDPH-FIX(ELE-2): 10 秒内没能显示出来即视为加载失败，必须先交还审批权再销毁小窗
          if (!popup.isDestroyed() && !popup.isVisible()) {
            handBackToRenderer();
            popup.destroy();
          }
        }, 10000);
        loadTimeout.unref?.();
        // CCDPH-FIX(ELE-2): 小窗超时/加载失败/被直接关掉时，渲染层此前已经收到 native-approval
        // 并把会话内审批卡片隐藏了；如果这里不通知回去，两个审批界面都会消失，而 server 侧
        // pending 的 Promise 没有别的 resolver，任务会一直挂起直到用户点停止。这里用既有的
        // native-approval-resolved 通道把审批权交还渲染层（渲染层会把它从 nativeApprovalIds
        // 移除并重新渲染会话内的审批卡片），保证任何时刻恰好有一个可见的审批入口。
        let handedBack = false;
        const handBackToRenderer = () => {
          if (handedBack) return;
          handedBack = true;
          clearTimeout(loadTimeout);
          approvalWindows.delete(payload.requestId);
          if (!window || window.isDestroyed()) return;
          try {
            window.webContents.send("native-approval-resolved", payload.requestId);
          } catch (error) {
            console.error("[ccdph] 审批小窗回退到会话内卡片失败：", error.message);
          }
        };
        const serialized = JSON.stringify(payload)
          .replace(/</g, "\\u003c")
          .replace(/>/g, "\\u003e")
          .replace(/\u2028/g, "\\u2028")
          .replace(/\u2029/g, "\\u2029");
        const html = `<!doctype html><meta charset="utf-8"><style>
          *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:transparent}body{padding:6px;font:12px 'Segoe UI','Microsoft YaHei UI',sans-serif;color:#f1f1ed}.card{height:100%;padding:12px;border:1px solid #4a4a47;border-radius:11px;background:#242422;box-shadow:0 14px 38px rgba(0,0,0,.48);overflow-y:auto}.head{display:flex;align-items:center;gap:8px}.glyph{display:grid;place-items:center;width:22px;height:22px;border-radius:6px;background:#f0f0ec;color:#171716;font-size:11px;font-weight:700}.title{font-size:12px;font-weight:650}.subtitle{margin:3px 0 8px;color:#a7a7a0;font-size:9px}.tool{display:flex;align-items:center;gap:6px;padding:7px 8px;border:1px solid #3b3b38;border-radius:7px;background:#191918;color:#d9d9d4;font:10px Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tool::before{content:'●';color:#8eb48f;font-size:8px}.detail{margin-top:5px;padding:4px 7px;border:1px solid #3b3b38;border-radius:7px;background:#191918;color:#e6e6e0;font:10px/1.4 Consolas,monospace;white-space:pre-wrap;word-break:break-all;max-height:40px;overflow-y:auto}label{display:block;margin:7px 0 3px;color:#c9c9c2;font-size:10px}input{width:100%;padding:6px;border:1px solid #4a4a47;border-radius:6px;background:#191918;color:#f1f1ed;font:11px 'Segoe UI'}.actions{display:flex;justify-content:flex-end;gap:6px;margin-top:10px}button{border:1px solid #4a4a47;border-radius:7px;padding:6px 11px;background:#2d2d2a;color:#e4e4df;cursor:pointer;font:600 10px 'Segoe UI'}button.primary{background:#f0f0ec;color:#171716;border-color:#f0f0ec}button:disabled{opacity:.5}
        </style><div class="card"><div class="head"><div class="glyph">C</div><div class="title">Claude 需要你的确认</div></div><div class="subtitle" id="summary">将在当前项目中执行一个操作</div><div class="tool" id="tool"></div><div class="detail" id="detail" hidden></div><div id="questions"></div><div class="actions"><button id="deny">拒绝</button><button class="primary" id="allow">批准</button></div></div><script>
          const payload=${serialized}; document.getElementById('summary').textContent=payload.title||'将在当前项目中执行一个操作'; const input=payload.input||{};
          // CCDPH-FIX(ELE-1): 旧代码是 payload.tool||input.command||input.file_path，而 tool 恒为真
          //（"shell"/"Bash"/"write_file"…），|| 链短路后用户只看得到工具名，看不到真正要批准的
          // 命令、脚本、路径或上传目标。改为：工具名单独一行，详情区展示决策相关的载荷 + 其余参数
          // 的紧凑 JSON；全部走 textContent（绝不拼 HTML）；超过 700 字符截断并显式标注。
          document.getElementById('tool').textContent=payload.tool||'工具请求';
          const detailLimit=700; const clipDetail=(value)=>{const text=String(value==null?'':value).replace(/\\r\\n?/g,'\\n').trim(); return text.length>detailLimit?text.slice(0,detailLimit)+'…（已截断）':text;};
          const primary=[['command','命令'],['script','脚本'],['file_path','文件'],['path','路径'],['url','网址']].find(([key])=>typeof input[key]==='string'&&input[key].trim());
          const rest={}; for(const key of Object.keys(input)) if(!primary||key!==primary[0]) rest[key]=input[key]; delete rest.questions;
          const detailParts=[]; if(primary) detailParts.push(primary[1]+'：'+input[primary[0]]); if(Object.keys(rest).length) detailParts.push(JSON.stringify(rest,null,2));
          const detailText=clipDetail(detailParts.join('\\n\\n')); const detailEl=document.getElementById('detail'); if(detailText){detailEl.textContent=detailText;detailEl.hidden=false;}
          const questions=payload.input&&payload.input.questions||[]; const questionsEl=document.getElementById('questions'); for(const q of questions){const label=document.createElement('label');label.textContent=q.question;const input=document.createElement('input');input.dataset.question=q.question;questionsEl.append(label,input)}
          function submit(allow){const answers={};const fields=document.querySelectorAll('#questions input'); if(allow&&fields.length&&[...fields].some(i=>!i.value.trim())){fields[[...fields].findIndex(i=>!i.value.trim())].focus();return;} fields.forEach(i=>answers[i.dataset.question]=i.value);document.querySelectorAll('button').forEach(b=>b.disabled=true);window.workbenchApproval.submit({...payload,allow,answers})} document.getElementById('deny').onclick=()=>submit(false);document.getElementById('allow').onclick=()=>submit(true);
        </script>`;
        popup.once("ready-to-show", () => {
          clearTimeout(loadTimeout);
          const display = screen.getDisplayNearestPoint(
            screen.getCursorScreenPoint(),
          );
          const area = display.workArea;
          const bounds = popup.getBounds();
          popup.setPosition(
            area.x + area.width - bounds.width - 18,
            area.y + area.height - bounds.height - 18,
          );
          popup.show();
          popup.focus();
        });
        popup.webContents.once("did-fail-load", () => {
          // CCDPH-FIX(ELE-2): 加载失败的小窗永远不会显示，先把审批权交还渲染层
          handBackToRenderer();
          if (!popup.isDestroyed()) popup.destroy();
        });
        popup.on("closed", () => {
          clearTimeout(loadTimeout);
          approvalWindows.delete(payload.requestId);
          // CCDPH-FIX(ELE-2): 用户没做任何决定就关掉小窗（Alt+F4 等）时同样要把审批权交还
          // 渲染层；已经提交过决定的窗口在 settledApprovalWindows 里，不会重复弹回卡片。
          if (!settledApprovalWindows.has(popup)) handBackToRenderer();
        });
        void popup
          .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
          .catch(() => {
            // CCDPH-FIX(ELE-2): loadURL 立即失败时同样回退到渲染层的审批卡片
            handBackToRenderer();
            if (!popup.isDestroyed()) popup.destroy();
          });
      };
      // CCDPH-FIX(ELE-3): webContents.send 在一个已销毁的窗口上会抛（"Object has been
      // destroyed"）。`window?.` 只挡 undefined，挡不住这种已被销毁的 webContents；而这个
      // 异常会从 notifier 里冒出去，穿过 server.mjs 的 approval Promise 执行体，把一次
      // 正常审批变成模型的「工具执行异常」。这里统一收口：先判断再发送，并且全部包在
      // try/catch 里（与 desktop.cjs 里 showApprovalWindow 的 send 保持一致）。
      const sendToMainWindow = (channel, arg) => {
        if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return false;
        try {
          window.webContents.send(channel, arg);
          return true;
        } catch (error) {
          console.error("[ccdph] 通知渲染层失败：", error.message);
          return false;
        }
      };
      engine.setNotifier((payload) => {
        const { title, failed, sessionId } = payload;
        const settings = engine.getSettings();
        if (payload.requestId) {
          // CCDPH-FIX(F14): 关闭原生小窗时必须“先返回”，不能再发 native-approval ——
          // 渲染层收到它就会认为审批已由原生窗口接管，从而把这个请求从唯一的会话内
  // 审批卡片里过滤掉；结果是两条渲染路径都不显示，任务永久挂起。
          if (settings.nativeApprovalWindow === false) return;
          sendToMainWindow("native-approval", payload.requestId);
          try {
            return showApprovalWindow(payload);
          } catch (error) {
            // CCDPH-FIX(ELE-2): 小窗连创建都失败（例如资源耗尽）时也必须把审批权交还渲染层，
            // 否则两条渲染路径都不显示；顺手把异常挡住，别让它冒泡打断 server 侧的 run。
            console.error("[ccdph] 审批小窗创建失败：", error.message);
            sendToMainWindow("native-approval-resolved", payload.requestId);
          }
        }
        if (
          !window ||
          window.isDestroyed() ||
          window.webContents.isDestroyed() ||
          (window.isFocused() && settings.notifyWhenFocused !== true) ||
          !Notification.isSupported()
        )
          return;
        const notice = new Notification({
          title: failed ? "Claude 任务需要注意" : "Claude 已完成",
          body: title,
          silent: settings.notificationSound === false,
        });
        notice.on("click", () => {
          if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
          try {
            window.show();
            window.focus();
          } catch (error) {
            console.error("[ccdph] 通知点击唤起主窗口失败：", error.message);
            return;
          }
          if (sessionId)
            void rendererCommand({ type: "select-session", id: sessionId });
        });
        notice.show();
      });
      ipcMain.on("approval-action", async (event, payload) => {
        if (!trustedSender(event)) return;
        if (!payload?.sessionId || !payload?.requestId) return;
        // CCDPH-FIX(ELE-4): 原来是从 event.sender 反推「要关闭哪个窗口」，而 trustedSender 对
        // 主窗口恒为真（同源），preload 又把 workbenchApproval 暴露给每个载入它的窗口 ——
        // 主窗口里任意脚本调用 submit() 就能把**主窗口**关掉/隐藏（closeToTray=false 时直接
        // 触发 quitting 退出应用），而且因为该窗口被记进 settledApprovalWindows，会话内的
        // 审批卡片也会被抑制，用户拿不到任何可见的审批入口。
        // 现在只认「requestId 已登记、且发送方正是那个已注册的审批小窗」，只关闭这个小窗。
        const popup = approvalWindows.get(payload.requestId);
        const senderWindow = BrowserWindow.fromWebContents(event.sender);
        if (!popup || popup.isDestroyed() || !senderWindow || senderWindow !== popup) return;
        try {
          const runtime = engine.getRuntime();
          const url = new URL(runtime.url);
          await fetch(`${url.origin}/api/approve`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-workbench-token": url.hash.slice(1),
            },
            body: JSON.stringify(payload),
          }).catch((err) => console.error("[ccdph] 审批提交失败：", err.message));
          sendToMainWindow("native-approval-resolved", payload.requestId);
        } finally {
          // CCDPH-FIX(ELE-2): 这个窗口是靠按钮结束的，关闭时不必再把审批卡片弹回渲染层
          settledApprovalWindows.add(popup);
          if (!popup.isDestroyed()) popup.close();
          approvalWindows.delete(payload.requestId);
        }
      });
      ipcMain.on("approval-resolved", (event, requestId) => {
        if (!trustedSender(event)) return;
        const popup = approvalWindows.get(requestId);
        if (popup && !popup.isDestroyed()) {
          // CCDPH-FIX(ELE-2): 渲染层已经自己处理完这次审批，关闭小窗时不再回退
          settledApprovalWindows.add(popup);
          popup.close();
        }
        approvalWindows.delete(requestId);
      });
      const rendererCommand = (command) => {
        if (!window || window.isDestroyed() || window.webContents.isDestroyed())
          return Promise.resolve(false);
        return window.webContents
          .executeJavaScript(
            `window.dispatchEvent(new CustomEvent("app-command", { detail: ${JSON.stringify(command)} }))`,
          )
          .then(() => true)
          .catch(() => false);
      };
      const syncFullscreen = (enabled) => {
        sendToMainWindow("fullscreen-change", enabled);
        void rendererCommand({ type: "fullscreen", enabled });
      };
      window.on("enter-full-screen", () => syncFullscreen(true));
      window.on("leave-full-screen", () => syncFullscreen(false));
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: "工作台",
            submenu: [
              {
                label: "新建任务",
                // accelerator 交给渲染层可配置快捷键接管（设置 → 键盘快捷键），
                // 菜单里写死会和用户自定义的组合键冲突，所以这里只留点击入口。
                click: () => rendererCommand("new-session"),
              },
              {
                label: "搜索与命令",
                click: () => rendererCommand("command-palette"),
              },
              {
                label: "设置",
                click: () => rendererCommand("settings"),
              },
              { type: "separator" },
              { label: "退出", role: "quit" },
            ],
          },
          {
            label: "编辑",
            submenu: [
              { role: "undo", label: "撤销" },
              { role: "redo", label: "重做" },
              { type: "separator" },
              { role: "cut", label: "剪切" },
              { role: "copy", label: "复制" },
              { role: "paste", label: "粘贴" },
              { role: "selectAll", label: "全选" },
            ],
          },
          {
            label: "视图",
            submenu: [
              { role: "reload", label: "刷新界面" },
              { role: "resetZoom", label: "实际大小" },
              { role: "zoomIn", label: "放大" },
              { role: "zoomOut", label: "缩小" },
              {
                label: "全屏",
                accelerator: "F11",
                click: () => {
                  // CCDPH-FIX(ELE-8): 窗口已销毁时这里会 TypeError（主进程未捕获异常）
                  if (!window || window.isDestroyed()) return;
                  window.setFullScreen(!window.isFullScreen());
                },
              },
            ],
          },
        ]),
      );
      window.once("ready-to-show", () => window.show());
      window.on("close", (event) => {
        if (quitting) return;
        if (engine.getSettings().closeToTray === false) {
          quitting = true;
          return;
        }
        event.preventDefault();
        window.hide();
      });
      await window.loadURL(engine.getRuntime().url);
    })
    .catch((error) => {
      dialog.showErrorBox("CCDPH 启动失败", error.message);
      app.exit(1);
    });
  // CCDPH-FIX(BR-5): 退出前必须把专用 Edge 连整棵进程树一起收掉。原来代码里的注释「不
  // detached 时子进程属于父进程的作业对象，父进程结束即被系统回收」是**错的** —— Node 和
  // Electron 都不会把子进程放进 Job Object，孤儿 Edge 会带着登录态和那个**无鉴权**的
  // --remote-debugging-port 一直留在机器上（任何本地进程都能通过 /json/list 驱动它）。
  // 而 stopDedicatedEdge() 之前只有 /api/browser/disable 和 SIGINT/SIGTERM 的 shutdown()
  // 会调用，从托盘/菜单/关窗退出时一次都不会执行。
  // 实现要点：before-quit 是同步事件、没法 await，所以第一次先 preventDefault() 把这次退出
  // 挡下，异步清理做完再自己调一次 app.quit()；清理有 6 秒硬上限（withQuitDeadline），
  // 且 stopDedicatedEdge 里的 taskkill 一旦拉起就会独立跑完，所以不会出现「退不掉的应用」。
  let quitCleanupDone = false;
  let quitCleanupPromise = null;
  const withQuitDeadline = (promise, ms = 6000) => {
    let timer = null;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(resolve, ms);
    });
    return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
  };
  // 幂等：before-quit 与 window-all-closed 两条退出路径都会调用，只跑一次
  const quitCleanup = () => {
    if (!quitCleanupPromise) {
      quitCleanupPromise = (async () => {
        // 资源清理可在设置 → 分析里关闭；关闭后跳过 stopRuns（保留终端/审批等进程资源）
        if (engine?.getSettings?.().resourceCleanup !== false) {
          try {
            await engine?.stopRuns();
          } catch (error) {
            console.error("[ccdph] 退出清理失败（停止运行中的任务）：", error.message);
          }
        }
        // 专用浏览器不受 resourceCleanup 开关影响：那个无鉴权的调试端口是安全项，无条件收掉
        try {
          const { stopDedicatedEdge } = await import("./browser/service.mjs");
          await stopDedicatedEdge();
        } catch (error) {
          console.error("[ccdph] 退出清理失败（结束专用浏览器）：", error.message);
        }
      })();
    }
    return quitCleanupPromise;
  };
  app.on("before-quit", (event) => {
    quitting = true;
    for (const popup of approvalWindows.values()) {
      // CCDPH-FIX(ELE-2): 退出过程中无需把审批卡片交还渲染层
      settledApprovalWindows.add(popup);
      if (!popup.isDestroyed()) popup.destroy();
    }
    approvalWindows.clear();
    tray?.destroy();
    tray = null;
    // 第二次 before-quit（清理完成后那次 app.quit()）直接放行，不再拦截
    if (quitCleanupDone) return;
    event.preventDefault();
    void (async () => {
      try {
        await withQuitDeadline(quitCleanup());
      } catch (error) {
        console.error("[ccdph] 退出清理异常：", error?.message || error);
      } finally {
        quitCleanupDone = true;
        app.quit();
      }
    })().catch(() => { });
  });
  app.on("window-all-closed", async () => {
    if (!quitting) return;
    // 与 before-quit 共用同一份幂等清理（两条退出路径都可能先到达）；
    // 本地 HTTP 服务仍要关掉，进程才能正常退出。
    await withQuitDeadline(quitCleanup()).catch(() => { });
    server?.close();
    app.quit();
  });
}
