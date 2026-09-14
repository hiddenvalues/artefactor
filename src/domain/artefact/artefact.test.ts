import { describe, expect, it } from "vitest";
import {
  archiveArtefact,
  assertDeletable,
  createArtefact,
  editArtefact,
  isThumbnailStale,
  restoreArtefact,
  shareArtefact,
  unshareArtefact,
  MAX_PAYLOAD_BYTES,
} from "./artefact";
import { InMemoryArtefactRepository } from "./in-memory-artefact-repository";
import { SINGLETON_SCOPE } from "./tenant-scope";
import { InvariantViolation } from "./errors";

const base = {
  id: "a1",
  ownerId: "u1",
  title: "Demo artefact",
  kind: "prototype" as const,
  payload: { ref: "r1", bytes: 1024, hash: "deadbeef" },
};

describe("createArtefact", () => {
  it("creates an active, private artefact with no slug", () => {
    const a = createArtefact(base);
    expect(a.status).toBe("active");
    expect(a.visibility).toBe("private");
    expect(a.publicSlug).toBeNull();
    expect(a.payloadBytes).toBe(1024);
  });

  it("trims and rejects an empty title (AH3)", () => {
    expect(() => createArtefact({ ...base, title: "   " })).toThrow(
      InvariantViolation,
    );
  });

  it("rejects an empty payload (AH2)", () => {
    expect(() =>
      createArtefact({ ...base, payload: { ref: "r", bytes: 0, hash: "h" } }),
    ).toThrow(InvariantViolation);
  });

  it("rejects a payload over the 100 MB cap (AH2)", () => {
    expect(() =>
      createArtefact({
        ...base,
        payload: { ref: "r", bytes: MAX_PAYLOAD_BYTES + 1, hash: "h" },
      }),
    ).toThrow(InvariantViolation);
  });

  it("requires an owner (AH1)", () => {
    expect(() => createArtefact({ ...base, ownerId: "" })).toThrow(
      InvariantViolation,
    );
  });
});

describe("shareArtefact / unshareArtefact (S5)", () => {
  it("mints the supplied slug on first share and sets the tier (AH4)", () => {
    const a = createArtefact(base);
    const shared = shareArtefact(a, { tier: "public", newSlug: "abc123" });
    expect(shared.visibility).toBe("public");
    expect(shared.publicSlug).toBe("abc123");
  });

  it("retains the existing slug when re-sharing, ignoring a new one (AH5)", () => {
    const a = { ...createArtefact(base), publicSlug: "kept", visibility: "private" as const };
    const shared = shareArtefact(a, { tier: "authenticated", newSlug: "ignored" });
    expect(shared.publicSlug).toBe("kept");
    expect(shared.visibility).toBe("authenticated");
  });

  it("changes tier between authenticated and public (AH6)", () => {
    const a = { ...createArtefact(base), publicSlug: "s", visibility: "authenticated" as const };
    expect(shareArtefact(a, { tier: "public" }).visibility).toBe("public");
  });

  it("requires a slug to share an artefact that has none (AH4)", () => {
    expect(() => shareArtefact(createArtefact(base), { tier: "public" })).toThrow(
      InvariantViolation,
    );
  });

  it("unshare returns to private but retains the slug (AH5)", () => {
    const shared = shareArtefact(createArtefact(base), {
      tier: "public",
      newSlug: "slug9",
    });
    const unshared = unshareArtefact(shared);
    expect(unshared.visibility).toBe("private");
    expect(unshared.publicSlug).toBe("slug9");
  });

  it("blocks share/unshare while archived (AH7)", () => {
    const archived = { ...createArtefact(base), status: "archived" as const };
    expect(() => shareArtefact(archived, { tier: "public", newSlug: "x" })).toThrow(
      InvariantViolation,
    );
    expect(() => unshareArtefact(archived)).toThrow(InvariantViolation);
  });

  it("bumps updatedAt on transition", () => {
    const a = createArtefact({ ...base, now: new Date("2026-01-01T00:00:00Z") });
    const later = new Date("2026-02-01T00:00:00Z");
    expect(shareArtefact(a, { tier: "public", newSlug: "s", now: later }).updatedAt).toEqual(
      later,
    );
  });
});

describe("editArtefact (S3)", () => {
  it("updates only the provided fields and bumps updatedAt", () => {
    const a = createArtefact({ ...base, now: new Date("2026-01-01T00:00:00Z") });
    const later = new Date("2026-03-01T00:00:00Z");
    const edited = editArtefact(a, { title: "  New title  ", now: later });
    expect(edited.title).toBe("New title");
    expect(edited.kind).toBe(a.kind); // untouched
    expect(edited.updatedAt).toEqual(later);
  });

  it("replaces the payload when given a new one (AH2)", () => {
    const a = createArtefact(base);
    const edited = editArtefact(a, {
      payload: { ref: "r2", bytes: 2048, hash: "newhash" },
    });
    expect(edited.payloadRef).toBe("r2");
    expect(edited.payloadBytes).toBe(2048);
    expect(edited.payloadHash).toBe("newhash");
  });

  it("rejects an empty title and oversize payload (AH2, AH3)", () => {
    const a = createArtefact(base);
    expect(() => editArtefact(a, { title: "   " })).toThrow(InvariantViolation);
    expect(() =>
      editArtefact(a, { payload: { ref: "r", bytes: MAX_PAYLOAD_BYTES + 1, hash: "h" } }),
    ).toThrow(InvariantViolation);
    expect(() =>
      editArtefact(a, { payload: { ref: "r", bytes: 0, hash: "h" } }),
    ).toThrow(InvariantViolation);
  });

  it("is blocked while archived (AH7)", () => {
    const archived = { ...createArtefact(base), status: "archived" as const };
    expect(() => editArtefact(archived, { title: "x" })).toThrow(InvariantViolation);
  });
});

describe("archiveArtefact / restoreArtefact (S7)", () => {
  it("archive marks inert and stamps archivedAt, keeping visibility", () => {
    const shared = shareArtefact(createArtefact(base), {
      tier: "public",
      newSlug: "s",
    });
    const now = new Date("2026-04-01T00:00:00Z");
    const archived = archiveArtefact(shared, { now });
    expect(archived.status).toBe("archived");
    expect(archived.archivedAt).toEqual(now);
    expect(archived.visibility).toBe("public"); // retained for restore
    expect(archived.publicSlug).toBe("s");
  });

  it("rejects archiving an already-archived artefact", () => {
    const archived = { ...createArtefact(base), status: "archived" as const };
    expect(() => archiveArtefact(archived)).toThrow(InvariantViolation);
  });

  it("restore returns to active at the prior visibility and clears archivedAt (AH9)", () => {
    const shared = shareArtefact(createArtefact(base), {
      tier: "authenticated",
      newSlug: "s",
    });
    const archived = archiveArtefact(shared);
    const restored = restoreArtefact(archived);
    expect(restored.status).toBe("active");
    expect(restored.archivedAt).toBeNull();
    expect(restored.visibility).toBe("authenticated"); // prior tier
  });

  it("rejects restoring an artefact that is not archived", () => {
    expect(() => restoreArtefact(createArtefact(base))).toThrow(InvariantViolation);
  });
});

describe("assertDeletable (S15, AH11)", () => {
  it("permits deleting an archived artefact", () => {
    const archived = archiveArtefact(createArtefact(base));
    expect(() => assertDeletable(archived)).not.toThrow();
  });

  it("rejects deleting an active artefact", () => {
    expect(() => assertDeletable(createArtefact(base))).toThrow(InvariantViolation);
  });
});

describe("InMemoryArtefactRepository", () => {
  it("persists and retrieves an artefact by id", async () => {
    const repo = new InMemoryArtefactRepository();
    await repo.save(createArtefact(base));
    expect(await repo.findById("a1", SINGLETON_SCOPE)).toMatchObject({
      id: "a1",
      title: "Demo artefact",
    });
    expect(await repo.findById("missing", SINGLETON_SCOPE)).toBeNull();
  });

  describe("listByOwner (S10)", () => {
    it("returns only the owner's active artefacts, newest first", async () => {
      const repo = new InMemoryArtefactRepository();
      const t0 = new Date("2026-01-01T00:00:00Z");
      const t1 = new Date("2026-01-02T00:00:00Z");
      await repo.save(createArtefact({ ...base, id: "old", now: t0 }));
      await repo.save(createArtefact({ ...base, id: "new", now: t1 }));
      await repo.save(createArtefact({ ...base, id: "other", ownerId: "u2" }));
      // An archived artefact of the same owner is hidden by default (AH7).
      const archived = {
        ...createArtefact({ ...base, id: "arch" }),
        status: "archived" as const,
      };
      await repo.save(archived);

      const list = await repo.listByOwner("u1", SINGLETON_SCOPE);
      expect(list.map((a) => a.id)).toEqual(["new", "old"]);
    });

    it("includes archived artefacts when asked", async () => {
      const repo = new InMemoryArtefactRepository();
      await repo.save(createArtefact(base));
      await repo.save({
        ...createArtefact({ ...base, id: "arch" }),
        status: "archived" as const,
      });
      const list = await repo.listByOwner("u1", SINGLETON_SCOPE, {
        includeArchived: true,
      });
      expect(list.map((a) => a.id).sort()).toEqual(["a1", "arch"]);
    });
  });

  describe("listShared (S14)", () => {
    const seed = async () => {
      const repo = new InMemoryArtefactRepository();
      const make = (id: string, over: Partial<ReturnType<typeof createArtefact>>) =>
        repo.save({ ...createArtefact({ ...base, id }), ...over });

      await make("pub", { ownerId: "u1", visibility: "public" });
      await make("auth", { ownerId: "u2", visibility: "authenticated" });
      await make("priv", { ownerId: "u2", visibility: "private" });
      await make("arch", { ownerId: "u1", visibility: "public", status: "archived" });
      return repo;
    };

    it("returns active authenticated+public across owners, never private/archived", async () => {
      const repo = await seed();
      // Viewer owns none of them → sees every shared artefact across owners.
      const shared = await repo.listShared("u3", SINGLETON_SCOPE);
      expect(shared.map((a) => a.id).sort()).toEqual(["auth", "pub"]);
    });

    it("excludes the viewer's own shared artefacts (they live in Your artefacts)", async () => {
      const repo = await seed();
      // u1 owns "pub" → it drops out; only u2's "auth" remains.
      const shared = await repo.listShared("u1", SINGLETON_SCOPE);
      expect(shared.map((a) => a.id).sort()).toEqual(["auth"]);
    });
  });

  // S22 (AH17/T2) — the read methods are tenant-scoped. OSS uses the singleton
  // scope (every row is DEFAULT_TENANT), so these prove the *seam*: a stub
  // multi-tenant scope never returns another tenant's rows. `findBySlug` is
  // deliberately global (AH6) and is asserted to stay cross-tenant.
  describe("tenant scope (S22)", () => {
    const TENANT_A = { tenantId: "org-a" };
    const TENANT_B = { tenantId: "org-b" };

    const seedTwoTenants = async () => {
      const repo = new InMemoryArtefactRepository();
      await repo.save({
        ...createArtefact({ ...base, id: "a-priv", tenantId: "org-a" }),
      });
      await repo.save({
        ...createArtefact({ ...base, id: "a-shared", tenantId: "org-a" }),
        visibility: "authenticated",
        publicSlug: "slug-a",
      });
      await repo.save({
        ...createArtefact({
          ...base,
          id: "b-priv",
          ownerId: "u2",
          tenantId: "org-b",
        }),
      });
      await repo.save({
        ...createArtefact({
          ...base,
          id: "b-shared",
          ownerId: "u2",
          tenantId: "org-b",
        }),
        visibility: "authenticated",
        publicSlug: "slug-b",
      });
      return repo;
    };

    it("findById returns null for an out-of-scope artefact", async () => {
      const repo = await seedTwoTenants();
      expect(await repo.findById("a-priv", TENANT_A)).not.toBeNull();
      expect(await repo.findById("a-priv", TENANT_B)).toBeNull();
    });

    it("listByOwner excludes other-tenant artefacts", async () => {
      const repo = await seedTwoTenants();
      const inA = await repo.listByOwner("u1", TENANT_A);
      expect(inA.map((a) => a.id).sort()).toEqual(["a-priv", "a-shared"]);
      // u1 owns nothing in org-b's scope.
      expect(await repo.listByOwner("u1", TENANT_B)).toEqual([]);
    });

    it("listShared only returns artefacts within the scope's tenant", async () => {
      const repo = await seedTwoTenants();
      // A viewer scoped to org-b sees only org-b's shared artefact, not org-a's.
      const shared = await repo.listShared("viewer", TENANT_B);
      expect(shared.map((a) => a.id)).toEqual(["b-shared"]);
    });

    it("findBySlug stays global (AH6) — a slug resolves across tenants", async () => {
      const repo = await seedTwoTenants();
      expect((await repo.findBySlug("slug-a"))?.id).toBe("a-shared");
      expect((await repo.findBySlug("slug-b"))?.id).toBe("b-shared");
    });
  });
});

describe("thumbnailHash (S35, AH25/AH26)", () => {
  it("starts null at create, so a new artefact's thumbnail is stale", () => {
    const a = createArtefact(base);
    expect(a.thumbnailHash).toBeNull();
    expect(isThumbnailStale(a)).toBe(true);
  });

  it("is fresh only while it equals the payload hash", () => {
    const a = createArtefact(base);
    expect(isThumbnailStale({ ...a, thumbnailHash: "deadbeef" })).toBe(false);
    expect(isThumbnailStale({ ...a, thumbnailHash: "older" })).toBe(true);
  });

  it("is left untouched by an edit, including a payload replacement", () => {
    const a = { ...createArtefact(base), thumbnailHash: "deadbeef" };
    const retitled = editArtefact(a, { title: "Renamed" });
    expect(retitled.thumbnailHash).toBe("deadbeef");
    const replaced = editArtefact(a, {
      payload: { ref: "r2", bytes: 10, hash: "cafebabe" },
    });
    expect(replaced.thumbnailHash).toBe("deadbeef");
    expect(isThumbnailStale(replaced)).toBe(true);
  });
});
