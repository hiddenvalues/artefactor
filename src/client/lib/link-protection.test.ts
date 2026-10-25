import { describe, expect, it, vi } from "vitest";
import {
  UNAMBIGUOUS_ALPHABET,
  copyText,
  expiryTimerDelay,
  emptyForm,
  enablePassword,
  expiryFor,
  formFor,
  generatePassword,
  gateChange,
  inheritedLinkGate,
  linkGateOnPublish,
} from "./link-protection";
import type { CollectionSummary } from "../../shared/contracts";

// S32a — the client's link-protection logic: the generated password, the copy
// button, and what the form submits.

const NOW = new Date("2026-06-01T12:00:00.000Z");

describe("inheritedLinkGate (S32b)", () => {
  const coll = (over: Partial<CollectionSummary>): CollectionSummary => ({
    id: "c-root",
    ownerId: "u",
    name: "Tree",
    description: null,
    parentId: null,
    rootId: "c-root",
    visibility: "public",
    status: "active",
    linkGate: { passwordProtected: true, expiresAt: null },
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...over,
  });
  const root = coll({});
  const child = coll({ id: "c-child", name: "Sub", parentId: "c-root", linkGate: null });
  const byId = new Map([root, child].map((c) => [c.id, c]));

  it("is the root's gate and name, for an artefact directly in the root or deeper", () => {
    const expected = { rootName: "Tree", gate: { passwordProtected: true, expiresAt: null } };
    expect(inheritedLinkGate("c-root", byId)).toEqual(expected);
    expect(inheritedLinkGate("c-child", byId)).toEqual(expected);
  });

  it("is null at top level, under an ungated or non-public root, or an unknown collection", () => {
    expect(inheritedLinkGate(null, byId)).toBeNull();
    expect(inheritedLinkGate("c-missing", byId)).toBeNull();
    const ungated = new Map([["c-root", coll({ linkGate: null })]]);
    expect(inheritedLinkGate("c-root", ungated)).toBeNull();
    const members = new Map([["c-root", coll({ visibility: "authenticated" })]]);
    expect(inheritedLinkGate("c-root", members)).toBeNull();
  });
});
const DAY = 24 * 60 * 60 * 1000;

describe("generatePassword (S32a)", () => {
  // r[verify hosting.link-gate.password-generator+2]
  it("returns 16 characters, all from the unambiguous alphabet", () => {
    const pw = generatePassword();
    expect(pw).toHaveLength(16);
    for (const ch of pw) expect(UNAMBIGUOUS_ALPHABET).toContain(ch);
  });

  // r[verify hosting.link-gate.password-generator+2]
  it("leaves out 0, O, 1, l and I", () => {
    for (const ch of "0O1lI") expect(UNAMBIGUOUS_ALPHABET).not.toContain(ch);
  });

  // r[verify hosting.link-gate.password-generator+2]
  it("differs between two calls", () => {
    expect(generatePassword()).not.toBe(generatePassword());
  });

  // r[verify hosting.link-gate.password-generator+2]
  it("skips a random byte that would favour the alphabet's first characters", () => {
    const n = UNAMBIGUOUS_ALPHABET.length;
    const limit = 256 - (256 % n);
    // Every other byte is at or above the largest multiple of the alphabet's size, where `% n`
    // would land on the first characters more often; only the bytes below it are kept.
    const fill = (bytes: Uint8Array) => {
      for (let i = 0; i < bytes.length; i++) bytes[i] = i % 2 === 0 ? limit + (i % (256 - limit)) : i;
      return bytes;
    };
    const spy = vi.spyOn(crypto, "getRandomValues").mockImplementation(fill as typeof crypto.getRandomValues);
    try {
      const pw = generatePassword(4);
      expect(pw).toBe([1, 3, 5, 7].map((b) => UNAMBIGUOUS_ALPHABET[b % n]).join(""));
    } finally {
      spy.mockRestore();
    }
  });
});

describe("the password field (S32a)", () => {
  // r[verify hosting.link-gate.password-generator+2]
  it("turning on 'Require a password' pre-fills a generated password", () => {
    const form = enablePassword(emptyForm());
    expect(form.requirePassword).toBe(true);
    expect(form.password).toHaveLength(16);
  });

  // r[verify hosting.link-gate.password-generator+2]
  it("'Change' on a kept password pre-fills a new generated one", () => {
    const kept = formFor({ passwordProtected: true, expiresAt: null });
    expect(kept.keepPassword).toBe(true);
    const form = enablePassword(kept);
    expect(form.keepPassword).toBe(false);
    expect(form.password).toHaveLength(16);
  });

  // r[verify hosting.link-gate.password-generator+2]
  it("the owner's edit replaces it in what is submitted", () => {
    const form = { ...enablePassword(emptyForm()), password: "my-own-choice" };
    expect(linkGateOnPublish(form, NOW)).toEqual({ password: "my-own-choice" });
  });
});

describe("expiry presets (S32a)", () => {
  it("maps 1 d / 7 d / 30 d to that far from now, none to null", () => {
    expect(expiryFor({ ...emptyForm(), expiry: "1d" }, NOW)).toBe(new Date(NOW.getTime() + DAY).toISOString());
    expect(expiryFor({ ...emptyForm(), expiry: "7d" }, NOW)).toBe(new Date(NOW.getTime() + 7 * DAY).toISOString());
    expect(expiryFor({ ...emptyForm(), expiry: "30d" }, NOW)).toBe(new Date(NOW.getTime() + 30 * DAY).toISOString());
    expect(expiryFor({ ...emptyForm(), expiry: "none" }, NOW)).toBeNull();
  });

  it("takes a custom local date-time", () => {
    const iso = expiryFor({ ...emptyForm(), expiry: "custom", customExpiry: "2026-07-01T09:30" }, NOW);
    expect(iso).toBe(new Date("2026-07-01T09:30").toISOString());
  });
});

describe("what the form submits (S32a)", () => {
  it("publishing with nothing chosen sends no gate", () => {
    expect(linkGateOnPublish(emptyForm(), NOW)).toBeUndefined();
  });

  it("publishing with a password and an expiry sends both", () => {
    const form = { ...emptyForm(), requirePassword: true, password: "correct-horse", expiry: "7d" as const };
    expect(linkGateOnPublish(form, NOW)).toEqual({
      password: "correct-horse",
      expiresAt: new Date(NOW.getTime() + 7 * DAY).toISOString(),
    });
  });

  it("an edit sends only what changed, null to clear", () => {
    const current = { passwordProtected: true, expiresAt: "2026-06-05T00:00:00.000Z" };
    // Keep the password, clear the expiry.
    expect(gateChange({ ...emptyForm(), requirePassword: true, keepPassword: true }, current, NOW)).toEqual({
      expiresAt: null,
    });
    // Clear the password, set a new expiry.
    expect(gateChange({ ...emptyForm(), expiry: "1d" }, current, NOW)).toEqual({
      password: null,
      expiresAt: new Date(NOW.getTime() + DAY).toISOString(),
    });
    // A new password.
    expect(
      gateChange({ ...emptyForm(), requirePassword: true, password: "new-password", keepExpiry: true }, current, NOW),
    ).toEqual({ password: "new-password" });
  });
});

describe("expiryTimerDelay (S32a)", () => {
  it("is the time left until the expiry, for a gate that will still expire", () => {
    expect(expiryTimerDelay({ passwordProtected: false, expiresAt: new Date(NOW.getTime() + 5000).toISOString() }, NOW)).toBe(5000);
  });

  it("is null with no expiry, or once it has passed", () => {
    expect(expiryTimerDelay(null, NOW)).toBeNull();
    expect(expiryTimerDelay({ passwordProtected: true, expiresAt: null }, NOW)).toBeNull();
    expect(expiryTimerDelay({ passwordProtected: false, expiresAt: NOW.toISOString() }, NOW)).toBeNull();
  });

  it("is capped to what a browser timer can hold", () => {
    const far = new Date(NOW.getTime() + 60 * DAY).toISOString();
    expect(expiryTimerDelay({ passwordProtected: false, expiresAt: far }, NOW)).toBe(2 ** 31 - 1);
  });
});

describe("copyText (S32a)", () => {
  // r[verify hosting.link-gate.password-generator+2]
  it("writes exactly the field's current value and reports Copied", async () => {
    const written: string[] = [];
    const label = await copyText({ writeText: async (t) => void written.push(t) }, "abc-DEF-234");
    expect(written).toEqual(["abc-DEF-234"]);
    expect(label).toBe("Copied");
  });

  it("reports a failure without throwing", async () => {
    const label = await copyText({ writeText: async () => Promise.reject(new Error("denied")) }, "x");
    expect(label).toBe("Copy failed");
    expect(await copyText(undefined, "x")).toBe("Copy failed");
  });
});
