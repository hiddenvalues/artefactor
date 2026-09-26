import { describe, expect, it } from "vitest";
import { THEME_BOOT_JS } from "./theme-boot";

// S45 — the pre-paint boot script the SPA's index.html and the host shell both
// inline. Evaluated with injected globals, as shell.test.ts does for the frame
// controller.
function boot(opts: { stored?: string | null; throws?: boolean; osDark: boolean }) {
  const classes = new Set<string>();
  const html = {
    classList: {
      toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)),
      contains: (c: string) => classes.has(c),
    },
  };
  let stored = opts.stored ?? null;
  const localStorage = {
    getItem: (k: string) => {
      if (opts.throws) throw new Error("SecurityError");
      return k === "artefactor:theme" ? stored : null;
    },
  };
  const listeners: ((e: { matches: boolean }) => void)[] = [];
  const mq = {
    matches: opts.osDark,
    addEventListener: (ev: string, cb: (e: { matches: boolean }) => void) => {
      if (ev === "change") listeners.push(cb);
    },
  };
  const matchMedia = (q: string) => {
    expect(q).toBe("(prefers-color-scheme: dark)");
    return mq;
  };
  new Function("localStorage", "matchMedia", "document", THEME_BOOT_JS)(localStorage, matchMedia, {
    documentElement: html,
  });
  return {
    dark: () => classes.has("dark"),
    osChanges: (matches: boolean) => {
      mq.matches = matches;
      for (const cb of listeners) cb({ matches });
    },
    store: (v: string) => (stored = v),
  };
}

describe("theme boot script (S45)", () => {
  it("sets dark for a stored dark under an OS in light", () => {
    expect(boot({ stored: "dark", osDark: false }).dark()).toBe(true);
  });

  it("leaves dark off for a stored light under an OS in dark", () => {
    expect(boot({ stored: "light", osDark: true }).dark()).toBe(false);
  });

  it("follows the OS when nothing is stored", () => {
    expect(boot({ stored: null, osDark: true }).dark()).toBe(true);
    expect(boot({ stored: null, osDark: false }).dark()).toBe(false);
  });

  it("treats an unreadable localStorage as system, without throwing", () => {
    let b: ReturnType<typeof boot> | undefined;
    expect(() => (b = boot({ throws: true, osDark: true }))).not.toThrow();
    expect(b!.dark()).toBe(true);
  });

  it("follows OS changes while the pref is system", () => {
    const b = boot({ stored: "system", osDark: false });
    b.osChanges(true);
    expect(b.dark()).toBe(true);
    b.osChanges(false);
    expect(b.dark()).toBe(false);
  });

  it("ignores OS changes while the pref is dark", () => {
    const b = boot({ stored: "dark", osDark: false });
    b.osChanges(true);
    b.osChanges(false);
    expect(b.dark()).toBe(true);
  });

  // The SPA may store an explicit choice after boot; the boot listener must not
  // then undo it on the next OS change.
  it("stops following the OS once an explicit choice is stored", () => {
    const b = boot({ stored: null, osDark: false });
    b.store("dark");
    b.osChanges(false);
    expect(b.dark()).toBe(true);
  });

  it("is one self-contained statement that can't close its script tag", () => {
    expect(THEME_BOOT_JS).not.toMatch(/<\/script/i);
    expect(THEME_BOOT_JS.trim()).toMatch(/^\(function\(\)\{[\s\S]*\}\)\(\);$/);
  });
});
