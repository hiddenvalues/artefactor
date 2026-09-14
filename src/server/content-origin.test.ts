import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { ArtefactSummary } from "../shared/contracts";
import type { MintedFrame } from "../test/frame";

// S36 (AH28) — with ARTEFACTOR_CONTENT_ORIGIN set, frames live only on that
// separate domain, which answers nothing else but /health; the app host answers
// no frame route. Set before the app (and its env) is imported.
const CONTENT = "https://content.test";
process.env.ARTEFACTOR_CONTENT_ORIGIN = CONTENT;

describe("content origin (S36)", () => {
  let app: Hono;
  let cookie: string;
  let artefact: ArtefactSummary;

  const onContent = (path: string, init: RequestInit = {}) => app.request(`${CONTENT}${path}`, init);
  const onApp = (path: string, init: RequestInit = {}) =>
    app.request(`http://localhost:3000${path}`, init);

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db } = await import("../infra/db/client");
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    const { createApp } = await import("./app");
    app = createApp();
    const res = await onApp("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "owner-content@example.com", password: "correct-horse-battery", name: "c" }),
    });
    cookie = res.headers.get("set-cookie")!.split(";")[0]!;
    const form = new FormData();
    form.set("title", "content");
    form.set("kind", "form");
    form.set("payload", new File(["<head></head><h1>on content</h1>"], "a.html"));
    const created = (await (
      await onApp("/api/artefacts", { method: "POST", body: form, headers: { cookie } })
    ).json()) as ArtefactSummary;
    artefact = (await (
      await onApp(`/api/artefacts/${created.id}/visibility`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ visibility: "authenticated" }),
      })
    ).json()) as ArtefactSummary;
  });

  async function mint(ref: string): Promise<MintedFrame> {
    const res = await onApp(`/api/artefacts/${ref}/frame-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: "{}",
    });
    expect(res.status).toBe(200);
    return (await res.json()) as MintedFrame;
  }

  it("the mint's frameUrl is absolute on the content origin, for slug and raw frames", async () => {
    expect((await mint(artefact.publicSlug!)).frameUrl).toMatch(
      new RegExp(`^${CONTENT}/a/${artefact.publicSlug}/frame\\?t=`),
    );
    expect((await mint(artefact.id)).frameUrl).toMatch(
      new RegExp(`^${CONTENT}/api/artefacts/${artefact.id}/raw/frame\\?t=`),
    );
  });

  it("the shell's iframe src is absolute on the content origin", async () => {
    const body = await (await onApp(`/a/${artefact.publicSlug}`, { headers: { cookie } })).text();
    const cfg = JSON.parse(body.match(/var cfg = (\{"frameUrl".*?\});/)![1]!) as { frameUrl: string };
    expect(cfg.frameUrl.startsWith(`${CONTENT}/a/${artefact.publicSlug}/frame?t=`)).toBe(true);
  });

  it("the content host serves the frames, and the shim posts to the app origin", async () => {
    for (const ref of [artefact.publicSlug!, artefact.id]) {
      const res = await app.request((await mint(ref)).frameUrl);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("<h1>on content</h1>");
      expect(body).toContain('"targetOrigin":"http://localhost:3000"');
    }
  });

  it("the content host serves /health", async () => {
    expect((await onContent("/health")).status).toBe(200);
  });

  it("the content host answers nothing else", async () => {
    for (const path of [
      `/a/${artefact.publicSlug}`,
      "/api/me",
      "/",
      "/index.html",
      `/api/artefacts/${artefact.id}/raw`,
      "/.well-known/oauth-authorization-server",
    ]) {
      expect((await onContent(path, { headers: { cookie } })).status, path).toBe(404);
    }
    const mcp = await onContent("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: "{}",
    });
    expect(mcp.status).toBe(404);
    const auth = await onContent("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(auth.status).toBe(404);
  });

  it("the app host answers no frame route", async () => {
    const { frameUrl } = await mint(artefact.publicSlug!);
    const { pathname, search } = new URL(frameUrl);
    expect((await onApp(`${pathname}${search}`)).status).toBe(404);
    const raw = new URL((await mint(artefact.id)).frameUrl);
    expect((await onApp(`${raw.pathname}${raw.search}`)).status).toBe(404);
  });

  it("IA6: a state change with the content origin as Origin → 403", async () => {
    const res = await onApp(`/api/artefacts/${artefact.id}/visibility`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie, Origin: CONTENT },
      body: JSON.stringify({ visibility: "public" }),
    });
    expect(res.status).toBe(403);
  });
});
