import { describe, expect, it } from "vitest";
import {
  archiveCollection,
  assignCollectionSlug,
  assertCollectionDeletable,
  createCollection,
  describeCollection,
  grantCollectionAccess,
  renameCollection,
  restoreCollection,
  revokeCollectionAccess,
  setCollectionAccess,
  type Collection,
} from "./collection";
import { CollectionInvariantViolation } from "./errors";
import { DEFAULT_TENANT } from "../artefact/artefact";

const OWNER = "owner-1";

function makeRoot(over: Partial<Collection> = {}): Collection {
  return {
    ...createCollection({ id: "c1", ownerId: OWNER, name: "Product" }),
    ...over,
  };
}

describe("createCollection", () => {
  // r[verify collections.collection.name-required]
  it("creates an active, private, top-level collection that is its own root", () => {
    const c = createCollection({ id: "c1", ownerId: OWNER, name: "  Product  " });
    expect(c.name).toBe("Product"); // trimmed
    expect(c.parentId).toBeNull();
    expect(c.rootId).toBe("c1"); // a root is its own tree root
    expect(c.visibility).toBe("private");
    expect(c.sharedWith).toEqual([]);
    expect(c.status).toBe("active");
    expect(c.tenantId).toBe(DEFAULT_TENANT);
  });

  // r[verify collections.tree.shape-fixed]
  it("a nested collection inherits the parent's rootId", () => {
    const root = makeRoot();
    const child = createCollection({
      id: "c2",
      ownerId: OWNER,
      name: "Q4",
      parent: root,
    });
    const grandchild = createCollection({
      id: "c3",
      ownerId: OWNER,
      name: "Experiments",
      parent: child,
    });
    expect(child.parentId).toBe("c1");
    expect(child.rootId).toBe("c1");
    expect(grandchild.rootId).toBe("c1"); // denormalized through the chain
  });

  // r[verify collections.collection.name-required]
  it("rejects an empty name", () => {
    expect(() =>
      createCollection({ id: "c1", ownerId: OWNER, name: "   " }),
    ).toThrow(CollectionInvariantViolation);
  });

  // r[verify collections.tree.single-owner]
  it("rejects a parent with a different owner or tenant", () => {
    const other = makeRoot({ ownerId: "owner-2" });
    expect(() =>
      createCollection({ id: "c2", ownerId: OWNER, name: "Q4", parent: other }),
    ).toThrow(CollectionInvariantViolation);
    const crossTenant = makeRoot({ tenantId: "acme" });
    expect(() =>
      createCollection({
        id: "c2",
        ownerId: OWNER,
        name: "Q4",
        parent: crossTenant,
      }),
    ).toThrow(CollectionInvariantViolation);
  });

  // r[verify collections.tree.shape-fixed]
  // r[verify collections.lifecycle.archived-inert+3]
  it("rejects creating under an archived parent", () => {
    const archived = archiveCollection(makeRoot());
    expect(() =>
      createCollection({ id: "c2", ownerId: OWNER, name: "Q4", parent: archived }),
    ).toThrow(CollectionInvariantViolation);
  });
});

describe("renameCollection", () => {
  it("renames, trimming, and bumps updatedAt", () => {
    const t1 = new Date("2026-01-02T00:00:00Z");
    const next = renameCollection(makeRoot(), "  Growth  ", { now: t1 });
    expect(next.name).toBe("Growth");
    expect(next.updatedAt).toEqual(t1);
  });

  // r[verify collections.collection.name-required]
  // r[verify collections.lifecycle.archived-inert+3]
  it("rejects empty names and archived collections", () => {
    expect(() => renameCollection(makeRoot(), " ")).toThrow(
      CollectionInvariantViolation,
    );
    expect(() => renameCollection(archiveCollection(makeRoot()), "X")).toThrow(
      CollectionInvariantViolation,
    );
  });
});

// r[verify collections.collection.description+2]
describe("collection description (S74)", () => {
  it("is trimmed at create", () => {
    const c = createCollection({
      id: "c1",
      ownerId: OWNER,
      name: "Help",
      description: "  Guides for new users  ",
    });
    expect(c.description).toBe("Guides for new users");
  });

  it("is null when blank or omitted", () => {
    expect(
      createCollection({ id: "c1", ownerId: OWNER, name: "Help", description: "   " }).description,
    ).toBeNull();
    expect(makeRoot().description).toBeNull();
  });

  it("collapses internal whitespace runs, line breaks included, to one space", () => {
    const c = createCollection({
      id: "c1",
      ownerId: OWNER,
      name: "Help",
      description: "Guides\n\nFAQ \t and   notes",
    });
    expect(c.description).toBe("Guides FAQ and notes");
  });

  it("applies the limit to the collapsed text", () => {
    const raw = "a".repeat(140) + "\n\n\n" + "b".repeat(139); // 282 raw, 280 collapsed
    expect(
      createCollection({ id: "c1", ownerId: OWNER, name: "Help", description: raw }).description,
    ).toBe("a".repeat(140) + " " + "b".repeat(139));
  });

  it("accepts exactly 280 characters and rejects 281, naming the limit", () => {
    const at = "a".repeat(280);
    expect(
      createCollection({ id: "c1", ownerId: OWNER, name: "Help", description: at }).description,
    ).toBe(at);
    expect(() =>
      createCollection({ id: "c1", ownerId: OWNER, name: "Help", description: "a".repeat(281) }),
    ).toThrow(/280/);
  });

  it("the edit sets and clears it, bumping updatedAt", () => {
    const t1 = new Date("2026-01-02T00:00:00Z");
    const described = describeCollection(makeRoot(), " Topics ", { now: t1 });
    expect(described.description).toBe("Topics");
    expect(described.updatedAt).toEqual(t1);
    expect(describeCollection(described, null).description).toBeNull();
    expect(() => describeCollection(makeRoot(), "a".repeat(281))).toThrow(
      CollectionInvariantViolation,
    );
  });

  // r[verify collections.lifecycle.archived-inert+3]
  it("refuses an archived collection's edit", () => {
    expect(() => describeCollection(archiveCollection(makeRoot()), "X")).toThrow(
      CollectionInvariantViolation,
    );
  });
});

describe("setCollectionAccess", () => {
  it("changes the tier on a root", () => {
    const next = setCollectionAccess(makeRoot(), "authenticated");
    expect(next.visibility).toBe("authenticated");
  });

  it("is a no-op at the same tier", () => {
    const c = makeRoot();
    expect(setCollectionAccess(c, "private")).toBe(c);
  });

  // r[verify collections.access.set-on-root-only]
  it("rejects a non-root — nested collections inherit", () => {
    const child = createCollection({
      id: "c2",
      ownerId: OWNER,
      name: "Q4",
      parent: makeRoot(),
    });
    expect(() => setCollectionAccess(child, "public")).toThrow(
      CollectionInvariantViolation,
    );
  });

  // r[verify collections.lifecycle.archived-inert+3]
  it("rejects an archived collection", () => {
    expect(() =>
      setCollectionAccess(archiveCollection(makeRoot()), "public"),
    ).toThrow(CollectionInvariantViolation);
  });
});

// r[verify hosting.access-list.retained]
// r[verify hosting.access-list.owner-managed-set]
describe("collection access list", () => {
  it("grants and revokes with set semantics", () => {
    const c = makeRoot();
    const granted = grantCollectionAccess(c, "user-2");
    expect(granted.sharedWith).toEqual(["user-2"]);
    expect(grantCollectionAccess(granted, "user-2")).toBe(granted); // no-op
    const revoked = revokeCollectionAccess(granted, "user-2");
    expect(revoked.sharedWith).toEqual([]);
    expect(revokeCollectionAccess(revoked, "ghost")).toBe(revoked); // no-op
  });

  // r[verify collections.access.set-on-root-only]
  // r[verify collections.lifecycle.archived-inert+3]
  it("rejects granting the owner, on non-roots, and while archived", () => {
    expect(() => grantCollectionAccess(makeRoot(), OWNER)).toThrow(
      CollectionInvariantViolation,
    );
    const child = createCollection({
      id: "c2",
      ownerId: OWNER,
      name: "Q4",
      parent: makeRoot(),
    });
    expect(() => grantCollectionAccess(child, "user-2")).toThrow(
      CollectionInvariantViolation,
    );
    expect(() =>
      grantCollectionAccess(archiveCollection(makeRoot()), "user-2"),
    ).toThrow(CollectionInvariantViolation);
  });
});

describe("collection lifecycle", () => {
  it("archive stamps archivedAt; restore clears it and keeps the tier", () => {
    const c = setCollectionAccess(makeRoot(), "public");
    const archived = archiveCollection(c);
    expect(archived.status).toBe("archived");
    expect(archived.archivedAt).not.toBeNull();
    const restored = restoreCollection(archived);
    expect(restored.status).toBe("active");
    expect(restored.archivedAt).toBeNull();
    expect(restored.visibility).toBe("public"); // tier retained through archival
  });

  // r[verify collections.lifecycle.delete-archived-only]
  it("guards double-archive, restore-of-active, and delete-of-active", () => {
    const c = makeRoot();
    expect(() => restoreCollection(c)).toThrow(CollectionInvariantViolation);
    expect(() => assertCollectionDeletable(c)).toThrow(
      CollectionInvariantViolation,
    );
    const archived = archiveCollection(c);
    expect(() => archiveCollection(archived)).toThrow(
      CollectionInvariantViolation,
    );
    expect(() => assertCollectionDeletable(archived)).not.toThrow();
  });
});

describe("collection public slug (S44)", () => {
  it("starts null on every new collection", () => {
    expect(makeRoot().publicSlug).toBeNull();
  });

  // r[verify collections.public-link.root-slug-minted]
  it("assignCollectionSlug sets the slug on a slugless root", () => {
    expect(assignCollectionSlug(makeRoot(), "abc").publicSlug).toBe("abc");
  });

  // r[verify collections.public-link.root-slug-minted]
  it("assignCollectionSlug refuses a non-root, and a root that already has one", () => {
    const root = makeRoot();
    const child = createCollection({ id: "c2", ownerId: OWNER, name: "Q4", parent: root });
    expect(() => assignCollectionSlug(child, "abc")).toThrow(CollectionInvariantViolation);
    expect(() => assignCollectionSlug(makeRoot({ publicSlug: "kept" }), "abc")).toThrow(
      CollectionInvariantViolation,
    );
  });

  // r[verify collections.public-link.root-slug-minted]
  it("setCollectionAccess retains the slug across every tier change", () => {
    let c = makeRoot({ publicSlug: "kept" });
    for (const tier of ["public", "private", "selected", "authenticated", "private"] as const) {
      c = setCollectionAccess(c, tier);
      expect(c.publicSlug).toBe("kept");
    }
  });
});
