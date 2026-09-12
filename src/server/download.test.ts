import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { ArtefactSummary } from "../shared/contracts";
import { extractDeclaredSchema } from "../domain/data/declared-schema";

// End-to-end S30: export an artefact's stored HTML through the real app
// (BFF → access matrix → payload store) against a throwaway db. The download is
// the *stored* payload verbatim — no S13 localStorage bootstrap, no S12 host
// shell — so download → edit → re-upload round-trips (AH7/AH8/AH9).
describe("artefact export — GET /api/artefacts/:ref/download (S30)", () => {
  let app: Hono;
  let owner: string;
  let other: string;

  const HTML = "<!doctype html><title>Trädgård</title><h1>hej</h1>";

  async function signUp(email: string): Promise<string> {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "correct-horse-battery", name: email }),
    });
    return res.headers.get("set-cookie")!.split(";")[0]!;
  }

  async function create(
    cookie: string,
    title = "Trädgård Report",
    html = HTML,
  ): Promise<ArtefactSummary> {
    const form = new FormData();
    form.set("title", title);
    form.set("kind", "interactive-doc");
    form.set("payload", new File([html], "a.html"));
    return (await (
      await app.request("/api/artefacts", { method: "POST", body: form, headers: { cookie } })
    ).json()) as ArtefactSummary;
  }

  async function share(cookie: string, id: string, visibility: string) {
    return (await (
      await app.request(`/api/artefacts/${id}/visibility`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ visibility }),
      })
    ).json()) as ArtefactSummary;
  }

  function download(ref: string, cookie?: string | null) {
    return app.request(`/api/artefacts/${ref}/download`, {
      headers: cookie ? { cookie } : {},
    });
  }

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db } = await import("../infra/db/client");
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    const { createApp } = await import("./app");
    app = createApp();
    owner = await signUp("download-owner@example.com");
    other = await signUp("download-other@example.com");
  });

  it("returns the owner's own private artefact byte-for-byte by id", async () => {
    const a = await create(owner);
    const res = await download(a.id, owner);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(HTML);
  });

  it("serves the stored payload, with no bootstrap or host shell", async () => {
    const a = await create(owner, "Persisting", "<body><script>localStorage.setItem('k','v')</script></body>");
    const body = await (await download(a.id, owner)).text();
    expect(body).toBe("<body><script>localStorage.setItem('k','v')</script></body>");
    expect(body).not.toContain("data/me");
    expect(body).not.toContain("<iframe");
  });

  it("sets the HTML content type and both Content-Disposition filename forms", async () => {
    const a = await create(owner);
    const res = await download(a.id, owner);
    expect(res.headers.get("content-type")).toBe("text/html; charset=UTF-8");
    const disposition = res.headers.get("content-disposition")!;
    expect(disposition).toContain('filename="tradgard-report.html"');
    expect(disposition).toContain("filename*=UTF-8''tr%C3%A4dg%C3%A5rd-report.html");
  });

  it("sets Content-Length to the artefact's payload size", async () => {
    const a = await create(owner);
    const res = await download(a.id, owner);
    expect(res.headers.get("content-length")).toBe(String(a.payloadBytes));
  });

  it("lets a signed-in viewer download an artefact shared with them by slug", async () => {
    const a = await create(owner);
    const shared = await share(owner, a.id, "authenticated");
    const res = await download(shared.publicSlug!, other);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(HTML);
  });

  it("lets an anonymous caller download a public artefact by slug", async () => {
    const a = await create(owner);
    const shared = await share(owner, a.id, "public");
    const res = await download(shared.publicSlug!, null);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(HTML);
  });

  it("404s a private artefact for a non-owner", async () => {
    const a = await create(owner);
    expect((await download(a.id, other)).status).toBe(404);
    expect((await download(a.id, null)).status).toBe(404);
  });

  it("404s an unshared artefact's id for an anonymous caller", async () => {
    const a = await create(owner);
    await share(owner, a.id, "authenticated");
    expect((await download(a.id, null)).status).toBe(404);
  });

  it("404s an archived artefact, including for its owner (AH7)", async () => {
    const a = await create(owner);
    const shared = await share(owner, a.id, "public");
    await app.request(`/api/artefacts/${a.id}/archive`, {
      method: "POST",
      headers: { cookie: owner },
    });
    expect((await download(a.id, owner)).status).toBe(404);
    expect((await download(shared.publicSlug!, null)).status).toBe(404);

    // Restore → download → re-archive is the owner's escape hatch (no carve-out).
    await app.request(`/api/artefacts/${a.id}/restore`, {
      method: "POST",
      headers: { cookie: owner },
    });
    expect((await download(a.id, owner)).status).toBe(200);
  });

  it("round-trips a declared schema block through export -> re-upload", async () => {
    const declared =
      '<!doctype html><script type="application/artefactor-schema+json">' +
      '{"key":"garden-v1","version":1,"example":{"beds":[{"id":"b1"}]}}' +
      "</script><h1>garden</h1>";
    const a = await create(owner, "Garden", declared);

    // Download, then re-upload the downloaded bytes as a new artefact — the
    // path a user takes to edit an artefact outside the app.
    const downloaded = await (await download(a.id, owner)).text();
    const form = new FormData();
    form.set("title", "Garden v2");
    form.set("kind", "interactive-doc");
    form.set("payload", new File([downloaded], "garden.html"));
    const reuploaded = (await (
      await app.request("/api/artefacts", { method: "POST", body: form, headers: { cookie: owner } })
    ).json()) as ArtefactSummary;

    const again = await (await download(reuploaded.id, owner)).text();
    expect(again).toBe(declared);
    // The convention survives because it lives in the trusted HTML — no plumbing.
    expect(extractDeclaredSchema(again)).toEqual({
      key: "garden-v1",
      version: 1,
      example: { beds: [{ id: "b1" }] },
    });
  });

  it("404s an unknown ref", async () => {
    expect((await download("no-such-artefact", owner)).status).toBe(404);
  });

  it("names the file after the ref when the title has no usable characters", async () => {
    const a = await create(owner, "★ ※ ★");
    const res = await download(a.id, owner);
    expect(res.headers.get("content-disposition")).toContain(
      `filename*=UTF-8''${encodeURIComponent(a.id)}.html`,
    );
  });
});
