import fs from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";
import { decodeJsonBuffer, scanStateComplexity } from "./server-policies.mjs";
import { foldDeepStateSubtrees } from "./state-safety.mjs";

async function readStateBounded(filename, maxBytes) {
  const limit = Math.max(1, Math.floor(Number(maxBytes) || 0));
  const handle = await fs.open(filename, "r");
  try {
    const before = await handle.stat();
    if (before.size > limit) {
      const error = new Error(`state.json 超过安全读取上限 ${limit} 字节`);
      error.code = "EFBIG";
      throw error;
    }
    const chunks = [];
    let total = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      total += chunk.length;
      if (total > limit) {
        const error = new Error(`state.json 超过安全读取上限 ${limit} 字节`);
        error.code = "EFBIG";
        throw error;
      }
      chunks.push(chunk);
    }
    const after = await handle.stat();
    if (
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      total !== before.size
    ) {
      const error = new Error("state.json 在读取期间发生变化，请重试");
      error.code = "EAGAIN";
      throw error;
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close().catch(() => { });
  }
}

try {
  const parsed = JSON.parse(
    decodeJsonBuffer(
      await readStateBounded(workerData.stateFile, workerData.maxBytes),
    ),
  );
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error(
      `state.json 顶层是 ${parsed === null ? "null" : Array.isArray(parsed) ? "数组" : typeof parsed}，不是会话数据对象`,
    );
  const foldedState = foldDeepStateSubtrees(parsed, workerData.serializationDepth);
  const complexity = scanStateComplexity(parsed);
  parentPort.postMessage({ parsed, foldedState, complexity });
} catch (error) {
  parentPort.postMessage({
    error: String(error?.message || error),
    code: String(error?.code || ""),
  });
}
