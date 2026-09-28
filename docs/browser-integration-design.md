# CCDPH 浏览器集成设计

> 本文档描述 CCDPH 的浏览器集成能力：基于 Playwright 的 `connectOverCDP` 操控本机 Edge。
> 实现分布：`browser/detect.mjs`、`browser/service.mjs`、`browser/lifecycle.mjs`、`browser/mcp-config.mjs`，
> 以及 `routes/integration.mjs` 中的 `/api/browser/*` 路由。

## 1. 目标与非目标

**目标**：让 Claude 会话能够通过 Playwright MCP 操作浏览器（attach 到用户已授权的 Edge，或拉起独立的专用 Edge）。

**非目标**：
- 不自带浏览器内核（`channel=msedge` 指向本机 Edge，无需下载浏览器）。
- 不写用户全局 MCP 配置（见 §8）。
- 不把浏览器凭据（登录态 cookie）上传或外发。

## 2. 两种模式

| 模式 | 连接方式 | 登录态来源 | 适用场景 |
|---|---|---|---|
| `attach` | 读 Edge 的 `DevToolsActivePort`（用户手动在 `edge://inspect/#remote-debugging` 勾选授权） | 用户自己的默认 Edge profile | 临时、低敏感 |
| `dedicated` | 用独立 `--user-data-dir` + 固定调试端口拉起专属 Edge | 专用 profile，长期保留 | 需要长期登录态、隔离于日常浏览 |

模式由 `db.settings.browser.mode` 决定，`enabled` 控制整体开关。

## 3. 架构总览

```
/设置 → /api/browser/enable ── commitBrowserSettings
                                 └─ withBrowserSettingsTransition
                                      ├─ reconcile（生命周期协调，见 §13）
                                      └─ commit（写 db.settings + save）

/browser/status ── browserStatus ── ensureConnection ── connectOverCDP
                                                         └─ probeTabs / probeCdp

Claude 会话启动 ── buildPlaywrightMcpConfig ── 运行时注入 MCP（见 §8）
```

## 4. 连接（CDP）

浏览器控制统一通过 Chrome DevTools Protocol（CDP）。Playwright 的 `chromium.connectOverCDP(endpoint)` 建立连接。

### §5.2 CDP 端点解析（`cdpEndpointFromSettings`）

- **attach 模式**：读取 `%LOCALAPPDATA%\Microsoft\Edge\User Data\DevToolsActivePort`，
  取首行端口号。端口缓存带 `mtime + size` 双重校验，避免「新端口写回同一 mtime 分辨率」
  时命中旧缓存。
- **dedicated 模式**：`http://127.0.0.1:${dedicatedPort}`（默认 9223，可在设置中改）。
- 缓存与端口的切换必须同时 `dropConnection()`，消除「旧 browser 永不 close」的泄漏。

连接建立后做心跳（`contexts()`），失败即断开重连。

## 5. 浏览器探测（`detect.mjs`）

### §7.1 本机安装探测（`detectBrowsers`）

- 依次探测 Edge / Chrome 的常见安装路径（含 `ProgramFiles(x86)`/`ProgramFiles`/`LOCALAPPDATA` 环境变量派生路径）。
- 环境变量为空时不拼相对路径（避免 `existsSync` 落到 cwd 下的同名文件）。
- 读 `DevToolsActivePort` 判断 Edge 是否已授权远程调试。

### §7.2 CDP 探针（`probeCdp` / `probeTabs`）

- 纯 `net.connect` 实现的轻量 HTTP 探针（不依赖 Playwright），向 `127.0.0.1:port` 发
  `GET /json/version`（版本/连接确认）与 `GET /json/list`（标签列表）。
- 响应体上限 64 KB（`PROBE_MAX_BYTES`），防止失控的本地监听进程把主进程内存吃光；
  头部结束标记缺失直接判失败，不再 `slice(-1+4)` 造垃圾 body。
- 超时由环境变量 `CCDPH_CDP_PROBE_TIMEOUT_MS` / `CCDPH_CDP_TABS_TIMEOUT_MS` 控制（有界）。

## 6. MCP 注入（`mcp-config.mjs`）

### §8 运行时注入，不写用户全局配置

Playwright MCP 的配置**只**在运行时注入到 Claude 引擎的会话启动参数里，绝不写进用户
全局的 `~/.claude.json` / `~/.claude/settings.json`。这样：

- 用户自己的 Claude Code 配置不被污染；
- 关闭浏览器能力后注入立即消失，无残留。

`buildPlaywrightMcpConfig(browser)` 生成：

- attach 模式：`--cdp-endpoint=msedge`（通道名连接，Playwright MCP 原生支持）。
- dedicated 模式：`--cdp-endpoint=http://127.0.0.1:${port}`。
- 图片响应：`--image-responses=omit`（非 allow 时）。
- 域白/黑名单：`--blocked-origins` / `--allowed-origins`（裸域名展开语义见 BR-11）。
- 入口解析：优先本地 `@playwright/mcp` CLI 入口（离线可用）；失败回退 `npx -y @playwright/mcp@0.0.80` 并显式告警。

## 7. 安全边界

- 调试端口**只监听回环地址**（`--remote-debugging-address=127.0.0.1`），不暴露到局域网。
- 专用 Edge 的 `--user-data-dir` 必须落在应用数据目录内（`resolveDedicatedProfileDir` 做
  绝对路径 + 真实路径包含性校验，拒绝 junction/symlink 越界、拒绝外来非空目录）。
- 专用浏览器进程带 PID 标记文件（`dedicated-edge.json`），异常退出后下次启动按标记清扫
  （身份核验：tasklist + netstat 复核 PID 与端口归属，避免 PID 复用误杀）。
- 退出时 `stopDedicatedEdge()` 用 `taskkill /T /F` 结束整棵进程树（Edge 会派生渲染/GPU/utility
  子进程，单 `kill()` 只杀主进程会残留）。

## 8. 专用浏览器生命周期（`lifecycle.mjs`）

### §13.3 启动 / 切换 / 停止 / 回滚

- `reconcileDedicatedBrowser(settings, deps)` 是**唯一的运行时边界**：比较「目标专用状态」与
  「当前专用状态」，决定 unchanged / started / restarted / stopped。
- 端口或 profile 变化时先 `stopDedicatedEdge()` 再拉起新实例；停不掉则拒绝提交设置（保留原设置）。
- `withBrowserSettingsTransition` 把「reconcile → commit」与失败回滚串成一个事务：
  commit 失败 → 回滚到 previous → 再 reconcile(previous) → 抛原错误，保证内存/磁盘/进程三者一致。

## 9. 截图清理

- 截图目录 `DATA/browser/screenshots`，文件名 `shot_<ts>_<hex8>.png`。
- TTL 30 天 + 数量上限 500 + 总量上限 256 MiB 三重回收；启动时清理一次 + 每小时一次（unref 定时器）。
- 清理失败永远静默，不影响浏览器主功能。

## 10. 已知限制（已声明的接受项）

- **专用模式 CDP 端口无鉴权**：CDP 协议本身无令牌/鉴权机制，运行期间同机同用户进程可经
  `/json/list` 驱动该浏览器。已用「回环绑定 + 启动清扫 + 退出整树收尾」缓解，并在
  `/api/browser/status` 的 `securityNote` 字段向用户如实提示。这是同机信任边界下的固有暴露面。
- **PID 身份复核与 taskkill 之间仍是毫秒级 TOCTOU**：`stopDedicatedEdge` 在核验身份后、杀进程前
  存在极小窗口，PID 复用理论上可能误杀。已通过 tasklist/netstat 双源复核压缩到毫秒级。
