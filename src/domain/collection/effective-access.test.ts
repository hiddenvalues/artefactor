import { describe, expect, it } from "vitest";
import { createArtefact, type Artefact } from "../artefact/artefact";
import { canViewArtefact } from "../artefact/access";
import { createCollection, type Collection } from "./collection";
import { effectiveViewable, effectiveVisibility } from "./effective-access";
import { moveArtefactToCollection } from "./move-artefact";
import { collectSubtree, chainToRoot } from "./tree";
import { CollectionInvariantViolation } from "./errors";
import { InvariantViolation } from "../artefact/errors";

const OWNER = "owner-1";

function makeArtefact(over: Partial<Artefact> = {}): Artefact {
  return {
    ...createArtefact({
      id: "a1",
      ownerId: OWNER,
      title: "Demo",
      kind: "prototype",
      payload: { ref: "r", bytes: 10, hash: "h" },
    }),
    ...over,
  };
}

function makeRoot(over: Partial<Collection> = {}): Collection {
  return {
    ...createCollection({ id: "c1", ownerId: OWNER, name: "Product" }),
    ...over,
  };
}

describe("effectiveViewable (CL5/AH20) feeding the unchanged access matrix", () => {
  it("a top-level artefact is governed by its own tier", () => {
    const a = makeArtefact({ visibility: "public" });
    expect(canViewArtefact(effectiveViewable(a, null), null)).toBe(true);
  });

  it("a private artefact in an authenticated tree is viewable by any signed-in user", () => {
    const root = makeRoot({ visibility: "authenticated" });
    const a = makeArtefact({ collectionId: root.id }); // own tier: private
    const eff = effectiveViewable(a, root);
    expect(canViewArtefact(eff, "someone-else")).toBe(true);
    expect(canViewArtefact(eff, null)).toBe(false);
    expect(effectiveVisibility(a, root)).toBe("authenticated");
  });

  it("an own-tier public artefact in a private tree is NOT viewable by others (dormancy)", () => {
    const root = makeRoot({ visibility: "private" });
    const a = makeArtefact({
      visibility: "public",
      publicSlug: "slug",
      collectionId: root.id,
    });
    const eff = effectiveViewable(a, root);
    expect(canViewArtefact(eff, "someone-else")).toBe(false);
    expect(canViewArtefact(eff, null)).toBe(false);
    expect(canViewArtefact(eff, OWNER)).toBe(true); // the owner always may
  });

  it("a selected tree grants exactly the root's members", () => {
    const root = makeRoot({ visibility: "selected", sharedWith: ["friend"] });
    const a = makeArtefact({ sharedWith: ["stranger"], collectionId: root.id });
    const eff = effectiveViewable(a, root);
    expect(canViewArtefact(eff, "friend")).toBe(true);
    // The artefact's own dormant list does not leak through (CL5).
    expect(canViewArtefact(eff, "stranger")).toBe(false);
  });

  it("the artefact's own archived status stays authoritative", () => {
    const root = makeRoot({ visibility: "public" });
    const a = makeArtefact({ status: "archived", collectionId: root.id });
    expect(canViewArtefact(effectiveViewable(a, root), null)).toBe(false); // AH7
  });

  it("an archived root renders the whole tree inert, even for an active artefact", () => {
    const root = makeRoot({ visibility: "public", status: "archived" });
    const a = makeArtefact({ collectionId: root.id }); // active, out of step
    expect(canViewArtefact(effectiveViewable(a, root), "anyone")).toBe(false);
  });
});

describe("moveArtefactToCollection (CL1/CL7)", () => {
  it("sets collectionId, leaving the own tier dormant but intact", () => {
    const root = makeRoot();
    const a = makeArtefact({ visibility: "authenticated", publicSlug: "s" });
    const moved = moveArtefactToCollection(a, root);
    expect(moved.collectionId).toBe(root.id);
    expect(moved.visibility).toBe("authenticated"); // dormant, retained
    expect(moved.publicSlug).toBe("s");
    const back = moveArtefactToCollection(moved, null);
    expect(back.collectionId).toBeNull(); // own tier resurfaces (CL5)
  });

  it("is a no-op when the target equals the current collection", () => {
    const a = makeArtefact();
    expect(moveArtefactToCollection(a, null)).toBe(a);
  });

  it("rejects cross-owner, cross-tenant, archived targets, and archived artefacts", () => {
    expect(() =>
      moveArtefactToCollection(makeArtefact(), makeRoot({ ownerId: "other" })),
    ).toThrow(CollectionInvariantViolation);
    expect(() =>
      moveArtefactToCollection(makeArtefact(), makeRoot({ tenantId: "acme" })),
    ).toThrow(CollectionInvariantViolation);
    expect(() =>
      moveArtefactToCollection(makeArtefact(), makeRoot({ status: "archived" })),
    ).toThrow(CollectionInvariantViolation);
    expect(() =>
      moveArtefactToCollection(makeArtefact({ status: "archived" }), makeRoot()),
    ).toThrow(InvariantViolation);
  });
});

describe("tree helpers", () => {
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
  const sibling = createCollection({
    id: "c4",
    ownerId: OWNER,
    name: "Archive-me",
    parent: root,
  });
  const all = [root, child, grandchild, sibling];

  it("collectSubtree returns the node plus every descendant, parents first", () => {
    expect(collectSubtree(all, root.id).map((c) => c.id)).toEqual([
      "c1",
      "c2",
      "c4",
      "c3",
    ]);
    expect(collectSubtree(all, child.id).map((c) => c.id)).toEqual(["c2", "c3"]);
    expect(collectSubtree(all, "missing")).toEqual([]);
  });

  it("chainToRoot walks nearest-first up to the root", () => {
    expect(chainToRoot(all, grandchild.id).map((c) => c.id)).toEqual([
      "c3",
      "c2",
      "c1",
    ]);
  });
});
