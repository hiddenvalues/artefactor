import { describe, expect, it } from "vitest";
import { createArtefact, type Artefact } from "./artefact";
import { ArtefactNotFound, InvariantViolation } from "./errors";
import { NO_LINK_GATE, type LinkPasswordHasher } from "./link-gate";
import { applySharing } from "./sharing";

// S55 — Manage access dialog: one draft, saved atomically. `applySharing`
// composes the existing sharing transitions on one aggregate.

const OWNER = "owner-1";
const OTHER = "user-9";
const PAST = new Date("2026-05-01T00:00:00Z");
const NOW = new Date("2026-06-01T12:00:00Z");
const FUTURE = new Date("2026-07-01T00:00:00Z");

const hasher: LinkPasswordHasher = {
  hash: async (pw) => `hashed:${pw}`,
  verify: async (pw, hash) => hash === `hashed:${pw}`,
};

function artefact(overrides: Partial<Artefact> = {}): Artefact {
  return {
    ...createArtefact({
      id: "a1",
      ownerId: OWNER,
      title: "Deck",
      kind: "slide-deck",
      payload: { ref: "r", bytes: 10, hash: "h" },
      now: PAST,
    }),
    ...overrides,
  };
}

const ctx = { now: NOW, newSlug: "fresh-slug", hasher };

describe("applySharing (S55)", () => {
  // r[verify hosting.sharing.members-replace]
  it("shares a private artefact with specific people, minting a slug", async () => {
    const next = await applySharing(artefact(), OWNER, { visibility: "selected", members: ["u1", "u2"] }, ctx);
    expect(next.visibility).toBe("selected");
    expect(next.sharedWith).toEqual(["u1", "u2"]);
    expect(next.publicSlug).toBe("fresh-slug");
    expect(next.updatedAt).toEqual(NOW);
  });

  // r[verify hosting.sharing.atomic-save]
  it("throws on a bad gate and leaves the input aggregate unchanged", async () => {
    const a = artefact();
    const before = structuredClone(a);
    await expect(
      applySharing(a, OWNER, { visibility: "public", linkGate: { password: "short" }, dataVisibility: "shared" }, ctx),
    ).rejects.toThrow(InvariantViolation);
    expect(a).toEqual(before);
  });

  // r[verify hosting.sharing.members-replace]
  // r[verify hosting.access-list.owner-never-member]
  it("refuses an access list that contains the owner", async () => {
    await expect(
      applySharing(artefact(), OWNER, { visibility: "selected", members: ["u1", OWNER] }, ctx),
    ).rejects.toThrow(InvariantViolation);
  });

  // r[verify hosting.sharing.members-replace]
  it("leaves a retained access list unchanged when members are omitted", async () => {
    const a = artefact({ visibility: "public", publicSlug: "s", sharedWith: ["u1", "u2"] });
    const next = await applySharing(a, OWNER, { visibility: "private" }, ctx);
    expect(next.visibility).toBe("private");
    expect(next.sharedWith).toEqual(["u1", "u2"]);
  });

  // r[verify hosting.sharing.members-replace]
  it("empties the list with members: [] and replaces it with exactly the given set", async () => {
    const a = artefact({ visibility: "selected", publicSlug: "s", sharedWith: ["u1", "u2"] });
    expect((await applySharing(a, OWNER, { visibility: "selected", members: [] }, ctx)).sharedWith).toEqual([]);
    expect(
      (await applySharing(a, OWNER, { visibility: "selected", members: ["u2", "u3", "u3"] }, ctx)).sharedWith,
    ).toEqual(["u2", "u3"]);
  });

  // r[verify hosting.link-gate.cleared-leaving-public]
  it("clears the gate and bumps its version when leaving public", async () => {
    const a = artefact({
      visibility: "public",
      publicSlug: "s",
      linkGate: { passwordHash: "hashed:secret-pw", expiresAt: FUTURE, version: 3 },
    });
    const next = await applySharing(a, OWNER, { visibility: "authenticated" }, ctx);
    expect(next.visibility).toBe("authenticated");
    expect(next.linkGate).toEqual({ passwordHash: null, expiresAt: null, version: 4 });
  });

  // r[verify hosting.sharing.applies-in-order]
  it("sets the gate with the change to public, and changes it while public", async () => {
    const made = await applySharing(
      artefact(),
      OWNER,
      { visibility: "public", linkGate: { password: "long-enough", expiresAt: FUTURE } },
      ctx,
    );
    expect(made.linkGate).toEqual({ passwordHash: "hashed:long-enough", expiresAt: FUTURE, version: 1 });
    const cleared = await applySharing(made, OWNER, { visibility: "public", linkGate: { password: null } }, ctx);
    expect(cleared.linkGate).toEqual({ passwordHash: null, expiresAt: FUTURE, version: 2 });
  });

  // r[verify hosting.sharing.applies-in-order]
  it("applies a tier, its gate, an access list and data visibility from one private artefact at once", async () => {
    const next = await applySharing(
      artefact(),
      OWNER,
      {
        visibility: "public",
        linkGate: { password: "long-enough" },
        members: [OTHER],
        dataVisibility: "shared",
      },
      ctx,
    );
    expect(next.visibility).toBe("public");
    expect(next.publicSlug).toBe("fresh-slug");
    expect(next.linkGate.passwordHash).toBe("hashed:long-enough");
    expect(next.sharedWith).toEqual([OTHER]);
    expect(next.dataVisibility).toBe("shared");
  });

  it("sets data visibility", async () => {
    const next = await applySharing(artefact(), OWNER, { visibility: "private", dataVisibility: "shared" }, ctx);
    expect(next.dataVisibility).toBe("shared");
    expect(next.linkGate).toEqual(NO_LINK_GATE);
  });

  // r[verify hosting.link-gate.public-only]
  it("refuses a link gate with any tier but public", async () => {
    await expect(
      applySharing(artefact(), OWNER, { visibility: "authenticated", linkGate: { expiresAt: FUTURE } }, ctx),
    ).rejects.toThrow(InvariantViolation);
  });

  // r[verify hosting.access.dormant-tier-frozen]
  it("refuses a tier change on a contained artefact", async () => {
    const a = artefact({ collectionId: "c1" });
    await expect(applySharing(a, OWNER, { visibility: "public" }, ctx)).rejects.toThrow(InvariantViolation);
  });

  // r[verify hosting.lifecycle.archived-frozen]
  it("refuses an archived artefact", async () => {
    const a = artefact({ status: "archived", archivedAt: PAST });
    await expect(applySharing(a, OWNER, { visibility: "private", dataVisibility: "shared" }, ctx)).rejects.toThrow(
      InvariantViolation,
    );
  });

  // r[verify hosting.access.no-existence-leak]
  // r[verify hosting.authority.owner-only]
  it("refuses a non-owner as not found", async () => {
    await expect(applySharing(artefact(), OTHER, { visibility: "public" }, ctx)).rejects.toThrow(ArtefactNotFound);
  });
});
