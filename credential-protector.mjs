import { spawn } from "node:child_process";
import path from "node:path";

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

export function createDefaultCredentialProtector(maxBytes = 1024 * 1024) {
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
