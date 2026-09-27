import fs from "node:fs/promises";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const WINDOWS_SYSTEM32 = path.join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
);
const WINDOWS_TASKKILL_EXE = path.join(WINDOWS_SYSTEM32, "taskkill.exe");
const WINDOWS_POWERSHELL_EXE = path.join(
  WINDOWS_SYSTEM32,
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const HELPER_STDOUT_MAX_CHARS = 2 * 1024 * 1024;
const HELPER_STDERR_MAX_CHARS = 4000;
const HELPER_RESPONSE_TIMEOUT_MS = 10_000;

export function mergePendingTerminalRecords(pending, current) {
  const recordKey = (record) => {
    const pid = Number(record?.pid);
    if (!Number.isInteger(pid) || pid <= 0) return "";
    return `${pid}|${String(record?.name || "").toLowerCase()}|${String(record?.started || "")}`;
  };
  const merged = new Map();
  for (const record of Array.isArray(pending) ? pending : []) {
    const key = recordKey(record);
    if (key) merged.set(key, record);
  }
  for (const record of Array.isArray(current) ? current : []) {
    const key = recordKey(record);
    if (key) merged.set(key, record);
  }
  return [...merged.values()];
}

export async function readTerminalRegistryDocument(
  file,
  {
    readFile = (target) => fs.readFile(target, "utf8"),
    removeFile = (target) => fs.rm(target, { force: true }),
    logger = console,
    onReadError = () => {},
  } = {},
) {
  let raw;
  try {
    raw = await readFile(file);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    logger.warn(
      "[ccdph] 读取终端进程注册表失败，已保留原文件以便下次重试:",
      error?.message || error,
    );
    onReadError(error);
    return null;
  }
  try {
    const doc = JSON.parse(raw);
    if (!doc || typeof doc !== "object" || Array.isArray(doc))
      throw new Error("注册表根节点不是对象");
    return doc;
  } catch (error) {
    await removeFile(file).catch((removeError) =>
      logger.warn(
        "[ccdph] 删除损坏的终端进程注册表失败:",
        removeError?.message || removeError,
      ),
    );
    return null;
  }
}

export async function recoverUnreadableTerminalRecords(
  file,
  pending,
  { readDocument = readTerminalRegistryDocument, logger = console } = {},
) {
  let unreadable = false;
  const doc = await readDocument(file, {
    logger,
    onReadError: () => {
      unreadable = true;
    },
  });
  return {
    unreadable,
    records: doc
      ? mergePendingTerminalRecords(pending, doc.records)
      : mergePendingTerminalRecords(pending, []),
  };
}

export function terminalRegistryPlatformStatus(platform = process.platform) {
  return platform === "win32"
    ? { supported: true, reason: "" }
    : {
        supported: false,
        reason: `终端异常退出恢复依赖 Windows Toolhelp32/taskkill，当前平台 ${platform} 不支持`,
      };
}

// Compile the Toolhelp32 bridge once in a long-lived helper. The previous
// implementation spawned PowerShell and Add-Type every two seconds while a
// terminal was active (about 1,800 compilations/hour).
const PROCESS_HELPER_SCRIPT = String.raw`
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class CcdphProcessSnapshot {
  public sealed class Entry {
    public uint ProcessId { get; set; }
    public uint ParentProcessId { get; set; }
    public string Name { get; set; }
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct PROCESSENTRY32 {
    public uint dwSize;
    public uint cntUsage;
    public uint th32ProcessID;
    public IntPtr th32DefaultHeapID;
    public uint th32ModuleID;
    public uint cntThreads;
    public uint th32ParentProcessID;
    public int pcPriClassBase;
    public uint dwFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
    public string szExeFile;
  }

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool Process32FirstW(IntPtr snapshot, ref PROCESSENTRY32 entry);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool Process32NextW(IntPtr snapshot, ref PROCESSENTRY32 entry);

  [DllImport("kernel32.dll")]
  private static extern bool CloseHandle(IntPtr handle);

  public static Entry[] Get() {
    const uint TH32CS_SNAPPROCESS = 0x00000002;
    IntPtr snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == new IntPtr(-1))
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    try {
      var result = new List<Entry>();
      var native = new PROCESSENTRY32();
      native.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
      if (!Process32FirstW(snapshot, ref native))
        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      do {
        result.Add(new Entry {
          ProcessId = native.th32ProcessID,
          ParentProcessId = native.th32ParentProcessID,
          Name = native.szExeFile ?? ""
        });
        native.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
      } while (Process32NextW(snapshot, ref native));
      return result.ToArray();
    } finally {
      CloseHandle(snapshot);
    }
  }
}
'@

while (($request = [Console]::In.ReadLine()) -ne $null) {
  $requestId = ''
  try {
    $requestDoc = $request | ConvertFrom-Json
    $requestId = [string]$requestDoc.id
    $all = @([CcdphProcessSnapshot]::Get())
    $byPid = @{}
    $byParent = @{}
    foreach ($item in $all) {
      $byPid[[uint32]$item.ProcessId] = $item
      $parent = [uint32]$item.ParentProcessId
      if (-not $byParent.ContainsKey($parent)) {
        $byParent[$parent] = [Collections.Generic.List[object]]::new()
      }
      $byParent[$parent].Add($item)
    }
    $selected = [Collections.Generic.HashSet[uint32]]::new()
    $queue = [Collections.Generic.Queue[uint32]]::new()
    foreach ($root in @($requestDoc.roots)) {
      $pidValue = [uint32]$root
      if ($pidValue -gt 0) { $queue.Enqueue($pidValue) }
    }
    while ($queue.Count -gt 0) {
      $pidValue = $queue.Dequeue()
      if (-not $selected.Add($pidValue)) { continue }
      if ($byParent.ContainsKey($pidValue)) {
        foreach ($child in $byParent[$pidValue]) {
          $queue.Enqueue([uint32]$child.ProcessId)
        }
      }
    }
    $rows = foreach ($pidValue in $selected) {
      $item = $byPid[$pidValue]
      if ($null -eq $item) { continue }
      $started = ''
      try {
        $process = [System.Diagnostics.Process]::GetProcessById([int]$pidValue)
        $started = $process.StartTime.ToUniversalTime().ToString('o')
        $process.Dispose()
      } catch { }
      [pscustomobject]@{
        ProcessId = $item.ProcessId
        ParentProcessId = $item.ParentProcessId
        Name = $item.Name
        Started = $started
      }
    }
    [Console]::Out.WriteLine((ConvertTo-Json -Compress -Depth 4 -InputObject @{ id = $requestId; rows = @($rows) }))
  } catch {
    [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @{ id = $requestId; error = $_.Exception.Message }))
  }
  [Console]::Out.Flush()
}
`;

export function createTerminalProcessRegistry({
  dataDir,
  getRootPids,
  killTimeout = 5000,
  logger = console,
}) {
  const file = path.join(dataDir, "terminal-processes.json");
  let snapshotPromise = null;
  let snapshotRequested = false;
  let delayedSnapshot = null;
  let periodicTimer = null;
  let processHelper = null;
  let helperOutput = "";
  let helperError = "";
  const helperRequests = new Map();
  let helperRequestSequence = 0;
  let pendingStaleRecords = [];
  let registryUnreadable = false;

  const mergeRecords = (current) => {
    return mergePendingTerminalRecords(pendingStaleRecords, current);
  };

  const uniqueTmpPath = () =>
    `${file}.terminal-pids-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;

  async function cleanupSnapshotTemps() {
    const folder = path.dirname(file);
    const prefix = `${path.basename(file)}.terminal-pids-`;
    const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith(prefix) || !entry.name.endsWith(".tmp"))
        continue;
      await fs.rm(path.join(folder, entry.name), { force: true }).catch((error) =>
        logger.warn("[ccdph] 清理终端注册表临时文件失败:", error?.message || error),
      );
    }
  }

  function rejectHelperRequests(error) {
    for (const request of helperRequests.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    helperRequests.clear();
  }

  function stopProcessHelper() {
    const helper = processHelper;
    processHelper = null;
    helperOutput = "";
    helperError = "";
    rejectHelperRequests(new Error("进程快照助手已停止"));
    if (!helper) return;
    helper.stdout?.removeAllListeners();
    helper.stderr?.removeAllListeners();
    helper.removeAllListeners();
    try {
      helper.stdin?.end();
      helper.kill();
    } catch { }
  }

  function ensureProcessHelper() {
    if (processHelper && processHelper.exitCode === null) return processHelper;
    helperOutput = "";
    helperError = "";
    const helper = spawn(
      WINDOWS_POWERSHELL_EXE,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", PROCESS_HELPER_SCRIPT],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    processHelper = helper;
    helper.stdout.setEncoding("utf8");
    helper.stderr.setEncoding("utf8");
    helper.stdout.on("data", (chunk) => {
      helperOutput += chunk;
      if (helperOutput.length > HELPER_STDOUT_MAX_CHARS) {
        logger.warn("[ccdph] 进程快照助手输出超过安全上限，已重启助手");
        stopProcessHelper();
        return;
      }
      for (;;) {
        const newline = helperOutput.indexOf("\n");
        if (newline < 0) break;
        const line = helperOutput.slice(0, newline).trim();
        helperOutput = helperOutput.slice(newline + 1);
        if (!line) continue;
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch (error) {
          logger.warn("[ccdph] 进程快照助手返回了无法解析的响应，已重启助手");
          stopProcessHelper();
          return;
        }
        const requestId = String(parsed?.id || "");
        const request = helperRequests.get(requestId);
        if (!request) continue;
        helperRequests.delete(requestId);
        clearTimeout(request.timer);
        try {
          if (parsed?.error) throw new Error(String(parsed.error));
          request.resolve(Array.isArray(parsed?.rows) ? parsed.rows : []);
        } catch (error) {
          request.reject(error);
        }
      }
    });
    helper.stderr.on("data", (chunk) => {
      helperError = `${helperError}${chunk}`.slice(-HELPER_STDERR_MAX_CHARS);
    });
    const failed = (error) => {
      if (processHelper === helper) processHelper = null;
      rejectHelperRequests(
        error instanceof Error
          ? error
          : new Error(helperError || "进程快照助手意外退出"),
      );
    };
    helper.once("error", failed);
    helper.once("exit", (code) =>
      failed(new Error(helperError || `进程快照助手退出（${code ?? "unknown"}）`)),
    );
    helper.stdin.on("error", failed);
    return helper;
  }

  async function windowsProcessTable(rootPids = []) {
    if (process.platform !== "win32") return [];
    const helper = ensureProcessHelper();
    return await new Promise((resolve, reject) => {
      const requestId = `${process.pid}-${++helperRequestSequence}-${Date.now()}`;
      const request = { id: requestId, resolve, reject, timer: null };
      request.timer = setTimeout(() => {
        helperRequests.delete(requestId);
        reject(new Error("进程快照助手响应超时"));
        stopProcessHelper();
      }, HELPER_RESPONSE_TIMEOUT_MS);
      request.timer.unref?.();
      helperRequests.set(requestId, request);
      try {
        helper.stdin.write(
          `${JSON.stringify({
            id: requestId,
            roots: rootPids
              .map(Number)
              .filter((pid) => Number.isInteger(pid) && pid > 0),
          })}\n`,
        );
      } catch (error) {
        helperRequests.delete(requestId);
        clearTimeout(request.timer);
        reject(error);
      }
    });
  }

  async function writeSnapshot() {
    if (process.platform !== "win32") return;
    if (registryUnreadable) {
      const recovered = await recoverUnreadableTerminalRecords(
        file,
        pendingStaleRecords,
        { logger },
      );
      if (recovered.unreadable) {
        logger.warn(
          "[ccdph] 终端进程注册表仍不可读，已跳过本次快照覆写以保留恢复记录",
        );
        return;
      }
      registryUnreadable = false;
      pendingStaleRecords = recovered.records;
    }
    const rootPids = getRootPids()
      .map(Number)
      .filter((pid) => Number.isInteger(pid) && pid > 0);
    const retainedRecords = mergeRecords([]);
    if (!rootPids.length) {
      if (retainedRecords.length) {
        const tmp = uniqueTmpPath();
        try {
          await fs.writeFile(
            tmp,
            JSON.stringify({ owner: null, records: retainedRecords }),
            "utf8",
          );
          await fs.rename(tmp, file);
        } catch (error) {
          await fs.rm(tmp, { force: true }).catch(() => {});
          throw error;
        }
      } else {
        await fs.rm(file, { force: true }).catch(() => { });
      }
      stopProcessHelper();
      return;
    }
    const table = await windowsProcessTable([...rootPids, process.pid]);
    const byPid = new Map(table.map((item) => [Number(item.ProcessId), item]));
    const byParent = new Map();
    for (const item of table) {
      const parent = Number(item.ParentProcessId);
      if (!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent).push(item);
    }
    const records = [];
    const seen = new Set();
    const queue = [...rootPids];
    while (queue.length) {
      const pid = queue.shift();
      if (seen.has(pid)) continue;
      seen.add(pid);
      const item = byPid.get(pid);
      if (item?.Started)
        records.push({
          pid,
          name: String(item.Name || ""),
          started: String(item.Started || ""),
        });
      for (const child of byParent.get(pid) || [])
        queue.push(Number(child.ProcessId));
    }
    const recordsToWrite = mergeRecords(records);
    const ownerItem = byPid.get(process.pid);
    const tmp = uniqueTmpPath();
    try {
      await fs.writeFile(
        tmp,
        JSON.stringify({
          owner: ownerItem?.Started
            ? {
                pid: process.pid,
                name: String(ownerItem.Name || ""),
                started: String(ownerItem.Started || ""),
              }
            : null,
          records: recordsToWrite,
        }),
        "utf8",
      );
      await fs.rename(tmp, file);
    } catch (error) {
      await fs.rm(tmp, { force: true }).catch(() => { });
      throw error;
    }
  }

  function schedule() {
    snapshotRequested = true;
    if (snapshotPromise) return snapshotPromise;
    snapshotPromise = (async () => {
      while (snapshotRequested) {
        snapshotRequested = false;
        await writeSnapshot().catch((error) =>
          logger.warn("[ccdph] 记录终端进程树失败:", error?.message || error),
        );
      }
    })().finally(() => {
      snapshotPromise = null;
      if (snapshotRequested) void schedule();
    });
    return snapshotPromise;
  }

  function scheduleAfter(delay = 250) {
    if (process.platform !== "win32" || delayedSnapshot) return;
    delayedSnapshot = setTimeout(() => {
      delayedSnapshot = null;
      void schedule();
    }, delay);
    delayedSnapshot.unref?.();
  }

  async function sweep() {
    if (process.platform !== "win32") return 0;
    await cleanupSnapshotTemps();
    registryUnreadable = false;
    const doc = await readTerminalRegistryDocument(file, {
      logger,
      onReadError: () => {
        registryUnreadable = true;
      },
    });
    if (!doc) return 0;
    // Enumeration failure is not proof that the recorded processes exited.
    // Preserve the registry so a later startup can retry instead of silently
    // losing the only recovery record.
    const owner = doc?.owner;
    const records = Array.isArray(doc?.records) ? doc.records : [];
    let table;
    try {
      table = await windowsProcessTable([
        Number(owner?.pid),
        ...records.map((record) => Number(record?.pid)),
      ]);
    } finally {
      // Startup sweeping needs one snapshot only. A helper will be started
      // again and kept alive when an interactive terminal is present.
      stopProcessHelper();
    }
    const live = new Map(table.map((item) => [Number(item.ProcessId), item]));
    const currentOwner = live.get(Number(owner?.pid));
    if (
      currentOwner &&
      String(currentOwner.Name || "").toLowerCase() ===
        String(owner?.name || "").toLowerCase() &&
      String(currentOwner.Started || "") === String(owner?.started || "")
    ) {
      logger.warn("[ccdph] 终端进程注册表属于仍在运行的实例，已跳过残留清扫");
      return 0;
    }
    let removed = 0;
    const killFailures = [];
    try {
      for (const record of records) {
        const pid = Number(record?.pid);
        const current = live.get(pid);
        if (
          !current ||
          String(current.Name || "").toLowerCase() !==
            String(record.name || "").toLowerCase() ||
          String(current.Started || "") !== String(record.started || "")
        )
          continue;
        // PID 可能在首次快照与 taskkill 之间退出并被复用。每次 kill 前重新核验
        // 名称与启动时间，避免 /T 连坐结束复用该 PID 的无关进程树。
        const immediateTable = await windowsProcessTable([pid]);
        const immediate = immediateTable.find(
          (item) => Number(item.ProcessId) === pid,
        );
        if (
          !immediate ||
          String(immediate.Name || "").toLowerCase() !==
            String(record.name || "").toLowerCase() ||
          String(immediate.Started || "") !== String(record.started || "")
        )
          continue;
        try {
          await exec(WINDOWS_TASKKILL_EXE, ["/PID", String(pid), "/T", "/F"], {
            windowsHide: true,
            timeout: killTimeout,
          });
          removed += 1;
        } catch (error) {
          killFailures.push({ pid, error });
          logger.warn(
            `[ccdph] 清理残留终端进程 ${pid} 失败，注册表已保留以便下次重试:`,
            error?.message || error,
          );
        }
      }
    } finally {
      stopProcessHelper();
    }
    if (killFailures.length) {
      pendingStaleRecords = records.filter((record) =>
        killFailures.some((failure) => failure.pid === Number(record.pid)),
      );
      throw new Error(`仍有 ${killFailures.length} 个残留终端进程未能确认清理`);
    }
    pendingStaleRecords = [];
    await fs.rm(file, { force: true }).catch(() => { });
    if (removed)
      logger.warn(`[ccdph] 已清理上次异常退出残留的 ${removed} 个终端进程`);
    return removed;
  }

  function start(interval = 2000) {
    if (periodicTimer) return;
    const support = terminalRegistryPlatformStatus();
    if (!support.supported) {
      logger.warn(`[ccdph] ${support.reason}；终端本身仍可使用，但强杀后的残留进程需手动清理`);
      return;
    }
    periodicTimer = setInterval(() => {
      if (getRootPids().some((pid) => Number.isInteger(Number(pid))))
        void schedule();
    }, interval);
    periodicTimer.unref?.();
  }

  function dispose() {
    clearInterval(periodicTimer);
    clearTimeout(delayedSnapshot);
    periodicTimer = null;
    delayedSnapshot = null;
    stopProcessHelper();
  }

  return { dispose, schedule, scheduleAfter, start, sweep };
}
