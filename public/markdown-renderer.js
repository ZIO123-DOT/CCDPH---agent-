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
// CCDPH-FIX(AUDIT-1): 上面两条 guard 只认「连续 ≥300 个同种定界符」，而 marked 的内联词法器对
// **散落**的 `*` / `_` 是二次复杂度 —— 实测（marked 17.0.6，页面加载的同一份构建）90KB 的 C 代码
// （`int *p = &x; /* note */ _v = *w;`，约 14000 个定界符）单次解析 >6s，50KB 同类文本 2.5s；
// 代价随定界符数 n 约按 6e-5·n² 增长（n=800→17ms、1365→40ms、3413→226ms、6827→1.5s），
// 与定界符是连续还是散落无关，所以「连续串」预检永远命中不了它。
// 这里补一条「定界符计数」预检：单趟 charCodeAt 计数、超限立刻返回，最坏 O(n) 且实测
// 200KB 输入只要 2~8ms（不是 ReDoS，也不会成为主要开销）。阈值 1500 对应的最坏解析代价约
// 0.15~0.25s（每条文本只付一次，之后进 markdownCache），而正常文档离它很远：README 级别
// 只有几十个定界符，20KB 网络文案为 0，含大量 `**粗体**`/`*斜体*`/表格/围栏的回复也只有几百。
const DELIMITER_CHARS_LIMIT = 1500;
// CCDPH-FIX(AUDIT-1): 流式路径（assistantMessage(..., true) → markdown(text, false)）不写缓存，
// 每 120ms 就用「更长的前缀」整段重排一次，单帧必须远小于这个间隔，所以给它更紧的一套预算：
// 计数上限 600（最坏约 30ms）+ 长度上限 20000（纯文本 20KB 解析仅 0.5ms，但 marked+DOMPurify
// 的 DOM 代价随长度线性增长）。超限时流式预览先降级为纯文本；最终 `text` 事件会经
// appendEventNode 以非 live 模式完整渲染 markdown，done 只做定点收尾。
const LIVE_DELIMITER_CHARS_LIMIT = 600;
const LIVE_MARKDOWN_LIMIT = 20000;
const tooManyDelimiters = (text, limit) => {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 42 || code === 95) {
      // * 或 _
      count += 1;
      if (count > limit) return true;
    }
  }
  return false;
};
// CCDPH-FIX(P1-1): app.js 的降级分支要用它裁剪，必须导出（此前只在本模块内使用，
// 导致 app.js 里 `clip(state.liveText, MARKDOWN_FALLBACK_LIMIT)` 抛 ReferenceError）。
export const MARKDOWN_FALLBACK_LIMIT = 100000;
// CCDPH-FIX(AUDIT-13): 回退预览的定长截断同样不能切在代理对中间
const markdownFallback = (key) =>
  `<pre class="markdown-fallback">${escapeHtml(clip(key, MARKDOWN_FALLBACK_LIMIT))}</pre>`;
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
    // CCDPH-FIX(AUDIT-1): cache === false 就是流式路径（assistantMessage(..., true) → markdown(text, !live)），
    // 它每 120ms 重排一次且不写缓存，用更紧的计数/长度预算（见上面的常量）。
    tooManyDelimiters(
      key,
      cache ? DELIMITER_CHARS_LIMIT : LIVE_DELIMITER_CHARS_LIMIT,
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
      FORBID_TAGS: ["img", "style", "input", "form"],
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
    // 这里改为解析成 DOM、只改真实属性节点；任何失败都保持原样（宁可不剥离，也不损坏内容）。
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
    } catch {
      /* 保持原样 */
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
