import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const [builderConfig, workflow, afterPack, desktopMain] = await Promise.all([
  readFile(path.join(root, "electron-builder.yml"), "utf8"),
  readFile(path.join(root, ".github/workflows/build.yml"), "utf8"),
  readFile(path.join(root, "scripts/after-pack.cjs"), "utf8"),
  readFile(path.join(root, "desktop.cjs"), "utf8"),
]);

assert.match(builderConfig, /hardenedRuntime:\s*true/);
assert.match(builderConfig, /notarize:\s*true/);
assert.match(builderConfig, /entitlements:\s*build-resources\/entitlements\.mac\.plist/);
assert.match(
  builderConfig,
  /entitlementsInherit:\s*build-resources\/entitlements\.mac\.inherit\.plist/,
);

for (const secret of [
  "MACOS_CERTIFICATE",
  "MACOS_CERTIFICATE_PASSWORD",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
]) {
  assert.match(workflow, new RegExp(`secrets\\.${secret}`), `${secret} 必须传入 macOS 构建`);
}
assert.match(workflow, /codesign --verify --deep --strict/);
assert.match(workflow, /spctl --assess --type execute/);
assert.match(workflow, /stapler validate/);
assert.match(workflow, /tests\/packaged-runtime-integrity\.mjs/);
assert.match(afterPack, /process\.env\.CSC_LINK/);
assert.match(desktopMain, /standardUserDataRoot\s*=\s*app\.getPath\("userData"\)/);
assert.match(
  desktopMain,
  /usePortableStorage\s*=\s*app\.isPackaged\s*&&\s*process\.platform\s*===\s*"win32"/,
);

console.log(
  "macOS release config ok: signed/notarized release and external userData are enforced",
);
