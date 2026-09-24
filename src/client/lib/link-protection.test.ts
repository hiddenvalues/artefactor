import { describe, expect, it } from "vitest";
import {
  UNAMBIGUOUS_ALPHABET,
  copyText,
  expiryTimerDelay,
  emptyForm,
  enablePassword,
  expiryFor,
  generatePassword,
  gateChange,
  linkGateOnPublish,
} from "./link-protection";

// S32a — the client's link-protection logic: the generated password, the copy
// button, and what the form submits.

const NOW = new Date("2026-06-01T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

describe("generatePassword (S32a)", () => {
  it("returns 16 characters, all from the unambiguous alphabet", () => {
    const pw = generatePassword();
    expect(pw).toHaveLength(16);
    for (const ch of pw) expect(UNAMBIGUOUS_ALPHABET).toContain(ch);
  });

  it("leaves out 0, O, 1, l and I", () => {
    for (const ch of "0O1lI") expect(UNAMBIGUOUS_ALPHABET).not.toContain(ch);
  });

  it("differs between two calls", () => {
    expect(generatePassword()).not.toBe(generatePassword());
  });
});

describe("the password field (S32a)", () => {
  it("turning on 'Require a password' pre-fills a generated password", () => {
    const form = enablePassword(emptyForm());
    expect(form.requirePassword).toBe(true);
    expect(form.password).toHaveLength(16);
  });

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
