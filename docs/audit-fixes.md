# CCDPH 审计修复索引

## 2026-09-27 · v0.3.2 启动可用性与鉴权收口

- Claude Code Authenticode 验证失败改为可见告警并继续启动；SHA-256 清单不一致仍是硬门禁。
- 启动令牌仅用于换取 HttpOnly 会话 Cookie，成功后从渲染进程内存清除；Cookie 覆盖普通 API、SSE 与卸载清理。
- Windows 供应商密钥使用 DPAPI；无安全存储时降级为仅本次运行，绝不写入磁盘明文。
- 旧明文密钥迁移失败不再阻断主界面；无法安全移除旧文件时清空内存密钥并锁定原文件。
- `launchDedicatedEdge` 在服务层直接校验端口/profile，不再把参数一致性只寄托于上层协调器。
- 全局历史排序缓存增加 revision 与 preferred-session 失效条件；终端 SSE 统一复用 `SSE_FRAME_CHARS`。
- 设计决策见 `docs/adr/0001-local-auth-and-secret-storage.md`，版本变更见根目录 `CHANGELOG.md`。
- 独立重审补充：Markdown 净化启用 `SANITIZE_NAMED_PROPS`，模型 HTML 的 `id/name` 统一加前缀，防止 DOM Clobbering。
- API 客户端对 401 统一尝试一次重新鉴权；无法恢复时明确提示重启应用。
- 新建会话在 `refreshState()` 后二次校验导航 revision；SSE 重连保留 `nativeApprovalIds`。
- `refreshState()` 增加最新请求序号守卫；bfcache 隐藏恢复先重挂生命周期监听，重新可见时再恢复 SSE 与状态刷新。
- 更新成功路径改由 `armUpdateInstallGateTimer` 自身默认超时控制，防止成功误报失败并提前松开 MED-15 闸门。
- CDP 连接用 keyed Promise 折叠并发；Hooks update 数组分支复用 MED-16 脱敏命令还原。
- Worktree 创建使用随机直系子目录原子预留，并在 `git worktree add` 后再次检查 realpath 包含性。
- 残留浏览器标记不可核验时的错误会给出标记绝对路径、PID 与“先结束进程再删标记”的恢复步骤。
- Windows PowerShell、where、cmd 及更新批处理外部工具固定使用 System32 路径，避免 cwd/PATH 同名文件劫持。
- Hooks update 的单命令与数组分支共用 MED-16 脱敏还原；Worktree 失败清理仅递归删除经 realpath 验证的普通受控目录。
- 终端进程助手使用请求 ID 对应响应；每次 taskkill 前重新核验 PID、进程名与启动时间，清理失败时保留注册表供下次重试。
- W-1：失败的终端清理记录进入 `pendingStaleRecords`，后续新终端快照或无终端快照都会合并保留，不再被覆盖或删除。
- W-1 回归测试同时覆盖活动快照与空闲快照；失败记录只在对应进程成功清理或身份确认失效后移除。
- W-1 housekeeping：启动 sweep 会清理历史 `terminal-processes.json.terminal-pids-*.tmp` 临时文件；合并 pending 记录时跳过无法解析为正整数的 PID。
- W-2：终端注册表 ENOENT 视为无记录，EBUSY/EPERM/EACCES 等读取失败保留原文件并告警；仅成功读取后 JSON 解析失败才删除损坏文件。
- W-3：读取失败会设置 `registryUnreadable`；后续快照覆写前必须重新读取并合并旧记录，持续不可读时跳过写入，避免同会话终端活动抹掉恢复档。

源码中的 `CCDPH-FIX(...)` 标记用于说明某段防御逻辑的来源。编号来自不同审计轮次，
不是按单一序列生成；修改带标记的代码时，应同时更新对应回归测试。

## 编号族

| 前缀 | 主题 | 主要位置 | 回归入口 |
|---|---|---|---|
| `HIGH-*` / `MED-*` / `LOW-*` | 历史稳定性、安全和资源修复 | `server.mjs`、`public/app.js` | `npm test` |
| `A10-*` | 第 10 轮破坏性审计：状态体积、限流、SDK 收尾、可观测性 | `server.mjs` | `tests/behavior.mjs`、隔离服务测试 |
| `AUDIT-*` | 前端增量渲染、终端、竞态和缓存 | `public/app.js` | `tests/behavior.mjs`、Playwright E2E |
| `BR-*` | 浏览器/CDP 安全、超时、引用和进程回收 | `browser/service.mjs` | `tests/behavior.mjs` |
| `ELE-*` | Electron 主进程、IPC、退出和更新 | `desktop.cjs` | 语法检查、桌面启动回归 |
| `FE-*` | 会话流、Markdown、前端状态恢复 | `public/app.js` | Playwright E2E |
| `F-*` / `RES-*` | 文件持久化、更新包与资源释放 | `server.mjs` | `tests/behavior.mjs` |

## 当前关键防线

- 状态文件：写入上限 256 MiB；读取前同样执行体积门。超限文件使用原子改名隔离，
  不读取、不复制，并生成 `state.json.oversize-readme.txt`。
- 请求体：单请求、全局在途字节和 100 层 JSON 深度三重限制。
- 会话历史：条数、单会话字节和全局字节预算；事件大小在规范化时一次计量。
- SSE：每客户端有界队列、背压断开、错误/关闭统一清理。
- 终端：数量上限、输出与 stdin 背压、进程树回收、启动定时器清理。
- 更新：HTTPS、SHA-256、下载体积上限、ZIP 中央目录路径校验、暂存目录回收。
- 浏览器：域名策略、Playwright MCP 出站约束、专用 profile 真实路径校验、CDP 探针超时、
  监听器幂等、截图三重预算。
- 前端：事件节点内容指纹、审批锚点定点替换、工具结果重放幂等、bfcache 恢复。

## D-01～D-11 整改索引（2026-09-26）

| 编号 | 结论与落点 | 回归测试 |
|---|---|---|
| D-01 | JSON 深度超过 100 时立即早退，不再扫描整棵树 | `behavior.mjs` 早退陷阱、`verify-patch-targeted.mjs` |
| D-02 | Git 输出超限/超时返回 `tooLarge`，不再误报 `notGit` | `behavior.mjs`、`git-http-tmp2.mjs` |
| D-03 | 更新清单和安装包拒绝重定向；SHA-256 恒时比较 | `behavior.mjs`、`verify-patch-targeted.mjs` |
| D-04 | 删除源码文本正则断言，改为真实 Edge E2E 与导出函数行为测试 | `renderer-behavior.mjs` |
| D-05 | 旧自研浏览器执行链曾保留并标记 `@deprecated`；R6 已确认无活跃入口并从发布代码删除，测试只覆盖 MCP 活跃护栏 | `behavior.mjs` |
| D-06 | 终端后代 PID/名称/创建时间持久化；异常退出后下次启动安全清扫 | `terminal-recovery.mjs` |
| D-07 | Windows 注册并释放 `SIGBREAK` 处理器 | `verify-patch-targeted.mjs` |
| D-08 | renderer 卸载清理幂等，bfcache 恢复时复位 | `renderer-behavior.mjs` |
| D-09 | 仅在 shell `spawn` 成功且 stdin 可写后发送 UTF-8 初始化帧 | `behavior.mjs` |
| D-10 | HTTP JSON 请求体接受 UTF-8 BOM | `verify-patch-targeted.mjs` |
| D-11 | 旧浏览器链缩进统一、死导出明确标记废弃 | 语法检查 |

## R2 第二轮整改索引

- 深状态：`state-safety.mjs` 在载入后局部折叠绝对深度超过 256 的子树；首次写回前先保存
  `state.json.folded-<时间>` 原始副本。深度 50～50000 的审计梯度均可启动，状态/设置接口保持 200。
- 轮次生命周期：默认 2 小时绝对看门狗（可用
  `WORKBENCH_RUN_HARD_DEADLINE_MS` 覆盖，最小 1000ms）与用户停止后的 5 秒看门狗并存，
  任一收尾都会清除两者。
- 请求体：JSON.parse 前执行字符串级深度预筛，16MB 深结构拒绝耗时从约 1.9s 降至约 60ms。
- 预览：非字符串结果按 100 项/字段、2000 节点、64 层和 40000 字符预算生成，
  在序列化过程中即停止扩张，不先构造超大中间字符串。
- Git/diff：大状态输出区分 `tooLarge`；diff 三级路径全部失败时降级文件预览。
- 审批：AskUserQuestion 回答限制 50 项、键 500 字、值 4000 字，并拒绝原型相关键。
- 用量：载入和新增统一保留 60 天。
- 状态接口：不再回传 home、数据目录或 Claude 可执行文件绝对路径。
- ZIP/worktree/限流：拒绝归一化路径碰撞；worktree realpath 失败即拒绝；所有回环地址共用限流键。
- 错误出口：RangeError/TypeError/ReferenceError/SyntaxError 统一返回业务文案，原始栈只写服务端日志。
- 热路径：MCP 文件常量与读写/校验助手移至模块作用域，不再按请求重建。
- 终端恢复：Windows 进程树快照改用原生 Toolhelp32 API，不再依赖可能随机返回
  `0x80004005` 的 WMI/CIM；枚举失败时保留登记文件，供下次启动重试。常驻助手仅对终端树
  和服务所有者获取启动时间，不再每 2 秒逐个查询全系统进程详情。
- 启动与更新：迁移写盘失败不再阻止服务监听；更新接管闸门最多保持 10 分钟，
  避免批处理未接管时永久锁死更新入口。
- 运行收尾：强制结束轮次同时关闭 SDK Query/迭代器；终端 LRU 淘汰等待整棵进程树
  完成回收后再创建新终端。
- 出口契约：`/api/state` 使用顶层白名单；Claude 检测与状态接口统一只返回
  `configured/version/error`，文件权限与磁盘不足错误统一为业务文案。

## 修改与验证规则

1. 不直接删除或弱化安全上限；需要调整时同时更新测试和本文件。
2. 所有动态测试使用独立 `WORKBENCH_DATA_DIR` 与随机端口。
3. 不在测试中读取或修改安装目录的 `.data`、`.desktop-data`、Claude 或 CC Switch 配置。
4. 提交前至少运行 `npm test`；涉及会话渲染时再运行 Playwright E2E。

## R4 第四轮整改索引

- 启动握手：`runtime.json` 写入失败仅记录日志，不再中断信号处理器与退出清理注册。
- 预览：使用当前祖先链识别真循环；横向共享对象会在各字段完整显示。
- 深状态：折叠写回前必须先保存原始 `state.json.folded-<时间>`，备份失败则拒绝覆盖。
- 路由：`classifyRouteDomain()` 的结果直接选择领域处理器，不再维护第二套分派条件链。
- 终端并发：启动请求进入串行队列，显式保证同一工作区复用和总数上限。
- 深度参数：负数/非数字折叠深度会安全归一化，不再触发根节点改写异常。
- 进程快照：Toolhelp32 仍枚举轻量 PID/PPID，但启动时间只查询服务与终端后代。
- 会话实时控制：进入会话写队列；auto 模式启动的任务不再接受无法实时应用的降权切换，
  前端在拒绝时恢复真实状态。
- 终端启动：启动横幅缓冲限制为 256 KiB，超过后截断并立即转入正常有界输出。
- 专用浏览器清扫：结束残留 Edge 前同时核对进程名、tasklist PID、调试端口和监听 PID，
  降低 PID 被普通 Edge 复用时的误杀风险。
- 测试门禁：`tests/qa-hardening.mjs` 的 45 条高风险极限用例已纳入 `npm test`。

## R5 第五轮整改索引

- 深度不变量：业务内容上限 `STATE_CONTENT_MAX_DEPTH=100` 与整树安全序列化上限
  `STATE_SAFE_SERIALIZATION_DEPTH=256` 集中定义在 `state-safety.mjs`，模块加载时校验前者不超过后者。
- 事件计量：事件首次进入会话历史时缓存 UTF-8 字节数；条数裁剪、字节裁剪与全局预算裁剪
  复用 WeakMap 缓存，不再对被丢弃事件重复 `JSON.stringify`。
- 串行队列：队列完全空闲后主动切断已完成的 Promise 祖先链，避免大型请求闭包延迟回收。

## R6 第六轮整改索引

- 模块拆分：路由分类移入 `route-registry.mjs`，服务端纯策略移入 `server-policies.mjs`；
  前端 API 客户端与 Markdown 安全渲染分别移入 `public/api-client.js`、
  `public/markdown-renderer.js`。
- 浏览器旧链：删除无活跃入口的 `executeBrowserTool` 兼容链及其敏感文件上传、页面执行、
  引用表和事件环缓存代码；活跃能力继续统一走 Playwright MCP。
- 平台边界：终端异常恢复明确标注为 Windows Toolhelp32/taskkill 能力；非 Windows 平台
  启动时输出降级原因，不再静默跳过。

## R7 全方位审查整改索引（2026-09-27）

- 浏览器 profile：创建目录后以 `realpath` 再校验，junction/symlink 无法把专用 Edge
  profile 引到数据目录之外；CDP 端口文件改为异步读取，探针超时具名且可有限度配置。
- 文件与流：稳定文件读取只从已校验句柄读取 `上限 + 1` 字节；会话 SSE 每轮最多 16 个、
  终端 SSE 每实例最多 8 个连接；终端快照助手 stdout/stderr 与响应时间均有具名上限。
- 状态与供应商：深状态原件备份保留最近 3 份并设 30 天 TTL；供应商模式、配置或密钥
  成功提交后立即失效用量缓存。
- Worktree：删除前再次 realpath，随后原子改名为同父目录随机 tombstone，复核捕获对象仍在
  授权基目录后才递归删除，最后用 `git worktree prune` 回收元数据。
- 更新包：ZIP 路径段限制为 255 UTF-8 字节；下载 SHA-256 通过后在解压前、解压后分别从
  磁盘流式复算，检测校验到安装间的替换；失败仍统一回收随机暂存目录。
- 前端长会话：内存事件保留 5000 条用于关联，DOM 只维护最近 1000 条并显示明确提示；
  文件搜索达到 5000 目录上限时返回并展示截断原因。
- 错误出口：裸 POSIX 绝对路径与既有 Windows/UNC 路径同样脱敏。
- 路由语义：终端与文件读写领域从 `workspace-read` 更名为 `workspace-io`。
- 复核已闭合：设置/API 密钥写队列、SSE snapshot 对账、Electron `window.open`/导航守卫、
  单实例锁、导出尾部字节预算和事件序列化字节缓存均无需重复实现。

## R8 独立极限审查整改索引（2026-09-27）

- 轮次资源：新增全局 Claude run 上限（默认按 CPU 取 4～16，可通过
  `WORKBENCH_MAX_CONCURRENT_RUNS` 在 1～32 内覆盖）；`/api/send` 在会话写队列中原子检查，
  达上限返回 429，不再允许令牌桶突发量直接转化为数百个子进程。
- 预览与事件：toJSON 转换链计入深度/节点预算，同一次预览只执行一次转换；tool input 在
  完整 `JSON.stringify` 前用迭代式字节/深度/节点预算检查，超限直接折叠。
- 状态载入：读取、JSON.parse、深子树折叠与复杂度扫描移入 worker；worker 使用同一文件句柄
  流式有界读取并检测读取期间变化；复杂度扫描以 `WeakSet` 防循环。会话规范化按批让出事件循环。
- 状态保存：序列化 worker 回传真实字节数，自动保存对 16 MiB / 64 MiB 以上状态分别采用
  2.5 秒 / 5 秒合并窗口；显式写接口仍立即落盘。结构化克隆是 worker 快照机制的固有成本，
  本轮通过降低大状态自动快照频率缓解峰值，而非宣称完全消除克隆。
- 文件与配置：`/api/files` 改为 `opendir` 流式枚举并限制 2000 项；配置 JSON 限制 16 MiB；
  API 密钥文件限制 1 MiB；skills/plugins 目录流式枚举，最多检查 200 个技能候选，单个
  `SKILL.md` 限制 256 KiB；文件搜索同时限制 5000 个目录和 100000 个条目。
- 数据规模：项目总数限制 200，保存失败会回滚刚加入的项目；供应商余额响应限制 1 MiB。
- Claude wrapper：`.cmd` 最多读取 1 MiB，只接受 wrapper 所在目录树内且文件名严格为
  `claude.exe` 的候选，忽略先出现的其他 `.exe`。
- 更新包：ZIP 任意路径段若以点或空格结尾即拒绝，避免 Windows 规范化后产生覆盖或碰撞。
- 回归门禁：新增 `tests/resource-limits.mjs`，并把独立审计 harness 从“证明缺陷存在”翻转为
  修复回归；覆盖目录/项目上限、Claude wrapper 选择、toJSON/循环防护、并发 run 与 ZIP 边界。
- SSE 首帧：会话与终端的 snapshot 现在走与增量广播相同的有界背压队列，不再直写绕过
  `SSE_MAX_PENDING_BYTES` 记账。
- 终端回退：ANSI CSI 按 ECMA-48 完整 `0x40–0x7E` 终止字节清洗，提取为可独立测试的
  `public/terminal-text.js`；Windows 命令捕获按 UTF-8 字节上限截断，不再用 UTF-16 长度。
- 错误可观测性：Git 权限/安装/safe.directory 失败不再伪装成“非 Git 仓库”；前端会话对账失败
  写入 console 并提示用户；损坏 state 隔离失败时恢复说明明确写“原文件仍保留”。
- 路径口径：`/api/diff` 只在明确 ENOENT（Git 删除文件）时采用严格词法回退，权限和 I/O 错误
  不再降级；全局历史字节总量改为增量记账，publish 热路径不再扫描全部会话。
- 发布流程：源码归档在 `D:\CCDPH-source`，桌面运行目录移除 tests/docs/test-output/旧备份；
  `desktop.cjs` 在打包运行时校验 `runtime-integrity.json` 中的 SHA-256 清单，检测损坏后阻止启动。

## R9 独立复审整改索引（2026-09-28）

> 依据：`CCDPH-独立审查报告-20260928.md`（从零独立通读 + 真机执行，结论 0×P0 / 0×P1 / 12×P2 / 14×P3）。
> 代码内标记沿用审查报告的编号，写作 `R2-P2-x` / `R2-P3-x`（R2 = 第二份审查报告的批次）。
> 随 **v0.3.4** 发布（`package.json` 0.3.3 → 0.3.4，含 CHANGELOG 条目）。

### 数据安全与持久化

- `R2-P2-1` 隔离备份清理漏掉 `.oversize-*`：真名是 `state.json.oversize-<ts>-<uuid8>`，而旧判据要求
  前缀后**紧跟纯数字**，导致每个 ≥256MiB 的隔离文件永久堆积。改为「数字时间戳 + 可选短随机后缀」，
  恢复说明文件（`.txt`）仍被排除。
- `R2-P2-2` 原子写缺持久化栅栏：`writeFile + rename` 在掉电后可能留下零长/半截文件，下次启动被判为
  损坏并空白启动。改为独立句柄 `write → fsync → rename`，POSIX 上再尽力 `sync` 目录项。
- `R2-P2-3` 读失败与内容损坏不再混为一谈：带 errno 的读取失败（EACCES/EBUSY/EAGAIN/ETIMEDOUT…）
  现在**不改名隔离**、原文件保持不动，并把 `stateWritesBlocked` 置位 —— 之后的任何 `save()` 直接如实
  失败（400）而不是用空白数据覆盖「恢复说明里承诺保留」的原文件；损坏隔离**失败**时同样置位。
  后台解析超时补 `ETIMEDOUT`，不再被当成坏 JSON。

### 诚实性与契约

- `R2-P2-6` 运行失败的 SSE 事件（会进 `state.json` 并上屏）改走 `sanitizeError`，与 HTTP 错误响应同口径。
- `R2-P3-6` `sanitizeError` 补脱敏裸 `sk-*` / `Bearer *`（此前只有 `redactHookCommand` 处理它们）。
- `R2-P2-10` `/api/worktrees` 与 `/api/git-config` 区分「本来不是 Git 仓库」（正常业务状态，仍 200）
  与「git 调用失败」（未安装 / PATH 异常 / dubious ownership / 权限 / 15s 超时 → 抛错走 400 +
  脱敏文案）。前端 `renderGitConfig` 的静默 `catch{}` 改为如实展示错误。
- `R2-P3-1` `/api/git-config/save` 的 `scope` 必须显式是 `local`/`global`，不再把缺失/非法值静默落到
  最宽的 `--global`。
- `R2-P3-2` `/api/terminal/stop` 保留幂等契约（仍 200），但不再用裸 `{ok:true}` 谎称「停掉了」，
  改为如实回 `{ok:true, stopped:false, reason}`。
- `R2-P2-9` 会话右键菜单项统一走 `action()` 包装：失败有 toast，不再丢弃 Promise（「删除本地记录」
  这类不可逆操作此前失败时完全无反馈）。
- `R2-P2-7` 终端 SSE `onerror` 现在会收敛状态（`terminalExited=true` + 关闭流）、在输出区与设置区
  显示中断提示并给出重连指引，不再让面板永久谎报「运行中」且按键被静默丢弃。
- `R2-P3-7` MCP stdio 的 `env` 若含凭据类变量名（`*_TOKEN`/`*_API_KEY`/`*_AUTH`/`*_SECRET`/
  `*_PASSWORD`），写日志并在响应里带 `warning`，前端 toast 展示 —— 不拒绝（很多 MCP server 正靠 env
  取凭据），但绝不静默。

### 可用性与隔离

- `R2-P2-8` 专用 Edge 残留清扫不再无条件阻断启动：只在**调试端口确实仍在监听**时 fail-closed；
  端口已关闭（或 netstat 不可用）时继续启动并留警告日志。恢复提示改为按端口定位监听进程，
  不再让用户去结束一个可能属于他自己的普通浏览器的 PID。
- `R2-P2-12` 桌面版数据目录改为「显式传入的 `WORKBENCH_DATA_DIR` 优先」，`startup-warnings.log`
  也跟随该目录；打包冒烟用例（`tests/packaged-signature-fallback.mjs`）据此使用临时目录，
  不再改写部署版真实的 `.data` / `.desktop-data`。
- `R2-P2-12b` 用户级 MCP 配置 `MCP_FILE` 从写死 `~/.claude.json` 改为跟随 `CLAUDE_CONFIG_DIR` 的
  父目录（默认行为不变）。此前任何只改 `CLAUDE_CONFIG_DIR` 的测试/临时运行都会改写**真实**用户目录
  下的 `.claude.json`（实测已复现），与「离线套件全程使用临时数据目录」的承诺矛盾。
- `R2-P3-4` `fitsJsonBudget` 对 `Infinity` 放行、对 `NaN` 变 0 的不一致改为失败关闭：任何非有限
  `maxBytes` 一律按 0 处理。
- `R2-P3-5` `api-auth.json` 改用与 `state.json` 相同的 `fsync + rename` 持久化原子写，写中途崩溃
  不再留下截断的密钥库（那会导致「不可读 → 拒绝覆盖 → 手工清理前无法保存密钥」）。

### 完整性链与门禁

- `R2-P2-4` `runtime-integrity.json` 现在**扫描 `sdk.mjs` 运行期 `require()`** 并解析到真实文件，
  自动纳入 `ajv/dist/runtime/*`、`ajv-formats/dist/formats` 等依赖（此前 `ajv` 命中数为 0，
  替换这些文件后启动校验全绿）。解析失败直接抛错，拒绝生成不完整的清单。
- `R2-P2-5` 澄清完整性链的边界而不是假装它是强边界：清单必须声明
  `algorithm=sha256, purpose=corruption-detection`；启动失败文案明确写出「不能阻止对安装目录有写
  权限的进程替换文件并重新生成清单」；验签解释器覆盖 `CCDPH_SIGNATURE_POWERSHELL` 现在必须与
  `CCDPH_ALLOW_SIGNATURE_OVERRIDE=1` 同时设置才生效（单个环境变量不再能重定向验签）。
- `R2-P2-11` 门禁不再有「不发光的绿灯」：安全用例（终端恢复、打包签名降级）自我 skip 只记为**盲区**，
  新增 G8 规则「安全用例无盲区」，不加 `--allow-blind-spots` 时门禁 **NO-GO**；`npm audit` 的
  `--skip-audit` / 空输出 / 非 JSON 三种失败模式同样从 PASS 改为盲区，并每次都打印
  「Electron/Chromium 不在 npm 依赖树内，CVE 扫描不覆盖」。
- `R2-P3-9` 审批小窗补齐 `setWindowOpenHandler` / `will-navigate` / `will-redirect` 守卫（此前只有
  主窗有）。
- `R2-P3-10` 剪贴板权限判定改用 `details.requestingUrl` / `requestingOrigin`（真正发起请求的 frame），
  不再用 `wc.getURL()` 的顶层文档 origin —— 同源页面里内嵌的跨源 iframe 不再能拿到
  `clipboard-sanitized-write`。
- `R2-P3-11` 打包态两个窗口统一 `devTools:false`；审批窗显式声明 `webSecurity:true`。

### 卫生、a11y 与口径

- `R2-P3-3` 更新包 1 GiB 上限在解压**之后**按真实文件体积复核（此前只累加 ZIP 中央目录声明的
  `uncompressedSize`，声明值可伪造）。
- `R2-P3-8` `.gitignore` 补 `.env` / `.env.*`（保留 `.env.example`）。
- `R2-P3-12` 会话右键菜单：子项补 `role="menuitem"`、支持 Esc 关闭与 ↑/↓ 导航、关闭后焦点还给触发项。
- `R2-P3-13` `public/index.html` 的 54 个此前无可访问名称的表单控件全部补 `aria-label`
  （审计后实测：76 个控件中「无名」为 0）。
- `R2-P3-14` `tests/syntax-check.mjs` 从手写清单改为「显式应用文件 + 自动扫描 `tests/`、`browser/`」
  （此前漏掉含 24KB `behavior.mjs` 在内的 4 个文件；覆盖数 49 → 53）；README 删掉指向**不存在**的
  `test/` 目录与 6 个用例的段落，改为真实测试布局与门禁说明；`package-lock.json` 根版本 0.3.2 → 0.3.3；
  `package.json` 补 `engines.node >= 20`。
- `R2-P3-15`（审查报告中的 speculative 项）CDP 端口匹配从字符串后缀 `endsWith(":9223")` 改为取最后一个
  冒号后的**完整端口号**再比较（同时兼容 `[::1]:9223`）。

### 本轮有意保留（未修，属已声明的接受项）

- **完整性清单不能自校验**：清单无法覆盖自己的哈希，且生成脚本本身也在清单里。任何对安装目录有写
  权限的进程都能重跑 `npm run integrity` 得到一份自洽清单。这是便携部署的固有边界，本轮的做法是
  **把边界写清楚**（清单用途声明 + 启动文案 + README），而不是假装它不可绕过。
- **`stopDedicatedEdge` 的 PID TOCTOU**：身份复核与 `taskkill /T /F` 之间仍是裸 PID。窗口在毫秒级，
  且已先复核身份；改为「即刻重新枚举 + 句柄级终止」在当前依赖（tasklist/netstat/taskkill）下没有
  可靠实现，故保留并在此登记。
- **签名验证失败仅告警**：这是既定设计（不得成为启动单点故障），本轮只澄清其与「完整性失败即阻止
  启动」两条路径的语义差异，未改变行为。

### 本轮验证

- `node tests/syntax-check.mjs` → `syntax ok: 53 files`- `npm test` → 45/45
- `node tests/api-tests.mjs` → 69/69（P0 失败 0）
- `node tests/gate.mjs` → **NO-GO**，唯一 FAIL 是 G8 盲区 `packaged-signature-fallback`
  （未设置 `CCDPH_PACKAGED_EXE`）；`--allow-blind-spots` 后 GO 8/8。
- 一次性探针（仓库外 `d:\ccdph-audit-tmp\r2-verify.mjs`）实测确认：`.oversize-*` 被清理且 readme 保留；
  非 git 目录仍是 200 业务状态；缺失/非法 `scope` 回 400；`terminal/stop` 未知 id 回
  `{ok:true,stopped:false}`；MCP 凭据 env 带出明文落盘告警且**未写入真实 `~/.claude.json`**；
  `state.json` 读取失败时读接口仍 200、写接口 400、原文件（含内容）零改动、不生成 `.corrupt-*`。

