import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkspaceMutationRoute } from "../routes/workspace-mutation.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "ccdph-worktree-root-"));
const base = await mkdtemp(path.join(os.tmpdir(), "ccdph-worktree-base-"));

async function resolveAuthorized(target, expectedBase) {
  const [realBase, realTarget] = await Promise.all([
    realpath(expectedBase).catch(() => null),
    realpath(target).catch(() => null),
  ]);
  if (!realBase || !realTarget) return null;
  const relative = path.relative(realBase, realTarget);
  if (!relative || relative.includes(path.sep) || relative.startsWith(".."))
    return null;
  return { base: realBase, target: realTarget };
}

function harness({ resolveTarget = resolveAuthorized, failAdd = false } = {}) {
  const gitCalls = [];
  let worktreeTarget = "";
  const route = createWorkspaceMutationRoute({
    body: async (req) => req._body,
    getDb: () => ({ projects: [], sessions: [], settings: {} }),
    getFilePicker: () => null,
    getFolderPicker: () => null,
    getPathOpener: () => null,
    json: (_res, value) => value,
    repoRootFor: () => root,
    requireObject: (value) => value,
    resolveAuthorizedWorktreeTarget: resolveTarget,
    worktreeBaseDir: () => base,
    git: async (_cwd, args) => {
      gitCalls.push(args);
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree")
        return "true\n";
      if (args[0] === "check-ref-format") return "";
      if (args[0] === "rev-parse" && String(args.at(-1)).startsWith("refs/heads/"))
        throw new Error("missing branch");
      if (args[0] === "worktree" && args[1] === "add") {
        const target = args[2] === "-b" ? args[4] : args[2];
        worktreeTarget = target;
        await writeFile(path.join(target, ".git"), "gitdir: test", "utf8");
        if (failAdd) throw new Error("simulated partial git failure");
        return "";
      }
      return "";
    },
  });
  return { route, gitCalls, worktreeTarget: () => worktreeTarget };
}

async function create(route, branch) {
  const url = new URL("http://127.0.0.1/api/worktrees/create");
  return route(
    { method: "POST", _body: { projectId: "p", branch } },
    {},
    url,
    url.pathname,
  );
}

try {
  const normal = harness();
  const created = await create(normal.route, "feature/safe-worktree");
  assert.equal(created.ok, true);
  assert.equal(path.dirname(created.path), await realpath(base));
  assert.match(path.basename(created.path), /^feature-safe-worktree-[0-9a-f]{8}$/);

  let checks = 0;
  const raced = harness({
    resolveTarget: async (target, expectedBase) => {
      checks += 1;
      return checks === 1 ? resolveAuthorized(target, expectedBase) : null;
    },
  });
  await assert.rejects(
    create(raced.route, "feature/raced-worktree"),
    /创建后目标路径发生替换或越界/,
  );

  const partial = harness({ failAdd: true });
  await assert.rejects(
    create(partial.route, "feature/partial-worktree"),
    /simulated partial git failure/,
  );
  await assert.rejects(realpath(partial.worktreeTarget()), { code: "ENOENT" });
  console.log("worktree create safety ok: randomized reservation and post-create containment checks pass");
} finally {
  await rm(root, { recursive: true, force: true });
  await rm(base, { recursive: true, force: true });
}
