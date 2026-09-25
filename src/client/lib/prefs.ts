import { useEffect, useState } from "react";

// Remember the dashboard's view controls across reloads — a full refresh
// otherwise dropped every choice back to its default. Stored in the SPA's own
// localStorage (not an artefact's hijacked store), under the same keys the
// Svelte client used, so a user's saved choices survive the S43 switch. Each
// value is validated on read, so a stale/unknown stored value falls back.
export const STORE_PREFIX = "artefactor:";

export function restore<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(STORE_PREFIX + key);
    return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

export function persist(key: string, value: string): void {
  try {
    localStorage.setItem(STORE_PREFIX + key, value);
  } catch {
    /* storage unavailable — the choice just won't persist */
  }
}

/** A string preference restored on mount and written back whenever it changes. */
export function usePref<T extends string>(key: string, allowed: readonly T[], fallback: T) {
  const [value, setValue] = useState<T>(() => restore(key, allowed, fallback));
  useEffect(() => persist(key, value), [key, value]);
  return [value, setValue] as const;
}
