import { describe, expect, it } from "vitest";
import { publicCollectionId } from "./public-collection";
import type { CollectionSummary } from "../../shared/contracts";

// S44 — which collection shows the "Public collection id" row in its access
// popover: a public root that has a slug, and nothing else.

function summary(over: Partial<CollectionSummary> = {}): CollectionSummary {
  return {
    id: "c1",
    ownerId: "u1",
    name: "Landing page",
    description: null,
    parentId: null,
    rootId: "c1",
    visibility: "public",
    status: "active",
    publicSlug: "Ab3dE6gH9jK",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

describe("publicCollectionId (S44)", () => {
  it("is the slug of a public root", () => {
    expect(publicCollectionId(summary())).toBe("Ab3dE6gH9jK");
  });

  it("is null for a non-public root, even one that keeps its slug", () => {
    for (const visibility of ["private", "selected", "authenticated"] as const) {
      expect(publicCollectionId(summary({ visibility }))).toBeNull();
    }
  });

  it("is null for a non-root and for a root without a slug", () => {
    expect(publicCollectionId(summary({ id: "c2", parentId: "c1" }))).toBeNull();
    expect(publicCollectionId(summary({ publicSlug: null }))).toBeNull();
    expect(publicCollectionId(summary({ publicSlug: undefined }))).toBeNull();
  });
});
