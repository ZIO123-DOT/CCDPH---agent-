export const MAX_RESPONSE_CHARS = 5 * 1024 * 1024;
export const SESSION_RESPONSE_CHARS = 64 * 1024 * 1024;
export const SSE_FRAME_CHARS = 5 * 1024 * 1024;

export function createApiClient(
  tokenProvider,
  { timeoutMs = 30_000, onUnauthorized = null } = {},
) {
  return async function api(route, data, options = {}) {
    const maxChars =
      Number(options.maxChars) > 0
        ? Number(options.maxChars)
        : MAX_RESPONSE_CHARS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      const token =
        typeof tokenProvider === "function" ? tokenProvider() : tokenProvider;
      response = await fetch("/api/" + route, {
        method: data === undefined ? "GET" : "POST",
        headers: {
          ...(token ? { "x-workbench-token": token } : {}),
          ...(data === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        signal: controller.signal,
      });
      const raw = await response.text();
      let result = {};
      if (raw) {
        if (raw.length > maxChars) {
          const size = `${(raw.length / 1048576).toFixed(1)}MB`;
          throw new Error(
            /^session\?/.test(route)
              ? `会话内容过大，无法在界面中打开（${size}）`
              : `服务响应过大（${size}），已拒绝解析`,
          );
        }
        try {
          result = JSON.parse(raw);
        } catch {
          throw new Error(
            response.ok
              ? "服务返回了无法解析的数据"
              : `请求失败（HTTP ${response.status}）`,
          );
        }
      }
      if (
        response.status === 401 &&
        options.retryUnauthorized !== false &&
        typeof onUnauthorized === "function"
      ) {
        const recovered = await onUnauthorized();
        if (recovered)
          return api(route, data, { ...options, retryUnauthorized: false });
      }
      if (!response.ok) throw new Error(result.error || "请求失败");
      return result;
    } finally {
      clearTimeout(timer);
    }
  };
}
