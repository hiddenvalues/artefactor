import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { OrganizationContext, OrganizationSettings } from "../shared/contracts";
import type { OrganizationContextProvider } from "./org-context";
import type { OrganizationAdministration, OrganizationRecord } from "./org-admin";

// S58 — Organization settings screen and its administration seam. OSS has no
// organization; a superset's provider reports the org and carries out changes,
// and core alone decides which org, who may administer it and who may be invited.
describe("organization administration (S58)", () => {
  let createApp: typeof import("./app").createApp;
  let plain: Hono;

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db } = await import("../infra/db/client");
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    ({ createApp } = await import("./app"));
    plain = createApp();
  });

  let seq = 0;
  async function signUp(app: Hono): Promise<string> {
    seq += 1;
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `s58-${seq}-${Date.now()}@example.com`, password: "correct-horse-battery", name: "S58" }),
    });
    expect(res.status).toBe(200);
    return res.headers.get("set-cookie")!.split(";")[0]!;
  }

  const send = (
    app: Hono,
    cookie: string | null,
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.request(`/api/organization${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  // Org A (the caller's role set per test) and org B, where the caller is a
  // member; the spy records every call and which org it was for.
  function fixture({ roleInA = "owner", active = "org-a", inviteDomains = ["acme.se"] } = {} as {
    roleInA?: "owner" | "admin" | "member";
    active?: string;
    inviteDomains?: string[];
  }) {
    const context: OrganizationContext = {
      activeId: active,
      memberships: [
        { id: "org-a", name: "Org A", role: roleInA },
        { id: "org-b", name: "Org B", role: "member" },
      ],
    };
    const records: Record<string, OrganizationRecord> = {
      "org-a": {
        id: "org-a",
        name: "Org A",
        members: [
          { id: "u-member", name: "Mia Member", email: "mia@acme.se", role: "member" },
          { id: "u-owner", name: "Olle Owner", email: "olle@acme.se", role: "owner" },
          { id: "u-owner-2", name: "Later Owner", email: "later@acme.se", role: "owner" },
        ],
        invitations: [{ id: "inv-1", email: "pending@acme.se", sentAt: "2026-10-01T00:00:00.000Z" }],
        inviteDomains,
      },
      "org-b": {
        id: "org-b",
        name: "Org B",
        members: [{ id: "u-b", name: "Bea", email: "bea@b.se", role: "owner" }],
        invitations: [{ id: "inv-b", email: "x@b.se", sentAt: "2026-10-01T00:00:00.000Z" }],
        inviteDomains: ["b.se"],
      },
    };
    const calls: { op: string; orgId: string; arg?: string }[] = [];
    const organizations: OrganizationContextProvider = {
      get: () => structuredClone(context),
      activate: () => {},
    };
    const administration: OrganizationAdministration = {
      read: (_c, orgId) => {
        calls.push({ op: "read", orgId });
        return structuredClone(records[orgId]!);
      },
      rename: (_c, orgId, name) => {
        calls.push({ op: "rename", orgId, arg: name });
        records[orgId]!.name = name;
      },
      invite: (_c, orgId, email) => {
        calls.push({ op: "invite", orgId, arg: email });
      },
      revoke: (_c, orgId, id) => {
        calls.push({ op: "revoke", orgId, arg: id });
        return id === "inv-1";
      },
    };
    const app = createApp(
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, organizations, administration,
    );
    const changes = () => calls.filter((c) => c.op !== "read");
    return { app, calls, changes };
  }

  // r[verify identity.org-admin.oss-absent+2]
  // r[verify platform.org-settings.routes]
  it("answers 404 on every organization route under the default providers", async () => {
    const cookie = await signUp(plain);
    expect((await send(plain, cookie, "GET", "")).status).toBe(404);
    expect((await send(plain, cookie, "PATCH", "", { name: "Acme" })).status).toBe(404);
    expect((await send(plain, cookie, "POST", "/invitations", { email: "ada@acme.se" })).status).toBe(404);
    expect((await send(plain, cookie, "DELETE", "/invitations/x")).status).toBe(404);
  });

  // r[verify identity.org-admin.oss-absent+2]
  // r[verify platform.org-settings.routes]
  it("answers 404 when the context provider reports no org, never calling the administration", async () => {
    const { calls } = fixture();
    const noContext: OrganizationContextProvider = { get: () => null, activate: () => {} };
    const spy: OrganizationAdministration = {
      read: () => {
        calls.push({ op: "read", orgId: "?" });
        throw new Error("called");
      },
      rename: () => {},
      invite: () => {},
      revoke: () => true,
    };
    const app = createApp(undefined, undefined, undefined, undefined, undefined, undefined, undefined, noContext, spy);
    const cookie = await signUp(app);
    expect((await send(app, cookie, "GET", "")).status).toBe(404);
    expect(calls).toEqual([]);
  });

  // r[verify identity.org-admin.active-org-only+2]
  // r[verify identity.org-admin.owner-or-admin+2]
  it("reads the active org as its owner, with invitations and invite domains, owners first", async () => {
    const { app, calls } = fixture();
    const cookie = await signUp(app);
    const res = await send(app, cookie, "GET", "");
    expect(res.status).toBe(200);
    const body = (await res.json()) as OrganizationSettings;
    expect(body.id).toBe("org-a");
    expect(body.role).toBe("owner");
    expect(body.owner).toEqual({ name: "Olle Owner", email: "olle@acme.se" });
    expect(body.members.map((m) => m.id)).toEqual(["u-owner", "u-owner-2", "u-member"]);
    expect(body.invitations).toEqual([{ id: "inv-1", email: "pending@acme.se", sentAt: "2026-10-01T00:00:00.000Z" }]);
    expect(body.inviteDomains).toEqual(["acme.se"]);
    expect(calls).toEqual([{ op: "read", orgId: "org-a" }]);
  });

  // r[verify identity.org-admin.active-org-only+2]
  // r[verify identity.org-admin.owner-or-admin+2]
  it("reads the active org as a member without invitations or invite domains", async () => {
    const { app, calls } = fixture({ active: "org-b" });
    const cookie = await signUp(app);
    const body = (await (await send(app, cookie, "GET", "")).json()) as OrganizationSettings;
    expect(body.id).toBe("org-b");
    expect(body.role).toBe("member");
    expect(body).not.toHaveProperty("invitations");
    expect(body).not.toHaveProperty("inviteDomains");
    expect(calls).toEqual([{ op: "read", orgId: "org-b" }]);
  });

  // r[verify identity.org-admin.active-org-only+2]
  // r[verify platform.org-settings.routes]
  it("acts on the active org whatever org id the body carries", async () => {
    const { app, changes } = fixture();
    const cookie = await signUp(app);
    expect((await send(app, cookie, "PATCH", "", { name: "Acme", organizationId: "org-b" })).status).toBe(200);
    expect((await send(app, cookie, "POST", "/invitations", { email: "ada@acme.se", organizationId: "org-b" })).status).toBe(201);
    expect(changes()).toEqual([
      { op: "rename", orgId: "org-a", arg: "Acme" },
      { op: "invite", orgId: "org-a", arg: "ada@acme.se" },
    ]);
  });

  // r[verify identity.org-admin.owner-or-admin+2]
  // r[verify platform.org-settings.routes]
  it("refuses every change to a member with 403, never calling rename, invite or revoke", async () => {
    const { app, changes } = fixture({ roleInA: "member" });
    const cookie = await signUp(app);
    expect((await send(app, cookie, "PATCH", "", { name: "Acme" })).status).toBe(403);
    expect((await send(app, cookie, "POST", "/invitations", { email: "ada@acme.se" })).status).toBe(403);
    expect((await send(app, cookie, "DELETE", "/invitations/inv-1")).status).toBe(403);
    expect(changes()).toEqual([]);
  });

  // r[verify identity.org-admin.owner-or-admin+2]
  it.each(["owner", "admin"] as const)("lets an %s rename the org, trimmed, and refuses a bad name", async (roleInA) => {
    const { app, changes } = fixture({ roleInA });
    const cookie = await signUp(app);
    const res = await send(app, cookie, "PATCH", "", { name: " Acme AB " });
    expect(res.status).toBe(200);
    expect(((await res.json()) as OrganizationSettings).name).toBe("Acme AB");
    expect((await send(app, cookie, "PATCH", "", { name: "" })).status).toBe(400);
    expect((await send(app, cookie, "PATCH", "", { name: "a".repeat(101) })).status).toBe(400);
    expect(changes()).toEqual([{ op: "rename", orgId: "org-a", arg: "Acme AB" }]);
  });

  // r[verify identity.org-admin.invite-domain+2]
  // r[verify platform.org-settings.routes]
  it("invites an admitted address, lower-cased, and refuses the rest without calling invite", async () => {
    const { app, changes } = fixture();
    const cookie = await signUp(app);
    const invite = (email: string) => send(app, cookie, "POST", "/invitations", { email });
    const ok = await invite("Ada@Acme.se");
    expect(ok.status).toBe(201);
    expect(((await ok.json()) as OrganizationSettings).id).toBe("org-a");
    for (const [email, status, error] of [
      ["ada@gmail.com", 400, "outside-domains"],
      ["ada@sub.acme.se", 400, "outside-domains"],
      ["not-an-email", 400, "invalid-email"],
      ["mia@acme.se", 409, "already-member"],
      ["pending@acme.se", 409, "already-invited"],
    ] as const) {
      const res = await invite(email);
      expect(res.status, email).toBe(status);
      expect(await res.json()).toEqual({ error: error });
    }
    expect(changes()).toEqual([{ op: "invite", orgId: "org-a", arg: "ada@acme.se" }]);
  });

  // r[verify identity.org-admin.invite-domain+2]
  // r[verify platform.org-settings.routes]
  it("refuses every invite when the org has no invite domains", async () => {
    const { app, changes } = fixture({ inviteDomains: [] });
    const cookie = await signUp(app);
    const res = await send(app, cookie, "POST", "/invitations", { email: "ada@acme.se" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "outside-domains" });
    expect(changes()).toEqual([]);
  });

  it("revokes a pending invitation, and answers 404 for one the provider doesn't know", async () => {
    const { app, changes } = fixture();
    const cookie = await signUp(app);
    expect((await send(app, cookie, "DELETE", "/invitations/inv-1")).status).toBe(200);
    expect((await send(app, cookie, "DELETE", "/invitations/nope")).status).toBe(404);
    expect(changes()).toEqual([
      { op: "revoke", orgId: "org-a", arg: "inv-1" },
      { op: "revoke", orgId: "org-a", arg: "nope" },
    ]);
  });

  // r[verify identity.session.protected-rejects-anonymous+2]
  // r[verify identity.origin.app-origin-only+2]
  it("refuses without a session, and a change from a foreign origin", async () => {
    const { app, changes } = fixture();
    expect((await send(app, null, "GET", "")).status).toBe(401);
    expect((await send(app, null, "PATCH", "", { name: "Acme" })).status).toBe(401);
    const cookie = await signUp(app);
    const evil = { Origin: "https://evil.example" };
    expect((await send(app, cookie, "PATCH", "", { name: "Acme" }, evil)).status).toBe(403);
    expect((await send(app, cookie, "POST", "/invitations", { email: "ada@acme.se" }, evil)).status).toBe(403);
    expect((await send(app, cookie, "DELETE", "/invitations/inv-1", undefined, evil)).status).toBe(403);
    expect(changes()).toEqual([]);
  });
});
