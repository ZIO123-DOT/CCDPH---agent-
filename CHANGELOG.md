# Changelog

本项目的重要变更记录于此。格式参考 Keep a Changelog，版本号遵循语义化版本。

## [0.3.7] - 2026-09-28

> 第五轮修复：把第四轮标为「已接受」的两项安全边界做真正的修复（不再只是声明接受）。

### Fixed

- **P2-4（安全边界，真修复）** 专用浏览器调试端口默认不再固定 `9223`。CDP 协议无鉴权，固定默认端口
  等于任何同机进程都知道该连哪里。现在启用专用模式时**随机分配高端口（20000–59999）并持久化**：
  `/api/browser/enable` 与 `/api/browser/launch` 在未显式配置端口时调用 `randomDedicatedPort()`；
  `cdpEndpointFromSettings` / `buildPlaywrightMcpConfig` / `reconcileDedicatedBrowser` 三个读路径
  对端口未配置（0）一律 **fail-closed**（返回空端点 / 不注入 MCP / 拒绝启动），不再回退可预测端口。
- **P3-4（令牌，真修复）** 启动令牌 `token`（出现在窗口 URL hash）改为**单次使用**：渲染层用它换取
  HttpOnly 会话 Cookie 后立即作废。此后即使同机进程在启动窗口期读到了 URL hash，也拿不到持久会话
  凭据。主进程的审批提交改用独立的 `streamAuthToken`（经 `getRuntime()` 暴露给主进程，不进 URL、
  不进任何回传渲染层/落盘的结构）。

### 回归护栏

- `settings-load-validation.mjs` 断言从「非法端口回退 9223」改为「回退 0（未配置，启用时随机分配）」。

### Notes

- **未修（保留声明）**：① `server.mjs` 6266 行单体内聚属重构范畴，非缺陷，强行拆分引入回归风险
  大于收益；② git 历史为 squash 重建，无法在不改写全部提交哈希的前提下追溯补粒度（属一次性历史
  事实，非可修复缺陷）。

## [0.3.6] - 2026-09-28

> 第四轮独立审查（从零通读 + 四链技能 + 实测压测）后的修复轮。结论 0×P0 / 0×P1 / 4×P2 / 6×P3。

### Fixed

- **P2-1（文档）** 补上 `docs/browser-integration-design.md` —— `browser/service.mjs` / `detect.mjs` /
  `mcp-config.mjs` 的注释长期引用该设计文档（§5.2/§7.1/§7.2/§8/§13.3）但文件缺失。现按实际实现
  补全：CDP 端点解析、浏览器探测、MCP 运行时注入、专用浏览器生命周期与安全边界。
- **P2-4（安全边界）** 专用授权浏览器的 CDP 调试端口是「本机回环 + 无鉴权」的固有暴露面（CDP
  协议本身无令牌/鉴权）。启动清扫 + 退出整树收尾已覆盖「残留」窗口，但「运行中」窗口此前未向
  用户说明。现在 `browserStatus` 对专用模式带出 `securityNote`，由 `/api/browser/status` 回传，
  让设置页如实提示该端口的暴露面。
- **P3-1（校验口径）** `normalizeModel` 现拒绝 `__proto__` / `prototype` / `constructor`，与
  MCP/hook 名、审批答案的原型污染收口口径统一（此前白名单会放行这些不可能合法的模型名）。
- **P3-3（诊断）** `scanStateComplexity` 区分「唯一节点数（nodes）」与「引用总数（references）」。
  旧实现只返回去重后的 nodes，大量共享引用（如 20 万槽位指向同一对象）会让复杂度诊断低估真实
  遍历成本与内存占用。
- **P3-5（完整性）** `checkForUpdate` 对明文 http（本机回环）更新源带出 `warning`：sha256 与清单
  同源拉取，无法抵御可伪造回环流量的同机进程。不阻断（本机测试源是合法用例），但绝不静默。
- **P3-6（出站请求）** `/api/browser/tabs/close` 在出站 `fetch /json/close` 前显式用 `probeCdp`
  复核目标端口**此刻仍是 CDP 端点**，把「这是 CDP 端点」从隐式（Playwright 已连上）改成显式，
  杜绝把 close 请求发到任意本地服务。

### 回归护栏

- 更新 `tests/behavior.mjs` 的 `scanStateComplexity` 断言以覆盖新增的 `references` 字段（环引用
  用例：nodes=1 / references=2，验证去重与引用计数分离）。

### Notes

- **未修（已声明的接受项）**：① 专用 CDP 端口无鉴权是 CDP 协议固有面，本轮以 `securityNote`
  如实告知 + 既有「回环绑定 + 启动清扫 + 退出收尾」缓解，不引入 CDP 鉴权代理（过度工程）；
  ② `server.mjs` 6266 行单体内聚属重构范畴，非缺陷，留待后续按关注点拆分；③ 单一静态令牌已由
  「URL 摘除（replaceState）+ HttpOnly Cookie + 不落盘」缓解，同机威胁模型下的残余风险与 CDP
  端口同源。
- **发布卫生**：补 `v0.3.2` 追溯标签（锚定 `aa3bac0`，见该 tag 注释）；git 历史为 squash 重建，
  细粒度条目无法 1:1 追溯，后续建议原子提交。

## [0.3.5] - 2026-09-28

> 针对第二份独立复审（`CCDPH-前端独立深审报告-20260928-第二次.md`，0×P0 / 0×P1 / 4×P2 / 11×P3）
> 的完整修复轮。全部 P2 与 P3 已修复或如实回报，并补齐回归护栏。

### Fixed

- **P2（性能）** markdown 定界符预检按「代价」而非「字符种类」计数。旧实现只数 `*`/`_`，
  散落的 `` ` ``/`~` 完全放行 —— 实测 120,000 字符的 `` `a `` 让 `markdown()` 阻塞 **1041 ms**
  （Node 复核 1542 ms）。现在 `* _ ` ~` 与成对链接 `[...](...)` 统一纳入预算（阈值 4000，实测
  最坏约 25–30 ms），病态输入一律降级为纯文本；`` `a ``×60000 从 1041 ms 降到 **0.6 ms**。
- **P2（保真）** 同一条预检误伤正文：`*`+`_` 超过 1500 就把整条消息静默降级为纯文本，
  且超过 10 万字符的部分被静默截断（页面上不可见）。阈值提高到 4000 后真实代码/散文不再命中
  （按实测密度 server.mjs 要 700 KB、purify 要 240 KB 才会触发，都超过单条事件上限）；同时降级
  产物现在带**可见说明**，截断时明确写出"仅显示前 N 字符、共 M 字符、完整内容见导出"。
- **P2（状态）** 终端启动补代际保护：`startTerminalOnce` 在 `await terminal/start` 前后比对
  导航代数，用户切项目/切会话后迟到的响应被丢弃并显式停掉那个终端（不再把旧终端绑到新视图）。
- **P2（并发）** `/api/settings` 在 `await` 浏览器 reconcile 之后再以**提交时刻**的 `db.settings`
  为基底重建，不再用 await 之前构建的克隆整体赋值 —— 修复 `recordDailyUsage`（不在队列里）在
  保存期间被静默覆盖的丢失更新。
- **P3** 完整性清单覆盖运行期会加载的 `playwright` / `@playwright/mcp`（旧清单 0 条，实测 364 个
  文件约 36 MiB 全未覆盖；现在纳入其可执行文件面，清单 44 → 196 条）。
- **P3** 清单生成器遇到符号链接/联接点即报错（旧实现静默跳过，可让清单漏项且不报错）。
- **P3** `/api/skills` 的 `SKILL.md` 与项目 `.mcp.json` 读前 `lstat` 拒绝符号链接 —— 修复
  「项目里放一个指向外部的链接，把外部文件首行/元数据通过 API 回传」的实测漏洞。
- **P3** `state.json` 载入时对 `settings.browser.*` 做与写入路径一致的校验（端口、mode 枚举、
  origin 列表字符白名单），不再信任本地可写文件里的任意值。
- **P3** markdown 的 class 剥离失败改为「失败关闭」（用禁用 class 的净化重跑），不再把模型可控
  的类名原样放行；图片 `type` 在渲染侧加白名单；`/api/terminal/stop` 已如实回 `stopped`/`reason`
  （并补测试锁定）。
- **P3** `connectSession` 增加连接序号，杜绝两次调用落在同一 await 窗口时孤儿 EventSource 的泄漏。
- **P3** 浏览器 origin 列表（allow/block）加字符白名单，拒绝 `;`/引号/CRLF/前导 `-`。
- **P3** a11y：3 个仅图标按钮补名称（停止生成 / 关闭）、4 个视觉隐藏的原生 `<select>` 移出 tab 序
  （保留读屏可读）、会话右键菜单补 `aria-label`。
- **P3** 来源校验加固：拒绝**重复 Host 头**与**绝对形式请求行**（`GET http://evil/... HTTP/1.1`）；
  `trustedSender` 把"主框架"校验提到 origin 之前；审批小窗改用**最小 preload**
  （`preload-approval.cjs`，只暴露 `workbenchApproval.submit`，不再持有主窗全套桥）。

### 回归护栏

- 新增 6 个测试模块并入 `npm test`：`markdown-guard`、`settings-load-validation`、
  `symlink-guards`、`request-gate-hardening`、`integrity-manifest`、`a11y-dom`；
  并把它们的标记加入 `gate.mjs` 的必需清单（G1）。语法检查覆盖 53 → 60 文件。

## [0.3.4] - 2026-09-28

> 第二份**独立复审**（从零通读 + 真机执行，未参考既往记录）后的修复轮。
> 结论为 0×P0 / 0×P1 / 12×P2 / 14×P3：对外攻击面已确认坚固，问题集中在
> **出错时的诚实性、数据持久化、完整性链与门禁可信度**。条目编号沿用该报告。

### Fixed

- **P2**（数据）隔离备份清理漏掉 `.oversize-*`：真名带 `-<uuid8>` 后缀，而旧判据要求前缀后
  紧跟纯数字，导致每个 ≥256MiB 的隔离文件**永久堆积**。现允许「时间戳 + 可选短随机后缀」，
  恢复说明文件（`.txt`）仍被排除。
- **P2**（数据）状态写盘缺持久化栅栏：`writeFile + rename` 在掉电后可能留下零长/半截文件，
  下次启动被判损坏并以**空白**数据启动（整个会话库「消失」）。现为
  `独立句柄写 → fsync → rename`，POSIX 上再尽力 `sync` 目录项。
- **P2**（数据）**读取失败被当成内容损坏**：带 errno 的失败（EACCES/EBUSY/EAGAIN/ETIMEDOUT）
  会把完好的 `state.json` 改名隔离，而隔离**失败**时仍以空白启动、随后任意一次保存都会覆盖
  「恢复说明里承诺保留」的原文件。现在读取失败不改名、不覆盖，并暂停写盘（读接口仍可用，
  写接口如实回 400 并说明原因）；隔离失败同样暂停写盘。
- **P2**（诚实性）运行失败的 SSE 事件文本会进 `state.json` 并上屏，却不经脱敏出口。现走
  `sanitizeError`，与 HTTP 错误同口径；`sanitizeError` 另补裸 `sk-*` / `Bearer *` 脱敏。
- **P2**（诚实性）`/api/worktrees` 与 `/api/git-config` 把「git 调用失败」（未安装 / PATH 异常 /
  dubious ownership / 权限 / 超时）伪装成 200「当前工作区不是 Git 仓库」。现在只有确认不是仓库
  才走该业务状态，其余抛错并回脱敏文案；前端 Git 面板的静默 `catch{}` 改为如实展示错误。
- **P2**（诚实性）会话右键菜单项丢弃 Promise：请求失败（服务重启 / 401 / 500）时无 toast、
  无 catch，「删除本地记录」这类不可逆操作会看起来「什么都没发生」。现统一走 `action()`。
- **P2**（诚实性）终端 SSE 中断后状态不收敛：面板继续显示「活的」提示符、设置区显示「运行中」，
  却再也不会写入输出、按键被静默丢弃、重新选中页签也不重启。现收敛状态 + 显示中断提示 + 可重连。
- **P2**（可用性）专用 Edge 残留清扫在身份「不可核验」时**无条件拒绝启动**，且提示会让用户去结束
  一个可能属于他自己的普通浏览器的 PID。现在只在无鉴权调试端口**确实仍在监听**时 fail-closed，
  端口已关闭（或无法判定）时继续启动并留警告日志；恢复提示改为按端口定位监听进程。
- **P2**（隔离）打包签名降级用例会启动部署版 exe 并改写其**真实** `.data`
  （`runtime.json` / `startup-warnings.log`）与 `.desktop-data`。现在 `WORKBENCH_DATA_DIR` 的
  显式取值优先（含 `startup-warnings.log` 的落点），该用例改用临时目录并自行清理。
- **P2**（隔离，复审外补充）用户级 MCP 配置 `MCP_FILE` 原写死 `~/.claude.json`，任何只改
  `CLAUDE_CONFIG_DIR` 的测试/临时运行都会改写**真实**用户配置（实测已复现）。现改为跟随
  `CLAUDE_CONFIG_DIR` 的父目录（默认行为不变），`tests/api-tests.mjs` 一并调整为临时根目录。
- **P2**（完整性）清单未覆盖 `sdk.mjs` **运行期** `require()` 的依赖：替换
  `node_modules/ajv/dist/runtime/*.js` 后启动校验全绿（实测 `ajv` 命中数 = 0）。生成器现在扫描
  `sdk.mjs` 的 `require()` 并解析到真实文件自动纳入（清单 39 → 44 条），解析失败直接拒绝生成。
- **P2**（完整性）澄清边界而非假装是强边界：清单必须声明
  `algorithm=sha256, purpose=corruption-detection`；启动失败文案写出「不能阻止对安装目录有写权限
  的进程替换文件并重新生成清单」；验签解释器覆盖 `CCDPH_SIGNATURE_POWERSHELL` 现在必须与
  `CCDPH_ALLOW_SIGNATURE_OVERRIDE=1` 同时设置才生效。
- **P2**（门禁）门禁存在「不发光的绿灯」：被 skip 的安全用例计入「已满足」，`npm audit` 在
  `--skip-audit` / 空输出 / 非 JSON 三种模式下全部 PASS。现在自我 skip 只记为**盲区**，新增
  **G8「安全用例无盲区」**（不加 `--allow-blind-spots` 即 NO-GO，加了也会把盲区印在报告与
  `--json` 里），G6 每次都会打印「Electron/Chromium 不在 npm 依赖树内，CVE 扫描不覆盖」。
- **P3** 更新包 1 GiB 上限此前只累加 ZIP **声明**的 `uncompressedSize`（可伪造），现在解压后按
  真实体积复核；`api-auth.json` 改为 `fsync + rename` 原子写；`fitsJsonBudget` 对 `Infinity`
  放行 / 对 `NaN` 变 0 的不一致改为失败关闭。
- **P3** `/api/git-config/save` 的 `scope` 必须显式是 `local`/`global`，不再把缺失/非法值静默落到
  最宽的 `--global`；`/api/terminal/stop` 保留幂等（仍 200）但如实回 `{ok:true,stopped:false,reason}`；
  MCP stdio 的 `env` 含凭据类变量名时写日志并在响应带 `warning`（不拒绝，但绝不静默）。
- **P3** 审批小窗补齐 `setWindowOpenHandler` / `will-navigate` / `will-redirect` 守卫；剪贴板权限
  判定改用发起请求的 frame（`details.requestingUrl`），跨源 iframe 不再能拿到
  `clipboard-sanitized-write`；打包态两窗统一 `devTools:false`。
- **P3** 会话右键菜单补 `role="menuitem"`、Esc 关闭与 ↑/↓ 导航、关闭后焦点归位；`public/index.html`
  的 54 个表单控件补 `aria-label`（76 个控件中「无可访问名称」降为 0）。
- **P3** `tests/syntax-check.mjs` 从手写清单改为「显式应用文件 + 自动扫描 `tests/`、`browser/`」
  （此前漏掉含 24KB `behavior.mjs` 在内的 4 个文件，49 → 53）；README 删掉指向**不存在**的
  `test/` 目录与 6 个用例的段落，改为真实测试布局 + 门禁说明；`package.json` 补 `engines.node >= 20`。
- **P3** CDP 端口匹配从字符串后缀 `endsWith(":9223")` 改为取最后一个冒号后的完整端口号比较
  （兼容 `[::1]:9223`）。

### Notes

- 版本一致性：`package-lock.json` 根版本此前停留在 `0.3.2`，本版与 `package.json` 对齐。
- **未修（已声明的接受项）**：① 完整性清单无法自校验 —— 对安装目录有写权限的进程总能重跑
  `npm run integrity` 得到自洽清单，本版把这条边界写进清单用途声明、启动文案与 README，而不是
  假装它不可绕过；② `stopDedicatedEdge` 身份复核与 `taskkill` 之间仍是毫秒级 PID TOCTOU；
  ③ 签名验证失败仅告警（既定设计：不得成为启动单点故障）。
- 门禁变化会影响发布流程：`node tests/gate.mjs` 现在有 **8 条规则**，未设置 `CCDPH_PACKAGED_EXE`
  时 `packaged-signature-fallback` 自我 skip，因此**默认 NO-GO**；确需放行必须显式加
  `--allow-blind-spots`（盲区仍会打印），或提供打包 exe 供该用例真实执行。
- 改动 `public/**` 或依赖后发布前**必须**重跑 `npm run integrity`：清单包含 `package.json`、
  `package-lock.json`，以及 `sdk.mjs` 运行期 `require()` 的全部依赖文件。

## [0.3.3] - 2026-09-27

> 全量审查（一次性通读全部源文件）后的修复轮。以下条目的编号对应审查报告中的 P1/P2/P3。

### Fixed

- **P1** `public/app.js` 引用了未导入的 `MARKDOWN_FALLBACK_LIMIT`：实时渲染失败时的降级分支
  会二次抛 `ReferenceError`。现已由 `markdown-renderer.js` 导出并在 `app.js` 引入。
- **P1** 更新批处理的 `spawn` 没有 `error` 监听：`cmd.exe` 启动失败会触发主进程全局
  uncaughtException 兜底、把应用直接退出。现在改为等待 `'spawn'` 确认启动成功后再 `unref()`，
  失败则如实回 400 并回收暂存目录。
- **P2** `/api/mcp-servers/save` 缺少名称校验：`name:"__proto__"` 会走原型 setter，
  条目不落盘却返回 `{ok:true}`，并临时改写对象原型。现与 delete 分支共用同一正则，
  且读取既有条目改用 `Object.hasOwn`。
- **P2** `/api/session/control` 对"明确请求但未应用"的字段仍回 `liveApplied:true`：
  运行中切换到自定义供应商模型时界面提示"已更新"而实际未生效。现在如实回报 `rejected`
  列表，前端据此提示"已更新，但运行中无法应用：…（未生效）"。
- **P2** 深状态折叠备份的 `copyFile` 失败会永久保留 pending，导致此后每次 `save()` 都抛错、
  进程终生无法持久化。现在区分 `ENOENT`（原文件已不存在 → 跳过备份继续写盘）与其他错误。
- **P2** `/api/session/update`、`/api/session/delete`、`/api/api-profiles/activate`
  都是"先改内存/先删目录再落盘"，写盘失败无回滚。现已分别加回滚；
  其中 delete 调整为**先落盘再删 worktree**，把不可逆操作挪到安全位置。
- **P2** `/api/stop` 未进 `sessionWriteQueue`，"发送后立刻停止"可能赶在 `runs` 注册前执行、
  取不到 run 仍回 `{ok:true}`。现已与 `/api/send` 共用同一串行队列。
- **P2** 更新 `.bat` 复制失败时只删暂存目录并退出，应用既没更新也没重启。现在失败分支
  会重新拉起应用。
- **P2** `/api/worktrees` 把未脱敏的 git 原始报错（常含绝对路径）塞进 200 body，绕过统一
  脱敏出口。现改用 `sanitizeError`。
- **P2** `preload.cjs` 的 `off*` 以回调对象为键（`WeakMap`），而 `contextBridge` 跨桥回调
  身份不保证一致 → `off*` 静默失效、监听器叠加。现改为每个 channel 只保留一个包装监听器。
- **P2** 桌面审批小窗提交失败时仍按"已解决"处理（发 resolved + 标记 settled），决策丢失
  且无反馈。现在只有提交成功才如此处理，失败则交还会话内卡片供重试。
- **P2** 完整性清单未覆盖渲染层实际加载的两个安全关键库
  （`node_modules/marked/lib/marked.esm.js` → `/vendor/marked.js`、
  `node_modules/dompurify/dist/purify.es.mjs` → `/vendor/purify.js`）。现已纳入清单
  （条目数 37 → 39）。
- **P2** `tests/packaged-signature-fallback.mjs` 是孤儿测试（只做语法检查、从不执行），
  "签名不可验证时必须告警并继续启动"没有任何门禁在守。现已接入 `tests/run.mjs`，
  并登记为 `gate.mjs` 的可选用例（无 `CCDPH_PACKAGED_EXE` 时自我 skip）。
- **P2** 会话消息区没有实时区域，屏幕阅读器不会朗读任何新消息。现加
  `role="log" aria-live="polite"`。

### Notes

- 本版随附的运行时可执行文件为 **Electron 44.3.0**（见运行版 `version` 文件）。
  该二进制不在 `package.json` 的依赖范围内，因此 **`npm audit` 不覆盖 Electron 及其内置
  Chromium/Node/V8 的 CVE**；升级 Electron 时需另行核对。
- 改动 `public/**` 后发布前**必须**重跑 `npm run integrity` 重新生成
  `runtime-integrity.json`，并把应用文件与清单**一起**同步到运行版。

## [0.3.2] - 2026-09-27

### Added

- 增加运行时 SHA-256 清单生成器，并覆盖 Claude Agent SDK 与 `claude.exe`。
- 增加浏览器生命周期、凭据加密/锁定/会话降级、接口鉴权与残留标记回归测试。
- 增加 HttpOnly 会话 Cookie，普通 API、SSE 与卸载清理请求使用同一会话鉴权。

### Changed

- 供应商密钥在 Windows 上改用当前用户 DPAPI 加密；没有系统安全存储时仅驻留内存。
- Claude Code 签名无法验证时改为记录告警并继续启动；运行时清单损坏仍阻止启动。
- 专用 Edge 的启动、切换、重启和异常退出清理统一走浏览器生命周期协调器。
- 启动令牌换取 Cookie 后立即从渲染进程内存清除，不再写入 `sessionStorage`。

### Fixed

- 修复 dedicated→attach、通用设置入口和端口/profile 变化造成的 Edge/CDP 残留或状态不一致。
- 修复未选择项目时无法读取用户级 MCP 列表。
- 修复旧明文密钥迁移失败导致应用无法启动，以及锁定密钥库被后续写入覆盖的问题。
- 修复实时会话控制失败时内存、磁盘与 SDK 状态不一致。
- 修复全局历史裁剪排序缓存可能使用陈旧会话优先级。
- 修复终端 SSE 帧上限重复硬编码和 Electron 字符串脚本注入路径。
- 修复模型输出中的 `id`/`name` 通过 DOM Clobbering 遮蔽停止、发送、设置等真实控件。
- 修复 401 后缺少统一重新鉴权与明确重启提示的问题。
- 修复创建会话期间导航竞态覆盖当前会话，以及 SSE 重连清空原生审批抑制状态的问题。
- 修复并发 `refreshState()` 的旧响应覆盖较新状态，以及隐藏状态下从 bfcache 恢复后资源永久不重挂的问题。
- 修复桌面更新成功后因未定义超时常量被误报失败并提前释放安装闸门。
- 修复并发浏览器状态请求重复建立 CDP 连接，以及 Hooks update 数组分支写回脱敏命令的问题。
- Worktree 创建改用随机目录原子预留，并在 Git 创建后重新验证真实路径包含性。
- 残留专用 Edge 无法核验时的启动错误增加 PID 标记路径与安全恢复指引。
- Windows PowerShell、where 和 cmd 调用统一固定到 System32 绝对路径，更新批处理内的外部工具亦使用系统绝对路径。
- Hooks update 的单命令分支补齐 MED-16 脱敏还原；终端残留清理在每次 taskkill 前重新核验 PID 身份。
- Worktree 失败清理可递归回收受控普通目录，并记录无法清理的残留。
- 长驻 PowerShell 进程快照助手改用请求 ID 配对响应，避免额外 stdout 行导致 FIFO 错位。
- 终端清理失败记录现在会合并进后续快照，即使同一会话继续创建/结束终端，也会保留到下次启动重试。
- 终端注册表失败记录保留行为已补齐回归测试，覆盖“同一会话后续有终端活动”和“无终端活动”两条路径。
- 启动时清理历史终端快照临时文件，并忽略注册表中的非法 PID；有效 PID/启动身份的去重规则保持不变。
- 终端注册表读取错误与 JSON 损坏分开处理：瞬时 I/O/权限错误保留恢复记录，只有确认无法解析的文件才删除。
- 终端注册表曾因读取失败而保留时，后续快照会先重试读取；仍不可读则跳过覆写，恢复后先合并磁盘旧记录再写入。

### Security

- 系统工具调用固定使用 Windows System32 绝对路径。
- 异常退出浏览器 PID 标记改为原子写入；标记损坏、身份不可核验或清理失败时 fail-closed。
- JSON/SSE 响应统一增加 `nosniff` 与 `no-referrer`。

## [0.3.1] - 2026-09-26

### Changed

- 移除 DeepSeekHarness 引擎与切换界面，运行引擎固定为 Claude Code。
- 建立源码 Git 基线与便携运行版完整性检查。
