# Changelog

本项目的重要变更记录于此。格式参考 Keep a Changelog，版本号遵循语义化版本。

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
