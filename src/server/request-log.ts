import type { MiddlewareHandler } from "hono";

// S50 — the request log. Same line shape as `hono/logger` (without ANSI
// colour), but a query value never reaches it: credentials travel in query
// strings (the magic-link `token`, the OAuth `code`/`state`, the frame token
// `?t=`), and the incoming line is printed before the handler consumes them.
// Every value is redacted, so a new URL-borne credential is covered unlisted.

const REDACTED = "[redacted]";

// The path as received (not decoded) plus the query with each value redacted:
// `name=[redacted]`, or a bare `name` for a part with no `=`, in order, repeats
// kept. Names stay percent-encoded, so a crafted name can't forge a log line.
// r[impl identity.log.request-log-no-values]
export function redactQuery(url: string): string {
  const pathStart = url.indexOf("/", url.indexOf("://") + 3);
  const pathAndQuery = pathStart === -1 ? "/" : url.slice(pathStart);
  const q = pathAndQuery.indexOf("?");
  if (q === -1) return pathAndQuery;
  const query = pathAndQuery.slice(q + 1);
  if (query === "") return pathAndQuery.slice(0, q);
  const parts = query.split("&").map((part) => {
    const eq = part.indexOf("=");
    return eq === -1 ? part : `${part.slice(0, eq)}=${REDACTED}`;
  });
  return `${pathAndQuery.slice(0, q)}?${parts.join("&")}`;
}

// Elapsed as `hono/logger` formats it: `12ms` under a second, else `1s`.
function elapsed(start: number): string {
  const delta = Date.now() - start;
  const text = delta < 1000 ? `${delta}ms` : `${Math.round(delta / 1000)}s`;
  return text.replace(/(\d)(?=(\d\d\d)+(?!\d))/g, "$1,");
}

// r[impl identity.log.request-log-lines]
export function requestLog(print: (line: string) => void = console.log): MiddlewareHandler {
  return async (c, next) => {
    const { method } = c.req;
    const target = redactQuery(c.req.url);
    print(`<-- ${method} ${target}`);
    const start = Date.now();
    await next();
    print(`--> ${method} ${target} ${c.res.status} ${elapsed(start)}`);
  };
}
