import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";

// S42 — Trusted-proxy client address (IA8), through the app: BetterAuth sees only
// the address `createApp` resolved, never a client-chosen header. Asserted on
// the `ipAddress` BetterAuth stores on the session row a sign-in creates.

type Sqlite = { prepare(sql: string): { get(...args: unknown[]): unknown } };

const PASSWORD = "correct-horse-battery";

let app: Hono;
let sqlite: Sqlite;

function peer(remoteAddress: string) {
  return { incoming: { socket: { remoteAddress } } };
}

// Sign in from `remoteAddress` with extra headers; the stored session's address.
async function signInFrom(
  email: string,
  remoteAddress: string,
  headers: Record<string, string>,
): Promise<string> {
  const res = await app.request(
    "/api/auth/sign-in/email",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ email, password: PASSWORD }),
    },
    peer(remoteAddress),
  );
  expect(res.status).toBe(200);
  const { token } = (await res.json()) as { token: string };
  const row = sqlite.prepare("SELECT ip_address AS ip FROM session WHERE token = ?").get(token) as {
    ip: string;
  };
  return row.ip;
}

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const client = await import("../infra/db/client");
  migrate(client.db, { migrationsFolder: "./src/infra/db/migrations" });
  sqlite = client.sqlite as unknown as Sqlite;
  const { createApp } = await import("./app");
  app = createApp();
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "ip@example.com", password: PASSWORD, name: "ip" }),
  });
  expect(res.status).toBe(200);
});

describe("BetterAuth reads only the IA8 address (S42)", () => {
  it("a client-sent X-Artefactor-Client-IP from a public peer is replaced by the peer's address", async () => {
    const ip = await signInFrom("ip@example.com", "198.51.100.9", {
      "X-Artefactor-Client-IP": "6.6.6.6",
      "X-Forwarded-For": "6.6.6.6",
    });
    expect(ip).toBe("198.51.100.9");
  });

  it("behind a trusted proxy, the proxy-appended hop is stored, not the client-sent first one", async () => {
    const ip = await signInFrom("ip@example.com", "10.0.1.5", {
      "X-Forwarded-For": "6.6.6.6, 198.51.100.4",
    });
    expect(ip).toBe("198.51.100.4");
  });
});
