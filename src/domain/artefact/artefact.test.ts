import { describe, expect, expectTypeOf, it } from "vitest";
import {
  archiveArtefact,
  assertDeletable,
  createArtefact,
  editArtefact,
  isThumbnailStale,
  restoreArtefact,
  setDataVisibility,
  shareArtefact,
  unshareArtefact,
  DEFAULT_TENANT,
  type Artefact,
} from "./artefact";
import { DEFAULT_MAX_PAYLOAD_BYTES } from "./enforcement";
import { grantAccess, revokeAccess } from "./access-list";
import { clearArtefactLinkGate } from "./link-gate";
import { changed, type OwnerChanges } from "./changed";
import { createCollection } from "../collection/collection";
import { evictFromCollection, moveArtefactToCollection } from "../collection/move-artefact";
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
  // r[verify hosting.create.active-private]
  it("creates an active, private artefact with no slug", () => {
    const a = createArtefact(base);
    expect(a.status).toBe("active");
    expect(a.visibility).toBe("private");
    expect(a.publicSlug).toBeNull();
    expect(a.payloadBytes).toBe(1024);
  });

  // r[verify hosting.create.title-kind-payload]
  it("carries the owner, title, kind and payload it was created from", () => {
    const a = createArtefact(base);
    expect(a).toMatchObject({
      ownerId: "u1",
      title: "Demo artefact",
      kind: "prototype",
      payloadRef: "r1",
      payloadBytes: 1024,
      payloadHash: "deadbeef",
    });
  });

  // r[verify hosting.artefact.title-required]
  it("trims and rejects an empty title", () => {
    expect(() => createArtefact({ ...base, title: "   " })).toThrow(
      InvariantViolation,
    );
  });

  // r[verify hosting.payload.size-bounds+2]
  it("rejects an empty payload", () => {
    expect(() =>
      createArtefact({ ...base, payload: { ref: "r", bytes: 0, hash: "h" } }),
    ).toThrow(InvariantViolation);
  });

  // r[verify hosting.payload.size-bounds+2]
  it("rejects a payload over the 100 MB cap", () => {
    expect(() =>
      createArtefact({
        ...base,
        payload: { ref: "r", bytes: DEFAULT_MAX_PAYLOAD_BYTES + 1, hash: "h" },
      }),
    ).toThrow(InvariantViolation);
  });

  // r[verify hosting.payload.cap-policy-decided+2]
  it("checks the payload against the cap it is given", () => {
    const MB = 1024 * 1024;
    const create = (bytes: number) =>
      createArtefact({ ...base, payload: { ref: "r", bytes, hash: "h" }, maxPayloadBytes: 10 * MB });
    expect(() => create(11 * MB)).toThrow("payload exceeds the 10 MB cap");
    expect(create(9 * MB).payloadBytes).toBe(9 * MB);
    const a = createArtefact(base);
    expect(() =>
      editArtefact(a, { payload: { ref: "r", bytes: 11 * MB, hash: "h" }, maxPayloadBytes: 10 * MB }),
    ).toThrow("payload exceeds the 10 MB cap");
  });

  // r[verify hosting.artefact.owner-required]
  it("requires an owner", () => {
    expect(() => createArtefact({ ...base, ownerId: "" })).toThrow(
      InvariantViolation,
    );
  });
});

describe("shareArtefact / unshareArtefact (S5)", () => {
  // r[verify hosting.slug.shared-has-slug]
  // r[verify hosting.share.sets-tier]
  it("mints the supplied slug on first share and sets the tier", () => {
    const a = createArtefact(base);
    const shared = shareArtefact(a, { tier: "public", newSlug: "abc123" });
    expect(shared.visibility).toBe("public");
    expect(shared.publicSlug).toBe("abc123");
  });

  // r[verify hosting.slug.minted-once-retained]
  it("retains the existing slug when re-sharing, ignoring a new one", () => {
    const a = { ...createArtefact(base), publicSlug: "kept", visibility: "private" as const };
    const shared = shareArtefact(a, { tier: "authenticated", newSlug: "ignored" });
    expect(shared.publicSlug).toBe("kept");
    expect(shared.visibility).toBe("authenticated");
  });

  // r[verify hosting.share.sets-tier]
  it("changes tier between authenticated and public", () => {
    const a = { ...createArtefact(base), publicSlug: "s", visibility: "authenticated" as const };
    expect(shareArtefact(a, { tier: "public" }).visibility).toBe("public");
  });

  // r[verify hosting.slug.shared-has-slug]
  it("requires a slug to share an artefact that has none", () => {
    expect(() => shareArtefact(createArtefact(base), { tier: "public" })).toThrow(
      InvariantViolation,
    );
  });

  // r[verify hosting.slug.minted-once-retained]
  // r[verify hosting.unshare.sets-private]
  it("unshare returns to private but retains the slug", () => {
    const shared = shareArtefact(createArtefact(base), {
      tier: "public",
      newSlug: "slug9",
    });
    const unshared = unshareArtefact(shared);
    expect(unshared.visibility).toBe("private");
    expect(unshared.publicSlug).toBe("slug9");
  });

  // r[verify hosting.lifecycle.archived-frozen]
  it("blocks share/unshare while archived", () => {
    const archived = { ...createArtefact(base), status: "archived" as const };
    expect(() => shareArtefact(archived, { tier: "public", newSlug: "x" })).toThrow(
      InvariantViolation,
    );
    expect(() => unshareArtefact(archived)).toThrow(InvariantViolation);
  });
});

describe("updatedAt (every change)", () => {
  const created = new Date("2026-01-01T00:00:00Z");
  const later = new Date("2026-02-01T00:00:00Z");
  const fresh = () => createArtefact({ ...base, now: created });
  const shared = () => shareArtefact(fresh(), { tier: "public", newSlug: "s", now: created });
  const collection = createCollection({ id: "c1", ownerId: "u1", name: "Folder" });
  const contained = () => moveArtefactToCollection(fresh(), collection, { now: created });
  const gated = (): Artefact => ({
    ...shared(),
    linkGate: { passwordHash: "h", expiresAt: null, version: 2 },
  });

  // r[verify hosting.artefact.updated-at-bumped+2]
  it.each([
    ["edit", () => editArtefact(fresh(), { title: "Renamed", now: later })],
    ["share", () => shareArtefact(fresh(), { tier: "public", newSlug: "s", now: later })],
    ["change tier", () => shareArtefact(shared(), { tier: "authenticated", now: later })],
    ["unshare", () => unshareArtefact(shared(), { now: later })],
    ["grant access", () => grantAccess(fresh(), "u2", later)],
    ["revoke access", () => revokeAccess(grantAccess(fresh(), "u2", created), "u2", later)],
    ["clear the link gate", () =>
      clearArtefactLinkGate(gated(), { requesterId: "u1", now: later })],
    ["set data visibility", () => setDataVisibility(fresh(), "u1", "shared", { now: later })],
    ["archive", () => archiveArtefact(fresh(), { now: later })],
    ["restore", () =>
      restoreArtefact(archiveArtefact(fresh(), { now: created }), { now: later })],
    ["move into a collection", () => moveArtefactToCollection(fresh(), collection, { now: later })],
    ["move to top level", () => moveArtefactToCollection(contained(), null, { now: later })],
    ["evict from a collection", () => evictFromCollection(contained(), { now: later })],
  ])("%s sets updatedAt to the time of the change", (_, change) => {
    expect(change().updatedAt).toEqual(later);
  });

  // r[verify hosting.artefact.updated-at-bumped+2]
  it.each([
    ["granting an existing member", () => grantAccess(grantAccess(fresh(), "u2", created), "u2", later)],
    ["revoking a non-member", () => revokeAccess(fresh(), "u2", later)],
    ["setting the current data visibility", () =>
      setDataVisibility(fresh(), "u1", fresh().dataVisibility, { now: later })],
    ["moving to the collection it is in", () =>
      moveArtefactToCollection(contained(), collection, { now: later })],
    ["evicting a top-level artefact", () => evictFromCollection(fresh(), { now: later })],
  ])("%s is a no-op that leaves updatedAt alone", (_, change) => {
    expect(change().updatedAt).toEqual(created);
  });

  const authenticated = () =>
    shareArtefact(fresh(), { tier: "authenticated", newSlug: "s", now: created });

  // r[verify hosting.artefact.updated-at-bumped+2]
  it.each([
    ["unsharing a private artefact", fresh, (a: Artefact) => unshareArtefact(a, { now: later })],
    ["sharing at the current tier", authenticated, (a: Artefact) =>
      shareArtefact(a, { tier: "authenticated", now: later })],
    ["sharing public → public with a gate set", gated, (a: Artefact) =>
      shareArtefact(a, { tier: "public", now: later })],
    ["an edit with no fields", fresh, (a: Artefact) => editArtefact(a, { now: later })],
    ["clearing an unset link gate", shared, (a: Artefact) =>
      clearArtefactLinkGate(a, { requesterId: "u1", now: later })],
  ])("%s returns the artefact itself", (_, make, change) => {
    const a = make();
    expect(change(a)).toBe(a);
  });

  // r[verify hosting.artefact.updated-at-bumped+2]
  it("changed() returns the input when every change equals the current value", () => {
    const a = fresh();
    expect(changed(a, {}, later)).toBe(a);
    expect(changed(a, { visibility: a.visibility }, later)).toBe(a);
    const next = changed(a, { visibility: "public" }, later);
    expect(next).not.toBe(a);
    expect(next.visibility).toBe("public");
    expect(next.updatedAt).toEqual(later);
  });
});

describe("identity", () => {
  // r[verify hosting.artefact.identity-fixed]
  it("lets no transition's changes name the id or the creation time", () => {
    expectTypeOf<OwnerChanges>().not.toHaveProperty("id");
    expectTypeOf<OwnerChanges>().not.toHaveProperty("createdAt");
  });

  // r[verify hosting.tenant.id-fixed]
  it("lets no transition's changes name the tenant", () => {
    expectTypeOf<OwnerChanges>().not.toHaveProperty("tenantId");
  });
});

describe("editArtefact (S3)", () => {
  // r[verify hosting.edit.fields-and-timestamp+2]
  it("updates only the provided fields and bumps updatedAt", () => {
    const a = createArtefact({ ...base, now: new Date("2026-01-01T00:00:00Z") });
    const later = new Date("2026-03-01T00:00:00Z");
    const edited = editArtefact(a, { title: "  New title  ", now: later });
    expect(edited.title).toBe("New title");
    expect(edited.kind).toBe(a.kind); // untouched
    expect(edited.updatedAt).toEqual(later);
  });

  // r[verify hosting.edit.fields-and-timestamp+2]
  it("leaves the artefact itself when no field changes", () => {
    const a = createArtefact({ ...base, now: new Date("2026-01-01T00:00:00Z") });
    const later = new Date("2026-03-01T00:00:00Z");
    expect(editArtefact(a, { now: later })).toBe(a);
    expect(editArtefact(a, { title: `  ${a.title} `, kind: a.kind, now: later })).toBe(a);
    expect(editArtefact(a, { title: "New", now: later }).updatedAt).toEqual(later);
  });

  // r[verify hosting.edit.fields-and-timestamp+2]
  it("replaces the payload when given a new one", () => {
    const a = createArtefact(base);
    const edited = editArtefact(a, {
      payload: { ref: "r2", bytes: 2048, hash: "newhash" },
    });
    expect(edited.payloadRef).toBe("r2");
    expect(edited.payloadBytes).toBe(2048);
    expect(edited.payloadHash).toBe("newhash");
  });

  // r[verify hosting.payload.size-bounds+2]
  // r[verify hosting.artefact.title-required]
  it("rejects an empty title and oversize payload", () => {
    const a = createArtefact(base);
    expect(() => editArtefact(a, { title: "   " })).toThrow(InvariantViolation);
    expect(() =>
      editArtefact(a, { payload: { ref: "r", bytes: DEFAULT_MAX_PAYLOAD_BYTES + 1, hash: "h" } }),
    ).toThrow(InvariantViolation);
    expect(() =>
      editArtefact(a, { payload: { ref: "r", bytes: 0, hash: "h" } }),
    ).toThrow(InvariantViolation);
  });

  // r[verify hosting.lifecycle.archived-frozen]
  it("is blocked while archived", () => {
    const archived = { ...createArtefact(base), status: "archived" as const };
    expect(() => editArtefact(archived, { title: "x" })).toThrow(InvariantViolation);
  });
});

describe("archiveArtefact / restoreArtefact (S7)", () => {
  // r[verify hosting.lifecycle.archive-stamps-archived-at]
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

  // r[verify hosting.lifecycle.archive-active-only]
  it("rejects archiving an already-archived artefact", () => {
    const archived = { ...createArtefact(base), status: "archived" as const };
    expect(() => archiveArtefact(archived)).toThrow(InvariantViolation);
  });

  // r[verify hosting.restore.prior-visibility]
  it("restore returns to active at the prior visibility and clears archivedAt", () => {
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

  // r[verify hosting.lifecycle.restore-archived-only]
  it("rejects restoring an artefact that is not archived", () => {
    expect(() => restoreArtefact(createArtefact(base))).toThrow(InvariantViolation);
  });
});

// r[verify hosting.delete.archived-only]
describe("assertDeletable (S15)", () => {
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
    // r[verify hosting.lifecycle.archived-hidden-from-listings]
    // r[verify hosting.listing.own-only]
    it("returns only the owner's active artefacts, newest first", async () => {
      const repo = new InMemoryArtefactRepository();
      const t0 = new Date("2026-01-01T00:00:00Z");
      const t1 = new Date("2026-01-02T00:00:00Z");
      await repo.save(createArtefact({ ...base, id: "old", now: t0 }));
      await repo.save(createArtefact({ ...base, id: "new", now: t1 }));
      await repo.save(createArtefact({ ...base, id: "other", ownerId: "u2" }));
      // An archived artefact of the same owner is hidden by default
      // (hosting.lifecycle.archived-hidden-from-listings).
      const archived = {
        ...createArtefact({ ...base, id: "arch" }),
        status: "archived" as const,
      };
      await repo.save(archived);

      const list = await repo.listByOwner("u1", SINGLETON_SCOPE);
      expect(list.map((a) => a.id)).toEqual(["new", "old"]);
    });

    // r[verify hosting.listing.own-only]
    it("orders by the last change, not by creation", async () => {
      const repo = new InMemoryArtefactRepository();
      await repo.save(createArtefact({ ...base, id: "old", now: new Date("2026-01-01T00:00:00Z") }));
      await repo.save(createArtefact({ ...base, id: "new", now: new Date("2026-01-02T00:00:00Z") }));
      const old = (await repo.findById("old", SINGLETON_SCOPE))!;
      await repo.save(editArtefact(old, { title: "Edited", now: new Date("2026-01-03T00:00:00Z") }));

      const list = await repo.listByOwner("u1", SINGLETON_SCOPE);
      expect(list.map((a) => a.id)).toEqual(["old", "new"]);
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

    // r[verify hosting.shared.others-viewable+2]
    it("returns active authenticated+public across owners, never private/archived", async () => {
      const repo = await seed();
      // Viewer owns none of them → sees every shared artefact across owners.
      const shared = await repo.listShared("u3", SINGLETON_SCOPE);
      expect(shared.map((a) => a.id).sort()).toEqual(["auth", "pub"]);
    });

    // r[verify hosting.shared.others-viewable+2]
    it("excludes the viewer's own shared artefacts (they live in Your artefacts)", async () => {
      const repo = await seed();
      // u1 owns "pub" → it drops out; only u2's "auth" remains.
      const shared = await repo.listShared("u1", SINGLETON_SCOPE);
      expect(shared.map((a) => a.id).sort()).toEqual(["auth"]);
    });

    // r[verify hosting.shared.others-viewable+2]
    it("lists top-level artefacts only: a contained one's own tier is dormant", async () => {
      const repo = await seed();
      await repo.save({
        ...createArtefact({ ...base, id: "contained", ownerId: "u2" }),
        visibility: "public",
        collectionId: "c1",
      });
      const shared = await repo.listShared("u3", SINGLETON_SCOPE);
      expect(shared.map((a) => a.id)).not.toContain("contained");
    });
  });

  // S22 (hosting.tenant.invisible-to-oss) — the read methods are tenant-scoped. OSS uses the
  // singleton scope (every row is DEFAULT_TENANT), so these prove the *seam*: a stub
  // multi-tenant scope never returns another tenant's rows. `findBySlug` is
  // deliberately global (hosting.slug.globally-unique) and is asserted to stay cross-tenant.
  describe("tenant scope (S22)", () => {
    // r[verify hosting.tenant.invisible-to-oss]
    it("puts an artefact created without a tenant in the default one, which the singleton scope reads", async () => {
      const repo = new InMemoryArtefactRepository();
      const a = createArtefact(base);
      expect(a.tenantId).toBe(DEFAULT_TENANT);
      await repo.save(a);
      expect(await repo.findById("a1", SINGLETON_SCOPE)).toMatchObject({ id: "a1" });
      expect((await repo.listByOwner("u1", SINGLETON_SCOPE)).map((x) => x.id)).toEqual(["a1"]);
    });

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

    // r[verify hosting.tenant.scope-excludes-other-tenants+2]
    it("findById returns null for an out-of-scope artefact", async () => {
      const repo = await seedTwoTenants();
      expect(await repo.findById("a-priv", TENANT_A)).not.toBeNull();
      expect(await repo.findById("a-priv", TENANT_B)).toBeNull();
    });

    // r[verify hosting.tenant.scope-excludes-other-tenants+2]
    it("listByOwner excludes other-tenant artefacts", async () => {
      const repo = await seedTwoTenants();
      const inA = await repo.listByOwner("u1", TENANT_A);
      expect(inA.map((a) => a.id).sort()).toEqual(["a-priv", "a-shared"]);
      // u1 owns nothing in org-b's scope.
      expect(await repo.listByOwner("u1", TENANT_B)).toEqual([]);
    });

    // r[verify hosting.tenant.scope-excludes-other-tenants+2]
    it("listShared only returns artefacts within the scope's tenant", async () => {
      const repo = await seedTwoTenants();
      // A viewer scoped to org-b sees only org-b's shared artefact, not org-a's.
      const shared = await repo.listShared("viewer", TENANT_B);
      expect(shared.map((a) => a.id)).toEqual(["b-shared"]);
    });

    // r[verify hosting.slug.globally-unique]
    // r[verify hosting.tenant.scope-excludes-other-tenants+2]
    it("findBySlug stays global — a slug resolves across tenants", async () => {
      const repo = await seedTwoTenants();
      expect((await repo.findBySlug("slug-a"))?.id).toBe("a-shared");
      expect((await repo.findBySlug("slug-b"))?.id).toBe("b-shared");
    });
  });
});

describe("thumbnailHash (S35)", () => {
  // r[verify hosting.thumbnail.stale-while-hash-differs]
  it("starts null at create, so a new artefact's thumbnail is stale", () => {
    const a = createArtefact(base);
    expect(a.thumbnailHash).toBeNull();
    expect(isThumbnailStale(a)).toBe(true);
  });

  // r[verify hosting.thumbnail.stale-while-hash-differs]
  it("is fresh only while it equals the payload hash", () => {
    const a = createArtefact(base);
    expect(isThumbnailStale({ ...a, thumbnailHash: "deadbeef" })).toBe(false);
    expect(isThumbnailStale({ ...a, thumbnailHash: "older" })).toBe(true);
  });

  // r[verify hosting.thumbnail.stale-while-hash-differs]
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
