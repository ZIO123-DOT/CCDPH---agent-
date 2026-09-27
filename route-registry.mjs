const SESSION_ROUTE_PATHS = new Set([
  "/api/sessions",
  "/api/session",
  "/api/session/update",
  "/api/session/control",
  "/api/session/delete",
  "/api/export",
  "/api/send",
  "/api/events",
  "/api/stop",
  "/api/approve",
]);

const WORKSPACE_READ_ROUTE_PATHS = new Set([
  "/api/files",
  "/api/file",
  "/api/changes",
  "/api/project-info",
  "/api/search-files",
  "/api/diff",
  "/api/reveal",
]);

const WORKSPACE_MUTATION_ROUTE_PATHS = new Set([
  "/api/clear-archived",
  "/api/projects",
  "/api/pick-folder",
  "/api/pick-file",
  "/api/claude/detect",
]);

const ROUTE_DOMAIN_RULES = Object.freeze([
  {
    domain: "integration",
    matches: (pathname) =>
      pathname.startsWith("/api/browser/") ||
      pathname.startsWith("/api/mcp-servers") ||
      pathname.startsWith("/api/hooks"),
  },
  {
    domain: "workspaceMutation",
    matches: (pathname) =>
      pathname.startsWith("/api/worktrees") ||
      pathname.startsWith("/api/git-") ||
      pathname.startsWith("/api/update/") ||
      WORKSPACE_MUTATION_ROUTE_PATHS.has(pathname),
  },
  {
    domain: "session",
    matches: (pathname) => SESSION_ROUTE_PATHS.has(pathname),
  },
  {
    domain: "workspaceIo",
    matches: (pathname) =>
      pathname.startsWith("/api/terminal/") ||
      WORKSPACE_READ_ROUTE_PATHS.has(pathname),
  },
]);

export function classifyRouteDomain(pathname) {
  for (const rule of ROUTE_DOMAIN_RULES)
    if (rule.matches(pathname)) return rule.domain;
  return pathname.startsWith("/api/") ? "api" : "static";
}

export function createRouteDomainHandlers(handlers) {
  return Object.freeze({
    integration: handlers.integration,
    workspaceMutation: handlers.workspaceMutation,
    session: handlers.session,
    workspaceIo: handlers.workspaceIo,
  });
}
