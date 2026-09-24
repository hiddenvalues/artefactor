export const VISIBILITIES = [
  "private",
  "selected",
  "authenticated",
  "public",
] as const;

export type Visibility = (typeof VISIBILITIES)[number];

export const STATUSES = ["active", "archived"] as const;

export type Status = (typeof STATUSES)[number];

// S41 (AH30, AD11) — whose saved data a viewer may load: `shared` lets anyone the
// matrix admits load any author's entry (AD4); `own` narrows a non-owner to their
// own. Never gates viewing itself.
export const DATA_VISIBILITIES = ["shared", "own"] as const;

export type DataVisibility = (typeof DATA_VISIBILITIES)[number];
