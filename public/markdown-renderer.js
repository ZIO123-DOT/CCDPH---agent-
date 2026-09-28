import { marked } from "/vendor/marked.js";
import DOMPurify from "/vendor/purify.js";

export const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ],
  );

const isHighSurrogate = (code) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code) => code >= 0xdc00 && code <= 0xdfff;
export const clip = (value, max) => {
  if (value.length <= max) return value;
  const cut = isHighSurrogate(value.charCodeAt(max - 1)) ? max - 1 : max;
  return value.slice(0, cut);
};
export const clipTail = (value, max) => {
  if (value.length <= max) return value;
  const start = value.length - max;
  return value.slice(isLowSurrogate(value.charCodeAt(start)) ? start + 1 : start);
};

const MARKDOWN_CACHE_MAX = 400;
const markdownCache = new Map();
// D-02 修复：marked 是递归下降解析器，嵌套层级 = 调用栈深度。深嵌套（实测约 3000 层
// `>`）会让 marked.parse 抛 RangeError，而 markdown() 是 DOM 渲染的唯一出口，一旦抛出
// 整条渲染链断裂、异常被静默吞成一句英文内部报错；又因触发事件已持久化，同一会话会
// 永久无法渲染。这里做廉价预检：命中深嵌套特征或超长文本时直接降级为纯文本。
// NEST_GUARD 只匹配连续 `>` 引用块，非递归的长输入（如大量 `[`）不受影响。
const NEST_GUARD = /(^|\n)[ \t]*(?:>[ \t]*){300,}/;
// CCDPH-FIX(FE-01): NEST_GUARD 只认 `>`，但 marked 的递归下降对**定界符**同样敏感。
// 实测（marked 17 + DOMPurify 3.4）：`*`×5625 + "x" + `*`×5625（11251 字符）抛
// RangeError: Maximum call stack size exceeded；`**`×3372（13489 字符）、`_`×6399 同理。
// 爆栈前代价是二次的：10KB 连续 `*` 阻塞主线程 134ms（n=1000→4.4ms、6000→180.9ms），
// 而流式渲染每 120ms 重排一次 —— 一条含星号的回复就能把界面拖死。
// 因此补一条「连续定界符」预检，阈值 300：远低于实测爆栈阈值（3372），也远高于任何
// 正常文本所需的长度 —— `***` / `---` 水平线只有 3 个，`**粗体**` 2 个，``` 围栏 3 个，
// emoji、ASCII 表格（用 `-`/`|`）、列表符号（`* ` 之间有空格）都不在这个字符类的连续串里，
// 所以合法 markdown 仍然正常走 marked，只有畸形长串降级为纯文本。
// 注意：`---` 不在字符类内，水平线规则不受影响；`***` 也远小于阈值。
const DELIMITER_RUN_GUARD = /[*_~`]{300,}/;
// CCDPH-FIX(R3-P2-1/R3-P2-2): 原来的「定界符计数」按 **字符种类** 计数（只认 `*`=42 与
// `_`=95），于是两头都错：
//   漏 —— 散落的 `` ` ``(96) 与 `~`(126) 完全不被计数，实测 120,000 字符的 `` `a `` 在真实
//         Edge 里让 markdown() 阻塞 **1041ms**（Node 复核 1542ms），守卫形同虚设；
//   误 —— `*`/`_` 阈值 1500 过紧，而真实代码里 `_`（snake_case）极常见，导致正文被**静默**
//        降级成纯文本（旧实现还顺带把 10 万字符以外的内容静默截掉）。
// 现在改为「按代价计数」：
//   · 内联强调/代码/删除线四类定界符 `* _ ` ~` 各计 1；
//   · 链接/图片候选计 min(『[』的个数, 『](』的个数) —— 单测表明 `[` 单独出现（38ms/12万）
//     与 `](` 单独出现（4.7ms/12万）都只是线性开销，只有**成对**结构才二次爆炸；
//   · 取两类计数的 **较大值** 作为预算判据（两类各自独立扫描，代价由更贵的一类主导）。
// 阈值由实测曲线反推（marked 17.0.6，字符数 → 解析耗时）：
//   ` 4000→9ms  8000→30ms  16000→107ms  30000→354ms  60000→1467ms
//   _ 4000→24ms 8000→95ms  16000→368ms  30000→1335ms 60000→5042ms
//   [a](x) 4000→25ms 8000→97ms 16000→367ms 30000→2895ms
// 取 4000 时最坏约 25~30ms；旧值 1500 对应最坏只有几毫秒（此前的注释高估了 10~50 倍），
// 白白牺牲了大量正常内容。提升到 4000 后，真实文本基本不会再被误伤：按实测密度，
// server.mjs(5.7/KB) 要 700KB、purify.es.mjs(16.7/KB) 要 240KB 才会触发，都超过单条事件
// 上限（120,000 字符）；只有极端重复/混淆文本才会命中。
const INLINE_TOKEN_LIMIT = 4000;
// CCDPH-FIX(AUDIT-1) 保留：流式路径（assistantMessage(..., true) → markdown(text, false)）不写
// 缓存、每 120ms 用更长前缀整段重排一次，单帧必须远小于这个间隔，所以给它更紧的预算：
// 1500（实测最坏约 6ms）+ 长度上限 20000（DOM 代价随长度线性）。超限时流式预览先降级为纯文本；
// 最终 `text` 事件会经 appendEventNode 以非 live 模式完整渲染 markdown。
const LIVE_INLINE_TOKEN_LIMIT = 1500;
const LIVE_MARKDOWN_LIMIT = 20000;
const countInlineTokens = (text, limit) => {
  let marks = 0;
  let brackets = 0;
  let linkClosers = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 42 || code === 95 || code === 96 || code === 126) {
      // * _ ` ~
      marks += 1;
      if (marks > limit) return true;
    } else if (code === 91) {
      // [
      brackets += 1;
    } else if (code === 93 && text.charCodeAt(index + 1) === 40) {
      // ](
      linkClosers += 1;
      if (Math.min(brackets, linkClosers) > limit) return true;
    }
  }
  return Math.min(brackets, linkClosers) > limit;
};
// CCDPH-FIX(P1-1): app.js 的降级分支要用它裁剪，必须导出（此前只在本模块内使用，
// 导致 app.js 里 `clip(state.liveText, MARKDOWN_FALLBACK_LIMIT)` 抛 ReferenceError）。
export const MARKDOWN_FALLBACK_LIMIT = 100000;
// CCDPH-FIX(R3-P2-2): 降级以前是**裸** `<pre>`：没有任何提示，用户只会看到"消息变成等宽纯文本"，
// 而且超过 10 万字符的部分被 clip 掉、页面上完全不可见（复制按钮复制的也是截断后的文本）。
// 现在两件事都写清楚：为什么降级、以及是否截断/截断了多少。
const markdownFallback = (key) => {
  const text = String(key == null ? "" : key);
  const clipped = clip(text, MARKDOWN_FALLBACK_LIMIT);
  const note =
    clipped.length < text.length
      ? `内容过长或结构异常，已按纯文本显示（未做 Markdown 渲染与代码高亮）；此处仅显示前 ${MARKDOWN_FALLBACK_LIMIT} 个字符（共 ${text.length} 个），完整内容请用导出或复制原文。`
      : "内容过长或结构异常，已按纯文本显示（未做 Markdown 渲染与代码高亮）。";
  return (
    `<div class="markdown-fallback-note">${escapeHtml(note)}</div>` +
    `<pre class="markdown-fallback">${escapeHtml(clipped)}</pre>`
  );
};
const MARKDOWN_CACHE_CHARS = 4 * 1024 * 1024;
let markdownCacheChars = 0;
export function clearMarkdownCache() {
  markdownCache.clear();
  markdownCacheChars = 0;
}
function cacheMarkdown(key, html) {
  const previous = markdownCache.get(key);
  if (previous !== undefined) {
    markdownCacheChars -= previous.length;
    markdownCache.delete(key);
  }
  markdownCache.set(key, html);
  markdownCacheChars += html.length;
  // 先按条数，再按字符数淘汰；至少保留刚写入的一条，避免单个超大 HTML 被立刻踢掉。
  while (
    markdownCache.size > MARKDOWN_CACHE_MAX ||
    (markdownCacheChars > MARKDOWN_CACHE_CHARS && markdownCache.size > 1)
  ) {
    const oldest = markdownCache.keys().next().value;
    markdownCacheChars -= (markdownCache.get(oldest) || "").length;
    markdownCache.delete(oldest);
  }
}
// CCDPH-FIX(L-07): 流式渲染的 key 是「整段累积文本」，每帧都是更长的前缀 —— 永远插入、
// 永不命中（120ms 一帧 ≈ 每秒 8 个 10KB 级 HTML 字符串）。所以 live 渲染不再进缓存，
// 并且缓存改为「条数 + 字符数」双重上限，注入 session 切换/删除时清空（见 disconnectSession）。
export const markdown = (text, cache = true) => {
  const key = text || "";
  if (
    key.length > 200000 ||
    NEST_GUARD.test(key) ||
    DELIMITER_RUN_GUARD.test(key) ||
    // CCDPH-FIX(R3-P2-1): cache === false 就是流式路径（assistantMessage(..., true) → markdown(text, !live)），
    // 它每 120ms 重排一次且不写缓存，用更紧的计数/长度预算（见上面的常量）。
    countInlineTokens(
      key,
      cache ? INLINE_TOKEN_LIMIT : LIVE_INLINE_TOKEN_LIMIT,
    ) ||
    (!cache && key.length > LIVE_MARKDOWN_LIMIT)
  )
    return markdownFallback(key);
  if (cache) {
    const cached = markdownCache.get(key);
    if (cached !== undefined) {
      markdownCache.delete(key);
      markdownCache.set(key, cached);
      return cached;
    }
  }
  let html;
  try {
    html = DOMPurify.sanitize(marked.parse(key), {
      // CCDPH-FIX(P3-MD-1): 显式禁止 svg/math —— DOMPurify 默认允许 SVG/MathML（为图表等
      // 场景），而模型输出里的 <svg>（可含脚本/href 外链）与 <math> 并非本应用所需。此前
      // 仅靠 DOMPurify 默认净化 + CSP `img-src 'self' data:` 兜底，这里显式缩小攻击面。
      FORBID_TAGS: ["img", "style", "input", "form", "svg", "math"],
      FORBID_ATTR: ["style"],
      // 模型输出里的 id/name 不能与应用控件同名，否则会让 document.querySelector
      // 命中消息区中的注入节点。保留锚点语义，但统一加 user-content- 前缀。
      SANITIZE_NAMED_PROPS: true,
    });
    // CCDPH-FIX(P3-15/P3-15b): class 未被净化 —— 模型可给元素套上应用自身的类名做界面欺骗。
    // 只保留代码高亮所需的 `language-*`。
    // ⚠️ 必须用 **DOM 级** 处理：早先我用字符串正则 `/\sclass="([^"]*)"/g`，而 DOMPurify 的
    // 序列化**不会转义文本节点里的 `"`** —— 于是正文/`<pre><code>` 里字面出现的
    // ` class="x"`（例如讲解 HTML 的消息）会被连字删掉，**静默篡改消息内容**。
    // 这里改为解析成 DOM、只改真实属性节点。
    // CCDPH-FIX(R3-P3-6): 但失败分支原来是「保持原样」—— 那等于把**模型可控的 class** 原封
    // 不动地放进页面（可伪装成应用的按钮/徽标做界面欺骗）。失败方向必须与意图一致：改为
    // 失败即**失败关闭** —— 用同一次 DOMPurify 配置再净化一遍，明确禁止 class（代价是这段
    // 异常路径拿不到 language-* 高亮，但绝不会放行模型可控的类名）。
    try {
      const parsed = new DOMParser().parseFromString(html, "text/html");
      for (const node of parsed.body.querySelectorAll("[class]")) {
        const kept = Array.from(node.classList).filter((name) =>
          name.startsWith("language-"),
        );
        if (kept.length) node.setAttribute("class", kept.join(" "));
        else node.removeAttribute("class");
      }
      html = parsed.body.innerHTML;
    } catch (classStripError) {
      console.error("消息 class 剥离失败，已改为禁用 class 的净化", classStripError);
      html = DOMPurify.sanitize(html, {
        // CCDPH-FIX(P3-MD-1): 显式禁止 svg/math —— DOMPurify 默认允许 SVG/MathML（为图表等
      // 场景），而模型输出里的 <svg>（可含脚本/href 外链）与 <math> 并非本应用所需。此前
      // 仅靠 DOMPurify 默认净化 + CSP `img-src 'self' data:` 兜底，这里显式缩小攻击面。
      FORBID_TAGS: ["img", "style", "input", "form", "svg", "math"],
        FORBID_ATTR: ["style", "class"],
        SANITIZE_NAMED_PROPS: true,
      });
    }
  } catch {
    // 兜底降级：即便预检没命中，渲染期抛栈溢出也不再让整条渲染链断裂。
    // 降级 HTML 自带转义（markdownFallback 内已 escapeHtml），不再过 DOMPurify。
    html = markdownFallback(key);
  }
  if (cache) cacheMarkdown(key, html);
  return html;
};
const MAX_INPUT_PREVIEW = 20000;
// CCDPH-FIX(FE-05): JSON.stringify(undefined) 返回 undefined（不是字符串），而服务端
// 允许 tool 事件没有 input（publish 用 `event.input &&` 保护，JSON.stringify 又会省略
// undefined 字段），于是 `undefined.length` 抛 TypeError —— 在实时 SSE 路径上
// appendEventNode 没有 try/catch，异常直接逃出 source.onmessage，工具卡永远不出现。
export const truncateForDisplay = (text) => {
  const value = text == null ? "" : String(text);
  return value.length > MAX_INPUT_PREVIEW
    ? clip(value, MAX_INPUT_PREVIEW) + "\n…（已截断，完整内容见工具输出）" // CCDPH-FIX(AUDIT-13)
    : value;
};
export function highlightCode(root) {
  if (!window.hljs) return;
  for (const code of root.querySelectorAll("pre code")) {
    if (code.dataset.highlighted) continue;
    try {
      hljs.highlightElement(code);
      code.dataset.highlighted = "yes";
    } catch { }
  }
}
