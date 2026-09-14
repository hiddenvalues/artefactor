import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type {
  AccessListResponse,
  ArtefactSummary,
  MeResponse,
  SharedArtefactSummary,
  UserSearchResponse,
} from "../shared/contracts";
import { openFrame } from "../test/frame";

// End-to-end S16: share with specific people. An owner creates an artefact,
// shares it at the `selected` tier (which mints a slug), then grants/revokes
// individual members. Access follows the matrix: owner + members can view; a
// signed-in non-member and the anonymous get 404. Members see it in "Shared
// with you". The owner finds people via the user-directory search.
describe("share with specific people (S16)", () => {
  let app: Hono;
  let owner: string;
  let member: string;
  let outsider: string;
  let memberId: string;

  const HTML = "<!doctype html><h1>selected</h1>";

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

  async function createSelected(): Promise<ArtefactSummary> {
    const form = new FormData();
    form.set("title", "Selected artefact");
    form.set("kind", "prototype");
    form.set("payload", new File([HTML], "a.html"));
    const created = (await (
      await app.request("/api/artefacts", {
        method: "POST",
        body: form,
        headers: { cookie: owner },
      })
    ).json()) as ArtefactSummary;
    const shared = await app.request(`/api/artefacts/${created.id}/visibility`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie: owner },
      body: JSON.stringify({ visibility: "selected" }),
    });
    return (await shared.json()) as ArtefactSummary;
  }

  function grant(id: string, userId: string, cookie = owner) {
    return app.request(`/api/artefacts/${id}/access`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ userId }),
    });
  }
  function revoke(id: string, userId: string, cookie = owner) {
    return app.request(`/api/artefacts/${id}/access/${userId}`, {
      method: "DELETE",
      headers: { cookie },
    });
  }
  // S36 — as the shell does: mint a frame token as the viewer, then open it.
  function frame(slug: string, cookie?: string) {
    return openFrame(app, slug, cookie);
  }

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db } = await import("../infra/db/client");
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    const { createApp } = await import("./app");
    app = createApp();
    owner = await signUp("owner-s16@example.com");
    member = await signUp("member-s16@example.com");
    outsider = await signUp("outsider-s16@example.com");
    memberId = await meId(member);
  });

  it("mints a slug when shared at the selected tier (AH12)", async () => {
    const a = await createSelected();
    expect(a.visibility).toBe("selected");
    expect(a.publicSlug).not.toBeNull();
  });

  it("serves the artefact to the owner and granted members, 404 to everyone else (AH8)", async () => {
    const a = await createSelected();
    const slug = a.publicSlug!;

    // Before granting: only the owner can view; the future member cannot.
    expect((await frame(slug, owner)).status).toBe(200);
    expect((await frame(slug, member)).status).toBe(404);

    // Grant the member, then they can view.
    expect((await grant(a.id, memberId)).status).toBe(204);
    expect((await frame(slug, member)).status).toBe(200);

    // A signed-in non-member and the anonymous still get 404 (no leak).
    expect((await frame(slug, outsider)).status).toBe(404);
    expect((await frame(slug)).status).toBe(404);

    // Revoke removes access again.
    expect((await revoke(a.id, memberId)).status).toBe(204);
    expect((await frame(slug, member)).status).toBe(404);
  });

  it("lists current members enriched with identity (owner-only)", async () => {
    const a = await createSelected();
    await grant(a.id, memberId);

    const res = await app.request(`/api/artefacts/${a.id}/access`, {
      headers: { cookie: owner },
    });
    expect(res.status).toBe(200);
    const { members } = (await res.json()) as AccessListResponse;
    expect(members).toEqual([
      { id: memberId, name: "member-s16@example.com", email: "member-s16@example.com" },
    ]);

    // A non-owner cannot read the member list (404, existence not leaked).
    expect(
      (await app.request(`/api/artefacts/${a.id}/access`, { headers: { cookie: outsider } }))
        .status,
    ).toBe(404);
  });

  it("rejects granting an unknown user and the owner themselves", async () => {
    const a = await createSelected();
    expect((await grant(a.id, "no-such-user")).status).toBe(400);
    const ownerId = await meId(owner);
    expect((await grant(a.id, ownerId)).status).toBe(400);
  });

  it("surfaces a selected artefact to its members in Shared with you (AH8)", async () => {
    const a = await createSelected();
    await grant(a.id, memberId);

    const res = await app.request("/api/shared", { headers: { cookie: member } });
    const { artefacts } = (await res.json()) as { artefacts: SharedArtefactSummary[] };
    expect(artefacts.some((x) => x.id === a.id && x.visibility === "selected")).toBe(true);

    // An outsider never sees it in their gallery.
    const out = await app.request("/api/shared", { headers: { cookie: outsider } });
    const outList = (await out.json()) as { artefacts: SharedArtefactSummary[] };
    expect(outList.artefacts.some((x) => x.id === a.id)).toBe(false);
  });

  it("searches the user directory by name/email, excluding the caller", async () => {
    const res = await app.request("/api/users/search?q=member-s16", {
      headers: { cookie: owner },
    });
    expect(res.status).toBe(200);
    const { users } = (await res.json()) as UserSearchResponse;
    expect(users.some((u) => u.email === "member-s16@example.com")).toBe(true);

    // Searching for yourself returns nothing (you're excluded).
    const self = await app.request("/api/users/search?q=owner-s16", {
      headers: { cookie: owner },
    });
    const selfUsers = ((await self.json()) as UserSearchResponse).users;
    expect(selfUsers.some((u) => u.email === "owner-s16@example.com")).toBe(false);

    // Auth required.
    expect((await app.request("/api/users/search?q=x")).status).toBe(401);
  });
});
