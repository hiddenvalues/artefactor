import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { AccessPolicy } from "../domain/artefact/access";
import type { ArtefactSummary, SharedListResponse } from "../shared/contracts";
import { mintFrameToken } from "../test/frame";

// End-to-end S32a — Link controls on public artefacts: password + expiry
// (AH22–AH24, AH31). The gate narrows only the public cell's extra audience:
// in OSS the anonymous visitor; under a policy refusing the `authenticated`
// tier (the cloud shape) also a signed-in outsider. The owner is never gated.

const HTML = "<!doctype html><h1>gated</h1>";
const PASSWORD = "correct-horse-battery";
const HOUR = 60 * 60 * 1000;

type Sqlite = { prepare(sql: string): { run(...args: unknown[]): unknown } };

let sqlite: Sqlite;
let app: Hono; // OSS default policy
let cloudApp: Hono; // a policy refusing the authenticated tier to the outsider
let owner: string;
let other: string;
let outsiderId: string;

async function signUp(target: Hono, email: string): Promise<string> {
  const res = await target.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "correct-horse-battery", name: email }),
  });
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

function get(target: Hono, path: string, cookie?: string) {
  return target.request(path, { headers: cookie ? { cookie } : {} });
}

function json(target: Hono, method: string, path: string, cookie: string, body?: unknown) {
  return target.request(path, {
    method,
    headers: { "Content-Type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function create(title = "Gated deck"): Promise<ArtefactSummary> {
  const form = new FormData();
  form.set("title", title);
  form.set("kind", "slide-deck");
  form.set("payload", new File([HTML], "a.html"));
  const res = await app.request("/api/artefacts", {
    method: "POST",
    body: form,
    headers: { cookie: owner },
  });
  return (await res.json()) as ArtefactSummary;
}

async function makePublic(
  linkGate?: { password?: string; expiresAt?: string },
): Promise<ArtefactSummary> {
  const a = await create();
  const res = await json(app, "PUT", `/api/artefacts/${a.id}/visibility`, owner, {
    visibility: "public",
    ...(linkGate ? { linkGate } : {}),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as ArtefactSummary;
}

function unlock(target: Hono, slug: string, password: string, headers: Record<string, string> = {}) {
  return target.request(`/a/${slug}/unlock`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams({ password }).toString(),
  });
}

// Unlock and return the pass cookie ("name=value").
async function passFor(target: Hono, slug: string, headers: Record<string, string> = {}) {
  const res = await unlock(target, slug, PASSWORD, headers);
  expect(res.status).toBe(303);
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

function expireNow(id: string) {
  sqlite.prepare("UPDATE artefact SET link_expires_at = ? WHERE id = ?").run(Date.now() - 1000, id);
}

// The frame URL the shell loads (the iframe's src).
function frameSrc(html: string): string {
  const m = html.match(/"frameUrl":"([^"]+)"/);
  expect(m, "shell carries a frame URL").not.toBeNull();
  return m![1]!.replace(/\\u0026/g, "&");
}

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const client = await import("../infra/db/client");
  migrate(client.db, { migrationsFolder: "./src/infra/db/migrations" });
  sqlite = client.sqlite as unknown as Sqlite;
  const { createApp } = await import("./app");
  app = createApp();
  owner = await signUp(app, "lg-owner@example.com");
  other = await signUp(app, "lg-other@example.com");
  const outsider = await signUp(app, "lg-outsider@example.com");
  outsiderId = ((await (await get(app, "/api/me", outsider)).json()) as { id: string }).id;
  const refuseOutsider: AccessPolicy = {
    grantsAuthenticatedTier: (viewerId) => viewerId !== outsiderId,
  };
  cloudApp = createApp(undefined, undefined, undefined, undefined, refuseOutsider);
  cloudOutsider = outsider;
});

let cloudOutsider: string;

describe("BFF — setting and clearing the gate (AH31)", () => {
  it("sets a password atomically with the change to public", async () => {
    const a = await makePublic({ password: PASSWORD });
    expect(a.visibility).toBe("public");
    expect(a.linkGate).toEqual({ passwordProtected: true, expiresAt: null });
  });

  it("rejects a gate with a non-public tier (400)", async () => {
    const a = await create();
    const res = await json(app, "PUT", `/api/artefacts/${a.id}/visibility`, owner, {
      visibility: "authenticated",
      linkGate: { password: PASSWORD },
    });
    expect(res.status).toBe(400);
  });

  it("rejects a gate on a non-public artefact, a short password and a past expiry (400)", async () => {
    const priv = await create();
    expect(
      (await json(app, "PUT", `/api/artefacts/${priv.id}/link-gate`, owner, { password: PASSWORD })).status,
    ).toBe(400);
    const pub = await makePublic();
    const short = await json(app, "PUT", `/api/artefacts/${pub.id}/link-gate`, owner, { password: "1234567" });
    expect(short.status).toBe(400);
    const past = await json(app, "PUT", `/api/artefacts/${pub.id}/link-gate`, owner, {
      expiresAt: new Date(Date.now() - HOUR).toISOString(),
    });
    expect(past.status).toBe(400);
    const junk = await json(app, "PUT", `/api/artefacts/${pub.id}/link-gate`, owner, { expiresAt: "soon" });
    expect(junk.status).toBe(400);
    const summary = (await (await get(app, `/api/artefacts/${pub.id}`, owner)).json()) as ArtefactSummary;
    expect(summary.visibility).toBe("public");
    expect(summary.linkGate).toBeNull();
  });

  it("is owner-only: a non-owner gets 404 (AH8)", async () => {
    const a = await makePublic();
    expect(
      (await json(app, "PUT", `/api/artefacts/${a.id}/link-gate`, other, { password: PASSWORD })).status,
    ).toBe(404);
    expect((await json(app, "DELETE", `/api/artefacts/${a.id}/link-gate`, other)).status).toBe(404);
  });

  it("rejects an archived artefact (400)", async () => {
    const a = await makePublic();
    await json(app, "POST", `/api/artefacts/${a.id}/archive`, owner);
    const res = await json(app, "PUT", `/api/artefacts/${a.id}/link-gate`, owner, { password: PASSWORD });
    expect(res.status).toBe(400);
  });

  it("edits and clears each half, and DELETE clears both", async () => {
    const a = await makePublic();
    const expiresAt = new Date(Date.now() + 24 * HOUR).toISOString();
    let res = await json(app, "PUT", `/api/artefacts/${a.id}/link-gate`, owner, { password: PASSWORD, expiresAt });
    expect(((await res.json()) as ArtefactSummary).linkGate).toEqual({ passwordProtected: true, expiresAt });
    res = await json(app, "PUT", `/api/artefacts/${a.id}/link-gate`, owner, { password: null });
    expect(((await res.json()) as ArtefactSummary).linkGate).toEqual({ passwordProtected: false, expiresAt });
    res = await json(app, "DELETE", `/api/artefacts/${a.id}/link-gate`, owner);
    expect(res.status).toBe(200);
    expect(((await res.json()) as ArtefactSummary).linkGate).toBeNull();
  });

  it("leaving public clears the gate; coming back is ungated", async () => {
    const a = await makePublic({ password: PASSWORD });
    await json(app, "PUT", `/api/artefacts/${a.id}/visibility`, owner, { visibility: "authenticated" });
    const back = await json(app, "PUT", `/api/artefacts/${a.id}/visibility`, owner, { visibility: "public" });
    const summary = (await back.json()) as ArtefactSummary;
    expect(summary.linkGate).toBeNull();
    expect(summary.publicSlug).toBe(a.publicSlug);
    expect((await get(app, `/a/${a.publicSlug}`)).status).toBe(200);
  });

  it("never returns the hash, and linkGate only on owner summaries", async () => {
    const a = await makePublic({ password: PASSWORD });
    const own = await (await get(app, "/api/artefacts", owner)).text();
    expect(own).not.toMatch(/passwordHash|scrypt/);
    expect(JSON.parse(own).artefacts.find((x: ArtefactSummary) => x.id === a.id).linkGate).toEqual({
      passwordProtected: true,
      expiresAt: null,
    });
    const shared = (await (await get(app, "/api/shared", other)).json()) as SharedListResponse;
    const seen = shared.artefacts.find((x) => x.id === a.id)!;
    expect(seen).toBeDefined();
    expect("linkGate" in seen).toBe(false);
    expect(JSON.stringify(shared)).not.toMatch(/passwordHash|scrypt/);
  });
});

describe("anonymous visitor on a password-gated public link (AH22)", () => {
  it("gets the unlock page and no frame", async () => {
    const a = await makePublic({ password: PASSWORD });
    const res = await get(app, `/a/${a.publicSlug}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`action="/a/${a.publicSlug}/unlock"`);
    expect(html).toContain('type="password"');
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain(HTML);
    expect((await get(app, `/a/${a.publicSlug}/frame`)).status).toBe(404);
  });

  it("a wrong password re-renders the page with an error (401) and sets no pass", async () => {
    const a = await makePublic({ password: PASSWORD });
    const res = await unlock(app, a.publicSlug!, "wrong-password");
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await res.text()).toContain("Wrong password");
  });

  it("the right password sets a pass that opens shell, frame and data reads", async () => {
    const a = await makePublic({ password: PASSWORD });
    const res = await unlock(app, a.publicSlug!, PASSWORD);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/a/${a.publicSlug}`);
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//);
    const pass = setCookie.split(";")[0]!;

    const shell = await get(app, `/a/${a.publicSlug}`, pass);
    expect(shell.status).toBe(200);
    const src = frameSrc(await shell.text());
    expect(src).toContain("?t=");
    const frame = await app.request(src);
    expect(frame.status).toBe(200);
    expect(await frame.text()).toContain("<h1>gated</h1>");

    expect((await get(app, `/api/artefacts/${a.publicSlug}/data/authors`, pass)).status).toBe(200);
    expect((await get(app, `/api/artefacts/${a.publicSlug}/download`, pass)).status).toBe(200);
  });

  it("the same pass does not open another gated artefact", async () => {
    const a = await makePublic({ password: PASSWORD });
    const b = await makePublic({ password: PASSWORD });
    const pass = await passFor(app, a.publicSlug!);
    const res = await get(app, `/a/${b.publicSlug}`, pass);
    expect(await res.text()).toContain(`action="/a/${b.publicSlug}/unlock"`);
    expect((await get(app, `/api/artefacts/${b.publicSlug}/data/authors`, pass)).status).toBe(403);
  });

  it("the API answers 403 { gate: 'password' } by slug and by id alias", async () => {
    const a = await makePublic({ password: PASSWORD });
    for (const ref of [a.publicSlug!, a.id]) {
      for (const path of [`/api/artefacts/${ref}/data/authors`, `/api/artefacts/${ref}/download`]) {
        const res = await get(app, path);
        expect(res.status, path).toBe(403);
        expect(await res.json()).toEqual({ gate: "password" });
      }
    }
  });

  it("changing or clearing the password voids a pass; an expiry-only change does not", async () => {
    const a = await makePublic({ password: PASSWORD });
    let pass = await passFor(app, a.publicSlug!);
    await json(app, "PUT", `/api/artefacts/${a.id}/link-gate`, owner, {
      expiresAt: new Date(Date.now() + 24 * HOUR).toISOString(),
    });
    expect(await (await get(app, `/a/${a.publicSlug}`, pass)).text()).toContain("<iframe");

    await json(app, "PUT", `/api/artefacts/${a.id}/link-gate`, owner, { password: "another-password" });
    expect(await (await get(app, `/a/${a.publicSlug}`, pass)).text()).toContain("/unlock");

    const res = await unlock(app, a.publicSlug!, "another-password");
    pass = res.headers.get("set-cookie")!.split(";")[0]!;
    await json(app, "PUT", `/api/artefacts/${a.id}/link-gate`, owner, { password: null });
    await json(app, "PUT", `/api/artefacts/${a.id}/link-gate`, owner, { password: PASSWORD });
    expect(await (await get(app, `/a/${a.publicSlug}`, pass)).text()).toContain("/unlock");
  });

  it("a frame token minted under a pass is refused once the password changes", async () => {
    const a = await makePublic({ password: PASSWORD });
    const pass = await passFor(app, a.publicSlug!);
    const src = frameSrc(await (await get(app, `/a/${a.publicSlug}`, pass)).text());
    await json(app, "PUT", `/api/artefacts/${a.id}/link-gate`, owner, { password: "another-password" });
    expect((await app.request(src)).status).toBe(404);
  });

  it("a pass never outlives the expiry", async () => {
    const expiresAt = new Date(Date.now() + HOUR);
    const a = await makePublic({ password: PASSWORD, expiresAt: expiresAt.toISOString() });
    const res = await unlock(app, a.publicSlug!, PASSWORD);
    const cookieExpires = res.headers.get("set-cookie")!.match(/Expires=([^;]+)/i)![1]!;
    expect(new Date(cookieExpires).getTime()).toBeLessThanOrEqual(expiresAt.getTime());
    const token = decodeURIComponent(res.headers.get("set-cookie")!.split(";")[0]!.split("=")[1]!);
    const claims = JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString());
    expect(claims.exp).toBe(expiresAt.getTime());
  });

  it("the 11th unlock attempt for one holder from one IP within 15 minutes is refused (429)", async () => {
    const a = await makePublic({ password: PASSWORD });
    const ip = { "X-Forwarded-For": "198.51.100.7, 10.0.0.1" };
    for (let i = 0; i < 10; i++) {
      expect((await unlock(app, a.publicSlug!, "wrong-password", ip)).status).toBe(401);
    }
    const blocked = await unlock(app, a.publicSlug!, PASSWORD, ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("set-cookie")).toBeNull();
    expect(await blocked.text()).toContain("Too many attempts");
    // Another client is unaffected.
    expect((await unlock(app, a.publicSlug!, PASSWORD, { "X-Forwarded-For": "198.51.100.8" })).status).toBe(303);
  });

  it("unlocking an ungated or unknown link reveals nothing new", async () => {
    const open = await makePublic();
    expect((await unlock(app, open.publicSlug!, "whatever")).status).toBe(303);
    const unknown = await unlock(app, "no-such-slug", PASSWORD);
    expect(unknown.status).toBe(302);
    expect(unknown.headers.get("location")).toContain("/?returnTo=");
  });
});

describe("expiry (AH23)", () => {
  it("past expiresAt: anonymous → sign-in, frame → 404; the owner is never expired", async () => {
    const a = await makePublic({ expiresAt: new Date(Date.now() + HOUR).toISOString() });
    expect((await get(app, `/a/${a.publicSlug}`)).status).toBe(200);
    expireNow(a.id);
    const anon = await get(app, `/a/${a.publicSlug}`);
    expect(anon.status).toBe(302);
    expect(anon.headers.get("location")).toBe(`/?returnTo=${encodeURIComponent(`/a/${a.publicSlug}`)}`);
    expect((await get(app, `/a/${a.publicSlug}/frame`)).status).toBe(404);
    expect((await get(app, `/api/artefacts/${a.publicSlug}/data/authors`)).status).toBe(404);

    const ownerShell = await get(app, `/a/${a.publicSlug}`, owner);
    expect(ownerShell.status).toBe(200);
    // The owner's preview says the link has expired; nobody else's shell would.
    expect(await ownerShell.text()).toContain("Link expired");
    expect(await (await get(app, `/api/artefacts/${a.id}/raw`, owner)).text()).toContain("Link expired");
    expect((await mintFrameToken(app, a.publicSlug!, owner)).status).toBe(200);
    expect((await get(app, `/api/artefacts/${a.publicSlug}/data/authors`, owner)).status).toBe(200);
    expect((await get(app, `/api/artefacts/${a.publicSlug}/download`, owner)).status).toBe(200);
    expect((await get(app, `/api/artefacts/${a.publicSlug}/viewers`, owner)).status).toBe(200);
    const summary = (await (await get(app, `/api/artefacts/${a.id}`, owner)).json()) as ArtefactSummary;
    expect(summary.visibility).toBe("public");
    expect(summary.publicSlug).toBe(a.publicSlug);

    // Extending the expiry restores the same URL.
    await json(app, "PUT", `/api/artefacts/${a.id}/link-gate`, owner, {
      expiresAt: new Date(Date.now() + HOUR).toISOString(),
    });
    expect((await get(app, `/a/${a.publicSlug}`)).status).toBe(200);
  });

  it("OSS: a signed-in non-owner opens a gated or expired public artefact normally", async () => {
    const a = await makePublic({ password: PASSWORD, expiresAt: new Date(Date.now() + HOUR).toISOString() });
    const shell = await get(app, `/a/${a.publicSlug}`, other);
    expect(shell.status).toBe(200);
    const html = await shell.text();
    expect(html).toContain("<iframe");
    expect(html).not.toContain("Link expired");
    expect((await mintFrameToken(app, a.publicSlug!, other)).status).toBe(200);
    expireNow(a.id);
    expect((await get(app, `/a/${a.publicSlug}`, other)).status).toBe(200);
    expect((await get(app, `/api/artefacts/${a.publicSlug}/data/authors`, other)).status).toBe(200);
  });
});

describe("a signed-in outsider the policy refuses the authenticated tier (AH18/AH22)", () => {
  it("is challenged on every read, and a pass opens them", async () => {
    const a = await makePublic({ password: PASSWORD });
    const slug = a.publicSlug!;
    expect(await (await get(cloudApp, `/a/${slug}`, cloudOutsider)).text()).toContain(`/a/${slug}/unlock`);
    const mint = await mintFrameToken(cloudApp, slug, cloudOutsider);
    expect(mint.status).toBe(403);
    expect(await mint.json()).toEqual({ gate: "password" });
    for (const path of [
      `/api/artefacts/${slug}/data/authors`,
      `/api/artefacts/${slug}/data/me`,
      `/api/artefacts/${slug}/download`,
      `/api/artefacts/${slug}/viewers`,
      `/api/artefacts/${slug}/thumbnail`,
    ]) {
      const res = await get(cloudApp, path, cloudOutsider);
      expect(res.status, path).toBe(403);
      expect(await res.json(), path).toEqual({ gate: "password" });
    }
    const write = await json(cloudApp, "PUT", `/api/artefacts/${slug}/data/me`, cloudOutsider, { k: 1 });
    expect(write.status).toBe(403);

    const pass = await passFor(cloudApp, slug);
    const both = `${cloudOutsider}; ${pass}`;
    expect(await (await get(cloudApp, `/a/${slug}`, both)).text()).toContain("<iframe");
    const minted = await mintFrameToken(cloudApp, slug, both);
    expect(minted.status).toBe(200);
    const { frameUrl } = (await minted.json()) as { frameUrl: string };
    expect((await cloudApp.request(frameUrl)).status).toBe(200);
    expect((await get(cloudApp, `/api/artefacts/${slug}/data/authors`, both)).status).toBe(200);
  });

  it("gets 404 once expired, while a teammate the tier admits still opens it", async () => {
    const a = await makePublic({ expiresAt: new Date(Date.now() + HOUR).toISOString() });
    expireNow(a.id);
    expect((await get(cloudApp, `/a/${a.publicSlug}`, cloudOutsider)).status).toBe(404);
    expect((await get(cloudApp, `/api/artefacts/${a.publicSlug}/download`, cloudOutsider)).status).toBe(404);
    expect((await get(cloudApp, `/a/${a.publicSlug}`, other)).status).toBe(200);
  });

  it("the owner is never challenged", async () => {
    const a = await makePublic({ password: PASSWORD });
    expect(await (await get(cloudApp, `/a/${a.publicSlug}`, owner)).text()).toContain("<iframe");
    expect((await get(cloudApp, `/api/artefacts/${a.publicSlug}/thumbnail`, owner)).status).toBe(404);
  });

  it("a thumbnail read through a pass is never cached; the owner's still is", async () => {
    const a = await makePublic({ password: PASSWORD });
    const { artefactRepository: repo, thumbnailStore } = await import("./adapters");
    const stored = (await repo.findById(a.id, { tenantId: "default" }))!;
    await thumbnailStore.put(a.id, stored.payloadHash, new Uint8Array([82, 73, 70, 70]));
    expect(await repo.recordThumbnail(a.id, stored.payloadHash)).toBe(true);

    const pass = await passFor(cloudApp, a.publicSlug!);
    const gated = await get(cloudApp, `/api/artefacts/${a.publicSlug}/thumbnail`, `${cloudOutsider}; ${pass}`);
    expect(gated.status).toBe(200);
    expect(gated.headers.get("cache-control")).toBe("private, no-store");
    const own = await get(cloudApp, `/api/artefacts/${a.id}/thumbnail`, owner);
    expect(own.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
  });
});
