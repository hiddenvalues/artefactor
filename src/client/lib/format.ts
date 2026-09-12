import type { ArtefactSummary } from "../../shared/contracts";
import {
  KIND_PRESENTATION,
  KIND_ORDER,
  kindPresentation,
  type KindPresentation,
} from "../../shared/kind-presentation";

export type Visibility = ArtefactSummary["visibility"];

// Per-kind presentation metadata lives in `shared/` so the server-rendered host
// shell reuses the same icon/title/type. Re-exported here under the names the
// client components already use.
export type KindMeta = KindPresentation;
export const KINDS = KIND_PRESENTATION;
export { KIND_ORDER };
export const kindMeta = kindPresentation;

// Indicator for an artefact that persists data (AH16 `usesStorage`). A small
// database glyph, shown in the dashboard/gallery card (upper-right) and row
// (after the kind label). Drawn as `<path>`s for Icon.svelte (24×24 box).
export const STORAGE_ICON: readonly string[] = [
  "M3 5a9 3 0 1 0 18 0a9 3 0 1 0-18 0", // top ellipse
  "M3 5V19a9 3 0 0 0 18 0V5", // sides + bottom
  "M3 12a9 3 0 0 0 18 0", // middle band
];
export const STORAGE_LABEL = "Saves data";

/** Per-visibility presentation metadata. */
export interface VisMeta {
  label: string;
  desc: string;
  icon: string[];
}

export const VIS: Record<Visibility, VisMeta> = {
  private: {
    label: "Private",
    desc: "Only you",
    icon: [
      "M5 11a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z",
      "M8 9V6a4 4 0 0 1 8 0v3",
    ],
  },
  selected: {
    label: "Specific people",
    desc: "Only people you choose",
    icon: [
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
      "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
      "M19 8v6",
      "M22 11h-6",
    ],
  },
  authenticated: {
    label: "Members",
    desc: "Any signed-in user",
    icon: [
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
      "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
      "M22 21v-2a4 4 0 0 0-3-3.87",
      "M16 3.13a4 4 0 0 1 0 7.75",
    ],
  },
  public: {
    label: "Public",
    desc: "Anyone with the link",
    icon: [
      "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z",
      "M2 12h20",
      "M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20",
    ],
  },
};

export const VIS_ORDER: Visibility[] = [
  "private",
  "selected",
  "authenticated",
  "public",
];

// S25 — Collections. Folder + bookmark glyphs and a stable per-collection tint
// (derived from the id — no stored color; the design prototype seeded colors,
// the real app hashes so a collection keeps its hue for life).
export const FOLDER_ICON = [
  "M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.2 3.9A2 2 0 0 0 7.5 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z",
];
export const BOOKMARK_ICON = ["M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"];
// Sidebar "Home" row + the picker's "Top level" option.
export const HOME_ICON = ["M3 10.5 12 3l9 7.5", "M5 9.5V21h14V9.5"];
// S30 — "Download HTML" (tray with a down arrow).
export const DOWNLOAD_ICON = [
  "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",
  "M7 10l5 5 5-5",
  "M12 15V3",
];
// The archive box (menu items + the sidebar Archive entry). TOAST_ICONS.archive
// is the 2-path toast variant of the same glyph.
export const ARCHIVE_ICON = [
  "M2 4h20",
  "M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9",
  "M10 13h4",
];

const COLLECTION_HUES = ["#2563eb", "#7c3aed", "#0f766e", "#d97706", "#db2777", "#16a34a"];
export function collectionColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLLECTION_HUES[h % COLLECTION_HUES.length] ?? "#0f766e";
}

/** "254 KB" / "1.2 MB" — matches the design's fmtBytes. */
export function fmtBytes(b: number): string {
  return b >= 1048576
    ? (b / 1048576).toFixed(1) + " MB"
    : Math.round(b / 1024) + " KB";
}

/** Initials from a display name ("Maya Chen" -> "MC"). */
export function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Relative-time label from an ISO-8601 timestamp ("2 days ago"). The design
 *  used pre-baked strings; the real API gives us `updatedAt`/`createdAt`. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.round(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}
