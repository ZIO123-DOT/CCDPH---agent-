import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

// 用于在 Electron 主进程里取到 safeStorage（Keychain）。纯 Node（npm start 开发态）下
// require("electron") 要么解析失败、要么返回的是 electron 二进制路径字符串（无 safeStorage），
// 两者都会在下方被识别为「无安全存储」而安全降级。
const require = createRequire(import.meta.url);

const POWERSHELL_EXE = path.join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const TASKKILL_EXE = path.join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
  "taskkill.exe",
);
// CCDPH-FIX(P3-17): PowerShell 会派生（conhost 等）子进程，只 `child.kill()` 会留下它们。
// 统一用 System32 绝对路径的 taskkill /T 收拾整棵树。
function killHelperTree(child) {
  if (Number.isInteger(child?.pid) && child.pid > 0) {
    try {
      spawn(TASKKILL_EXE, ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      })
        .on("error", () => { })
        .unref?.();
    } catch {
      /* 忽略：下面仍会尝试单进程 kill */
    }
  }
  try {
    child?.kill?.();
  } catch {
    /* 忽略 */
  }
}

function runWindowsDpapi(script, input, maxBytes) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      POWERSHELL_EXE,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const finish = (error, value = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      killHelperTree(child);
      finish(new Error("Windows DPAPI 操作超时"));
    }, 15_000);
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxBytes * 2) {
        killHelperTree(child);
        finish(new Error("Windows DPAPI 输出超过安全上限"));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= 64 * 1024) stderr.push(chunk);
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code !== 0)
        return finish(
          new Error(
            `Windows DPAPI 操作失败（退出码 ${code}）：${Buffer.concat(stderr).toString("utf8").trim().slice(0, 500)}`,
          ),
        );
      finish(null, Buffer.concat(stdout).toString("utf8").trim());
    });
    child.stdin.on("error", (error) => finish(error));
    child.stdin.end(String(input));
  });
}

// macOS：Electron safeStorage（Keychain）。仅在 Electron 主进程内可用；纯 Node（npm start）
// 下 require("electron") 会失败或返回路径字符串 → 返回 null（会话级降级）。
function resolveElectronSafeStorage() {
  try {
    const electron = require("electron");
    const safeStorage = electron && electron.safeStorage;
    return safeStorage &&
      typeof safeStorage.isEncryptionAvailable === "function" &&
      safeStorage.isEncryptionAvailable()
      ? safeStorage
      : null;
  } catch {
    return null;
  }
}

export function createMacKeychainProtector(
  safeStorage = resolveElectronSafeStorage(),
) {
  if (!safeStorage) return null;
  return {
    name: "macos-keychain",
    encrypt: async (plaintext) =>
      safeStorage.encryptString(String(plaintext)).toString("base64"),
    decrypt: async (payload) =>
      safeStorage.decryptString(Buffer.from(String(payload), "base64")),
  };
}

export function createDefaultCredentialProtector(maxBytes = 1024 * 1024) {
  if (process.platform === "darwin") return createMacKeychainProtector();
  if (process.platform !== "win32") return null;
  return {
    name: "windows-dpapi",
    encrypt: (plaintext) =>
      runWindowsDpapi(
        "Add-Type -AssemblyName System.Security;$b=[Convert]::FromBase64String([Console]::In.ReadToEnd());$p=[System.Security.Cryptography.ProtectedData]::Protect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($p))",
        Buffer.from(String(plaintext), "utf8").toString("base64"),
        maxBytes,
      ),
    decrypt: (payload) =>
      runWindowsDpapi(
        "Add-Type -AssemblyName System.Security;$b=[Convert]::FromBase64String([Console]::In.ReadToEnd());$p=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Text.Encoding]::UTF8.GetString($p))",
        String(payload),
        maxBytes,
      ),
  };
}
