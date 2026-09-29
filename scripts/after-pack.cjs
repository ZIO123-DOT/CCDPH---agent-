// 无 Developer ID 的本地构建做 ad-hoc 签名，便于开发机自测。正式 CI 设置 CSC_LINK
// 后由 electron-builder 用 Developer ID Application 重签并公证，不能在这里用 ad-hoc
// 覆盖正式签名。
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) {
    console.log("[after-pack] production signing identity configured; skip ad-hoc signing");
    return;
  }
  const appDir = context.appOutDir; // release/mac-arm64
  const appName = fs.readdirSync(appDir).find((e) => e.endsWith(".app"));
  if (!appName) throw new Error(`after-pack: 在 ${appDir} 未找到 .app`);
  const appPath = path.join(appDir, appName);
  console.log(`[after-pack] ad-hoc signing ${appPath}`);
  execFileSync("codesign", ["--deep", "--force", "--sign", "-", appPath], {
    stdio: "inherit",
  });
};
