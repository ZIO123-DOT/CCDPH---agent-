import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function createWorkspaceMutationRoute(deps) {
  const {
    MAX_PROJECTS,
    armUpdateInstallGateTimer,
    body,
    checkForUpdate,
    getChanges,
    getDb,
    getFilePicker,
    getFolderPicker,
    getPathOpener,
    git,
    installUpdate,
    markGlobalHistoryBytesDirty,
    json,
    listWorktrees,
    matchWorktree,
    redetectClaude,
    removeWorktreeOf,
    resolveAuthorizedWorktreeTarget,
    repoRootFor,
    requireObject,
    sanitizeError,
    save,
    sessionWriteQueue,
    updateRuntime,
    workspaceRoot,
    worktreeBaseDir,
  } = deps;

  // CCDPH-FIX(R2-P2-10): 「本来不是 Git 仓库」是正常业务状态，而「git 调用失败」
  //（未安装 / PATH 异常 / dubious ownership / 权限 / 15s 超时）是真实故障。原来的
  // 裸 `catch {}` 把两者混为一谈并以 200 + error 返回，用户完全无法定位故障。
  const NOT_GIT_REPO_RE = /not a git repository|not a repository|不是 git 仓库/i;
  const isNotGitRepositoryError = (error) =>
    NOT_GIT_REPO_RE.test(`${error?.stderr || ""}\n${error?.message || ""}`);
  // `git config <key>` 在**未设置**时以 exit 1 + 空 stderr 结束，这属于正常「未配置」；
  // 其余（spawn ENOENT、被杀、有 stderr 的退出）都是真实故障。
  const isUnsetGitConfigError = (error) =>
    error?.code === 1 && !error?.killed && !String(error?.stderr || "").trim();

  async function cleanupReservedWorktreeTarget(target, baseDir, reason) {
    const targetStat = await fs.lstat(target).catch(() => null);
    if (!targetStat?.isDirectory() || targetStat.isSymbolicLink()) return false;
    const authorized = await resolveAuthorizedWorktreeTarget(target, baseDir);
    if (!authorized) return false;
    try {
      await fs.rm(authorized.target, { recursive: true, force: true });
      return true;
    } catch (error) {
      console.warn(
        `[ccdph] ${reason}后的 Worktree 目录清理失败:`,
        error?.message || error,
      );
      return false;
    }
  }

return async function routeWorkspaceMutationDomain(req, res, url, pathname) {
  const db = getDb();
  const pathOpener = getPathOpener();
  const folderPicker = getFolderPicker();
  const filePicker = getFilePicker();
  if (req.method === "GET" && pathname === "/api/worktrees") {
    let root = "";
    try {
      root = repoRootFor(
        url.searchParams.get("projectId"),
        url.searchParams.get("sessionId"),
      );
    } catch (e) {
      // CCDPH-FIX(HIGH-7): 项目/会话不存在属于**真实失败**，必须走 4xx。原来把它塞进
      // 200 的 body 里（实测 {"git":false,...,"error":"项目不存在"} + HTTP 200），
      // 前端 api() 按 res.ok 判断会把失败当成功。消息原样抛出，前端 catch 分支
      //（app.js:2360-2367）会照旧展示同一条文案。
      // 注意：下面的「当前工作区不是 Git 仓库」是正常业务状态，继续用 200 + error 提示。
      throw new Error(e?.message || "请先选择项目");
    }
    let inside = false;
    let probeFailure = "";
    try {
      inside =
        (await git(root, ["rev-parse", "--is-inside-work-tree"])).trim() ===
        "true";
    } catch (error) {
      // CCDPH-FIX(R2-P2-10): 只有确认是「不是仓库」才落进下面的 200 业务状态；
      // 其它失败一律抛出（全局处理器回 400 + 脱敏文案），前端 renderWorktrees 的
      // catch 会照旧展示「读取 Worktree 失败：…」。
      if (!isNotGitRepositoryError(error)) probeFailure = sanitizeError(error);
    }
    if (probeFailure)
      throw new Error(`无法读取 Git 仓库状态：${probeFailure}`);
    if (!inside)
      return json(res, {
        git: false,
        root,
        worktrees: [],
        count: 0,
        error: "当前工作区不是 Git 仓库",
      });
    let worktrees = [];
    let error = "";
    try {
      worktrees = await listWorktrees(root);
    } catch (e) {
      // CCDPH-FIX(P2-10): 原来把 git 原始报错（常含绝对路径，如 dubious ownership 文案）
      // 直接塞进 200 body，绕过全仓统一的脱敏出口。改用 sanitizeError。
      error = sanitizeError(e);
    }
    return json(res, {
      git: true,
      root,
      worktrees,
      count: worktrees.length,
      ...(error ? { error } : {}),
    });
  }
  if (req.method === "POST" && pathname === "/api/worktrees/create") {
    const input = requireObject(await body(req));
    const root = repoRootFor(input.projectId, input.sessionId);
    const inside = (
      await git(root, ["rev-parse", "--is-inside-work-tree"]).catch(() => "")
    ).trim();
    if (inside !== "true") throw new Error("独立 Worktree 需要 Git 仓库");
    const branch = String(input.branch || "").trim();
    if (!branch || branch.length > 200)
      throw new Error("请填写有效的分支名（200 字以内）");
    try {
      await git(root, ["check-ref-format", "--branch", branch]);
    } catch {
      throw new Error("分支名不合法（不能包含空格、~、^?: 等字符）");
    }
    const base = String(input.base || "").trim();
    if (base) {
      try {
        await git(root, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
      } catch {
        throw new Error(`基线「${base}」不存在`);
      }
    }
    const baseDir = worktreeBaseDir(root);
    await fs.mkdir(baseDir, { recursive: true });
    const slug =
      branch
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .replace(/^[-.]+|[-.]+$/g, "")
        .slice(0, 80)
        .replace(/[.-]+$/g, "") || "worktree";
    const target = path.join(baseDir, `${slug}-${randomUUID().slice(0, 8)}`);
    try {
      await fs.mkdir(target);
    } catch (error) {
      // CCDPH-FIX(P3-25): 不再把绝对路径回显给客户端（目标目录在应用数据目录下，
      // 属内部信息）。前端只需要知道"这个名字被占了"。
      if (error?.code === "EEXIST")
        throw new Error("目标目录已存在，已拒绝覆盖（请稍后重试）");
      throw error;
    }
    const reservedTarget = await resolveAuthorizedWorktreeTarget(target, baseDir);
    if (!reservedTarget) {
      await cleanupReservedWorktreeTarget(target, baseDir, "创建前校验失败");
      throw new Error("Worktree 目标目录在创建前被替换或越过受控目录，已拒绝操作");
    }
    let branchExists = false;
    try {
      await git(root, [
        "rev-parse",
        "--verify",
        "--quiet",
        `refs/heads/${branch}`,
      ]);
      branchExists = true;
    } catch { }
    try {
      if (branchExists) await git(root, ["worktree", "add", target, branch]);
      else await git(root, ["worktree", "add", "-b", branch, target, base || "HEAD"]);
    } catch (error) {
      await cleanupReservedWorktreeTarget(target, baseDir, "Git 创建失败");
      throw error;
    }
    const authorizedTarget = await resolveAuthorizedWorktreeTarget(target, baseDir);
    if (!authorizedTarget) {
      console.warn(
        `[ccdph] Worktree 创建后目标路径越界，未自动删除可疑路径: ${target}`,
      );
      throw new Error(
        "Worktree 创建后目标路径发生替换或越界；已停止返回该路径，请检查 Git worktree 列表并人工清理",
      );
    }
    return json(res, {
      ok: true,
      path: authorizedTarget.target,
      branch,
      created: !branchExists,
    });
  }
  if (req.method === "POST" && pathname === "/api/worktrees/remove") {
    const input = requireObject(await body(req));
    const root = repoRootFor(input.projectId, input.sessionId);
    const target = String(input.path || "").trim();
    if (!target) throw new Error("缺少要移除的 Worktree 路径");
    const worktrees = await listWorktrees(root);
    const match = matchWorktree(worktrees, target);
    if (!match) throw new Error("该路径不在当前仓库的 Worktree 列表里，已拒绝操作");
    if (match.main) throw new Error("主工作区不能移除");
    const args = ["worktree", "remove"];
    if (input.force === true) args.push("--force");
    args.push(match.path);
    await git(root, args);
    return json(res, { ok: true, path: match.path });
  }
  if (req.method === "POST" && pathname === "/api/worktrees/open") {
    const input = requireObject(await body(req));
    const root = repoRootFor(input.projectId, input.sessionId);
    const target = String(input.path || "").trim();
    if (!target) throw new Error("缺少要打开的 Worktree 路径");
    const worktrees = await listWorktrees(root);
    const match = matchWorktree(worktrees, target);
    if (!match) throw new Error("该路径不在当前仓库的 Worktree 列表里，已拒绝操作");
    if (!pathOpener)
      throw new Error("请粘贴路径在文件管理器中打开；桌面版支持一键打开");
    await pathOpener(match.path);
    return json(res, { ok: true, path: match.path });
  }
  // ---- Git 配置：全局身份 + 当前项目的远程仓库管理（支持带端口的 ssh URL） ----
  const GIT_URL_RE =
    /^(https?:\/\/[^\s]+|ssh:\/\/[^\s@]+@[^\s:]+:\d{1,5}\/[^\s]+|git@[^\s:]+:[^\s]+|\/[^\s]+|[a-zA-Z]:\\[^\s]+)$/;
  if (req.method === "GET" && pathname === "/api/git-config") {
    const root = workspaceRoot(
      url.searchParams.get("projectId"),
      url.searchParams.get("sessionId"),
    );
    const readConfig = async (scope, key, cwd) => {
      try {
        return (
          await git(cwd, [
            "config",
            scope === "global" ? "--global" : "--local",
            key,
          ])
        ).trim();
      } catch (error) {
        // CCDPH-FIX(R2-P2-10): 原来一律回空串，把「未设置」与「git 不可用」混在一起。
        // 未设置（exit 1 + 空 stderr）仍回空串；真实故障向上抛出。
        if (isUnsetGitConfigError(error)) return "";
        throw error;
      }
    };
    let userName = "";
    let userEmail = "";
    try {
      [userName, userEmail] = await Promise.all([
        readConfig("global", "user.name", os.homedir()),
        readConfig("global", "user.email", os.homedir()),
      ]);
    } catch (error) {
      throw new Error(`无法读取全局 Git 配置：${sanitizeError(error)}`);
    }
    let remotes = [];
    let inside = false;
    let branch = "";
    let upstream = "";
    let ahead = 0;
    let behind = 0;
    let worktreeCount = 0;
    let changeCount = 0;
    let lastCommit = null;
    let localName = "";
    let localEmail = "";
    try {
      inside =
        (await git(root, ["rev-parse", "--is-inside-work-tree"])).trim() ===
        "true";
      if (inside) {
        try {
          branch = (await git(root, ["branch", "--show-current"])).trim();
        } catch { }
        try {
          upstream = (
            await git(root, [
              "rev-parse",
              "--abbrev-ref",
              "--symbolic-full-name",
              "@{upstream}",
            ])
          ).trim();
        } catch { }
        if (upstream) {
          try {
            const counts = (
              await git(root, [
                "rev-list",
                "--left-right",
                "--count",
                "@{upstream}...HEAD",
              ])
            )
              .trim()
              .split(/\s+/);
            behind = Number(counts[0]) || 0;
            ahead = Number(counts[1]) || 0;
          } catch { }
        }
        try {
          const out = await git(root, ["remote", "-v"]);
          const seen = new Map();
          for (const line of out.split("\n")) {
            const match = line.match(/^(\S+)\t(\S+)\s+\((fetch|push)\)$/);
            if (!match) continue;
            const [, name, target, kind] = match;
            const item = seen.get(name) || { name, fetch: "", push: "" };
            item[kind] = target;
            seen.set(name, item);
          }
          remotes = [...seen.values()];
        } catch { }
        try {
          worktreeCount = (await listWorktrees(root)).length;
        } catch { }
        try {
          changeCount = (await getChanges(root)).files.length;
        } catch { }
        try {
          const line = (
            await git(root, ["log", "-1", "--pretty=%H%x09%s"])
          ).trim();
          if (line) {
            const [hash, ...rest] = line.split("\t");
            lastCommit = { hash, subject: rest.join("\t") };
          }
        } catch { }
        localName = await readConfig("local", "user.name", root);
        localEmail = await readConfig("local", "user.email", root);
      }
    } catch (error) {
      // CCDPH-FIX(R2-P2-10): 块内其余读取各自是尽力而为（分支/上游/远程/提交都可能
      // 合理地失败），但「仓库探测失败」与「配置读取故障」必须如实上报，不能静默按
      // 「不是仓库」处理。
      if (!isNotGitRepositoryError(error))
        throw new Error(`无法读取 Git 配置：${sanitizeError(error)}`);
      inside = false;
    }
    const origin = remotes.find((item) => item.name === "origin");
    return json(res, {
      inside,
      remotes,
      userName,
      userEmail,
      global: { userName, userEmail },
      local: { userName: localName, userEmail: localEmail },
      branch,
      upstream,
      ahead,
      behind,
      origin: origin?.fetch || origin?.push || "",
      worktreeCount,
      changeCount,
      lastCommit,
      root,
    });
  }
  if (req.method === "POST" && pathname === "/api/git-config/save") {
    const input = requireObject(await body(req));
    // CCDPH-FIX(R2-P3-1): 原来是 `input.scope === "local" ? "local" : "global"` ——
    // 缺失/非法 scope 会静默落到最宽的 `--global`（写用户 ~/.gitconfig），与同模块其它
    // 枚举「严格校验后拒绝」的口径不一致。现在只接受显式的 local / global。
    const scope = input.scope;
    if (scope !== "local" && scope !== "global")
      throw new Error("scope 必须是 local 或 global");
    const userName = String(input.userName ?? input.name ?? "")
      .trim()
      .slice(0, 120);
    const userEmail = String(input.userEmail ?? input.email ?? "")
      .trim()
      .slice(0, 200);
    if (!userName && !userEmail) throw new Error("请填写用户名或邮箱");
    if (userName && /[<>"\n\r]/.test(userName))
      throw new Error("用户名包含非法字符");
    if (
      userEmail &&
      !/^[\w.+-]+@[\w-]+(\.[\w-]+)+$|^[\w.+-]+$/.test(userEmail)
    )
      throw new Error("邮箱格式不正确");
    // CCDPH-FIX(D1): 以 - 开头的值会被 git config 当成选项解析，直接拒绝。
    if (userName.startsWith("-")) throw new Error("用户名不能以 - 开头");
    if (userEmail.startsWith("-")) throw new Error("邮箱不能以 - 开头");
    const args = scope === "global" ? ["--global"] : ["--local"];
    let cwd = os.homedir();
    if (scope === "local") {
      cwd = repoRootFor(
        url.searchParams.get("projectId") || input.projectId,
        url.searchParams.get("sessionId") || input.sessionId,
      );
      const inside = (
        await git(cwd, ["rev-parse", "--is-inside-work-tree"]).catch(() => "")
      ).trim();
      if (inside !== "true")
        throw new Error("当前工作区不是 Git 仓库，无法写入仓库级身份");
    }
    if (userName) await git(cwd, ["config", ...args, "user.name", userName]);
    if (userEmail)
      await git(cwd, ["config", ...args, "user.email", userEmail]);
    return json(res, { ok: true, scope, userName, userEmail });
  }
  if (req.method === "POST" && pathname === "/api/git-remote/save") {
    const root = workspaceRoot(
      url.searchParams.get("projectId"),
      url.searchParams.get("sessionId"),
    );
    const input = requireObject(await body(req));
    const name = String(input.name || "").trim();
    const target = String(input.url || "").trim().slice(0, 600);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name))
      throw new Error("远程名称只能是字母数字与 .-（如 origin、upstream）");
    if (!GIT_URL_RE.test(target))
      throw new Error("URL 支持 https://、ssh://git@主机:端口/路径 或 git@主机:路径");
    const existing = await git(root, ["remote"]).catch(() => "");
    // CCDPH-FIX(D1): 加 -- 分隔符，避免远程名被 git 当成选项解析
    if (existing.split("\n").map((item) => item.trim()).includes(name))
      await git(root, ["remote", "set-url", "--", name, target]);
    else await git(root, ["remote", "add", "--", name, target]);
    await save();
    return json(res, { ok: true, name, url: target });
  }
  if (req.method === "POST" && pathname === "/api/git-remote/delete") {
    const root = workspaceRoot(
      url.searchParams.get("projectId"),
      url.searchParams.get("sessionId"),
    );
    const input = requireObject(await body(req));
    const name = String(input.name || "").trim();
    if (!name) throw new Error("缺少远程名称");
    // CCDPH-FIX(D1): 原先只判空，name 可含空格或以 - 开头（会被 git 当成选项解析）。
    // 与 /api/git-remote/save 用同一条字符集校验，并校验 -- 分隔符。
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name))
      throw new Error("远程名称只能是字母数字与 .-_（且不能以 - 开头）");
    if (name === "origin" && input.confirm !== true)
      throw new Error("删除 origin 前需要二次确认");
    await git(root, ["remote", "remove", "--", name]);
    await save();
    return json(res, { ok: true });
  }
  if (req.method === "POST" && pathname === "/api/clear-archived") {
    await body(req);
    return await sessionWriteQueue(async () => {
      const before = db.sessions.length;
      const previousSessions = db.sessions;
      const dropped = db.sessions.filter((item) => item.archived && !item.running);
      db.sessions = db.sessions.filter((item) => !item.archived || item.running);
      markGlobalHistoryBytesDirty();
      // CCDPH-FIX(P3-20): 先落盘（失败可回滚内存），成功后再逐个删 worktree 目录。
      // 原顺序相反：先删目录（不可逆）再 save，save 失败时接口报 400 但记录与目录都已没了。
      try {
        await save();
      } catch (error) {
        db.sessions = previousSessions;
        markGlobalHistoryBytesDirty();
        throw error;
      }
      const worktree = { removed: 0, kept: 0 };
      for (const item of dropped) {
        const result = await removeWorktreeOf(item).catch((error) => {
          console.error(
            "[ccdph] 清空归档后清理 worktree 失败（目录可能残留）:",
            error?.message || error,
          );
          return { removed: 0, kept: 1 };
        });
        worktree.removed += result.removed;
        worktree.kept += result.kept;
      }
      return json(res, {
        removed: before - db.sessions.length,
        worktree,
      });
    });
  }
  if (req.method === "POST" && pathname === "/api/projects") {
    const input = requireObject(await body(req));
    if (typeof input.path !== "string" || !path.isAbsolute(input.path))
      throw new Error("请输入完整的项目文件夹路径");
    const folder = await fs.realpath(input.path);
    if (!(await fs.stat(folder)).isDirectory()) throw new Error("请选择文件夹");
    let p = db.projects.find(
      (p) => p.path.toLowerCase() === folder.toLowerCase(),
    );
    if (!p) {
      if (db.projects.length >= MAX_PROJECTS)
        throw new Error(
          `项目数量已达上限（${MAX_PROJECTS}），请先移除不再使用的项目`,
        );
      p = { id: randomUUID(), name: path.basename(folder), path: folder };
      db.projects.push(p);
      try {
        await save();
      } catch (error) {
        db.projects = db.projects.filter((item) => item !== p);
        throw error;
      }
    }
    return json(res, p);
  }
  if (req.method === "POST" && pathname === "/api/pick-folder") {
    if (!folderPicker)
      throw new Error("请粘贴文件夹路径；桌面版支持原生文件夹选择器");
    return json(res, { path: await folderPicker() });
  }
  if (req.method === "POST" && pathname === "/api/pick-file") {
    if (!filePicker)
      throw new Error("请粘贴 claude.exe 路径；桌面版支持原生文件选择器");
    return json(res, { path: await filePicker() });
  }
  if (req.method === "POST" && pathname === "/api/claude/detect") {
    const result = await redetectClaude();
    return json(res, result);
  }
  if (req.method === "GET" && pathname === "/api/update/check") {
    return json(res, await checkForUpdate());
  }
  if (req.method === "POST" && pathname === "/api/update/install") {
    if (process.env.WORKBENCH_DESKTOP !== "1")
      throw new Error("自动安装仅支持桌面版；网页版请手动下载新版本");
    // CCDPH-FIX(H-9): 后台化（保留 MED-15 重入闸门）。整个下载/解包/写 bat（最坏 900s）
    // 不再在这条请求里跑 —— 前端 api() 30 秒就 abort，用户会看到「失败」并重试。
    // 现在：本请求立即返回 { started: true, jobId }，任务在后台执行并更新 updateRuntime.job；
    // 闸门被占时返回 409 与明确错误文案。
    if (updateRuntime.installRunning)
      return json(
        res,
        { error: "已有更新任务在进行，请等待其完成（下载与解包可能需要几分钟）" },
        409,
      );
    updateRuntime.installRunning = true;
    clearTimeout(updateRuntime.installResetTimer);
    updateRuntime.installResetTimer = null;
    const jobId = randomUUID();
    updateRuntime.job.running = true;
    updateRuntime.job.stage = "下载";
    updateRuntime.job.startedAt = Date.now();
    updateRuntime.job.finishedAt = 0;
    updateRuntime.job.error = "";
    // CCDPH-FIX(P3-22): job 对象里带上 jobId，前端轮询 /api/update/status 时才能把
    // 当前状态归属到这次安装任务（此前只把 jobId 回给调用方，job 里没有）。
    updateRuntime.job.id = jobId;
    void (async () => {
      try {
        const result = await installUpdate((stage) => {
          updateRuntime.job.stage = stage;
        });
        updateRuntime.job.running = false;
        updateRuntime.job.stage = "完成";
        updateRuntime.job.finishedAt = Date.now();
        console.log(
          `[ccdph] 更新任务 ${jobId} 已就绪${result?.version ? `（${result.version}）` : ""}`,
        );
        updateRuntime.installResetTimer = armUpdateInstallGateTimer(() => {
          updateRuntime.installResetTimer = null;
          updateRuntime.installRunning = false;
          if (updateRuntime.job.stage === "完成")
            updateRuntime.job.stage = "等待重启超时，可重新安装";
          console.warn("[ccdph] 更新程序未在预期时间内接管，已重新开放安装入口");
        });
      } catch (error) {
        // 失败必须如实落进 job 状态（前端轮询可见），并放开闸门允许重试。
        updateRuntime.installRunning = false;
        updateRuntime.job.running = false;
        updateRuntime.job.stage = "失败";
        updateRuntime.job.finishedAt = Date.now();
        updateRuntime.job.error = sanitizeError(error);
        console.error(`[ccdph] 更新任务 ${jobId} 失败:`, updateRuntime.job.error);
      }
      // 成功时**保持闸门关闭**（MED-15 语义）：apply-update.bat 会在几秒后 taskkill
      // 本进程并覆盖安装目录，这段时间里再放一次安装进来只会互相踩踏。
    })().catch((error) => {
      updateRuntime.installRunning = false;
      updateRuntime.job.running = false;
      updateRuntime.job.stage = "失败";
      updateRuntime.job.finishedAt = Date.now();
      updateRuntime.job.error = sanitizeError(error);
      console.error(`[ccdph] 更新任务 ${jobId} 异常退出:`, updateRuntime.job.error);
    });
    return json(res, { started: true, jobId });
  }
  if (req.method === "GET" && pathname === "/api/update/status") {
    // CCDPH-FIX(H-9): 更新进度查询。不校验桌面版 —— 网页版查状态无害（恒为 idle）。
    return json(res, { ...updateRuntime.job });
  }
  return json(res, { error: "接口不存在" }, 404);
}
}
