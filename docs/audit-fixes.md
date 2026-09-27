# CCDPH 审计修复索引

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
