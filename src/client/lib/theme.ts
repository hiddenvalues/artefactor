import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { restore, usePref } from "./prefs";

// S45 — App dark mode with a UI toggle. The theme is a per-browser UI
// preference in the SPA's own localStorage (`artefactor:theme`, via prefs.ts),
// like view/density/sort: never an artefact's hijacked store, never the
// backend. `system` follows the OS. The first paint is already right —
// src/shared/theme-boot.ts sets `.dark` before the bundle loads — and
// `ThemeProvider` takes over from there.
export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];
export type ResolvedTheme = "light" | "dark";

const KEY = "theme";
const FALLBACK: Theme = "system";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function resolveTheme(pref: Theme, prefersDark: boolean): ResolvedTheme {
  return pref === "dark" || (pref === "system" && prefersDark) ? "dark" : "light";
}

export function restoreTheme(): Theme {
  return restore(KEY, THEMES, FALLBACK);
}

interface ThemeState {
  theme: Theme;
  resolved: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const osPrefersDark = () => typeof matchMedia === "function" && matchMedia(DARK_QUERY).matches;

// Outside a provider (the design catalog, which keeps its own switch) the
// theme reads as light and can't be changed.
const ThemeContext = createContext<ThemeState>({ theme: FALLBACK, resolved: "light", setTheme: () => {} });

/** Mounted once at the app root: owns the preference and `<html>`'s `.dark`. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = usePref(KEY, THEMES, FALLBACK);
  const [prefersDark, setPrefersDark] = useState(osPrefersDark);

  useEffect(() => {
    if (theme !== "system" || typeof matchMedia !== "function") return;
    const mq = matchMedia(DARK_QUERY);
    const onChange = () => setPrefersDark(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const resolved = resolveTheme(theme, prefersDark);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [resolved]);

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);
  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): ThemeState {
  return useContext(ThemeContext);
}
