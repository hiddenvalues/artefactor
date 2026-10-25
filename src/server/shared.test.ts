import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type {
  ArtefactSummary,
  SharedArtefactSummary,
} from "../shared/contracts";

// End-to-end S14: the signed-in "Shared with you" view. Two owners publish
// artefacts at various tiers; a signed-in viewer sees others' shared artefacts
// (across owners), but not their own (those are in "Your artefacts") nor
// anyone's private.
describe("shared with you (S14)", () => {
  let app: Hono;
  let alice: string;
  let bob: string;

  async function signUp(email: string): Promise<string> {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "correct-horse-battery", name: email }),
    });
    return res.headers.get("set-cookie")!.split(";")[0]!;
  }

  // Create an artefact and set it to `visibility`; returns its summary.
  async function publish(cookie: string, title: string, visibility: string) {
    const form = new FormData();
    form.set("title", title);
    form.set("kind", "prototype");
    form.set("payload", new File(["<h1>x</h1>"], "a.html"));
    const created = (await (
      await app.request("/api/artefacts", {
        method: "POST",
        body: form,
        headers: { cookie },
      })
    ).json()) as ArtefactSummary;
    if (visibility !== "private") {
      await app.request(`/api/artefacts/${created.id}/visibility`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ visibility }),
      });
    }
    return created;
  }

  function shared(cookie?: string) {
    return app.request("/api/shared", {
      headers: cookie ? { cookie } : {},
    });
  }

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db } = await import("../infra/db/client");
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    const { createApp } = await import("./app");
    app = createApp();
    alice = await signUp("alice-s14@example.com");
    bob = await signUp("bob-s14@example.com");

    await publish(alice, "Alice public", "public");
    await publish(alice, "Alice authenticated", "authenticated");
    await publish(alice, "Alice private", "private");
    await publish(bob, "Bob public", "public");
  });

  // r[verify hosting.listing.signed-in-only+2]
  it("requires a signed-in user (not anonymous)", async () => {
    expect((await shared()).status).toBe(401);
  });

  // r[verify hosting.shared.others-shared+2]
  it("lists others' shared artefacts, excluding the viewer's own and others' private", async () => {
    const res = await shared(bob);
    expect(res.status).toBe(200);
    const { artefacts } = (await res.json()) as {
      artefacts: SharedArtefactSummary[];
    };
    const titles = artefacts.map((a) => a.title).sort();
    // Bob sees Alice's shared artefacts, but NOT his own "Bob public" (that is
    // in his "Your artefacts") and NOT Alice's private one.
    expect(titles).toEqual(["Alice authenticated", "Alice public"]);
    expect(titles).not.toContain("Bob public");
    expect(titles).not.toContain("Alice private");
    // Every listed artefact is active, shared, owned by someone else, and has a
    // slug to open.
    expect(
      artefacts.every(
        (a) =>
          a.status === "active" &&
          a.visibility !== "private" &&
          a.publicSlug !== null,
      ),
    ).toBe(true);
    // Each carries its visibility and slug.
    expect(
      Object.fromEntries(artefacts.map((a) => [a.title, [a.visibility, typeof a.publicSlug]])),
    ).toEqual({
      "Alice authenticated": ["authenticated", "string"],
      "Alice public": ["public", "string"],
    });
  });

  // r[verify hosting.shared.others-shared+2]
  it("attributes each shared artefact to its owner's display identity", async () => {
    const res = await shared(bob);
    const { artefacts } = (await res.json()) as {
      artefacts: SharedArtefactSummary[];
    };
    // Both visible artefacts are Alice's; sign-up set name === email for her.
    expect(artefacts.length).toBe(2);
    expect(
      artefacts.every(
        (a) =>
          a.owner.name === "alice-s14@example.com" &&
          a.owner.email === "alice-s14@example.com",
      ),
    ).toBe(true);
  });
});
