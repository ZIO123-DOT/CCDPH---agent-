import path from "node:path";

export function createIntegrationRoute(deps) {
  const {
    DATA,
    MAX_HOOKS_PER_EVENT,
    SUPPORTED_HOOK_EVENTS,
    body,
    browserStatus,
    cdpEndpointFromSettings,
    commitBrowserSettings,
    credentialEnvKeyPattern,
    detectBrowsers,
    getDb,
    getExternalOpener,
    hooksCount,
    hooksWriteQueue,
    isValidPort,
    json,
    mcpWriteQueue,
    readJsonFile,
    readMcpDoc,
    readSettingsJsonStrict,
    requireObject,
    restoreRedactedHookCommands,
    sanitizeMcpEntry,
    serializeHooks,
    settingsJsonPath,
    settingsWriteQueue,
    validateHookItem,
    validateHooksStructure,
    workspaceRoot,
    writeMcpDoc,
    writeSettingsJson,
  } = deps;

return async function routeIntegrationDomain(req, res, url, pathname) {
  const db = getDb();
  const externalOpener = getExternalOpener();
  if (req.method === "GET" && pathname === "/api/browser/detect") {
    return json(res, await detectBrowsers());
  }
  if (req.method === "GET" && pathname === "/api/browser/status") {
    const info = await browserStatus(db.settings.browser);
    return json(res, {
      engine: "claude",
      enabled: Boolean(db.settings.browser?.enabled),
      mode: db.settings.browser?.mode || "attach",
      connection: {
        connected: info.connected,
        browser: info.browser,
        version: info.browser,
        port: info.port,
        cdpEndpoint: await cdpEndpointFromSettings(db.settings.browser),
      },
      tabs: info.tabs || [],
      ...(info.launchError ? { launchError: info.launchError } : {}),
    });
  }
  if (req.method === "POST" && pathname === "/api/browser/enable") {
    const input = requireObject(await body(req));
    return await settingsWriteQueue(async () => {
      const mode = ["attach", "dedicated"].includes(input.mode) ? input.mode : "attach";
    // CCDPH-FIX(MED-2): 先整体校验、再一次性赋值。原实现一进门就写
    // db.settings.browser.enabled = true / mode = mode，之后才校验端口 ——
    // POST {mode:"dedicated", dedicatedPort:80} 回 400「端口需在 1024-65535 之间」，
    // 但内存里 browser.enabled 已经是 true：随后任何一次 publish→scheduleSave、
    // 设置保存或浏览器调用都会把这个「被拒绝的意图」写进 state.json，浏览器徽标亮起、
    // browserMcpEnabled() 还会开始向新的 Claude 轮次注入 Playwright MCP。
    const next = { ...(db.settings.browser || {}), enabled: true, mode };
    if (input.dedicatedPort !== undefined) {
      // CCDPH-FIX: 与 /api/settings 用同一条端口校验，杜绝把端口设为 80 这类特权端口
      if (!isValidPort(input.dedicatedPort))
        throw new Error("端口需在 1024-65535 之间");
      next.dedicatedPort = input.dedicatedPort;
    }
    if (Array.isArray(input.blockOrigins))
      next.blockOrigins = input.blockOrigins
        .filter((s) => typeof s === "string")
        .map((s) => s.trim().slice(0, 200))
        .slice(0, 50);
    if (mode === "dedicated") {
      const profileDir = next.profileDir || path.join(DATA, "browser-profile");
      next.profileDir = profileDir;
    }
    await commitBrowserSettings(next);
      const status = await browserStatus(db.settings.browser);
      return json(res, { ok: true, browser: status });
    });
  }
  if (req.method === "POST" && pathname === "/api/browser/disable") {
    return await settingsWriteQueue(async () => {
      await commitBrowserSettings({ ...db.settings.browser, enabled: false });
      return json(res, { ok: true });
    });
  }
  if (req.method === "POST" && pathname === "/api/browser/launch") {
    const input = requireObject(await body(req));
    const mode = ["attach", "dedicated"].includes(input.mode) ? input.mode : "attach";
    const msedge = (await detectBrowsers()).browsers.find((b) => b.kind === "edge")?.path;
    if (!msedge) throw new Error("本机未找到 Edge");
    if (mode === "attach") {
      // CCDPH-FIX: edge:// 是浏览器内部 URL，必须走系统 shell.openExternal。
      // 原实现把它交给 setPathOpener（内部第一步是 fs.stat），必然 ENOENT 报错。
      if (externalOpener) {
        await externalOpener("edge://inspect/#remote-debugging");
        return json(res, {
          ok: true,
          opened: true,
          hint: "请在打开的页面勾选 Allow remote debugging，然后回到设置刷新",
        });
      }
      // 拿不到外部 opener（例如浏览器开发版）时如实降级，不要假装已打开
      return json(res, {
        ok: true,
        opened: false,
        hint: "请手动在 Edge 地址栏打开 edge://inspect/#remote-debugging 并勾选 Allow remote debugging，然后回到设置刷新",
      });
    }
    return await settingsWriteQueue(async () => {
      const profileDir = db.settings.browser.profileDir || path.join(DATA, "browser-profile");
      await commitBrowserSettings({
        ...db.settings.browser,
        enabled: true,
        mode: "dedicated",
        profileDir,
      });
      return json(res, { ok: true, hint: "专用授权浏览器已启动，请在其中登录你需要的网站（登录态长期保留）" });
    });
  }
  if (req.method === "GET" && pathname === "/api/browser/tabs") {
    const status = await browserStatus(db.settings.browser);
    return json(res, { tabs: status.tabs || [] });
  }
  if (req.method === "POST" && pathname === "/api/browser/tabs/close") {
    const input = requireObject(await body(req));
    if (!input.targetId) throw new Error("缺少 targetId");
    // CDP /json/close/<id>
    const status = await browserStatus(db.settings.browser);
    const port = status.port;
    if (!port) throw new Error("浏览器未连接");
    // CCDPH-FIX(F-06): 与文件里其它出站请求一致加显式超时。fetch 默认没有超时，
    // CDP 端口被僵尸进程占住（accept 后不回包）时这个请求会永远挂着、请求槽被占死，
    // 而 .catch(() => null) 只处理 rejection、处理不了「一直不返回」。
    let res2 = null;
    let closeError = "";
    try {
      res2 = await fetch(
        `http://127.0.0.1:${port}/json/close/${encodeURIComponent(input.targetId)}`,
        { signal: AbortSignal.timeout(5000) },
      );
      // CCDPH-FIX(P3-21): 不消费响应体时套接字会滞留到超时/GC。这里读掉（丢弃内容）。
      await res2.text().catch(() => "");
    } catch (error) {
      closeError =
        error?.name === "TimeoutError"
          ? "CDP 未在 5 秒内响应"
          : String(error?.message || error);
    }
    return json(res, {
      ok: Boolean(res2 && res2.ok),
      ...(closeError ? { error: closeError } : {}),
    });
  }
  // ---- MCP 服务器管理：读写 ~/.claude.json 的 mcpServers（Claude Code 用户级标准配置） ----
  if (req.method === "GET" && pathname === "/api/mcp-servers") {
    const projectId = url.searchParams.get("projectId");
    const root = projectId
      ? workspaceRoot(projectId, url.searchParams.get("sessionId"))
      : "";
    const [doc, projectMcp] = await Promise.all([
      readMcpDoc(),
      root ? readJsonFile(path.join(root, ".mcp.json")) : {},
    ]);
    const list = [];
    for (const [name, entry] of Object.entries(doc.mcpServers || {}))
      list.push({
        name,
        source: "user",
        type: entry.type === "http" || entry.url ? "http" : "stdio",
        command: entry.command || "",
        args: entry.args || [],
        url: entry.url || "",
        envKeys: Object.keys(entry.env || {}),
        headerKeys: Object.keys(entry.headers || {}),
      });
    for (const [name, entry] of Object.entries(projectMcp.mcpServers || {}))
      list.push({
        name,
        source: "project",
        type: entry.type === "http" || entry.url ? "http" : "stdio",
        command: entry.command || "",
        args: entry.args || [],
        url: entry.url || "",
        envKeys: Object.keys(entry.env || {}),
        headerKeys: Object.keys(entry.headers || {}),
      });
    return json(res, { servers: list });
  }
  if (req.method === "POST" && pathname === "/api/mcp-servers/save") {
    const input = requireObject(await body(req));
    const name = String(input.name || "").trim();
    // CCDPH-FIX(P2-1): save 分支此前**没有**名称校验（delete 分支 F-10 有），于是
    // name:"__proto__" 会走 `doc.mcpServers["__proto__"] = entry` 的原型 setter ——
    // 条目不落盘却回 {ok:true}（失败伪装成功），并临时改写该对象的原型。
    // 这里与 delete 分支使用同一正则（首个字符必须是字母数字 → "__proto__"/"constructor"
    // 这类原型相关名一律拒绝）。
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name))
      throw new Error("MCP 名称只能是字母数字与 .-_（≤64 字符）");
    const entry = sanitizeMcpEntry(input);
    // CCDPH-FIX(R2-P3-7): MCP stdio 的 env 会被**明文**写进 MCP 配置文件（~/.claude.json），
    // 而 profile.env 明确拒绝 *_TOKEN / *_API_KEY / *_AUTH / *_SECRET / *_PASSWORD —— 两条
    // 通道的口径此前不一致，凭据就这样静默落盘。这里不做拒绝（很多 MCP server 正是靠 env
    // 拿凭据，一律拒绝会让功能不可用），但必须**如实告知**：写日志 + 在响应里带出 warning，
    // 由前端提示用户。绝不静默。
    const credentialEnvKeys = Object.keys(entry.env || {}).filter((key) =>
      credentialEnvKeyPattern.test(key),
    );
    if (credentialEnvKeys.length)
      console.warn(
        `[ccdph] MCP「${name}」的 env 含凭据类变量名（${credentialEnvKeys.join(", ")}），将以明文写入 MCP 配置文件`,
      );
    // B-03 修复：整段「读-改-写」进 mcpWriteQueue 串行化（原来无锁，60 并发只落盘 1 条）。
    await mcpWriteQueue(async () => {
      const doc = await readMcpDoc();
      doc.mcpServers = doc.mcpServers && typeof doc.mcpServers === "object" ? doc.mcpServers : {};
      // CCDPH-FIX(F13): 前端为安全起见不回显密钥，编辑已存在的条目时不会提交 env/headers。
      // 原实现直接整体替换，导致用户一改命令就把原有密钥/鉴权头静默抹掉。
      // CCDPH-FIX(P2-1): 只认自有属性，避免 name 命中原型链（如 "constructor"）时拿到继承值。
      const existing = Object.hasOwn(doc.mcpServers, name)
        ? doc.mcpServers[name] || {}
        : {};
      if (!entry.env && existing.env) entry.env = existing.env;
      if (!entry.headers && existing.headers) entry.headers = existing.headers;
      doc.mcpServers[name] = entry;
      await writeMcpDoc(doc);
    });
    return json(res, {
      ok: true,
      name,
      ...(credentialEnvKeys.length
        ? {
            warning: `MCP「${name}」的 env 里含凭据类变量（${credentialEnvKeys.join("、")}）；它会以明文保存在 MCP 配置文件里，请确认这是你接受的方式。`,
          }
        : {}),
    });
  }
  if (req.method === "POST" && pathname === "/api/mcp-servers/delete") {
    const input = requireObject(await body(req));
    const name = String(input.name || "").trim();
    if (input.source === "project")
      throw new Error("项目级 MCP 在项目目录的 .mcp.json 里，请直接编辑该文件");
    // CCDPH-FIX(F-10): 名称必须先校验，且存在性只能看**自有属性**。原来 name:"constructor"
    // 会沿原型链查到真值，而 delete 对继承属性是空操作 → 回 {ok:true} 却什么也没删，
    // 还白白把整个 ~/.claude.json 重写一遍。
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name))
      throw new Error("MCP 名称只能是字母数字与 .-_（≤64 字符）");
    // CCDPH-FIX(F-04): 与 /api/mcp-servers/save 共用同一把互斥锁。两段「读-改-写」不互斥
    // 时，后写的一方会用陈旧副本覆盖对方的结果（静默丢更新）。
    await mcpWriteQueue(async () => {
      const doc = await readMcpDoc();
      const servers =
        doc.mcpServers && typeof doc.mcpServers === "object" ? doc.mcpServers : {};
      if (!Object.hasOwn(servers, name)) throw new Error("MCP 服务器不存在");
      delete servers[name];
      doc.mcpServers = servers;
      await writeMcpDoc(doc);
    });
    return json(res, { ok: true });
  }
  // ---- Hooks：查询 / 编辑 CLAUDE_CONFIG_DIR/settings.json 的 hooks ----
  if (req.method === "GET" && pathname === "/api/hooks") {
    const file = settingsJsonPath();
    let doc = {};
    let error = "";
    try {
      doc = await readSettingsJsonStrict(file);
    } catch (e) {
      error = e.message;
    }
    const hooks =
      doc.hooks && typeof doc.hooks === "object" && !Array.isArray(doc.hooks)
        ? doc.hooks
        : {};
    return json(res, {
      file,
      events: SUPPORTED_HOOK_EVENTS,
      hooks: serializeHooks(hooks),
      count: hooksCount(hooks),
      ...(error ? { error } : {}),
    });
  }
  if (req.method === "POST" && pathname === "/api/hooks/save") {
    // QA 残留补齐：与 B-06 同源——此前 hooks/save 未做正文类型校验，body=null 会回显
    // 内部 TypeError（"Cannot read properties of null (reading 'action')"）。复用 requireObject
    // 统一回中文校验提示（只补这一个端点，不扩大改动面）。
    const input = requireObject(await body(req));
    const file = settingsJsonPath();
    // B-03 修复：整段「读-改-写」进 hooksWriteQueue 串行化（原来无锁 + 固定临时名，
    // 40 并发只落盘 1 条）。队列只保证互斥，调用者仍能看到自己的失败。
    const outcome = await hooksWriteQueue(async () => {
      const doc = await readSettingsJsonStrict(file);
      const current =
        doc.hooks && typeof doc.hooks === "object" && !Array.isArray(doc.hooks)
          ? doc.hooks
          : {};
      const action = typeof input.action === "string" ? input.action : "set";
      let next;
      if (action === "set") {
        // 完整结构覆写（高级用法）；必须整体合并。
        if (input.hooks === undefined) throw new Error("缺少 hooks 内容");
        next = validateHooksStructure(input.hooks);
        // CCDPH-FIX(MED-16): 绝不允许把脱敏后的命令写回磁盘。GET /api/hooks 永远不返回
        // 真实命令文本（redactHookCommand 把密钥换成「前 4 位 + …」），而 add/update
        // 两条增量路径都刻意避开写回脱敏串 —— 只有这条 set 路径会把客户端手里的
        // 脱敏副本原样落盘，用户 ~/.claude/settings.json 里所有带凭据的 hook 从此失效，
        // 而且再也无法从应用里恢复真实值。
        // 选择的做法（比"直接禁用 set"更安全、也不牺牲功能）：
        //   1) 能按「事件+下标」对上旧条目的，直接用磁盘上的真实命令覆盖回提交值
        //      （即 GET → 改 matcher → POST set 这个最典型的用法完全不受影响）；
        //   2) 对不上的（被客户端改写过的脱敏串）一律拒绝整次写入，宁可报错也不静默损坏。
        const restored = restoreRedactedHookCommands(next, current);
        if (restored.unresolved.length)
          throw new Error(
            `提交的 Hook 命令看起来是 /api/hooks 回给页面的脱敏副本（${restored.unresolved.join("、")}），` +
              `已拒绝写入，以免把真实密钥替换成「sk-Ab…」这类残值。请从原文件恢复真实命令，或用 action:"update" 只改 matcher。`,
          );
      } else {
        // 增量：仅改动目标事件，保留其它事件的原样（避免脱敏命令覆盖真实命令）
        const event = String(input.event || "");
        if (!SUPPORTED_HOOK_EVENTS.includes(event))
          throw new Error(`不支持的事件名：${event || "(?)"}`);
        const list = Array.isArray(current[event]) ? [...current[event]] : [];
        if (action === "add") {
          // CCDPH-FIX(F-08): 增量 add 同样受单事件上限约束。原来只有 action:"set"
          // 检查 50 条，add 能无限追加（实测 200 次请求全部 200）—— 而这份文件
          // Claude Code 会逐条执行，且超限后同一 API 再也无法整体覆写它。
          if (list.length >= MAX_HOOKS_PER_EVENT)
            throw new Error(
              `事件 ${event} 的 Hook 数量过多（上限 ${MAX_HOOKS_PER_EVENT}）`,
            );
          list.push(
            validateHookItem(
              {
                matcher: input.matcher ?? "",
                hooks: [{ type: "command", command: input.command }],
              },
              event,
            ),
          );
        } else if (action === "delete") {
          const index = Number(input.index);
          if (!Number.isInteger(index) || index < 0 || index >= list.length)
            throw new Error("要删除的 Hook 不存在");
          list.splice(index, 1);
        } else if (action === "update") {
          const index = Number(input.index);
          if (!Number.isInteger(index) || index < 0 || index >= list.length)
            throw new Error("要更新的 Hook 不存在");
          const existing = list[index];
          const restoreUpdateCandidate = (candidate) => {
            const candidateList = [...list];
            candidateList[index] = candidate;
            const restored = restoreRedactedHookCommands(
              { [event]: candidateList },
              { [event]: list },
            );
            if (restored.unresolved.length)
              throw new Error(
                `提交的 Hook 命令包含无法对应原值的脱敏副本（${restored.unresolved.join("、")}），已拒绝更新`,
              );
            return candidateList[index];
          };
          const matcher =
            input.matcher === undefined ? existing?.matcher ?? "" : input.matcher;
          const command =
            typeof input.command === "string" ? input.command.trim() : "";
          if (!command) {
            // 未带新命令（原命令可能因脱敏未被前端带出）：只更新 matcher，保留原命令
            const preserved = Array.isArray(existing?.hooks) ? existing.hooks : [];
            if (!preserved.length) throw new Error("Hook 命令不能为空");
            list[index] = { ...existing, matcher: String(matcher) };
          } else if (Array.isArray(input.hooks)) {
            // 高级调用方整体提交 hooks 数组时，同样必须恢复/拒绝 GET 接口产生的脱敏副本。
            const candidate = validateHookItem(
              { ...existing, matcher, hooks: input.hooks },
              event,
            );
            list[index] = restoreUpdateCandidate(candidate);
          } else {
            // CCDPH-FIX: 只替换 hooks[0]，同 matcher 下的兄弟命令原样保留。
            // 原实现用 [{ type, command }] 重建整个 hooks 数组，会把 hooks[1..] 静默丢掉。
            // CCDPH-FIX(P3-27): 原来硬编码 `type: "command"`，会把用户原有的
            // `type:"prompt"` 等 hook 静默改写。这里保留原条目的 type。
            const originalType =
              typeof existing?.hooks?.[0]?.type === "string"
                ? existing.hooks[0].type
                : "command";
            const nextHooks = [
              { type: originalType, command },
              ...(Array.isArray(existing?.hooks) ? existing.hooks.slice(1) : []),
            ];
            list[index] = restoreUpdateCandidate(
              validateHookItem(
                { ...existing, matcher, hooks: nextHooks },
                event,
              ),
            );
          }
        } else {
          throw new Error(`不支持的操作：${action}`);
        }
        next = { ...current };
        if (list.length) next[event] = list;
        else delete next[event];
      }
      doc.hooks = next;
      await writeSettingsJson(doc);
      return { hooks: serializeHooks(next), count: hooksCount(next) };
    });
    return json(res, { ok: true, ...outcome });
  }
  // ---- Worktrees：列出 / 新建 / 移除 / 打开当前仓库的 git worktree ----
  return json(res, { error: "接口不存在" }, 404);
}
}
