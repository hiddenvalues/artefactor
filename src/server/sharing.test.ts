import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { AccessListResponse, ArtefactSummary, MeResponse, SetSharingRequest } from "../shared/contracts";

// End-to-end S55 — Manage access dialog: one draft, saved atomically.
// `PUT /api/artefacts/:id/sharing` saves the owner's whole sharing set at once.
describe("set sharing (S55)", () => {
  let app: Hono;
  let owner: string;
  let outsider: string;
  let memberId: string;

  async function signUp(email: string): Promise<string> {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "correct-horse-battery", name: email }),
    });
    return res.headers.get("set-cookie")!.split(";")[0]!;
  }

  async function meId(cookie: string): Promise<string> {
    return ((await (await app.request("/api/me", { headers: { cookie } })).json()) as MeResponse).id;
  }

  async function create(): Promise<ArtefactSummary> {
    const form = new FormData();
    form.set("title", "Sharing artefact");
    form.set("kind", "prototype");
    form.set("payload", new File(["<!doctype html><script>localStorage.getItem('x')</script>"], "a.html"));
    const res = await app.request("/api/artefacts", { method: "POST", body: form, headers: { cookie: owner } });
    return (await res.json()) as ArtefactSummary;
  }

  function share(id: string, body: Partial<SetSharingRequest> | string, cookie = owner) {
    return app.request(`/api/artefacts/${id}/sharing`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  async function summary(id: string): Promise<ArtefactSummary> {
    return (await (await app.request(`/api/artefacts/${id}`, { headers: { cookie: owner } })).json()) as ArtefactSummary;
  }

  async function members(id: string): Promise<string[]> {
    const res = await app.request(`/api/artefacts/${id}/access`, { headers: { cookie: owner } });
    return ((await res.json()) as AccessListResponse).members.map((m) => m.id);
  }

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db } = await import("../infra/db/client");
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    const { createApp } = await import("./app");
    app = createApp();
    owner = await signUp("owner-s55@example.com");
    const member = await signUp("member-s55@example.com");
    outsider = await signUp("outsider-s55@example.com");
    memberId = await meId(member);
  });

  it("saves tier, members and data visibility together and answers the summary", async () => {
    const a = await create();
    const res = await share(a.id, { visibility: "selected", members: [memberId], dataVisibility: "shared" });
    expect(res.status).toBe(200);
    const s = (await res.json()) as ArtefactSummary;
    expect(s).toMatchObject({ visibility: "selected", dataVisibility: "shared" });
    expect(s.publicSlug).not.toBeNull();
    expect(await members(a.id)).toEqual([memberId]);
  });

  it("sets link protection with the change to public", async () => {
    const a = await create();
    const res = await share(a.id, { visibility: "public", linkGate: { password: "long-enough-pw" } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as ArtefactSummary).linkGate).toEqual({ passwordProtected: true, expiresAt: null });
  });

  // r[verify hosting.sharing.atomic-save]
  it("changes nothing when one part is refused", async () => {
    const a = await create();
    const before = await summary(a.id);
    const res = await share(a.id, {
      visibility: "public",
      members: [memberId],
      dataVisibility: "shared",
      linkGate: { password: "short" },
    });
    expect(res.status).toBe(400);
    expect(await summary(a.id)).toEqual(before);
    expect(await members(a.id)).toEqual([]);
  });

  // r[verify hosting.sharing.members-replace]
  it("refuses an unknown member with 400 unknown user, saving nothing", async () => {
    const a = await create();
    const res = await share(a.id, { visibility: "selected", members: [memberId, "no-such-user"] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown user" });
    expect((await summary(a.id)).visibility).toBe("private");
    expect(await members(a.id)).toEqual([]);
  });

  it("answers 404 to a non-owner and 400 to a body without a valid visibility", async () => {
    const a = await create();
    expect((await share(a.id, { visibility: "public" }, outsider)).status).toBe(404);
    expect((await share(a.id, { members: [] })).status).toBe(400);
    expect((await share(a.id, { visibility: "everyone" as never })).status).toBe(400);
    expect((await share(a.id, { visibility: "selected", members: "x" as never })).status).toBe(400);
    expect((await share(a.id, { visibility: "private", dataVisibility: "all" as never })).status).toBe(400);
    expect((await share(a.id, { visibility: "public", linkGate: { password: 5 } as never })).status).toBe(400);
    expect((await share(a.id, "null")).status).toBe(400);
    expect((await summary(a.id)).visibility).toBe("private");
  });

  it("requires sign-in", async () => {
    const a = await create();
    const res = await app.request(`/api/artefacts/${a.id}/sharing`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibility: "public" }),
    });
    expect(res.status).toBe(401);
  });
});
