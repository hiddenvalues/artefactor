import { format } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import type { Hono } from "hono";

// S51 — BetterAuth's log prints no credential, through `createApp`: a failed
// OAuth callback logs BetterAuth's `StateError`, whose `details` carry the `state`.
// `parseState` runs before the provider lookup, so Google need not be configured.

let app: Hono;
const sinks: MockInstance[] = [];

beforeAll(async () => {
  for (const method of ["error", "warn", "log"] as const) {
    sinks.push(vi.spyOn(console, method).mockImplementation(() => {}));
  }
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const client = await import("../infra/db/client");
  migrate(client.db, { migrationsFolder: "./src/infra/db/migrations" });
  const { createApp } = await import("./app");
  app = createApp();
});

afterAll(() => {
  for (const sink of sinks) sink.mockRestore();
});

// r[verify identity.log.auth-log-app]
describe("BetterAuth's log through the app (S51)", () => {
  it("a state mismatch logs the failure and no credential", async () => {
    for (const sink of sinks) sink.mockClear();
    const res = await app.request("/api/auth/callback/google?code=C0DE&state=ST4TE");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/error=state_mismatch/);
    const output = sinks.flatMap((s) => s.mock.calls.map((args) => format(...args))).join("\n");
    expect(output).toContain("Failed to parse state");
    expect(output).toContain("state_mismatch");
    expect(output).not.toContain("ST4TE");
    expect(output).not.toContain("C0DE");
  });
});
