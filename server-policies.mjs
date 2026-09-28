import { randomInt } from "node:crypto";
import { STATE_CONTENT_MAX_DEPTH } from "./state-safety.mjs";

// CCDPH-FIX(R5-P2-4): 专用浏览器调试端口默认不再固定 9223，改为随机高端口。CDP 无鉴权，
// 固定默认端口 = 任何同机进程都知道该连哪里；随机化后同机攻击者必须先探测端口，抬高门槛
//（仍可 netstat 发现，属纵深防御而非根本消除——CDP 协议本身无令牌，根因见 browser/service.mjs）。
export function randomDedicatedPort() {
  // 20000–59999：避开特权端口(0-1023)与常见服务端口，降低与他程序冲突概率
  return randomInt(20000, 60000);
}

export function decodeJsonBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe)
    return buffer.subarray(2).toString("utf16le");
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    for (let i = 0; i + 1 < swapped.length; i += 2) {
      const first = swapped[i];
      swapped[i] = swapped[i + 1];
      swapped[i + 1] = first;
    }
    return swapped.toString("utf16le");
  }
  const text = buffer.toString("utf8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
// CCDPH-FIX(A10-17): 「只是太大」≠「已损坏」。本函数只做**非致命诊断**，返回对象/数组节点数与
// 相对最大深度，供调用方记录日志；**绝不 throw、绝不参与「判定损坏 → 备份 + 空白启动」**。
// 原实现越界即 throw，配合 start() 的 catch 会把合法重度库（如 100 会话 × 2100 事件）误判为损坏。
export function scanStateComplexity(value) {
  const stack = [{ value, depth: 0 }];
  const seen = new WeakSet();
  let nodes = 0;
  // CCDPH-FIX(R4-P3-3): 区分「唯一节点数」与「引用总数」。旧实现只返回去重后的 nodes，
  // 大量共享引用（如 20 万槽位指向同一对象）会让诊断低估真实遍历成本与内存占用。
  // references 计入每一个被弹出的对象引用（含共享/重复），nodes 仍按 WeakSet 去重。
  let references = 0;
  let maxDepth = 0;
  while (stack.length) {
    const current = stack.pop();
    const item = current.value;
    if (!item || typeof item !== "object") continue;
    references += 1;
    if (seen.has(item)) continue;
    seen.add(item);
    nodes += 1;
    if (current.depth > maxDepth) maxDepth = current.depth;
    const values = Array.isArray(item) ? item : Object.values(item);
    for (const child of values)
      if (child && typeof child === "object")
        stack.push({ value: child, depth: current.depth + 1 });
  }
  return { nodes, references, maxDepth };
}
// CCDPH-FIX(A10-17): 计算**某个值自身**的嵌套最大深度（相对计数，不含根这一层）。
// 用于对单条事件/单条消息做局部判定：内容过深时只折叠那一条，绝不因此把整库判损坏。
export function maxNestingDepth(value, limit = Infinity) {
  let maxDepth = 0;
  const stack = [{ v: value, d: 0 }];
  const seen = new WeakSet();
  while (stack.length) {
    const { v, d } = stack.pop();
    if (!v || typeof v !== "object") continue;
    if (seen.has(v)) continue;
    seen.add(v);
    if (d > maxDepth) maxDepth = d;
    // CCDPH-FIX(D-01): 已经确定超限时立即返回，不再遍历剩余节点。
    if (maxDepth > limit) return maxDepth;
    const values = Array.isArray(v) ? v : Object.values(v);
    for (const c of values) if (c && typeof c === "object") stack.push({ v: c, d: d + 1 });
  }
  return maxDepth;
}
export function assertJsonDepth(value, maxDepth = STATE_CONTENT_MAX_DEPTH) {
  if (maxNestingDepth(value, maxDepth) > maxDepth)
    throw new Error(`请求 JSON 嵌套不能超过 ${maxDepth} 层`);
  return value;
}
export const PERMISSION_MODES = ["default", "acceptEdits", "plan", "auto"];
// 端口合法性判定：/api/settings 与 /api/browser/enable 共用。
// CCDPH-FIX: 原先只有 /api/settings 校验范围；/api/browser/enable 只判整数，
// 导致可以把浏览器连接端口设成 80 这类特权端口。
export const isValidPort = (value) =>
  Number.isInteger(value) && value >= 1024 && value <= 65535;
// CCDPH-FIX(F7): 界面快捷键组合键校验。旧正则只认「单字符」键名，
// ctrl+arrowup / ctrl+space / 命名键基本都被静默丢弃（前端却提示"已保存"）。
export const SHORTCUT_RE =
  /^((ctrl|alt|shift|meta)\+)*([a-z0-9,.;\[\]'\/=\-`]|f([1-9]|1[0-2])|arrow(up|down|left|right)|page(up|down)|home|end|space|enter|escape|tab|delete|insert|backspace)$/i;
// 至少一个修饰键（裸字母/数字/标点会吞掉正常输入，不允许单独注册）
export const SHORTCUT_MODIFIER_RE = /^(ctrl|alt|shift|meta)\+/i;
// 可单独使用的命名键（无修饰键也不会与文本输入冲突）。
export const SHORTCUT_NAMED_KEY_RE =
  /^(f([1-9]|1[0-2])|arrow(up|down|left|right)|page(up|down)|home|end|space|enter|escape|tab|delete|insert|backspace)$/i;
export function normalizePermissionMode(value, fallback = "default") {
  return PERMISSION_MODES.includes(value)
    ? value
    : PERMISSION_MODES.includes(fallback)
      ? fallback
      : "default";
}
export function canApplyPermissionModeLive(initialMode, nextMode) {
  return initialMode !== "auto" || nextMode === "auto";
}
/**
 * The SDK's auto mode owns permission classification. Supplying canUseTool
 * would install a host approval surface and make every classifier escalation
 * wait for a manual response, which defeats the Workbench's auto mode.
 */
export function permissionOptions(permissionMode, canUseTool) {
  const mode = normalizePermissionMode(permissionMode);
  if (mode === "auto")
    return { permissionMode: mode, permissionPrompts: "none" };
  return {
    permissionMode: mode,
    permissionPrompts: "host",
    canUseTool,
  };
}
export function browserRestrictions(permissionMode, browserEnabled) {
  return permissionMode === "auto" && browserEnabled
    ? {
        disallowedTools: [
          "mcp__browser__browser_evaluate",
          "mcp__browser__browser_run_code",
          // CCDPH-FIX(D2): auto 模式补封 browser_file_upload。它是「本地→远端外泄原语」
          // （把本地任意文件读出并上传到页面），与 evaluate/run_code 同属「突破只读浏览
          // 边界」的能力 —— 威胁模型上同一类只封一半 = 收口不一致（提示注入可让模型
          // 在 auto + 浏览器开启时无审批上传 .ssh/.env 等敏感文件）。
          // 已评估其余浏览器工具：click/type/navigate 按产品语义保留（auto 的核心用法）；
          // screenshot/pdf_save 只把内容回传给模型而非外发远端；install 只改本机浏览器
          // 安装，无外泄能力 —— 均不在此列。
          "mcp__browser__browser_file_upload",
        ],
      }
    : {};
}
