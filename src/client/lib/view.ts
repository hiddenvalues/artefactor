import type { Route } from "./route";

/** The SPA's screens. Each has a path in the URL (S59, `route.ts`). */
// S57 — `account` is the Account screen, opened from the account menu.
// S58 — `organization` is Organization settings, opened from it with an org context.
export type View = Route["view"];
