import fs from "node:fs/promises";
import path from "node:path";

const TERMINAL_SSE_MAX_CLIENTS = 8;
const DIRECTORY_ENTRIES_MAX = 2000;

export function createWorkspaceIoRoute(deps) {
  const {
    FILE_EXCLUDES,
    body,
    boundedText,
    closeSseClients,
    findFiles,
    getChanges,
    getPathOpener,
    getProjectInfo,
    git,
    gitChangesFailure,
    json,
    killProcessTree,
    readStableBoundedFile,
    requireObject,
    safePath,
    ssePending,
    startTerminal,
    terminalBroadcast,
    terminalProcessRegistry,
    terminalStartQueue,
    terminals,
    within,
    writeSseInitialFrame,
    workspaceRoot,
    writeSseClients,
  } = deps;

return async function routeWorkspaceIoDomain(req, res, url, pathname) {
  if (req.method === "GET" && pathname === "/api/files") {
    const root = workspaceRoot(
      url.searchParams.get("projectId"),
      url.searchParams.get("sessionId"),
    );
    const relative = url.searchParams.get("path") || "";
    const folder = await safePath(root, relative);
    const entries = [];
    let truncated = false;
    let directory;
    try {
      directory = await fs.opendir(folder);
      for await (const entry of directory) {
        if (FILE_EXCLUDES.has(entry.name) || entry.isSymbolicLink()) continue;
        if (entries.length >= DIRECTORY_ENTRIES_MAX) {
          truncated = true;
          break;
        }
        entries.push({
          name: entry.name,
          directory: entry.isDirectory(),
          path: path
            .relative(root, path.join(folder, entry.name))
            .replaceAll("\\", "/"),
        });
      }
    } finally {
      await directory?.close().catch(() => { });
    }
    entries.sort(
      (a, b) =>
        Number(b.directory) - Number(a.directory) ||
        a.name.localeCompare(b.name),
    );
    return json(res, {
      files: entries,
      truncated,
      truncationReason: truncated
        ? `该目录超过 ${DIRECTORY_ENTRIES_MAX} 项，仅显示前 ${DIRECTORY_ENTRIES_MAX} 项`
        : "",
    });
  }
  if (req.method === "GET" && pathname === "/api/file") {
    const root = workspaceRoot(
      url.searchParams.get("projectId"),
      url.searchParams.get("sessionId"),
    );
    const target = await safePath(root, url.searchParams.get("path") || "");
    // CCDPH-FIX(M-5): TOCTOU 收口。safePath（realpath）之后原来按路径 stat + readFile，
    // 两步之间文件可被换成 junction/symlink 指向区外。
    // 句柄复验思路：先取 stat，再 fs.open，用**同一个句柄** fstat 比对 dev/ino ——
    // 不一致说明校验与读取之间对象已被替换，拒绝；一致才从该句柄读内容。500KB 上限保留。
    const content = await readStableBoundedFile(target);
    if (content.includes(0)) throw new Error("此文件不是可预览的文本文件");
    return json(res, { text: content.toString("utf8") });
  }
  if (req.method === "GET" && pathname === "/api/changes") {
    const root = workspaceRoot(
      url.searchParams.get("projectId"),
      url.searchParams.get("sessionId"),
    );
    try {
      return json(res, await getChanges(root));
    } catch (error) {
      return json(res, gitChangesFailure(error));
    }
  }
  if (req.method === "GET" && pathname === "/api/project-info") {
    const root = workspaceRoot(
      url.searchParams.get("projectId"),
      url.searchParams.get("sessionId"),
    );
    return json(res, { ...(await getProjectInfo(root)), root });
  }
  if (req.method === "GET" && pathname === "/api/search-files") {
    const root = workspaceRoot(
      url.searchParams.get("projectId"),
      url.searchParams.get("sessionId"),
    );
    const found = await findFiles(root, url.searchParams.get("q") || "");
    return json(res, {
      files: found.files,
      truncated: found.truncated,
      truncationReason: found.truncationReason,
    });
  }
  if (req.method === "GET" && pathname === "/api/diff") {
    const root = workspaceRoot(
      url.searchParams.get("projectId"),
      url.searchParams.get("sessionId"),
    );
    const relative = url.searchParams.get("path") || "";
    if (!relative || path.isAbsolute(relative)) throw new Error("文件路径无效");
    // 优先用 safePath（realpath 级沙箱）。只有明确的 ENOENT（Git 删除中的文件）
    // 才允许受限词法回退；权限、I/O 或其他错误绝不能降级为弱校验。
    let target;
    try {
      target = await safePath(root, relative);
    } catch (error) {
      const normalized = relative.replace(/\\/g, "/");
      const segments = normalized.split("/");
      if (
        error?.code !== "ENOENT" ||
        !normalized ||
        normalized.startsWith("/") ||
        segments.some(
          (segment) =>
            !segment || segment === "." || segment === ".." || segment.includes(":"),
        )
      )
        throw error;
      target = path.resolve(root, ...segments);
    }
    if (!within(root, target)) throw new Error("文件路径无效");
    // Deleted files have no realpath; Git only reads the selected path here.
    let text;
    try {
      text = await git(root, [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "HEAD",
        "--",
        relative,
      ]);
    } catch {
      try {
        text = await git(root, [
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--",
          relative,
        ]);
        text += await git(root, [
          "diff",
          "--cached",
          "--no-ext-diff",
          "--no-textconv",
          "--",
          relative,
        ]);
      } catch {
        text = "";
      }
    }
    if (!text) {
      try {
        const filename = await safePath(root, relative);
        const content = await readStableBoundedFile(filename);
        if (content.includes(0)) throw new Error("二进制文件");
        text = content
          .toString("utf8")
          .split("\n")
          .map((line) => "+" + line)
          .join("\n");
      } catch {
        text = "无法预览该文件的差异（文件可能过大或为二进制文件）。";
      }
    }
    return json(res, { text });
  }
  if (req.method === "POST" && pathname === "/api/reveal") {
    const pathOpener = getPathOpener();
    if (!pathOpener) throw new Error("仅桌面版支持在资源管理器中打开");
    const input = requireObject(await body(req));
    const root = workspaceRoot(input.projectId, input.sessionId);
    const target = input.path ? await safePath(root, input.path) : root;
    await pathOpener(target);
    return json(res, { ok: true });
  }
  if (req.method === "POST" && pathname === "/api/terminal/start") {
    const input = requireObject(await body(req));
    const root = workspaceRoot(input.projectId, input.sessionId);
    const terminal = await terminalStartQueue(() => startTerminal(root));
    return json(res, {
      id: terminal.id,
      output: boundedText(terminal),
      exited: terminal.exited,
    });
  }
  if (req.method === "GET" && pathname === "/api/terminal/events") {
    const terminal = terminals.get(url.searchParams.get("id"));
    if (!terminal) throw new Error("终端不存在");
    if (terminal.clients.size >= TERMINAL_SSE_MAX_CLIENTS)
      return json(
        res,
        { error: `同一终端最多允许 ${TERMINAL_SSE_MAX_CLIENTS} 个事件流连接` },
        429,
      );
    terminal.lastUsedAt = Date.now(); // CCDPH-FIX(LOW-6): 有客户端在看 = 正在使用
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    writeSseInitialFrame(
      terminal.clients,
      res,
      `data: ${JSON.stringify({ type: "snapshot", text: boundedText(terminal), exited: terminal.exited })}\n\n`,
      !terminal.exited,
    );
    if (terminal.exited) return;
    const timer = setInterval(() => {
      terminal.lastUsedAt = Date.now();
      writeSseClients(terminal.clients, ": heartbeat\n\n");
    }, 15000);
    const cleanup = () => {
      clearInterval(timer);
      terminal.clients.delete(res);
      ssePending.delete(res);
    };
    res.on("close", cleanup);
    res.on("error", cleanup);
    return;
  }
  if (req.method === "POST" && pathname === "/api/terminal/input") {
    const input = requireObject(await body(req)),
      terminal = terminals.get(input.id);
    if (!terminal) throw new Error("终端不存在");
    if (terminal.exited) throw new Error("终端已经结束");
    if (typeof input.text !== "string" || input.text.length > 10000)
      throw new Error("终端输入无效");
    terminal.lastUsedAt = Date.now(); // CCDPH-FIX(LOW-6): 有输入 = 正在使用（LRU 依据）
    // xterm.js sends a bare CR for Enter, but cmd.exe only ends a line on CRLF
    // when stdin is a pipe, so normalise every line ending to CRLF.
    // (Input that already uses CRLF, e.g. the plain-text fallback, is
    // unchanged by this transformation.)
    // kill() 与 'exit' 之间存在竞态窗口：此时 exited 仍为 false，
    // 但 stdin 已随子进程销毁。write() 对已关闭的 stdin 不会同步 throw，
    // 而是异步 emit error（已被 stdinClosed 标志捕获）。需主动检查避免虚假成功。
    if (terminal.stdinClosed || terminal.child.stdin.writableEnded)
      throw new Error("终端已经结束");
    // CCDPH-FIX(HIGH-6): 这里原来在 write() 返回 false 时挂一个 once("error")。
    // 但 write() 的返回值只表示**背压**（内核缓冲已满），并不是错误，正常不会有
    // error 事件 —— 于是每次背压写都会往 stdin 上永久多挂一个监听器且永不移除，
    // 监听器数组无限增长（并在第 11 个开始刷 MaxListenersExceededWarning）。
    // startTerminal() 里已经挂了常驻 error 监听（同样把 stdinClosed 置 true），
    // 这里重复注册是多余的。
    const normalizedInput = input.text.replace(/\r\n|\r|\n/g, "\r\n");
    const maxPendingBytes = 256 * 1024;
    if (
      terminal.stdinBackpressured ||
      terminal.child.stdin.writableLength +
          Buffer.byteLength(normalizedInput, "utf8") >
        maxPendingBytes
    )
      throw new Error("终端输入过快，子进程尚未读取完上一批数据，请稍后重试");
    terminal.stdinBackpressured = !terminal.child.stdin.write(normalizedInput);
    terminalProcessRegistry.scheduleAfter();
    return json(res, { ok: true });
  }
  if (req.method === "POST" && pathname === "/api/terminal/stop") {
    const input = requireObject(await body(req)),
      terminal = terminals.get(input.id);
    if (terminal && !terminal.exited) {
      // CCDPH-FIX(HIGH-4): 原来是 terminal.child.kill() —— 只结束 cmd.exe 自己，
      // 用户在该终端里启动的子进程（dev server / python / docker …）全部变成孤儿继续跑，
      // 界面上的「停止」对这类命令等于撒谎。改为结束整棵进程树。
      await killProcessTree(terminal.child);
      // kill() is asynchronous: the 'exit' event has not fired yet. Mark and
      // remove this dying terminal now, otherwise the next /terminal/start
      // reuses it and the UI immediately receives the late 'exit' event.
      terminal.exited = true;
      clearTimeout(terminal.startupTimer);
      terminal.startup = false;
      terminal.startupOutput = "";
      terminalBroadcast(terminal, { type: "exit", code: null });
      closeSseClients(terminal.clients);
      clearTimeout(terminal.releaseTimer);
      terminal.child.stdout?.off("data", terminal.append);
      terminal.child.stderr?.off("data", terminal.append);
      if (terminal.onStdinDrain)
        terminal.child.stdin?.off("drain", terminal.onStdinDrain);
      terminals.delete(terminal.id);
      void terminalProcessRegistry.schedule();
    }
    return json(res, { ok: true });
  }
  return json(res, { error: "接口不存在" }, 404);
}
}
