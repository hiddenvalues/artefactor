import { describe, expect, it } from "vitest";
import { createArtefact, type Artefact } from "../artefact/artefact";
import { defaultAccessPolicy } from "../artefact/access";
import {
  NO_LINK_GATE,
  authorizeArtefactRead,
  type LinkGate,
  type LinkPasswordHasher,
} from "../artefact/link-gate";
import { createCollection, setCollectionAccess, type Collection } from "./collection";
import { effectiveLinkGate, effectiveViewable } from "./effective-access";
import { CollectionInvariantViolation, CollectionNotFound } from "./errors";
import { clearCollectionLinkGate, setCollectionLinkGate } from "./link-gate";

// S32b — Link controls on public collections: password + expiry.

const OWNER = "owner-1";
const OTHER = "user-2";
const NOW = new Date("2026-06-01T12:00:00Z");
const PAST = new Date("2026-05-01T00:00:00Z");
const FUTURE = new Date("2026-07-01T00:00:00Z");

const hasher: LinkPasswordHasher = {
  hash: async (pw) => `hashed:${pw}`,
  verify: async (pw, hash) => hash === `hashed:${pw}`,
};

function root(over: Partial<Collection> = {}): Collection {
  return {
    ...createCollection({ id: "c1", ownerId: OWNER, name: "Product", visibility: "public", now: PAST }),
    ...over,
  };
}

function child(parent: Collection): Collection {
  return createCollection({ id: "c2", ownerId: OWNER, name: "Sub", parent, now: PAST });
}

function artefact(over: Partial<Artefact> = {}): Artefact {
  return {
    ...createArtefact({
      id: "a1",
      ownerId: OWNER,
      title: "Deck",
      kind: "slide-deck",
      payload: { ref: "r", bytes: 10, hash: "h" },
      now: PAST,
    }),
    ...over,
  };
}

const gate = (over: Partial<LinkGate> = {}): LinkGate => ({ ...NO_LINK_GATE, ...over });

describe("createCollection — link gate (S32b)", () => {
  it("starts with no gate at version 0", () => {
    expect(root().linkGate).toEqual({ passwordHash: null, expiresAt: null, version: 0 });
  });
});

describe("setCollectionLinkGate / clearCollectionLinkGate", () => {
  const set = (c: Collection, input: { password?: string | null; expiresAt?: Date | null; requesterId?: string }) =>
    setCollectionLinkGate(c, { requesterId: input.requesterId ?? OWNER, now: NOW, ...input }, hasher);

  // r[verify collections.link-gate.public-root-only]
  it("refuses a nested collection, a non-public root and an archived root", async () => {
    await expect(set(child(root()), { password: "longenough" })).rejects.toThrow(CollectionInvariantViolation);
    await expect(set(root({ visibility: "selected" }), { password: "longenough" })).rejects.toThrow(
      CollectionInvariantViolation,
    );
    await expect(set(root({ status: "archived", archivedAt: PAST }), { password: "longenough" })).rejects.toThrow(
      CollectionInvariantViolation,
    );
    expect(() => clearCollectionLinkGate(child(root()), { requesterId: OWNER, now: NOW })).toThrow(
      CollectionInvariantViolation,
    );
  });

  // r[verify collections.link-gate.public-root-only]
  it("refuses a non-owner as not found", async () => {
    await expect(set(root(), { password: "longenough", requesterId: OTHER })).rejects.toThrow(CollectionNotFound);
    expect(() => clearCollectionLinkGate(root(), { requesterId: OTHER, now: NOW })).toThrow(CollectionNotFound);
  });

  // r[verify collections.link-gate.public-root-only]
  it("refuses a 7-character password and a past expiry", async () => {
    await expect(set(root(), { password: "1234567" })).rejects.toThrow(CollectionInvariantViolation);
    await expect(set(root(), { expiresAt: PAST })).rejects.toThrow(CollectionInvariantViolation);
  });

  // r[verify collections.link-gate.public-root-only]
  it("a password set bumps the version, an expiry-only change does not, a clear does; the tier never moves", async () => {
    const withPw = await set(root(), { password: "longenough" });
    expect(withPw.linkGate).toEqual({ passwordHash: "hashed:longenough", expiresAt: null, version: 1 });
    const withExpiry = await set(withPw, { expiresAt: FUTURE });
    expect(withExpiry.linkGate).toEqual({ passwordHash: "hashed:longenough", expiresAt: FUTURE, version: 1 });
    const cleared = clearCollectionLinkGate(withExpiry, { requesterId: OWNER, now: NOW });
    expect(cleared.linkGate).toEqual({ passwordHash: null, expiresAt: null, version: 2 });
    for (const c of [withPw, withExpiry, cleared]) expect(c.visibility).toBe("public");
  });
});

describe("setCollectionAccess — leaving public (S32b)", () => {
  const gated = () => root({ linkGate: gate({ passwordHash: "h", expiresAt: FUTURE, version: 3 }) });

  // r[verify collections.link-gate.cleared-leaving-public]
  it("public → selected clears the gate and bumps its version", () => {
    expect(setCollectionAccess(gated(), "selected", { now: NOW }).linkGate).toEqual({
      passwordHash: null,
      expiresAt: null,
      version: 4,
    });
  });

  // r[verify collections.link-gate.cleared-leaving-public]
  it("public → public keeps the gate", () => {
    expect(setCollectionAccess(gated(), "public", { now: NOW }).linkGate).toEqual(gated().linkGate);
  });
});

describe("effectiveLinkGate", () => {
  const own = gate({ passwordHash: "own", version: 5 });
  const rootGate = gate({ passwordHash: "root", version: 2 });

  // r[verify collections.link-gate.root-governs-tree]
  it("a top-level artefact holds its own gate", () => {
    expect(effectiveLinkGate(artefact({ linkGate: own }), null)).toEqual({ holderId: "a1", gate: own });
  });

  // r[verify collections.link-gate.root-governs-tree]
  it("a contained artefact follows its root's gate; its own retained gate is dormant", () => {
    const r = root({ linkGate: rootGate });
    const contained = artefact({ collectionId: "c2", linkGate: own });
    expect(effectiveLinkGate(contained, r)).toEqual({ holderId: "c1", gate: rootGate });
  });

  // r[verify collections.link-gate.root-governs-tree]
  it("after eviction to top level the artefact's own gate applies again", () => {
    const evicted = artefact({ collectionId: null, linkGate: own });
    expect(effectiveLinkGate(evicted, null)).toEqual({ holderId: "a1", gate: own });
  });
});

describe("authorizeArtefactRead under a gated root (S32b)", () => {
  const r = root({ linkGate: gate({ passwordHash: "root", version: 2 }) });
  const contained = artefact({ collectionId: "c1", visibility: "private" });
  const read = (viewerId: string | null, pass: { version: number } | null, tree: Collection = r) =>
    authorizeArtefactRead(
      {
        artefact: contained,
        effective: effectiveViewable(contained, tree),
        gate: effectiveLinkGate(contained, tree).gate,
        viewerId,
        pass,
        now: NOW,
      },
      defaultAccessPolicy,
    );

  // r[verify collections.link-gate.root-governs-tree]
  it("challenges the anonymous, admits them with the root's current pass, never gates the owner", async () => {
    expect(await read(null, null)).toBe("challenge");
    expect(await read(null, { version: 2 })).toBe("granted");
    expect(await read(null, { version: 1 })).toBe("challenge");
    expect(await read(OWNER, null)).toBe("granted");
  });

  // r[verify collections.link-gate.root-governs-tree]
  it("an expired root is private to the anonymous", async () => {
    const expired = root({ linkGate: gate({ expiresAt: PAST }) });
    expect(await read(null, null, expired)).toBe("sign-in");
  });
});
