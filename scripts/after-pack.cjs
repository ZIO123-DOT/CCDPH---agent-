// electron-builder 打包完成后、生成 dmg 之前，对 macOS 应用做 ad-hoc 签名。
// 未签名的 mac 应用在 Apple Silicon 上下载后会被 Gatekeeper 判为「已损坏」；
// ad-hoc 签名后变为「无法验证开发者」，首次可右键 → 打开（或 xattr -cr）绕过。
// 说明：SDK 原生二进制（claude）在 CI 里已于 `npm run integrity` 之前单独签名，
// 这里 --deep 再签一次是幂等的（ad-hoc 签名确定性），不会改变其哈希。
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appDir = context.appOutDir; // release/mac-arm64
  const appName = fs.readdirSync(appDir).find((e) => e.endsWith(".app"));
  if (!appName) throw new Error(`after-pack: 在 ${appDir} 未找到 .app`);
  const appPath = path.join(appDir, appName);
  console.log(`[after-pack] ad-hoc signing ${appPath}`);
  execFileSync("codesign", ["--deep", "--force", "--sign", "-", appPath], {
    stdio: "inherit",
  });
};
