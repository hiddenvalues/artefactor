import { describe, expect, it } from "vitest";
import {
  archiveCollection,
  assertCollectionDeletable,
  createCollection,
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

describe("createCollection (CL1–CL3)", () => {
  it("creates an active, private, top-level collection that is its own root", () => {
    const c = createCollection({ id: "c1", ownerId: OWNER, name: "  Product  " });
    expect(c.name).toBe("Product"); // CL2 — trimmed
    expect(c.parentId).toBeNull();
    expect(c.rootId).toBe("c1"); // a root is its own tree root
    expect(c.visibility).toBe("private");
    expect(c.sharedWith).toEqual([]);
    expect(c.status).toBe("active");
    expect(c.tenantId).toBe(DEFAULT_TENANT);
  });

  it("a nested collection inherits the parent's rootId (CL3)", () => {
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

  it("rejects an empty name (CL2)", () => {
    expect(() =>
      createCollection({ id: "c1", ownerId: OWNER, name: "   " }),
    ).toThrow(CollectionInvariantViolation);
  });

  it("rejects a parent with a different owner or tenant (CL1)", () => {
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

  it("rejects creating under an archived parent (CL7)", () => {
    const archived = archiveCollection(makeRoot());
    expect(() =>
      createCollection({ id: "c2", ownerId: OWNER, name: "Q4", parent: archived }),
    ).toThrow(CollectionInvariantViolation);
  });
});

describe("renameCollection (CL2/CL7)", () => {
  it("renames, trimming, and bumps updatedAt", () => {
    const t1 = new Date("2026-01-02T00:00:00Z");
    const next = renameCollection(makeRoot(), "  Growth  ", { now: t1 });
    expect(next.name).toBe("Growth");
    expect(next.updatedAt).toEqual(t1);
  });

  it("rejects empty names and archived collections", () => {
    expect(() => renameCollection(makeRoot(), " ")).toThrow(
      CollectionInvariantViolation,
    );
    expect(() => renameCollection(archiveCollection(makeRoot()), "X")).toThrow(
      CollectionInvariantViolation,
    );
  });
});

describe("setCollectionAccess (CL4)", () => {
  it("changes the tier on a root", () => {
    const next = setCollectionAccess(makeRoot(), "authenticated");
    expect(next.visibility).toBe("authenticated");
  });

  it("is a no-op at the same tier", () => {
    const c = makeRoot();
    expect(setCollectionAccess(c, "private")).toBe(c);
  });

  it("rejects a non-root — nested collections inherit (CL4)", () => {
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

  it("rejects an archived collection (CL7)", () => {
    expect(() =>
      setCollectionAccess(archiveCollection(makeRoot()), "public"),
    ).toThrow(CollectionInvariantViolation);
  });
});

describe("collection access list (CL4, AH13/14 semantics)", () => {
  it("grants and revokes with set semantics", () => {
    const c = makeRoot();
    const granted = grantCollectionAccess(c, "user-2");
    expect(granted.sharedWith).toEqual(["user-2"]);
    expect(grantCollectionAccess(granted, "user-2")).toBe(granted); // no-op
    const revoked = revokeCollectionAccess(granted, "user-2");
    expect(revoked.sharedWith).toEqual([]);
    expect(revokeCollectionAccess(revoked, "ghost")).toBe(revoked); // no-op
  });

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

describe("collection lifecycle (CL7/CL8)", () => {
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
