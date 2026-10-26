import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type {
  ArtefactSummary,
  Capabilities,
  CollectionSummary,
  InviteResult,
  PublicConfigResponse,
  ShareInvitation,
} from "../shared/contracts";
import type { ShareInvitations } from "./share-invitations";

// S33b — Share-invitation seam. OSS invites nobody, so with no port every
// invitation route is a 404; a superset's port only records and mails, and
// core alone decides which artefact, whose, and which address.
describe("share-invitation seam (S33b)", () => {
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
  async function signUp(app: Hono): Promise<{ cookie: string; email: string }> {
    seq += 1;
    const email = `s33b-${seq}-${Date.now()}@example.com`;
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "correct-horse-battery", name: "S33b" }),
    });
    expect(res.status).toBe(200);
    return { cookie: res.headers.get("set-cookie")!.split(";")[0]!, email };
  }

  const send = (app: Hono, cookie: string, method: string, path: string, body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  // An active top-level artefact of the caller's, at `visibility`.
  async function artefact(app: Hono, cookie: string, visibility = "selected"): Promise<string> {
    const form = new FormData();
    form.set("title", "Invite me");
    form.set("kind", "prototype");
    form.set("payload", new File(["<h1>hi</h1>"], "a.html"));
    const res = await app.request("/api/artefacts", { method: "POST", body: form, headers: { cookie } });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as ArtefactSummary;
    if (visibility !== "private") {
      expect((await send(app, cookie, "PUT", `/artefacts/${id}/visibility`, { visibility })).status).toBe(200);
    }
    return id;
  }

  const invitation: ShareInvitation = {
    id: "inv-1",
    email: "pending@b.co",
    createdAt: "2026-10-01T00:00:00.000Z",
    expiresAt: "2026-10-15T00:00:00.000Z",
  };

  // A port that records every call and answers `result` to an invite.
  function fixture(result: InviteResult = { status: "pending", invitation }, capabilities?: Capabilities) {
    const calls: { op: string; artefactId: string; arg?: string }[] = [];
    const port: ShareInvitations = {
      invite: (_c, artefactId, email) => {
        calls.push({ op: "invite", artefactId, arg: email });
        return result;
      },
      list: (_c, artefactId) => {
        calls.push({ op: "list", artefactId });
        return [invitation];
      },
      revoke: (_c, artefactId, invitationId) => {
        calls.push({ op: "revoke", artefactId, arg: invitationId });
        return invitationId === "inv-1";
      },
    };
    const app = createApp(
      undefined, undefined, undefined, undefined, undefined, undefined, capabilities, undefined, undefined, undefined,
      undefined, port,
    );
    return { app, calls };
  }

  const reported = async (app: Hono) =>
    ((await (await app.request("/api/config")).json()) as PublicConfigResponse).capabilities.shareInvitations;

  // r[verify hosting.invitations.oss-default-off+3]
  it("reports shareInvitations only when the capability and a port are both injected", async () => {
    const on: Capabilities = { magicLinkSignIn: false, verifiedSignUp: false, passwordReset: false, shareInvitations: true };
    expect(await reported(fixture(undefined, on).app)).toBe(true);
    // A port with the capability off, and the capability on with no port.
    expect(await reported(fixture().app)).toBe(false);
    expect(await reported(createApp(undefined, undefined, undefined, undefined, undefined, undefined, on))).toBe(false);
  });

  // Every route, with a valid body, against artefact `id`.
  const everyRoute = (app: Hono, cookie: string, id: string) => [
    send(app, cookie, "POST", `/artefacts/${id}/invitations`, { email: "new@b.co" }),
    send(app, cookie, "GET", `/artefacts/${id}/invitations`),
    send(app, cookie, "DELETE", `/artefacts/${id}/invitations/inv-1`),
  ];

  // r[verify hosting.invitations.oss-default-off+3]
  it("reports shareInvitations: false and answers 404 on every invitation route by default", async () => {
    const config = (await (await plain.request("/api/config")).json()) as PublicConfigResponse;
    expect(config.capabilities.shareInvitations).toBe(false);
    const { cookie } = await signUp(plain);
    const id = await artefact(plain, cookie);
    const answers = await Promise.all(everyRoute(plain, cookie, id));
    expect(answers.map((r) => r.status)).toEqual([404, 404, 404]);
  });

  // r[verify hosting.invitations.route-decides-target+2]
  it("answers 404 for an unknown id or another owner's artefact, never calling the port", async () => {
    const { app, calls } = fixture();
    const owner = await signUp(app);
    const other = await signUp(app);
    const id = await artefact(app, owner.cookie);
    for (const [cookie, target] of [[other.cookie, id], [owner.cookie, "no-such-id"]] as const) {
      const answers = await Promise.all(everyRoute(app, cookie, target));
      expect(answers.map((r) => r.status)).toEqual([404, 404, 404]);
    }
    expect(calls).toEqual([]);
  });

  // r[verify hosting.invitations.route-decides-target+2]
  // A private, an archived and a contained artefact of the caller's.
  async function uninvitable(app: Hono, cookie: string): Promise<string[]> {
    const privateId = await artefact(app, cookie, "private");
    const archivedId = await artefact(app, cookie);
    expect((await send(app, cookie, "POST", `/artefacts/${archivedId}/archive`)).status).toBe(200);
    const containedId = await artefact(app, cookie);
    const collection = (await (await send(app, cookie, "POST", "/collections", { name: "Folder" })).json()) as CollectionSummary;
    expect(
      (await send(app, cookie, "PUT", `/artefacts/${containedId}/collection`, { collectionId: collection.id })).status,
    ).toBe(200);
    return [privateId, archivedId, containedId];
  }

  // r[verify hosting.invitations.route-decides-target+2]
  it("refuses an invite to a private, archived or contained artefact with 409 not-invitable, never calling the port", async () => {
    const { app, calls } = fixture();
    const { cookie } = await signUp(app);
    for (const id of await uninvitable(app, cookie)) {
      const res = await send(app, cookie, "POST", `/artefacts/${id}/invitations`, { email: "new@b.co" });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "not-invitable" });
    }
    expect(calls).toEqual([]);
  });

  // r[verify hosting.invitations.route-decides-target+2]
  it("lists and revokes a private, archived or contained artefact's invitations through the port", async () => {
    const { app, calls } = fixture();
    const { cookie } = await signUp(app);
    const ids = await uninvitable(app, cookie);
    for (const id of ids) {
      const listed = await send(app, cookie, "GET", `/artefacts/${id}/invitations`);
      expect(listed.status).toBe(200);
      expect(await listed.json()).toEqual([invitation]);
      expect((await send(app, cookie, "DELETE", `/artefacts/${id}/invitations/inv-1`)).status).toBe(204);
    }
    expect(calls).toEqual(
      ids.flatMap((artefactId) => [
        { op: "list", artefactId },
        { op: "revoke", artefactId, arg: "inv-1" },
      ]),
    );
  });

  // r[verify hosting.invitations.route-decides-target+2]
  it("answers 400 invalid-email for a malformed address or the owner's own, never calling the port", async () => {
    const { app, calls } = fixture();
    const owner = await signUp(app);
    const id = await artefact(app, owner.cookie);
    // Over SMTP's 254 characters, and a long one that would backtrack for minutes.
    const tooLong = `${"a".repeat(250)}@b.co`;
    const pathological = `a@${".a".repeat(100_000)} x`;
    // Address-list syntax a mailer would read as another recipient.
    const listSyntax = ['"x"<victim@y.co>', "a@b.co,c@d.co", "a@b.co;c@d.co"];
    // Control and invisible format characters, and empty domain labels.
    const unseen = ["a\u0000@b.co", "x‮@b.co", "a​@b.co", "a@..co", "a@.b.co", "a@b.co."];
    const malformed = ["nope", "", ` ${owner.email.toUpperCase()} `, undefined, tooLong, pathological];
    for (const email of [...malformed, ...listSyntax, ...unseen]) {
      const res = await send(app, owner.cookie, "POST", `/artefacts/${id}/invitations`, { email });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid-email" });
    }
    expect(calls).toEqual([]);
  });

  // r[verify hosting.invitations.route-decides-target+2]
  it("passes a trimmed, lower-cased email to the port and answers its result", async () => {
    const granted: InviteResult = { status: "granted" };
    const { app, calls } = fixture(granted);
    const { cookie } = await signUp(app);
    const id = await artefact(app, cookie, "authenticated");
    const res = await send(app, cookie, "POST", `/artefacts/${id}/invitations`, { email: " A@B.co " });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(granted);
    expect(calls).toEqual([{ op: "invite", artefactId: id, arg: "a@b.co" }]);
  });

  // r[verify hosting.invitations.route-decides-target+2]
  it("lists the port's pending invitations and revokes through it, 404 when it has none", async () => {
    const { app, calls } = fixture();
    const { cookie } = await signUp(app);
    const id = await artefact(app, cookie);
    const listed = await send(app, cookie, "GET", `/artefacts/${id}/invitations`);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual([invitation]);
    expect((await send(app, cookie, "DELETE", `/artefacts/${id}/invitations/inv-1`)).status).toBe(204);
    expect((await send(app, cookie, "DELETE", `/artefacts/${id}/invitations/inv-x`)).status).toBe(404);
    expect(calls).toEqual([
      { op: "list", artefactId: id },
      { op: "revoke", artefactId: id, arg: "inv-1" },
      { op: "revoke", artefactId: id, arg: "inv-x" },
    ]);
  });
});
