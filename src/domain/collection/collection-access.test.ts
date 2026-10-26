import { describe, expect, it } from "vitest";
import { createCollection, type Collection } from "./collection";
import { authorizeCollectionRead, canContributeToTree } from "./collection-access";
import { defaultAccessPolicy, type AccessPolicy } from "../artefact/access";
import type { LinkGate, LinkPass } from "../artefact/link-gate";
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

// A policy that refuses OUTSIDER the `authenticated` tier (a viewer outside the
// root's tenant in a multi-tenant superset); everyone else holds it.
const OUTSIDER = "outsider-4";
const refusing: AccessPolicy = {
  grantsAuthenticatedTier: (viewerId) => viewerId !== OUTSIDER,
};
const NOW = new Date("2026-10-25T12:00:00Z");
const gated = (over: Partial<LinkGate> = {}): LinkGate => ({
  passwordHash: "scrypt$hash",
  expiresAt: null,
  version: 3,
  ...over,
});

function read(
  r: Collection,
  viewerId: string | null,
  pass: LinkPass | null = null,
  policy: AccessPolicy = refusing,
): Promise<boolean> {
  return authorizeCollectionRead({ root: r, viewerId, pass, now: NOW }, policy);
}

describe("authorizeCollectionRead (S28)", () => {
  // r[verify collections.read.follows-root+2]
  it("is signed-in only — even a public root denies anonymous", async () => {
    expect(await read(root({ visibility: "public" }), null)).toBe(false);
  });

  // r[verify collections.read.follows-root+2]
  it("asks the policy for the authenticated tier", async () => {
    const auth = root({ visibility: "authenticated" });
    expect(await read(auth, OUTSIDER)).toBe(false);
    expect(await read(auth, OTHER, null, defaultAccessPolicy)).toBe(true);
  });

  // r[verify collections.read.follows-root+2]
  it("an ungated public root admits a viewer the policy refuses", async () => {
    expect(await read(root({ visibility: "public" }), OUTSIDER)).toBe(true);
  });

  // r[verify collections.read.follows-root+2]
  it("a password-gated public root admits the public cell's audience only with a current pass", async () => {
    const r = root({ visibility: "public", linkGate: gated() });
    expect(await read(r, OUTSIDER)).toBe(false);
    expect(await read(r, OUTSIDER, { version: 3 })).toBe(true);
    expect(await read(r, OUTSIDER, { version: 2 })).toBe(false);
  });

  // r[verify collections.read.follows-root+2]
  it("an expired public root refuses the public cell's audience, even with a valid pass", async () => {
    const r = root({
      visibility: "public",
      linkGate: gated({ expiresAt: new Date("2026-10-01T00:00:00Z") }),
    });
    expect(await read(r, OUTSIDER, { version: 3 })).toBe(false);
  });

  // r[verify collections.read.follows-root+2]
  it("never gates the owner or a viewer the policy admits", async () => {
    const r = root({ visibility: "public", linkGate: gated() });
    expect(await read(r, OWNER)).toBe(true);
    expect(await read(r, OTHER)).toBe(true);
  });

  // r[verify collections.read.follows-root+2]
  it("follows the matrix for selected and private roots", async () => {
    const sel = root({ visibility: "selected", sharedWith: [MEMBER] });
    expect(await read(sel, MEMBER)).toBe(true);
    expect(await read(sel, OTHER)).toBe(false);
    expect(await read(root(), OWNER)).toBe(true);
    expect(await read(root(), OTHER)).toBe(false);
    // A private root's retained access list grants its members nothing.
    expect(await read(root({ sharedWith: [MEMBER] }), MEMBER)).toBe(false);
  });

  // r[verify collections.read.follows-root+2]
  it("an archived root grants no one, owner included", async () => {
    const archived = root({ visibility: "public", status: "archived" });
    expect(await read(archived, OWNER)).toBe(false);
    expect(await read(archived, OTHER)).toBe(false);
  });
});

describe("canContributeToTree (S29)", () => {
  // r[verify collections.contributor.on-root-access-list+2]
  it("grants the owner and listed members the read decision grants", () => {
    const shared = root({ visibility: "authenticated", sharedWith: [MEMBER] });
    expect(canContributeToTree(shared, OWNER, true)).toBe(true);
    expect(canContributeToTree(shared, MEMBER, true)).toBe(true);
    // Any signed-in user can READ an authenticated root — but only listed
    // members contribute (no drive-by additions).
    expect(canContributeToTree(shared, OTHER, true)).toBe(false);
  });

  // r[verify collections.contributor.on-root-access-list+2]
  it("a listed member the read decision refuses cannot contribute", () => {
    const shared = root({ visibility: "authenticated", sharedWith: [MEMBER] });
    expect(canContributeToTree(shared, MEMBER, false)).toBe(false);
  });

  // r[verify collections.contributor.on-root-access-list+2]
  it("denies anonymous", () => {
    expect(canContributeToTree(root({ visibility: "public" }), null, true)).toBe(false);
  });
});

describe("evictFromCollection", () => {
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
