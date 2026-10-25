import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { Artefact } from "../domain/artefact/artefact";
import { ArtefactConflict } from "../domain/artefact/errors";
import type { ArtefactSummary } from "../shared/contracts";

// S60 — Save concurrency: a save never overwrites a newer artefact. A conflict that survives a
// command's retries is a 409 on the BFF (hosting.save.conflict-http); any other uncaught error
// keeps Hono's default 500. The repository is wrapped so a test can make every save fail.

describe("save conflict over the BFF (S60)", () => {
  let app: Hono;
  let cookie: string;
  let failSave: (() => Error) | null = null;

  async function patchTitle(id: string, title: string) {
    const form = new FormData();
    form.set("title", title);
    return app.request(`/api/artefacts/${id}`, { method: "PATCH", body: form, headers: { cookie } });
  }

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db } = await import("../infra/db/client");
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    const { defaultAdapters } = await import("./adapters");
    const { createApp } = await import("./app");
    const inner = defaultAdapters.artefactRepository;
    const artefactRepository = Object.create(inner) as typeof inner;
    artefactRepository.save = async (a: Artefact) => {
      if (failSave) throw failSave();
      return inner.save(a);
    };
    app = createApp({ ...defaultAdapters, artefactRepository });

    const signUp = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "save-conflict@example.com",
        password: "correct-horse-battery",
        name: "Owner",
      }),
    });
    cookie = signUp.headers.get("set-cookie")!.split(";")[0]!;
  });

  async function create(): Promise<ArtefactSummary> {
    const form = new FormData();
    form.set("title", "Racing");
    form.set("kind", "prototype");
    form.set("payload", new File(["<h1>hi</h1>"], "a.html", { type: "text/html" }));
    const res = await app.request("/api/artefacts", { method: "POST", body: form, headers: { cookie } });
    expect(res.status).toBe(201);
    return (await res.json()) as ArtefactSummary;
  }

  // r[verify hosting.save.conflict-http]
  it("answers 409 { error: conflict } when the edit's save keeps conflicting", async () => {
    const a = await create();
    failSave = () => new ArtefactConflict(a.id);
    try {
      const res = await patchTitle(a.id, "never saved");
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "conflict" });
    } finally {
      failSave = null;
    }
  });

  // r[verify hosting.save.conflict-http]
  it("keeps Hono's default 500 for any other uncaught error", async () => {
    const a = await create();
    failSave = () => new Error("disk on fire");
    try {
      const res = await patchTitle(a.id, "never saved");
      expect(res.status).toBe(500);
    } finally {
      failSave = null;
    }
  });
});
