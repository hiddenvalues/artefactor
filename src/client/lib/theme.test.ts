import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTheme, restoreTheme, THEMES } from "./theme";

// S45 — App dark mode with a UI toggle: the theme preference and its resolution.
describe("theme preference (S45)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const stored = (value: string | null) =>
    vi.stubGlobal("localStorage", { getItem: (k: string) => (k === "artefactor:theme" ? value : null) });

  // r[verify platform.theme.resolve]
  it("offers light, dark and system", () => {
    expect(THEMES).toEqual(["light", "dark", "system"]);
  });

  // r[verify platform.theme.resolve]
  it("resolves system against the OS and an explicit choice regardless of it", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  // r[verify platform.theme.resolve]
  it("restores an unknown stored value as system", () => {
    stored("blue");
    expect(restoreTheme()).toBe("system");
  });

  // r[verify platform.theme.resolve]
  it("restores nothing stored as system", () => {
    stored(null);
    expect(restoreTheme()).toBe("system");
  });

  // r[verify platform.theme.resolve]
  it("restores a stored choice", () => {
    stored("dark");
    expect(restoreTheme()).toBe("dark");
  });
});
