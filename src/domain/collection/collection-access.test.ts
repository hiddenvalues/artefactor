import { describe, expect, it } from "vitest";
import { createCollection, type Collection } from "./collection";
import { canContributeToTree, canViewCollection } from "./collection-access";
import { evictFromCollection } from "./move-artefact";
import { createArtefact } from "../artefact/artefact";

const OWNER = "owner-1";
const MEMBER = "member-2";
const OTHER = "other-3";

function root(over: Partial<Collection> = {}): Collection {
  return {
    ...createCollection({ id: "c1", ownerId: OWNER, name: "Product" }),
    ...over,
  };
}

describe("canViewCollection (S28, CL11)", () => {
  it("is signed-in only — even a public root denies anonymous", () => {
    expect(canViewCollection(root({ visibility: "public" }), null)).toBe(false);
    expect(canViewCollection(root({ visibility: "public" }), OTHER)).toBe(true);
  });

  it("follows the matrix per tier", () => {
    expect(canViewCollection(root(), OWNER)).toBe(true);
    expect(canViewCollection(root(), OTHER)).toBe(false); // private
    const sel = root({ visibility: "selected", sharedWith: [MEMBER] });
    expect(canViewCollection(sel, MEMBER)).toBe(true);
    expect(canViewCollection(sel, OTHER)).toBe(false);
    expect(canViewCollection(root({ visibility: "authenticated" }), OTHER)).toBe(true);
  });

  it("an archived root grants no one, owner included", () => {
    const archived = root({ visibility: "public", status: "archived" });
    expect(canViewCollection(archived, OWNER)).toBe(false);
    expect(canViewCollection(archived, OTHER)).toBe(false);
  });
});

describe("canContributeToTree (S29, CL12)", () => {
  it("grants the owner and listed members who can view", () => {
    const shared = root({ visibility: "authenticated", sharedWith: [MEMBER] });
    expect(canContributeToTree(shared, OWNER)).toBe(true);
    expect(canContributeToTree(shared, MEMBER)).toBe(true);
    // Any signed-in user can VIEW an authenticated root — but only listed
    // members contribute (no drive-by additions).
    expect(canContributeToTree(shared, OTHER)).toBe(false);
  });

  it("a private root's list grants nothing (members cannot even view)", () => {
    const priv = root({ visibility: "private", sharedWith: [MEMBER] });
    expect(canContributeToTree(priv, MEMBER)).toBe(false);
    expect(canContributeToTree(priv, OWNER)).toBe(true);
  });

  it("denies anonymous", () => {
    expect(canContributeToTree(root({ visibility: "public" }), null)).toBe(false);
  });
});

describe("evictFromCollection (CL13/CL14)", () => {
  const artefact = createArtefact({
    id: "a1",
    ownerId: MEMBER,
    title: "Demo",
    kind: "prototype",
    payload: { ref: "r", bytes: 10, hash: "h" },
  });

  it("clears containment, even on an archived artefact", () => {
    const contained = {
      ...artefact,
      collectionId: "c1",
      status: "archived" as const,
      archivedAt: new Date(),
    };
    const evicted = evictFromCollection(contained);
    expect(evicted.collectionId).toBeNull();
    expect(evicted.status).toBe("archived"); // untouched otherwise
    expect(evicted.visibility).toBe("private"); // dormant own tier intact
  });

  it("is a no-op at top level", () => {
    expect(evictFromCollection(artefact)).toBe(artefact);
  });
});
