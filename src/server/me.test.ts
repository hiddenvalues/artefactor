import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { MeResponse } from "../shared/contracts";

// S57 — Account screen: change your name. `PATCH /api/me` renames only the
// caller, through BetterAuth's own `updateUser`; the domain stores no profile.
describe("PATCH /api/me (S57)", () => {
  let app: Hono;

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db } = await import("../infra/db/client");
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    const { createApp } = await import("./app");
    app = createApp();
  });

  let seq = 0;
  async function signUp(name = "S57"): Promise<string> {
    seq += 1;
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `s57-${seq}-${Date.now()}@example.com`, password: "correct-horse-battery", name }),
    });
    expect(res.status).toBe(200);
    return res.headers.get("set-cookie")!.split(";")[0]!;
  }

  const rename = (cookie: string | null, body: unknown, headers: Record<string, string> = {}) =>
    app.request("/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
      body: JSON.stringify(body),
    });

  const nameOf = async (cookie: string) =>
    ((await (await app.request("/api/me", { headers: { cookie } })).json()) as MeResponse).name;

  // r[verify identity.account.rename-self+2]
  // r[verify platform.account.rename-route]
  it("sets the caller's trimmed name, and no one else's", async () => {
    const other = await signUp("Grace Hopper");
    const cookie = await signUp();
    const res = await rename(cookie, { name: "  Ada Lovelace " });
    expect(res.status).toBe(200);
    const body = (await res.json()) as MeResponse;
    expect(body.name).toBe("Ada Lovelace");
    expect(body.email).toMatch(/^s57-/);
    expect(await nameOf(cookie)).toBe("Ada Lovelace");
    expect(await nameOf(other)).toBe("Grace Hopper");
  });

  // r[verify identity.account.rename-self+2]
  // r[verify platform.account.rename-route]
  it.each([
    ["an empty name", { name: "" }],
    ["a blank name", { name: "   " }],
    ["no name", {}],
    ["a non-string name", { name: 7 }],
    ["a 101-character name", { name: "a".repeat(101) }],
  ])("refuses %s with 400 and writes nothing", async (_label, body) => {
    const cookie = await signUp("Unchanged");
    const res = await rename(cookie, body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error?: unknown }).error).toEqual(expect.any(String));
    expect(await nameOf(cookie)).toBe("Unchanged");
  });

  // r[verify identity.account.rename-self+2]
  // r[verify platform.account.rename-route]
  it("accepts a name of exactly 100 characters", async () => {
    const cookie = await signUp();
    expect((await rename(cookie, { name: "b".repeat(100) })).status).toBe(200);
    expect(await nameOf(cookie)).toBe("b".repeat(100));
  });

  // r[verify identity.session.protected-rejects-anonymous+2]
  // r[verify identity.origin.app-origin-only+2]
  it("refuses without a session, and from a foreign origin", async () => {
    expect((await rename(null, { name: "Nobody" })).status).toBe(401);
    const cookie = await signUp("Unchanged");
    expect((await rename(cookie, { name: "Mallory" }, { Origin: "https://evil.example" })).status).toBe(403);
    expect(await nameOf(cookie)).toBe("Unchanged");
  });

  // Neither our route nor BetterAuth's own endpoints move the email.
  // r[verify identity.account.email-read-only]
  it("never changes the caller's email", async () => {
    const cookie = await signUp();
    const emailOf = async () =>
      ((await (await app.request("/api/me", { headers: { cookie } })).json()) as MeResponse).email;
    const before = await emailOf();
    const post = (path: string, body: unknown) =>
      app.request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify(body),
      });

    expect((await rename(cookie, { name: "Ada", email: "moved@example.com" })).status).toBe(200);
    // Each refusal by its own code: a 400 for another reason (no verification
    // mail configured) would not show `change-email` is off.
    const updated = await post("/api/auth/update-user", { email: "moved@example.com" });
    expect(updated.status).toBe(400);
    expect(await updated.json()).toMatchObject({ code: "EMAIL_CAN_NOT_BE_UPDATED" });
    const changed = await post("/api/auth/change-email", { newEmail: "moved@example.com" });
    expect(changed.status).toBe(400);
    expect(await changed.json()).toMatchObject({ code: "CHANGE_EMAIL_DISABLED" });
    expect(await emailOf()).toBe(before);
  });
});
