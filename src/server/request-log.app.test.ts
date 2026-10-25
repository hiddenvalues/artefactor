import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { Hono } from "hono";

// S50 — Secrets stay out of the request log, through `createApp`: the
// magic-link token, the OAuth callback's code/state and the frame token never
// reach a logged line, while each request's path does.

let app: Hono;
let log: MockInstance<typeof console.log>;

// Spied before `createApp`: the request log binds its printer when it is built.
beforeAll(async () => {
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const client = await import("../infra/db/client");
  migrate(client.db, { migrationsFolder: "./src/infra/db/migrations" });
  const { createApp } = await import("./app");
  app = createApp();
});

beforeEach(() => {
  log.mockClear();
});

afterAll(() => {
  log.mockRestore();
});

// Every line `console.log` received while `url` was served.
async function logged(url: string): Promise<string[]> {
  await app.request(url);
  return log.mock.calls.map((args) => args.map(String).join(" "));
}

// r[verify identity.log.request-log-app]
describe("the app's request log (S50)", () => {
  it.each([
    ["/api/auth/magic-link/verify?token=S3CRET&callbackURL=%2F", "/api/auth/magic-link/verify"],
    ["/api/auth/callback/google?code=C0DE&state=ST4TE", "/api/auth/callback/google"],
    ["/a/some-slug/frame?t=FR4METOKEN", "/a/some-slug/frame"],
  ])("GET %s logs its path and no credential", async (url, path) => {
    const lines = await logged(url);
    expect(lines.some((l) => l.startsWith(`<-- GET ${path}?`))).toBe(true);
    expect(lines.some((l) => l.startsWith(`--> GET ${path}?`))).toBe(true);
    for (const secret of ["S3CRET", "C0DE", "ST4TE", "FR4METOKEN"]) {
      expect(lines.join("\n")).not.toContain(secret);
    }
  });

  it("logs /health in and out", async () => {
    const lines = await logged("/health");
    expect(lines).toContain("<-- GET /health");
    expect(lines.some((l) => /^--> GET \/health 200 \d+m?s$/.test(l))).toBe(true);
  });
});
