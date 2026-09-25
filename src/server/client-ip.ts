import { BlockList, isIP } from "node:net";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { MiddlewareHandler } from "hono";

// S42 — Trusted-proxy client address (IA8): the client address is resolved
// once, and only a trusted proxy may name it. Every consumer of a client address
// (the S32a unlock limit, BetterAuth's rate limiter and stored
// `session.ipAddress`) reads the one value the middleware below resolves.

// The header BetterAuth reads its client address from (`advanced.ipAddress`).
// The middleware strips any client-sent copy and sets it to the IA8 address.
export const CLIENT_IP_HEADER = "x-artefactor-client-ip";

declare module "hono" {
  interface ContextVariableMap {
    // The IA8 client address of the current request.
    clientIp: string;
  }
}

// Loopback plus the private and link-local ranges: where a same-host or
// Docker-network proxy connects from.
const DEFAULT_TRUSTED_PROXIES =
  "127.0.0.0/8, ::1/128, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, fc00::/7, fe80::/10";

export interface TrustedProxies {
  has(ip: string): boolean;
}

// A comma-separated list of CIDRs or bare addresses (a /32 or /128). Unset or
// empty gives the default; a set value replaces it. An invalid entry throws.
export function parseTrustedProxies(value: string | undefined): TrustedProxies {
  const source = value?.trim() ? value : DEFAULT_TRUSTED_PROXIES;
  const list = new BlockList();
  for (const raw of source.split(",")) {
    const entry = raw.trim();
    const [address = "", prefix, ...rest] = entry.split("/");
    const family = isIP(address);
    const max = family === 4 ? 32 : 128;
    const bits = prefix === undefined ? max : /^\d{1,3}$/.test(prefix) ? Number(prefix) : NaN;
    if (family === 0 || rest.length > 0 || !(bits >= 0 && bits <= max)) {
      throw new Error(`invalid trusted proxy entry "${entry}" (expected an IP address or CIDR)`);
    }
    list.addSubnet(address, bits, family === 4 ? "ipv4" : "ipv6");
  }
  return {
    has(ip) {
      const family = isIP(ip);
      return family !== 0 && list.check(ip, family === 4 ? "ipv4" : "ipv6");
    },
  };
}

// `::ffff:a.b.c.d` → `a.b.c.d`; anything else trimmed and unchanged.
function normalize(address: string): string {
  const trimmed = address.trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
  return mapped ? mapped[1]! : trimmed;
}

// IA8 — start from the socket peer; while the current address is a trusted
// proxy, step one hop left in `X-Forwarded-For`. The first untrusted hop is the
// client; if every hop is trusted, the leftmost is. An empty or unparsable hop
// stops the walk at the last address reached, so garbage never becomes a key.
export function resolveClientIp(
  forwardedFor: string | undefined,
  socketAddress: string | undefined,
  trusted: TrustedProxies,
): string {
  let current = socketAddress === undefined ? "" : normalize(socketAddress);
  if (!current) return "unknown";
  if (!trusted.has(current)) return current;
  const hops = forwardedFor === undefined ? [] : forwardedFor.split(",");
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = normalize(hops[i]!);
    if (isIP(hop) === 0) return current;
    current = hop;
    if (!trusted.has(current)) return current;
  }
  return current;
}

// A root middleware (registered by `createApp` before every route): resolve the
// address once, hand it to BetterAuth as the one header it reads, and expose it
// to routes as the `clientIp` variable.
export function createClientAddress(trusted: TrustedProxies): MiddlewareHandler {
  return async (c, next) => {
    let socket: string | undefined;
    try {
      socket = getConnInfo(c).remote.address;
    } catch {
      socket = undefined; // no socket (e.g. an in-process request)
    }
    const ip = resolveClientIp(c.req.header("X-Forwarded-For"), socket, trusted);
    // `set` replaces every client-sent value of the header.
    c.req.raw.headers.set(CLIENT_IP_HEADER, ip);
    c.set("clientIp", ip);
    await next();
  };
}
