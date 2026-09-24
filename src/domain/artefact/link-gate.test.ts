import { describe, expect, it } from "vitest";
import {
  archiveArtefact,
  createArtefact,
  shareArtefact,
  unshareArtefact,
  type Artefact,
} from "./artefact";
import { defaultAccessPolicy, type AccessPolicy } from "./access";
import { ArtefactNotFound, InvariantViolation } from "./errors";
import {
  NO_LINK_GATE,
  authorizeArtefactRead,
  clearArtefactLinkGate,
  evaluateLinkGate,
  setArtefactLinkGate,
  type LinkGate,
  type LinkPasswordHasher,
} from "./link-gate";

// S32a — Link controls on public artefacts: password + expiry (AH22–AH24, AH31).

const OWNER = "owner-1";
const OTHER = "user-2";
const NOW = new Date("2026-06-01T12:00:00Z");
const PAST = new Date("2026-05-01T00:00:00Z");
const FUTURE = new Date("2026-07-01T00:00:00Z");

// A transparent test hasher: the domain only needs hash/verify to agree.
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

const publicArtefact = (overrides: Partial<Artefact> = {}) =>
  artefact({ visibility: "public", publicSlug: "slug1", ...overrides });

function gate(overrides: Partial<LinkGate> = {}): LinkGate {
  return { ...NO_LINK_GATE, ...overrides };
}

describe("createArtefact — link gate (S32a)", () => {
  it("starts with no gate at version 0", () => {
    expect(artefact().linkGate).toEqual({ passwordHash: null, expiresAt: null, version: 0 });
  });
});

describe("evaluateLinkGate (AH22/AH23)", () => {
  it("is open with no gate", () => {
    expect(evaluateLinkGate(NO_LINK_GATE, NOW, null)).toBe("open");
  });

  it("is open with a future expiry and no password", () => {
    expect(evaluateLinkGate(gate({ expiresAt: FUTURE }), NOW, null)).toBe("open");
  });

  it("is expired past the expiry, even with a valid pass", () => {
    const g = gate({ expiresAt: PAST, passwordHash: "x", version: 3 });
    expect(evaluateLinkGate(g, NOW, { version: 3 })).toBe("expired");
    expect(evaluateLinkGate(gate({ expiresAt: PAST }), NOW, null)).toBe("expired");
  });

  it("is expired exactly at the expiry instant", () => {
    expect(evaluateLinkGate(gate({ expiresAt: NOW }), NOW, null)).toBe("expired");
  });

  it("challenges a password gate without a pass", () => {
    expect(evaluateLinkGate(gate({ passwordHash: "x", version: 1 }), NOW, null)).toBe(
      "challenge",
    );
  });

  it("opens with a pass at the current version", () => {
    expect(
      evaluateLinkGate(gate({ passwordHash: "x", version: 2 }), NOW, { version: 2 }),
    ).toBe("open");
  });

  it("challenges a pass with a stale version", () => {
    expect(
      evaluateLinkGate(gate({ passwordHash: "x", version: 2 }), NOW, { version: 1 }),
    ).toBe("challenge");
  });
});

describe("setArtefactLinkGate (AH31)", () => {
  it("sets a password (hashed) and bumps the version and updatedAt", async () => {
    const a = await setArtefactLinkGate(
      publicArtefact(),
      { requesterId: OWNER, password: "correct-horse", now: NOW },
      hasher,
    );
    expect(a.linkGate).toEqual({ passwordHash: "hashed:correct-horse", expiresAt: null, version: 1 });
    expect(a.updatedAt).toEqual(NOW);
    expect(a.visibility).toBe("public");
  });

  it("changing the password bumps the version again", async () => {
    const a = await setArtefactLinkGate(
      publicArtefact({ linkGate: gate({ passwordHash: "hashed:one-two-three", version: 4 }) }),
      { requesterId: OWNER, password: "four-five-six", now: NOW },
      hasher,
    );
    expect(a.linkGate.version).toBe(5);
    expect(a.linkGate.passwordHash).toBe("hashed:four-five-six");
  });

  it("clearing the password (null) bumps the version", async () => {
    const a = await setArtefactLinkGate(
      publicArtefact({ linkGate: gate({ passwordHash: "hashed:x", version: 4, expiresAt: FUTURE }) }),
      { requesterId: OWNER, password: null, now: NOW },
      hasher,
    );
    expect(a.linkGate).toEqual({ passwordHash: null, expiresAt: FUTURE, version: 5 });
  });

  it("an expiry-only change keeps the version and the password", async () => {
    const a = await setArtefactLinkGate(
      publicArtefact({ linkGate: gate({ passwordHash: "hashed:x", version: 4 }) }),
      { requesterId: OWNER, expiresAt: FUTURE, now: NOW },
      hasher,
    );
    expect(a.linkGate).toEqual({ passwordHash: "hashed:x", expiresAt: FUTURE, version: 4 });
  });

  it("clears the expiry with null", async () => {
    const a = await setArtefactLinkGate(
      publicArtefact({ linkGate: gate({ expiresAt: FUTURE }) }),
      { requesterId: OWNER, expiresAt: null, now: NOW },
      hasher,
    );
    expect(a.linkGate.expiresAt).toBeNull();
  });

  it("refuses a non-owner as not found (AH8/AH9)", async () => {
    await expect(
      setArtefactLinkGate(publicArtefact(), { requesterId: OTHER, password: "long-enough", now: NOW }, hasher),
    ).rejects.toBeInstanceOf(ArtefactNotFound);
  });

  it.each(["private", "selected", "authenticated"] as const)(
    "refuses a %s artefact",
    async (visibility) => {
      await expect(
        setArtefactLinkGate(
          artefact({ visibility, publicSlug: "s" }),
          { requesterId: OWNER, password: "long-enough", now: NOW },
          hasher,
        ),
      ).rejects.toBeInstanceOf(InvariantViolation);
    },
  );

  it("refuses an archived artefact (AH7)", async () => {
    await expect(
      setArtefactLinkGate(
        archiveArtefact(publicArtefact()),
        { requesterId: OWNER, password: "long-enough", now: NOW },
        hasher,
      ),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });

  it("refuses a contained artefact (AH20)", async () => {
    await expect(
      setArtefactLinkGate(
        publicArtefact({ collectionId: "c1" }),
        { requesterId: OWNER, password: "long-enough", now: NOW },
        hasher,
      ),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });

  it("refuses a 7-character password and one over 128", async () => {
    for (const password of ["1234567", "x".repeat(129)]) {
      await expect(
        setArtefactLinkGate(publicArtefact(), { requesterId: OWNER, password, now: NOW }, hasher),
      ).rejects.toBeInstanceOf(InvariantViolation);
    }
  });

  it("accepts an 8- and a 128-character password", async () => {
    for (const password of ["12345678", "x".repeat(128)]) {
      const a = await setArtefactLinkGate(
        publicArtefact(),
        { requesterId: OWNER, password, now: NOW },
        hasher,
      );
      expect(a.linkGate.passwordHash).toBe(`hashed:${password}`);
    }
  });

  it("refuses a past or present expiry (AH23)", async () => {
    for (const expiresAt of [PAST, NOW]) {
      await expect(
        setArtefactLinkGate(publicArtefact(), { requesterId: OWNER, expiresAt, now: NOW }, hasher),
      ).rejects.toBeInstanceOf(InvariantViolation);
    }
  });
});

describe("clearArtefactLinkGate (AH31)", () => {
  it("clears both halves and bumps the version", () => {
    const a = clearArtefactLinkGate(
      publicArtefact({ linkGate: gate({ passwordHash: "h", expiresAt: FUTURE, version: 2 }) }),
      { requesterId: OWNER, now: NOW },
    );
    expect(a.linkGate).toEqual({ passwordHash: null, expiresAt: null, version: 3 });
    expect(a.visibility).toBe("public");
  });

  it("refuses a non-owner as not found", () => {
    expect(() =>
      clearArtefactLinkGate(publicArtefact(), { requesterId: OTHER, now: NOW }),
    ).toThrow(ArtefactNotFound);
  });

  it("refuses an archived artefact", () => {
    expect(() =>
      clearArtefactLinkGate(archiveArtefact(publicArtefact()), { requesterId: OWNER, now: NOW }),
    ).toThrow(InvariantViolation);
  });
});

describe("tier changes and the gate (AH31)", () => {
  const gated = () =>
    publicArtefact({ linkGate: gate({ passwordHash: "h", expiresAt: FUTURE, version: 2 }) });

  it("public → authenticated clears the gate and bumps the version", () => {
    const a = shareArtefact(gated(), { tier: "authenticated", now: NOW });
    expect(a.linkGate).toEqual({ passwordHash: null, expiresAt: null, version: 3 });
  });

  it("public → private clears the gate and bumps the version", () => {
    const a = unshareArtefact(gated(), { now: NOW });
    expect(a.linkGate).toEqual({ passwordHash: null, expiresAt: null, version: 3 });
    expect(a.publicSlug).toBe("slug1");
  });

  it("public → public keeps the gate", () => {
    const a = shareArtefact(gated(), { tier: "public", now: NOW });
    expect(a.linkGate).toEqual(gated().linkGate);
  });

  it("a change between non-public tiers leaves the gate alone", () => {
    const a = shareArtefact(artefact({ visibility: "selected", publicSlug: "s" }), {
      tier: "authenticated",
      now: NOW,
    });
    expect(a.linkGate).toEqual(NO_LINK_GATE);
  });
});

describe("authorizeArtefactRead (AH22–AH24)", () => {
  const refuseAuthenticatedTier: AccessPolicy = { grantsAuthenticatedTier: () => false };

  async function read(
    a: Artefact,
    viewerId: string | null,
    opts: { pass?: { version: number } | null; policy?: AccessPolicy; effective?: Artefact } = {},
  ) {
    return authorizeArtefactRead(
      { artefact: a, effective: opts.effective ?? a, viewerId, pass: opts.pass ?? null, now: NOW },
      opts.policy ?? defaultAccessPolicy,
    );
  }

  const passworded = () => publicArtefact({ linkGate: gate({ passwordHash: "h", version: 1 }) });
  const expired = () => publicArtefact({ linkGate: gate({ expiresAt: PAST }) });

  it("denies what the matrix denies before any gate (AH24)", async () => {
    const hidden = artefact({ visibility: "private", linkGate: gate({ passwordHash: "h", version: 1 }) });
    expect(await read(hidden, null)).toBe("sign-in");
    expect(await read(hidden, OTHER)).toBe("not-found");
  });

  it("never gates the owner", async () => {
    expect(await read(passworded(), OWNER)).toBe("granted");
    expect(await read(expired(), OWNER)).toBe("granted");
  });

  it("challenges the anonymous on a password gate and grants them with a current pass", async () => {
    expect(await read(passworded(), null)).toBe("challenge");
    expect(await read(passworded(), null, { pass: { version: 1 } })).toBe("granted");
    expect(await read(passworded(), null, { pass: { version: 0 } })).toBe("challenge");
  });

  it("treats an expired gate as private for the anonymous (sign-in)", async () => {
    expect(await read(expired(), null)).toBe("sign-in");
  });

  it("OSS: a signed-in non-owner is admitted by the authenticated tier and never gated", async () => {
    expect(await read(passworded(), OTHER)).toBe("granted");
    expect(await read(expired(), OTHER)).toBe("granted");
  });

  it("a signed-in user the policy refuses the authenticated tier is gated", async () => {
    expect(await read(passworded(), OTHER, { policy: refuseAuthenticatedTier })).toBe("challenge");
    expect(await read(expired(), OTHER, { policy: refuseAuthenticatedTier })).toBe("not-found");
  });

  it("a contained artefact's own gate is dormant (AH20)", async () => {
    const contained = passworded();
    contained.collectionId = "c1";
    // Effective access from a public root (S32b adds the root's own gate).
    expect(await read(contained, null, { effective: publicArtefact() })).toBe("granted");
  });

  it("a gate is consulted only when the effective tier is public", async () => {
    // A stale gate on a non-public row is never consulted.
    const authed = artefact({ visibility: "authenticated", publicSlug: "s", linkGate: gate({ expiresAt: PAST }) });
    expect(await read(authed, OTHER)).toBe("granted");
  });
});
