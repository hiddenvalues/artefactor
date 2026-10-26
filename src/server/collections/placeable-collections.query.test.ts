import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryCollectionRepository } from "../../domain/collection/in-memory-collection-repository";
import {
  archiveCollection,
  createCollection,
  grantCollectionAccess,
  type Collection,
} from "../../domain/collection/collection";
import type { Visibility } from "../../domain/artefact/visibility";
import type { AccessPolicy } from "../../domain/artefact/access";
import { SINGLETON_SCOPE } from "../../domain/artefact/tenant-scope";
import { listPlaceableCollections } from "./placeable-collections.query";

// S75 — the collections an Account may place an artefact into, for `list_collections`.
describe("listPlaceableCollections (S75)", () => {
  let collectionRepo: InMemoryCollectionRepository;

  beforeEach(() => {
    collectionRepo = new InMemoryCollectionRepository();
  });

  async function make(
    id: string,
    ownerId: string,
    options: { parent?: Collection; visibility?: Visibility; tenantId?: string; grant?: string[] } = {},
  ): Promise<Collection> {
    let c = createCollection({
      id,
      ownerId,
      name: id,
      parent: options.parent ?? null,
      visibility: options.visibility,
      tenantId: options.tenantId,
    });
    for (const userId of options.grant ?? []) c = grantCollectionAccess(c, userId);
    await collectionRepo.save(c);
    return c;
  }

  const ids = async (userId: string) =>
    (await listPlaceableCollections(userId, SINGLETON_SCOPE, { collectionRepo })).map(
      (row) => [row.collection.id, row.own],
    );

  // r[verify mcp.collections.list-placeable]
  it("lists every active node of the caller's own trees, then of trees they contribute to", async () => {
    const mine = await make("Mine", "u1");
    await make("Mine-1", "u1", { parent: mine });
    const theirs = await make("Theirs", "u2", { visibility: "selected", grant: ["u1"] });
    await make("Theirs-1", "u2", { parent: theirs });

    expect(await ids("u1")).toEqual([
      ["Mine", true],
      ["Mine-1", true],
      ["Theirs", false],
      ["Theirs-1", false],
    ]);
  });

  // r[verify mcp.collections.list-placeable]
  it("never lists a viewer-only tree, an archived node, or another tenant's collection", async () => {
    await make("Viewable", "u2", { visibility: "authenticated" });
    const contributed = await make("Contributed", "u2", { visibility: "selected", grant: ["u1"] });
    const gone = await make("Contributed-gone", "u2", { parent: contributed });
    await collectionRepo.save(archiveCollection(gone));
    const own = await make("Own-gone", "u1");
    const ownChild = await make("Own-gone-1", "u1", { parent: own });
    await collectionRepo.save(archiveCollection(own));
    await collectionRepo.save(archiveCollection(ownChild));
    await make("Elsewhere", "u1", { tenantId: "another-tenant" });

    expect(await ids("u1")).toEqual([["Contributed", false]]);
  });

  // r[verify collections.contributor.on-root-access-list+2]
  it("leaves out a tree the read decision refuses a listed contributor", async () => {
    const gated = await make("Gated", "u2", { visibility: "public", grant: ["u1"] });
    await collectionRepo.save({
      ...gated,
      linkGate: { passwordHash: "scrypt$hash", expiresAt: null, version: 1 },
    });
    const refuseU1: AccessPolicy = { grantsAuthenticatedTier: (viewerId) => viewerId !== "u1" };

    const rows = await listPlaceableCollections("u1", SINGLETON_SCOPE, {
      collectionRepo,
      accessPolicy: refuseU1,
    });
    expect(rows).toEqual([]);
    // The OSS default admits u1, so the gate does not apply and the tree is placeable.
    expect(await ids("u1")).toEqual([["Gated", false]]);
  });

  // r[verify mcp.collections.list-placeable]
  it("is empty for a caller with no collection to place into", async () => {
    await make("Theirs", "u2");
    expect(await ids("u1")).toEqual([]);
  });

  // r[verify mcp.collections.list-shape]
  it("orders own trees by root name, parents before children, siblings by name, with the path and the root's tier", async () => {
    const b = await make("B", "u1", { visibility: "public" });
    const a = await make("A", "u1", { visibility: "authenticated" });
    const a2 = await make("A-z", "u1", { parent: a });
    await make("A-a", "u1", { parent: a });
    await make("A-z-1", "u1", { parent: a2 });
    await make("B-1", "u1", { parent: b });

    const rows = await listPlaceableCollections("u1", SINGLETON_SCOPE, { collectionRepo });
    expect(rows.map((r) => [r.collection.id, r.path, r.visibility])).toEqual([
      ["A", ["A"], "authenticated"],
      ["A-a", ["A", "A-a"], "authenticated"],
      ["A-z", ["A", "A-z"], "authenticated"],
      ["A-z-1", ["A", "A-z", "A-z-1"], "authenticated"],
      ["B", ["B"], "public"],
      ["B-1", ["B", "B-1"], "public"],
    ]);
  });
});
