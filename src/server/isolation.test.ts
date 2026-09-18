import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { ArtefactSummary } from "../shared/contracts";
import { FRAME_SANDBOX_FLAGS } from "./runtime/sandbox";
import { frameChannel, signFrameToken, verifyFrameToken } from "./runtime/frame-token";
import { mintFrameToken, openFrame, type MintedFrame } from "../test/frame";

// S36 — Isolated artefact serving: sandboxed frame, frame token, optional content
// origin. End-to-end over the real app: the shell embeds a tokened, sandboxed
// frame; frames authenticate only by token, re-check access at every redeem, and
// answer an expired token with a page that asks the shell to re-mint.
describe("isolated artefact serving (S36)", () => {
  let app: Hono;
  let ownerCookie: string;
  let otherCookie: string;
  let ownerId: string;
  let otherId: string;

  const HTML = "<!doctype html><html><head></head><body><h1>isolated</h1></body></html>";
  const CSP = `sandbox ${FRAME_SANDBOX_FLAGS}`;
  const SECRET = process.env.BETTER_AUTH_SECRET!;

  async function signUp(email: string): Promise<string> {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "correct-horse-battery", name: email }),
    });
    return res.headers.get("set-cookie")!.split(";")[0]!;
  }

  async function meId(cookie: string): Promise<string> {
    const res = await app.request("/api/me", { headers: { cookie } });
    return ((await res.json()) as { id: string }).id;
  }

  async function makeArtefact(visibility: string): Promise<ArtefactSummary> {
    const form = new FormData();
    form.set("title", `${visibility} isolated`);
    form.set("kind", "form");
    form.set("payload", new File([HTML], "a.html"));
    const created = (await (
      await app.request("/api/artefacts", { method: "POST", body: form, headers: { cookie: ownerCookie } })
    ).json()) as ArtefactSummary;
    if (visibility === "private") return created;
    return setVisibility(created.id, visibility);
  }

  async function setVisibility(id: string, visibility: string): Promise<ArtefactSummary> {
    const res = await app.request(`/api/artefacts/${id}/visibility`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ visibility }),
    });
    return (await res.json()) as ArtefactSummary;
  }

  async function putData(ref: string, cookie: string, blob: string) {
    const res = await app.request(`/api/artefacts/${ref}/data/me`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie },
      body: blob,
    });
    expect(res.status).toBe(200);
    return (await res.json()) as { updatedAt: string };
  }

  async function mint(ref: string, cookie: string, author?: string): Promise<MintedFrame> {
    const res = await mintFrameToken(app, ref, cookie, author);
    expect(res.status).toBe(200);
    return (await res.json()) as MintedFrame;
  }

  const tokenOf = (frameUrl: string) => new URL(frameUrl, "http://x").searchParams.get("t")!;
  // The shim's inlined config (seed + writable) in a served frame.
  const shimCfg = (body: string) =>
    JSON.parse(body.match(/var cfg = (\{.*?\});/)![1]!) as {
      seed: string;
      writable: boolean;
      targetOrigin: string;
      channel: string | null;
    };
  const iframeTag = (body: string) => body.match(/<iframe[^>]*>/)![0];
  const shellCfg = (body: string) =>
    JSON.parse(body.match(/var cfg = (\{"frameUrl".*?\});/)![1]!) as { frameUrl: string };

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db } = await import("../infra/db/client");
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    const { createApp } = await import("./app");
    app = createApp();
    ownerCookie = await signUp("owner-s36@example.com");
    otherCookie = await signUp("other-s36@example.com");
    ownerId = await meId(ownerCookie);
    otherId = await meId(otherCookie);
  });

  describe("sandbox (AH28)", () => {
    it("the slug shell and the owner-preview shell frame the artefact sandboxed", async () => {
      const a = await makeArtefact("public");
      for (const path of [`/a/${a.publicSlug}`, `/api/artefacts/${a.id}/raw`]) {
        const tag = iframeTag(await (await app.request(path, { headers: { cookie: ownerCookie } })).text());
        expect(tag).toContain(`sandbox="${FRAME_SANDBOX_FLAGS}"`);
        expect(tag).not.toContain("allow-same-origin");
      }
    });

    it("tokened slug and raw frames carry the sandbox CSP and no referrer", async () => {
      const a = await makeArtefact("public");
      for (const ref of [a.publicSlug!, a.id]) {
        const res = await app.request((await mint(ref, ownerCookie)).frameUrl);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-security-policy")).toBe(CSP);
        expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      }
    });

    it("the anonymous public frame and the expired-token page carry it too", async () => {
      const a = await makeArtefact("public");
      const anon = await app.request(`/a/${a.publicSlug}/frame`);
      expect(anon.status).toBe(200);
      expect(anon.headers.get("content-security-policy")).toBe(CSP);
      expect(anon.headers.get("referrer-policy")).toBe("no-referrer");

      const expired = signFrameToken(
        { artefactId: a.id, route: "slug", viewerId: ownerId, authorId: null, exp: Date.now() - 1 },
        SECRET,
      );
      const page = await app.request(`/a/${a.publicSlug}/frame?t=${expired}`);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-security-policy")).toBe(CSP);
      expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    });

    it("a denied frame is still served under the sandbox headers", async () => {
      const res = await app.request("/a/no-such-slug/frame");
      expect(res.status).toBe(404);
      expect(res.headers.get("content-security-policy")).toBe(CSP);
    });
  });

  describe("frame token redeem (AD10)", () => {
    it("never reads cookies: a session and no token → 404 on an authenticated artefact", async () => {
      const a = await makeArtefact("authenticated");
      const res = await app.request(`/a/${a.publicSlug}/frame`, { headers: { cookie: ownerCookie } });
      expect(res.status).toBe(404);
      const raw = await app.request(`/api/artefacts/${a.id}/raw/frame`, { headers: { cookie: ownerCookie } });
      expect(raw.status).toBe(404);
    });

    it("a session and no token on a public artefact → the anonymous read-only seed", async () => {
      const a = await makeArtefact("public");
      await putData(a.publicSlug!, ownerCookie, '{"k":"owner-secret"}');
      const res = await app.request(`/a/${a.publicSlug}/frame`, { headers: { cookie: ownerCookie } });
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("<h1>isolated</h1>");
      expect(shimCfg(body)).toMatchObject({ seed: "{}", writable: false });
      expect(body).not.toContain("owner-secret");
    });

    it("an own-context token seeds the viewer's blob, writable", async () => {
      const a = await makeArtefact("authenticated");
      await putData(a.publicSlug!, otherCookie, '{"k":"other-own"}');
      const body = await (await app.request((await mint(a.publicSlug!, otherCookie)).frameUrl)).text();
      expect(shimCfg(body)).toMatchObject({ seed: '{"k":"other-own"}', writable: true });
    });

    it("an author token seeds that author's blob, read-only", async () => {
      const a = await makeArtefact("authenticated");
      await putData(a.publicSlug!, ownerCookie, '{"k":"owner-data"}');
      const minted = await mint(a.publicSlug!, otherCookie, ownerId);
      expect(verifyFrameToken(tokenOf(minted.frameUrl), SECRET)).toMatchObject({
        status: "valid",
        claims: { viewerId: otherId, authorId: ownerId },
      });
      const body = await (await app.request(minted.frameUrl)).text();
      expect(shimCfg(body)).toMatchObject({ seed: '{"k":"owner-data"}', writable: false });
    });

    it("naming yourself as the author is your own, writable context", async () => {
      const a = await makeArtefact("authenticated");
      const minted = await mint(a.publicSlug!, otherCookie, otherId);
      expect(shimCfg(await (await app.request(minted.frameUrl)).text()).writable).toBe(true);
    });

    it("the ?author= query parameter is gone", async () => {
      const a = await makeArtefact("public");
      await putData(a.publicSlug!, ownerCookie, '{"k":"owner-param"}');
      const body = await (await app.request(`/a/${a.publicSlug}/frame?author=${ownerId}`)).text();
      expect(body).not.toContain("owner-param");
    });

    it("a token for another artefact → 404", async () => {
      const a = await makeArtefact("public");
      const b = await makeArtefact("public");
      const t = tokenOf((await mint(a.publicSlug!, ownerCookie)).frameUrl);
      expect((await app.request(`/a/${b.publicSlug}/frame?t=${t}`)).status).toBe(404);
    });

    it("a raw token on a slug frame, or a slug token on a raw frame → 404", async () => {
      const a = await makeArtefact("public");
      const raw = tokenOf((await mint(a.id, ownerCookie)).frameUrl);
      expect((await app.request(`/a/${a.publicSlug}/frame?t=${raw}`)).status).toBe(404);
      const slug = tokenOf((await mint(a.publicSlug!, ownerCookie)).frameUrl);
      expect((await app.request(`/api/artefacts/${a.id}/raw/frame?t=${slug}`)).status).toBe(404);
    });

    it("a tampered or foreign-secret token → 404", async () => {
      const a = await makeArtefact("public");
      const forged = signFrameToken(
        { artefactId: a.id, route: "slug", viewerId: ownerId, authorId: null, exp: Date.now() + 60_000 },
        "some-other-secret-that-is-long-enough",
      );
      expect((await app.request(`/a/${a.publicSlug}/frame?t=${forged}`)).status).toBe(404);
      expect((await app.request(`/a/${a.publicSlug}/frame?t=garbage`)).status).toBe(404);
    });

    it("revoking access makes a still-unexpired token 404", async () => {
      const a = await makeArtefact("authenticated");
      const minted = await mint(a.publicSlug!, otherCookie);
      expect((await app.request(minted.frameUrl)).status).toBe(200);
      await setVisibility(a.id, "private");
      expect((await app.request(minted.frameUrl)).status).toBe(404);
    });

    it("an archived artefact's raw token → 404", async () => {
      const a = await makeArtefact("private");
      const minted = await mint(a.id, ownerCookie);
      await app.request(`/api/artefacts/${a.id}/archive`, { method: "POST", headers: { cookie: ownerCookie } });
      expect((await app.request(minted.frameUrl)).status).toBe(404);
    });

    it("an expired token → a page that asks the shell to re-mint and seeds nothing", async () => {
      const a = await makeArtefact("authenticated");
      await putData(a.publicSlug!, ownerCookie, '{"k":"expired-seed"}');
      const expired = signFrameToken(
        { artefactId: a.id, route: "slug", viewerId: ownerId, authorId: null, exp: Date.now() - 1 },
        SECRET,
      );
      const res = await app.request(`/a/${a.publicSlug}/frame?t=${expired}`);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("artefactor:frame-token-expired");
      expect(body).toContain("parent.postMessage");
      expect(body).not.toContain("expired-seed");
      expect(body).not.toContain("<h1>isolated</h1>");
    });
  });

  describe("mint (AD10)", () => {
    it("401 for the anonymous", async () => {
      const a = await makeArtefact("public");
      const res = await app.request(`/api/artefacts/${a.publicSlug}/frame-token`, { method: "POST" });
      expect(res.status).toBe(401);
    });

    it("404 for a viewer the matrix denies, by slug or by id", async () => {
      const a = await makeArtefact("public");
      await setVisibility(a.id, "private");
      expect((await mintFrameToken(app, a.publicSlug!, otherCookie)).status).toBe(404);
      expect((await mintFrameToken(app, a.id, otherCookie)).status).toBe(404);
      expect((await mintFrameToken(app, "no-such-ref", otherCookie)).status).toBe(404);
    });

    it("a non-owner viewer can't mint the owner preview by id", async () => {
      const a = await makeArtefact("authenticated");
      expect((await mintFrameToken(app, a.id, otherCookie)).status).toBe(404);
    });

    it("200 { frameUrl, seedUpdatedAt } by slug, for the viewer's own context", async () => {
      const a = await makeArtefact("authenticated");
      const { updatedAt } = await putData(a.publicSlug!, otherCookie, '{"k":"v"}');
      const minted = await mint(a.publicSlug!, otherCookie);
      expect(minted.seedUpdatedAt).toBe(updatedAt);
      expect(minted.frameUrl).toMatch(new RegExp(`^/a/${a.publicSlug}/frame\\?t=`));
      expect(verifyFrameToken(tokenOf(minted.frameUrl), SECRET)).toMatchObject({
        status: "valid",
        claims: { artefactId: a.id, route: "slug", viewerId: otherId, authorId: null },
      });
    });

    it("200 by id for the owner: the owner-preview raw frame", async () => {
      const a = await makeArtefact("private");
      const minted = await mint(a.id, ownerCookie);
      expect(minted.seedUpdatedAt).toBeNull();
      expect(minted.frameUrl).toMatch(new RegExp(`^/api/artefacts/${a.id}/raw/frame\\?t=`));
      const res = await app.request(minted.frameUrl);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("<h1>isolated</h1>");
    });

    it("honours author, reporting that author's seed", async () => {
      const a = await makeArtefact("authenticated");
      const { updatedAt } = await putData(a.publicSlug!, ownerCookie, '{"k":"o"}');
      const minted = await mint(a.publicSlug!, otherCookie, ownerId);
      expect(minted.seedUpdatedAt).toBe(updatedAt);
    });

    it("400 for a non-string author", async () => {
      const a = await makeArtefact("public");
      const res = await app.request(`/api/artefacts/${a.publicSlug}/frame-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({ author: 42 }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("shell render", () => {
    it("embeds a tokened frame URL and the viewer's pin for a signed-in viewer", async () => {
      const a = await makeArtefact("authenticated");
      const { updatedAt } = await putData(a.publicSlug!, otherCookie, '{"k":"v"}');
      const body = await (await app.request(`/a/${a.publicSlug}`, { headers: { cookie: otherCookie } })).text();
      const cfg = shellCfg(body) as unknown as { frameUrl: string; seedUpdatedAt: string };
      expect(cfg.frameUrl).toMatch(new RegExp(`^/a/${a.publicSlug}/frame\\?t=`));
      expect(cfg.seedUpdatedAt).toBe(updatedAt);
      expect(verifyFrameToken(tokenOf(cfg.frameUrl), SECRET)).toMatchObject({
        status: "valid",
        claims: { artefactId: a.id, route: "slug", viewerId: otherId, authorId: null },
      });
    });

    it("embeds a token-less frame URL for an anonymous viewer", async () => {
      const a = await makeArtefact("public");
      const cfg = shellCfg(await (await app.request(`/a/${a.publicSlug}`)).text());
      expect(cfg.frameUrl).toBe(`/a/${a.publicSlug}/frame`);
    });

    it("the owner preview embeds a tokened raw frame URL", async () => {
      const a = await makeArtefact("private");
      const body = await (await app.request(`/api/artefacts/${a.id}/raw`, { headers: { cookie: ownerCookie } })).text();
      const cfg = shellCfg(body);
      expect(cfg.frameUrl).toMatch(new RegExp(`^/api/artefacts/${a.id}/raw/frame\\?t=`));
      expect((await app.request(cfg.frameUrl)).status).toBe(200);
    });

    // S36 — the shell accepts a change only when it carries the channel of the
    // frame URL it loaded, so a page the frame navigated itself to (same window,
    // no channel) can't forge one.
    it("binds the frame to its shell: the mint's channel is the one inlined in that frame", async () => {
      const a = await makeArtefact("authenticated");
      const minted = await mint(a.publicSlug!, otherCookie);
      expect(minted.channel).toBe(frameChannel(tokenOf(minted.frameUrl), SECRET));
      expect(shimCfg(await (await app.request(minted.frameUrl)).text()).channel).toBe(
        minted.channel,
      );
    });

    it("gives each frame URL its own channel, and an anonymous frame none", async () => {
      const a = await makeArtefact("public");
      const first = await mint(a.publicSlug!, ownerCookie);
      const second = await mint(a.publicSlug!, otherCookie);
      expect(second.channel).not.toBe(first.channel);
      const anon = await (await app.request(`/a/${a.publicSlug}/frame`)).text();
      expect(shimCfg(anon).channel).toBeNull();
    });

    it("the shell render's channel matches its embedded frame URL", async () => {
      const a = await makeArtefact("authenticated");
      const body = await (await app.request(`/a/${a.publicSlug}`, { headers: { cookie: otherCookie } })).text();
      const cfg = shellCfg(body) as unknown as { frameUrl: string; channel: string };
      expect(cfg.channel).toBe(frameChannel(tokenOf(cfg.frameUrl), SECRET));
    });

    it("the shim posts to the app origin", async () => {
      const a = await makeArtefact("public");
      const body = await (await openFrame(app, a.publicSlug!, ownerCookie)).text();
      expect(shimCfg(body).targetOrigin).toBe("http://localhost:3000");
    });
  });
});
