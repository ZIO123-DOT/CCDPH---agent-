# CCDPH

> 软件原名 Claude Workbench，现已正式更名为 **CCDPH**。

给本机 Claude Code 使用的中文图形工作台。左侧项目和会话，中间聊天，右侧文件、Git 修改和终端；支持跟随系统、浅色、深色主题。

## 打开

双击桌面的 **CCDPH** 快捷方式，或直接运行 `D:\CCDPH\CCDPH.exe`。这是标准 Electron 便携窗口，无需 PowerShell、VBS 或终端启动器。整个 `D:\CCDPH` 文件夹需要保留在一起。

当前发布目标仅支持 Windows x64。源码可在其他平台启动部分网页功能，但终端异常退出恢复依赖
Windows Toolhelp32 与 `taskkill`；非 Windows 平台会明确记录降级提示，不承诺残留进程自动清理。

1. 点击左侧「＋」添加项目，选择文件夹或粘贴完整路径。
2. 在底部输入任务并发送。Enter 发送，Shift + Enter 换行；可选择模型、权限模式和新任务环境。
3. Claude Code 需要确认的操作显示确认卡片；AskUserQuestion 可直接填写回答。
4. 右侧可搜索和预览项目文件、加入上下文、查看 Git 分支与 Diff，并将修改意见回填聊天框。
5. 「终端」面板在当前任务目录运行本地命令；任务菜单支持搜索、重命名、置顶、归档、删除和 Markdown 导出。
6. 「设置」采用完整的分类式设置中心，可搜索并配置常规、外观、通知、模型与思考、权限、CC Switch、MCP 与扩展、项目与 Git、终端、数据与隐私、快捷键和关于；命令面板可用 `Ctrl+K` 打开。
7. 收起侧栏后仍保留工作区、GitHub/远程、Git 变更、Worktrees 和设置快速导航；项目配置了 `origin` 时可从 GitHub/远程入口打开仓库。
8. 权限请求固定显示在右下角待处理浮窗，不会被思考过程顶走；桌面版还会弹出可直接操作的右下角“批准/拒绝”小窗。
9. 可通过图片按钮、拖拽或直接粘贴截图，把 PNG/JPEG/GIF/WebP 图片交给 Claude 识别；单次最多 4 张、每张 8 MB。

点击窗口关闭按钮会隐藏到系统托盘，正在运行的任务、终端和本地服务继续工作；双击托盘图标可恢复窗口。需要完全退出时，请使用托盘或“工作台”菜单中的“退出”。

## 接入与数据

- 使用官方 `@anthropic-ai/claude-agent-sdk` 驱动本机已有 `claude.exe`，读取 Claude Code 用户、项目和本地配置。前端没有自行实现 agent 执行循环。
- CC Switch 继续负责管理服务商。先在 CC Switch 选择 Claude Code 服务商，再在工作台发送消息。每轮请求启动 Claude Code 读取配置；切换服务商后建议新建会话，避免不同模型的历史兼容问题。使用 CC Switch 本地代理时请保持其运行。
- 也可在「设置 → API 接入」中选择“供应商配置”，直接填写 Anthropic 兼容的 Base URL、模型映射与密钥。DeepSeek、Kimi、GLM、OpenRouter 等第三方模型均通过 Claude Code 的兼容 API 路径调用。
- 工作台会在 Node 服务端只读检查 CC Switch 当前 Claude Provider，并对受支持的官方余额接口查询余额。DeepSeek、StepFun、SiliconFlow、OpenRouter 和 Novita 已有适配；密钥本体不会返回给页面，也不写入日志；仅回传末 4 位用于确认填的是哪把 key。余额每 60 秒刷新，也可点击左下角额度手动刷新。
- Windows 上，工作台使用当前 Windows 用户的 DPAPI 加密供应商密钥，并把密文存入数据目录的 `api-auth.json`；密钥不进 `db.settings`、不回传页面，也不写日志。系统安全存储不可用的平台会降级为“仅本次运行”：密钥只驻留内存，退出后需要重新输入，磁盘不会写入明文。旧版明文文件升级失败时主界面仍可启动，并会尽力清除磁盘明文后进入仅本次运行模式。CC Switch 自己的数据库不会被修改。Hooks 面板会写入 Claude Code 的 `CLAUDE_CONFIG_DIR/settings.json`，MCP 面板会写入 `~/.claude.json`，均为“先备份、写临时文件校验可解析、再原子替换”。第三方中转服务的兼容性由其接口实现决定。
- 默认模型跟随现有配置，也可以在输入框底部选择模型。账号能否使用某个模型由现有服务配置决定。
- 独立 DeepSeek Harness 引擎及其切换界面已移除；应用始终使用 Claude Code。旧会话会在启动时自动按 Claude Code 会话加载。
- 单轮任务默认最长运行 2 小时；如需调整，可设置环境变量
  `WORKBENCH_RUN_HARD_DEADLINE_MS`（毫秒，最小 1000）。到达上限会强制结束卡住的任务，
  防止会话和连接永久占用。
- 桌面版会话保存在 exe 旁的 `.data/`，窗口设置在 `.desktop-data/`；开发版位于源代码目录。实际模型请求仍由 Claude Code 发往你配置的服务。
- 只监听 `127.0.0.1:4318`。启动令牌仅用于首次换取 `HttpOnly + SameSite=Strict` 会话 Cookie，换取成功后渲染层会立即清空内存中的令牌；所有接口仍校验 Host、Origin、会话 Cookie 和分桶限流。不要公开转发该端口。
- 这是便携 Electron 桌面程序，没有系统安装器或自动更新器。渲染页面禁用 Node 集成，启用上下文隔离和 Chromium 沙箱。
- 文件面板是只读预览。修改由 Claude Code 工具执行；Git 面板显示整个项目现有修改，不能将所有修改归因于当前会话。
- 新工作台会话会保存并续接 Claude 会话 ID；暂不自动导入此前终端里的历史会话。
- Claude 文本和思考支持增量流式显示，工具执行期间实时显示进度。
- 成本显示为 SDK 的 API 等值估算，并非订阅或第三方服务的实际扣费。

## 设置中心

- 常规：关闭到托盘、恢复最近会话、自动任务命名、默认右侧面板。
- 外观：系统/浅色/深色主题、界面字体、基础字号、舒适/紧凑密度、缩放、减少动态效果、默认展开思考。
- 模型与思考：默认模型、Agent SDK `effort` 思考强度、单次任务最大轮数，并可应用到当前会话。
- 权限与通知：四种 Claude Code 权限模式、完成通知、声音、前台通知和原生右下角审批小窗。
- CC Switch：显示当前 Provider 和余额，可配置自动刷新与刷新间隔；密钥只在 Node 服务端使用。
- 对 CC Switch 自定义 Provider，Workbench 可读取其 `usage_script` 中的同源 GET 余额模板；不会执行任意 JavaScript，只允许访问当前 Provider Base URL 的同源地址。
- MCP 与扩展：安全扫描全局及项目 MCP、Claude Skills、Hooks 和插件数量，可打开 Claude 配置目录；不返回环境变量值或密钥。
- 项目与终端：默认工作环境、当前路径、Git origin、Shell、终端输出上限和退出后释放时间。
- 数据与隐私：会话事件保留上限、本地数据目录、归档清理和遥测状态。
- 设置中心使用接近 Codex 的全窗口布局：顶部返回应用、左侧固定搜索与分类、右侧大标题和宽设置卡片；复选项统一为蓝色滑动开关。
- 设置导航按 Codex 风格拆为“个人 / 集成 / 编码”三组，保留本地版真实支持的外观、通知、模型、权限、CC Switch、MCP、Hooks、Git、终端、Worktrees、浏览器本地预览等入口；宠物、电脑操控、云端插件商店、语音和旧数据导入等当前无法真实实现的入口不会显示。
- 在消息框输入 `/` 会显示全局和当前项目的 Claude Skills 候选；输入名称可过滤，方向键/Enter 选择后插入 `/skill-name` 调用，不会把 Skill 文件正文发送到 Renderer。
- 当前会话可在每轮之间切换模型、权限模式和思考强度；选择后立即保存，刷新和切换会话不会恢复旧值。运行期间控件会临时锁定，任务结束后自动重新启用。

## 第二版限制

- Worktree 使用 detached worktree；当前不会自动回迁或清理，确认不再需要后请手动处理。
- 终端是本地持久子进程；隐藏到托盘时继续运行，完全退出或点击停止才会结束。命令输出仅保留最近一段内容，已退出终端会在短暂保留后释放。
- 当前支持图片附件和项目内文件上下文；普通外部文档附件尚未实现。Diff 反馈按文件回填，暂不支持逐行评论定位。
- 云任务、账号同步、插件市场等 Claude Code 本地 SDK 之外的服务不在本项目范围内。
- 界面缩放会保持工作区完整适配窗口；全屏可用 `F11` 或 `Esc` 退出，也可点击右上角的退出按钮。
- 缩放使用带反向尺寸补偿的 GPU transform，80%–130% 均铺满窗口，不会在右侧留下黑区或裁掉 UI。
- “自动模式”交给 Claude Code 的安全分类器决定允许或拒绝，不会弹出工作台人工审批；手动确认、自动接受编辑和计划模式仍显示右下角审批浮窗。
- 额度优先读取 CC Switch 当前 Provider 的受支持余额接口；未适配或未提供余额 API 的第三方服务仍只显示本轮等值成本。

## 排查启动问题

桌面启动错误会以原生对话框显示。运行时 SHA-256 清单不一致仍会阻止启动；Claude Code 的 Authenticode 签名因离线证书链、PowerShell 策略或安全软件而暂时无法验证时，CCDPH 会写入 `.data/startup-warnings.log`、显示告警并降级继续启动，不会把应用“锁死”。旧 PowerShell/VBS 启动器曾触发杀毒软件启发式检测，已移除；无需恢复文件、添加白名单或关闭防护。

依赖已安装。迁移机器后需要 Node.js 20+ 和已配置好的 Claude Code，然后运行：

```powershell
npm install --cache .npm-cache --registry https://registry.npmjs.org --omit=optional
```

如果 Claude Code 不在 PATH，可设置环境变量 `CLAUDE_CODE_EXECUTABLE` 为 `claude.exe` 的完整路径。登录、API Key 或服务地址继续使用 Claude Code 自身配置；不要把密钥粘贴进聊天界面。

发布包在其他 Windows 电脑上首次运行时，不会携带本机的会话、项目路径或密钥。如果 Claude Code 不在 PATH，请打开「设置 → 环境」，选择那台电脑上已安装的 `claude.exe`；路径保存在该电脑发布包旁的 `.data/state.json`。Claude Code 本身需要按 Anthropic 官方方式安装，CC Switch 则需要在该电脑单独安装并配置。

工作台启动时会验证候选 `claude.exe --version`，会跳过失效的 npm shim；如果系统里同时存在旧 shim，建议直接设置 `CLAUDE_CODE_EXECUTABLE` 指向实际安装路径。

端口被占用时，可设置 `WORKBENCH_PORT` 为其他端口后重新启动。窗口无法连接时请退出桌面程序后重新打开。

## 从源码运行与测试

前置条件：Node.js 20+，依赖已安装（见上节 `npm install` 命令）。仓库提供四个脚本（见 `package.json` 的 `scripts`）：

- `npm start`：即 `node server.mjs`，启动浏览器开发服务（默认 `127.0.0.1:4318`，可用 `WORKBENCH_PORT` 换端口）。本次启动的入口 URL 与令牌只打印在该进程终端，不写入磁盘。
- `npm test`：即 `node tests/run.mjs`，运行离线测试：启动冒烟（鉴权与 `runtime.json` 不含令牌）、`state.json` 损坏兜底、NTFS ADS 拦截、更新任务后台化回归。全程使用临时数据目录与随机端口，不触碰部署目录的 `.data`。
- `npm run check`：即 `node tests/syntax-check.mjs`，对全部源码文件逐个做 `node --check` 语法检查。清单 = 显式列出的应用文件（`server.mjs`、`desktop.cjs`、`preload.cjs`、`routes/*.mjs`、`public/*.js`、`scripts/*.mjs`）+ **自动扫描**的 `tests/*.mjs` 与 `browser/*.mjs`。
- `npm run integrity`：重新生成 `runtime-integrity.json`。只应在代码冻结后运行，并在同步到运行版后复算全部条目。清单内容 = 应用文件 + 关键第三方依赖 + **扫描 `sdk.mjs` 运行期 `require()` 得到的所有依赖文件**（如 `ajv`/`ajv-formats` 的运行时模块）。

仓库没有桌面打包脚本：桌面入口是 `desktop.cjs`（需自行以 Electron 运行），当前桌面运行版位于 `D:\CCDPH`，应用代码为 `D:\CCDPH\resources\app`。便携 exe 由仓库外的打包器生成，不存在 `npm run desktop` 或 `npm run build:desktop` 命令。依赖版本由 `package-lock.json` 锁定。

> **随附的运行时**：当前运行版内含 **Electron 44.3.0**（见 `D:\CCDPH\version`）。Electron 不在 `package.json` 的 `dependencies` 里，**`npm audit` 不会覆盖它及其内置 Chromium / Node / V8 的 CVE**；每次发版应记录所用 Electron 版本，并单独跟进其安全公告。门禁的 G6 规则每次都会把这条覆盖盲区打印出来（`覆盖盲区：Electron/Chromium 运行时不在 npm 依赖树内，CVE 扫描不覆盖`）。
>
> **完整性清单的边界**：`runtime-integrity.json` 的用途是 **corruption-detection**（检测文件损坏或被静默替换）。它不是能抵挡"对安装目录有写权限的进程"的安全边界 —— 对方可以直接重跑 `npm run integrity` 生成一份自洽的清单。若安装目录对普通用户可写，请改到受保护的位置部署。验签用的 PowerShell 解释器覆盖（`CCDPH_SIGNATURE_POWERSHELL`）现在必须与 `CCDPH_ALLOW_SIGNATURE_OVERRIDE=1` 同时设置才生效（仅打包冒烟用例使用）。

## 开发

离线测试全部位于 `tests/`，由 `tests/run.mjs`（`npm test`）统一驱动：`behavior.mjs`（状态机/策略单测）、`route-domains.mjs`、`state-fold-backup.mjs`、`api-tests.mjs`（HTTP 接口与生命周期）、`sse-limits.mjs`、`browser-*.mjs`、`terminal-registry-*.mjs`、`terminal-recovery.mjs`、`credential-*.mjs`、`worktree-*.mjs`、`resource-limits.mjs`、`renderer-*.mjs`、`mcp-save-name.mjs`、`frontend-export-coverage.mjs`。除 `packaged-signature-fallback.mjs`（需 `CCDPH_PACKAGED_EXE`，未设置时自我跳过）外，全部使用临时数据目录与随机端口，**不触碰部署目录的 `.data` / `.desktop-data`**。

发版门禁是 `node tests/gate.mjs`（8 条规则：回归完整性、通过率、P0/P1 失败数、语法、`npm audit`、接口用例、**安全用例无盲区**）。安全用例（终端恢复、打包签名降级）若自我跳过，默认会让门禁 **NO-GO**；确需在无打包 exe / 离线环境下放行，必须显式加 `--allow-blind-spots`（盲区仍会打印在报告与 `--json` 输出里）。

`node tests/gate.mjs --inject=G2` 可注入指定规则失败，用于自检门禁确实能拦截。

接入依据：[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)、[权限处理](https://code.claude.com/docs/en/agent-sdk/permissions)。
