# CCDPH macOS 移植评估

> 状态：评估稿（2026-09-28）。CCDPH 当前为 Windows 专属应用，本文列出全部 Windows 依赖、
> 对应的 macOS 替代方案与工作量拆分。**移植无法在本 Windows 主机上验证**，最终需在 Mac 上
> 构建 + 签名 + 公证，或用 GitHub Actions macOS runner 出未签名包后手工签名。

## 结论速览

| 模块 | Windows 现状 | macOS 替代 | 难度 |
|---|---|---|---|
| Claude 可执行文件解析 | `claude.exe/.cmd/.bat` + `where.exe` + `ComSpec cmd.exe` | `claude`（npm/brew）+ `which` + 直接 `execFile` | 低 |
| 凭据加密 | DPAPI（PowerShell 子进程） | Electron `safeStorage`（Keychain）或 `security` CLI | 中（需改架构） |
| 终端进程恢复 | Toolhelp32 + `taskkill.exe /T /F` | `ps` + `kill`（SIGTERM/SIGKILL / 进程组） | 中 |
| 浏览器自动化 | `msedge.exe`/`chrome.exe` 硬编码路径 + taskkill | `/Applications/….app/Contents/MacOS/…` + `kill` | 中 |
| 自动更新 | `powershell.exe` 解压 + `.bat` 自替换 + taskkill | `ditto`/`unzip` + shell 自替换 + `kill` | 中 |
| 桌面主进程 | `powershell.exe` + `claude-agent-sdk-win32-x64` | `claude-agent-sdk-darwin-{arm64,x64}` | 中 |
| 路径处理 | `path.win32`/盘符 | `path`（已跨平台，逐个核对） | 低 |
| 打包/分发 | 便携版，无打包配置 | electron-packager（darwin）+ 签名/公证 | 中 |

## 逐项明细

### 1. Claude Code 可执行文件解析（`server.mjs`）
- **位置**：`findClaude()`（约 1105–1153）、`claudeVersionOf()`（1155–1183）、`resolveNativeClaudeExecutable()`（约 2140–2165）。
- **Windows 特有**：`WINDOWS_WHERE_EXE`（`where.exe`）、`WINDOWS_CMD_EXE`（`cmd.exe`）、`ComSpec`、`%APPDATA%`/`%LOCALAPPDATA%`、`.cmd`/`.bat` 分支 + `cmd /d /s /c ""<path>" --version"` + `windowsVerbatimArguments`。
- **mac 方案**：候选列表改为 `~/.local/bin/claude`、`/opt/homebrew/bin/claude`、`/usr/local/bin/claude`、npm 全局 `…/node_modules/@anthropic-ai/claude-code/cli.js`（或 `bin/claude`）；用 `which claude` 兜底；`.cmd/.bat` 分支整个跳过，非 win32 走 `execFile(candidate, ["--version"])`（已存在该通用分支）。
- **已就绪**：`claudeVersionOf` 的可执行名白名单已含 `claude`（Unix 二进制名），`findClaude` 已含 `~/.local/bin/claude` 候选。
- **风险点**：`resolveNativeClaudeExecutable` 里 `claude.exe` 特判（2146 行）需加 darwin 分支。

### 2. 凭据加密（`credential-protector.mjs`）—— ✅ 已实现（2026-09-28）
- **Windows 现状**：以**独立子进程**跑 `powershell.exe -Command`（`windows-dpapi`），规避主进程直接持有 DPAPI 句柄；配 `taskkill.exe` 超时收拾。
- **mac 障碍**：Electron `safeStorage`（Keychain 后端）**只能在 Electron 主进程内调用**，无法在纯 Node 子进程用。
- **mac 实现**：新增 `createMacKeychainProtector()`，在 Electron 主进程内 `require("electron").safeStorage`（Keychain）做加解密，`name: "macos-keychain"`，密文仍存 `api-auth.json`（version 2 格式）；纯 Node（`npm start`）下 `require("electron")` 失败 → 返回 `null` 会话级降级。单测见 `tests/behavior.mjs`（注入假 safeStorage 验证往返）。**待真实 Mac 上验证 Keychain 加解密**。

### 3. 终端进程恢复（`terminal-registry.mjs`）—— ✅ 已实现（2026-09-28）
- **Windows 现状**：Toolhelp32 快照 + `taskkill.exe /T /F`（进程树强杀），PID 复用前重新核验进程名/启动时间。
- **mac 实现**：新增 `unixProcessTable()`（`ps -axo pid=,ppid=,lstart=,comm=` 枚举 + 父子树遍历）与 `killTerminalProcess()`（`SIGKILL`，ESRCH 视为成功）；`writeSnapshot`/`sweep`/`scheduleAfter` 放开 darwin，`terminalRegistryPlatformStatus()` 标记 darwin 支持。名称+启动时间复核逻辑两平台共用，防 PID 复用误杀。**待真实 Mac 验证 `ps` 解析**。

### 4. 浏览器自动化（`browser/detect.mjs`、`browser/service.mjs`）—— ✅ 已实现（2026-09-28）
- **Windows 现状**：硬编码 `C:\Program Files\…\msedge.exe` / `chrome.exe`，读 `DevToolsActivePort`，`taskkill /T` 收进程树，`--remote-debugging-port` + 专用 Profile。
- **mac 实现**：
  - 路径：`/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge` / Google Chrome 对应路径（`detect.mjs` 已加）
  - `DevToolsActivePort` 在 `~/Library/Application Support/Microsoft Edge/DevToolsActivePort`（`detect.mjs` 已加）
  - 进程树：`launchDedicatedEdge` 非 win32 加 `detached`（进程组组长），`killProcessTree` 非 win32 用 `kill(-pid, "SIGKILL")`
- **注意**：Chromium CDP 在 mac 上行为一致，Playwright MCP 无需改。**待真实 Mac 验证进程组 kill**。

### 5. 自动更新（`server.mjs`）—— ✅ 已实现（2026-09-28）
- **Windows 现状**：`powershell.exe -Command Expand-Archive`、`taskkill` + `.bat` 自替换重启动脚本（纯 ASCII）、`%SystemRoot%\System32`。
- **mac 实现**：解压用 `ditto -x -k`（保留 .app 内符号链接/权限）；安装目录上溯到 .app 父目录；应用入口改为找 `CCDPH.app`（目录）；自替换用 `/bin/sh` 脚本（`kill` → `ditto` 替换 .app → `open` 重启动 → 回收暂存），路径经环境变量传入。**待真实 Mac 验证 ditto/.app 替换**。

### 6. 桌面主进程（`desktop.cjs`）—— ✅ 已实现（2026-09-28）
- **Windows 现状**：`powershell.exe`、`node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe`、`process.platform !== "win32"` 早退。
- **mac 实现**：SDK 平台二进制按 `process.platform`/`process.arch` 选择（`claude-agent-sdk-darwin-{arm64,x64}` + 裸 `claude`），`REQUIRED_RUNTIME_FILES` 与验签共用该映射。验签仍仅 win32（Authenticode 是 Windows 专属）。

### 7. 路径处理（`routes/workspace-io.mjs` 等）
- 用 `path` 模块处基本跨平台；需逐处核对 `path.win32`、盘符假设、`C:\` 字符串比较（`server.mjs` 的 `.cmd` 白名单里 `/^[a-zA-Z]:\\/` 等）。多为「加 darwin 分支」的机械改动。

### 8. 打包/分发
- 当前无 electron-builder/packager 配置（便携版）。mac 需新增：electron-packager（darwin/arm64+x64）→ 签名（Apple Developer ID）→ 公证（`notarytool`）。未签名包在 Apple Silicon 上**无法启动**（需至少 ad-hoc `codesign -s -`）。

## 建议拆分（按风险从低到高）

- **P0（机械分支）—— ✅ 已完成**：`findClaude`/`claudeVersionOf` darwin 分支；浏览器路径；`resolveNativeClaudeExecutable`（mac 上是 no-op，已确认）。
- **P1（需 mac 验证）—— ✅ 已完成（待 Mac 验证）**：凭据 `safeStorage`（Keychain）；终端恢复 `ps`+`kill`；浏览器进程树 kill + detached；自动更新 `ditto`/`sh`；桌面主进程 SDK darwin 映射。
- **P2（只能在 mac 上收尾）**：真实浏览器启动/进程树验证；终端 `ps` 解析验证；ditto/.app 替换验证；打包 + 签名 + 公证。

## 前置未知项（已确认）
- `@anthropic-ai/claude-agent-sdk` 已发布 `darwin-x64`/`darwin-arm64` 原生二进制（见 `package.json` optionalDependencies，v0.3.268），无需走 npm 全局 `claude`。
