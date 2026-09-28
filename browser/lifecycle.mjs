import path from "node:path";

function samePath(left, right) {
  const a = path.resolve(String(left || ""));
  const b = path.resolve(String(right || ""));
  return process.platform === "win32"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

/**
 * Reconcile the owned Edge process with persisted browser settings.
 * This is the single runtime boundary used by every settings-writing route.
 */
export async function reconcileDedicatedBrowser(settings, deps) {
  const {
    dataDir,
    browserStatus,
    dedicatedEdgeState,
    detectBrowsers,
    launchDedicatedEdge,
    stopDedicatedEdge,
  } = deps;
  const desiredDedicated = Boolean(
    settings?.enabled && settings?.mode === "dedicated",
  );
  const current = dedicatedEdgeState();
  if (!desiredDedicated) {
    if (current && !(await stopDedicatedEdge()))
      throw new Error("无法结束专用浏览器，已保留原设置；请关闭 Edge 后重试");
    return { action: current ? "stopped" : "unchanged", current: null };
  }

  // CCDPH-FIX(R5-P2-4): 端口未配置（0）时拒绝启动专用浏览器（fail-closed），不再回退 9223。
  // 正常路径下 /api/browser/enable 与 /api/browser/launch 已随机分配并持久化端口。
  const port = Number(settings.dedicatedPort) || 0;
  if (!port) throw new Error("专用浏览器端口未配置，请先在设置里启用并分配端口");
  const profileDir = settings.profileDir || path.join(dataDir, "browser-profile");
  if (
    current &&
    current.port === port &&
    samePath(current.profileDir, profileDir)
  )
    return { action: "unchanged", current };

  if (current && !(await stopDedicatedEdge()))
    throw new Error("无法结束旧的专用浏览器，已保留原设置；请关闭 Edge 后重试");
  const msedge = (await detectBrowsers()).browsers.find(
    (browser) => browser.kind === "edge",
  )?.path;
  if (!msedge) throw new Error("本机未找到 Edge，无法启动专用授权浏览器");
  const launched = await launchDedicatedEdge(msedge, port, profileDir);
  if (!launched) {
    const failed = await browserStatus({ ...settings, profileDir, dedicatedPort: port });
    throw new Error(failed.launchError || "专用浏览器启动失败");
  }
  return {
    action: current ? "restarted" : "started",
    current: dedicatedEdgeState(),
    profileDir,
  };
}

export async function withBrowserSettingsTransition({
  previous,
  next,
  reconcile,
  commit,
  rollback,
  onRollbackError = () => {},
}) {
  try {
    await reconcile(next);
    return await commit(next);
  } catch (error) {
    await rollback(previous);
    try {
      await reconcile(previous);
    } catch (rollbackError) {
      onRollbackError(rollbackError);
    }
    throw error;
  }
}
