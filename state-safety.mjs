// Depth invariants:
// - STATE_CONTENT_MAX_DEPTH bounds individual inbound values/events.
// - STATE_SAFE_SERIALIZATION_DEPTH bounds the complete persisted state tree.
// The content limit must never exceed the serialization limit, so every value
// accepted by the business-level guard remains safe for state persistence.
export const STATE_CONTENT_MAX_DEPTH = 100;
export const STATE_SAFE_SERIALIZATION_DEPTH = 256;
if (STATE_CONTENT_MAX_DEPTH > STATE_SAFE_SERIALIZATION_DEPTH)
  throw new Error("状态内容深度上限不能超过安全序列化深度上限");

export function foldDeepStateSubtrees(
  value,
  limit = STATE_SAFE_SERIALIZATION_DEPTH,
) {
  if (!value || typeof value !== "object") return { changed: false, folded: 0 };
  limit = Number.isFinite(Number(limit)) ? Math.max(0, Math.floor(Number(limit))) : STATE_SAFE_SERIALIZATION_DEPTH;
  const stack = [{ value, depth: 0, parent: null, key: null }];
  const seen = new WeakSet();
  let changed = false;
  let folded = 0;
  while (stack.length) {
    const current = stack.pop();
    const item = current.value;
    if (!item || typeof item !== "object") continue;
    if (current.depth > limit) {
      if (!current.parent) continue;
      Object.defineProperty(current.parent, current.key, {
        value: `[字段嵌套超过 ${limit} 层，已折叠]`,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      changed = true;
      folded += 1;
      continue;
    }
    if (seen.has(item)) continue;
    seen.add(item);
    if (Array.isArray(item)) {
      for (let index = item.length - 1; index >= 0; index -= 1)
        if (item[index] && typeof item[index] === "object")
          stack.push({
            value: item[index],
            depth: current.depth + 1,
            parent: item,
            key: index,
          });
    } else {
      for (const [key, child] of Object.entries(item))
        if (child && typeof child === "object")
          stack.push({
            value: child,
            depth: current.depth + 1,
            parent: item,
            key,
          });
    }
  }
  return { changed, folded };
}

export function assertJsonTextDepth(text, maxDepth = STATE_CONTENT_MAX_DEPTH) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (inString) {
      if (escaped) escaped = false;
      else if (code === 92) escaped = true;
      else if (code === 34) inString = false;
      continue;
    }
    if (code === 34) {
      inString = true;
      continue;
    }
    if (code === 123 || code === 91) {
      depth += 1;
      if (depth > maxDepth + 1)
        throw new Error(`请求 JSON 嵌套不能超过 ${maxDepth} 层`);
    } else if (code === 125 || code === 93) {
      depth = Math.max(0, depth - 1);
    }
  }
  return text;
}

function stringifyPreviewBounded(
  value,
  { maxChars, maxItems, maxNodes, maxDepth },
) {
  const state = {
    nodes: 0,
    remainingChars: maxChars,
    truncated: false,
    ancestors: new WeakSet(),
  };
  const clone = (item, depth) => {
    if (typeof item === "string") {
      if (state.remainingChars <= 0) {
        state.truncated = true;
        return undefined;
      }
      const kept = item.slice(0, state.remainingChars);
      state.remainingChars -= kept.length;
      if (kept.length < item.length) state.truncated = true;
      return kept.length < item.length ? `${kept}…（已截断）` : kept;
    }
    if (!item || typeof item !== "object") {
      if (["number", "boolean"].includes(typeof item))
        state.remainingChars = Math.max(
          0,
          state.remainingChars - String(item).length,
        );
      return typeof item === "bigint" ? String(item) : item;
    }
    if (state.remainingChars <= 0) {
      state.truncated = true;
      return undefined;
    }
    if (depth > maxDepth) {
      state.truncated = true;
      return "[内容嵌套过深，已截断]";
    }
    if (state.ancestors.has(item)) return "[循环引用]";
    state.ancestors.add(item);
    try {
      if (typeof item.toJSON === "function") {
        const converted = item.toJSON();
        if (converted !== item) {
          state.nodes += 1;
          if (state.nodes > maxNodes) {
            state.truncated = true;
            return "[内容节点过多，已截断]";
          }
          return clone(converted, depth + 1);
        }
      }
      state.nodes += 1;
      if (state.nodes > maxNodes) {
        state.truncated = true;
        return "[内容节点过多，已截断]";
      }
      if (Array.isArray(item)) {
        const count = Math.min(item.length, maxItems);
        const sample = [];
        for (let index = 0; index < count; index += 1)
          sample.push(clone(item[index], depth + 1));
        if (item.length > maxItems) {
          state.truncated = true;
          return {
            截断提示: `仅预览前 ${maxItems} 项（原 ${item.length} 项）`,
            items: sample,
          };
        }
        return sample;
      }
      const sample = Object.create(null);
      let count = 0;
      for (const property of Object.keys(item)) {
        count += 1;
        if (count > maxItems) {
          sample.截断提示 = `仅预览前 ${maxItems} 个字段`;
          state.truncated = true;
          break;
        }
        const propertyCost = JSON.stringify(property).length + 2;
        if (propertyCost > state.remainingChars) {
          state.truncated = true;
          break;
        }
        state.remainingChars -= propertyCost;
        sample[property] = clone(item[property], depth + 1);
      }
      return sample;
    } finally {
      state.ancestors.delete(item);
    }
  };
  const cloned = clone(value, 0);
  const compact = JSON.stringify(cloned);
  if (compact === undefined) return { compact, pretty: compact };
  const pretty = JSON.stringify(cloned, null, 2);
  const addBudgetMarker = (serialized) =>
    state.truncated
      ? `${serialized}\n…（内容预算已用尽）`
      : serialized;
  return {
    compact: addBudgetMarker(compact),
    pretty: addBudgetMarker(pretty),
  };
}

// 在不构造整段 JSON 字符串的情况下做保守字节预算。对象键和逗号按略高于真实 JSON
// 的成本计入，因此只会提前折叠，不会把超限值误判为安全。用于模型 tool input 热路径，
// 避免先对数 MB 输入完整 JSON.stringify，判断超限后又立刻丢弃该字符串。
export function fitsJsonBudget(
  value,
  maxBytes,
  { maxDepth = STATE_CONTENT_MAX_DEPTH, maxNodes = 20_000 } = {},
) {
  maxBytes = Math.max(0, Math.floor(Number(maxBytes) || 0));
  const stack = [{ value, depth: 0 }];
  const seen = new WeakSet();
  let bytes = 0;
  let nodes = 0;
  const add = (amount) => {
    bytes += amount;
    return bytes <= maxBytes;
  };
  while (stack.length) {
    const current = stack.pop();
    const item = current.value;
    if (item === null) {
      if (!add(4)) return false;
      continue;
    }
    if (typeof item !== "object") {
      let text;
      try {
        text = JSON.stringify(
          typeof item === "bigint" ? String(item) : item,
        );
      } catch {
        return false;
      }
      if (!add(Buffer.byteLength(text ?? "null", "utf8"))) return false;
      continue;
    }
    if (current.depth > maxDepth || seen.has(item)) return false;
    seen.add(item);
    nodes += 1;
    if (nodes > maxNodes || !add(2)) return false;
    if (Array.isArray(item)) {
      if (!add(Math.max(0, item.length - 1))) return false;
      for (let index = item.length - 1; index >= 0; index -= 1)
        stack.push({ value: item[index], depth: current.depth + 1 });
      continue;
    }
    let keys;
    try {
      keys = Object.keys(item);
    } catch {
      return false;
    }
    if (!add(Math.max(0, keys.length - 1))) return false;
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      let child;
      try {
        child = item[key];
      } catch {
        return false;
      }
      if (!add(Buffer.byteLength(JSON.stringify(key), "utf8") + 1))
        return false;
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
  return true;
}

export function previewBounded(
  value,
  {
    maxChars = 40_000,
    maxItems = 100,
    maxNodes = 2000,
    maxDepth = 64,
  } = {},
) {
  if (typeof value === "string") return value.slice(0, maxChars);
  const limits = { maxChars, maxItems, maxNodes, maxDepth };
  try {
    const { compact, pretty } = stringifyPreviewBounded(value, limits);
    if (compact === undefined) return "";
    if (compact.length > maxChars)
      return `${compact.slice(0, maxChars)}\n…（内容过长，已截断 ${compact.length - maxChars} 字符）`;
    return pretty.length > maxChars ? compact : pretty;
  } catch {
    return "[内容嵌套过深，无法预览]";
  }
}
