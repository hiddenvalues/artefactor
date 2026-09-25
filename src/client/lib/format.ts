import {
  AppWindow,
  ClipboardList,
  File,
  FileCode,
  Globe,
  Lock,
  Presentation,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { ArtefactSummary } from "../../shared/contracts";
import type { ArtefactKind } from "../../domain/artefact/kind";
import { KIND_PRESENTATION, KIND_ORDER } from "../../shared/kind-presentation";

export type Visibility = ArtefactSummary["visibility"];

// Per-kind presentation. The label comes from `shared/` (the server-rendered
// host shell shows the same one); the colour and tint are the `--kind-*` tokens
// in app.css, and the glyph is lucide's.
export interface KindMeta {
  label: string;
  color: string;
  tint: string;
  icon: LucideIcon;
}

const KIND_ICONS: Record<ArtefactKind, LucideIcon> = {
  prototype: AppWindow,
  "slide-deck": Presentation,
  form: ClipboardList,
  "interactive-doc": FileCode,
  other: File,
};

export { KIND_ORDER };

export function kindMeta(kind: string): KindMeta {
  const k = (kind in KIND_PRESENTATION ? kind : "other") as ArtefactKind;
  return {
    label: KIND_PRESENTATION[k].label,
    color: `var(--kind-${k})`,
    tint: `var(--kind-${k}-tint)`,
    icon: KIND_ICONS[k],
  };
}

export const KINDS: Record<ArtefactKind, KindMeta> = Object.fromEntries(
  KIND_ORDER.map((k) => [k, kindMeta(k)]),
) as Record<ArtefactKind, KindMeta>;

// Shown for an artefact that persists data (AH16 `usesStorage`).
export const STORAGE_LABEL = "Saves data";

/** Per-visibility presentation metadata. */
export interface VisMeta {
  label: string;
  desc: string;
  icon: LucideIcon;
}

export const VIS: Record<Visibility, VisMeta> = {
  private: { label: "Private", desc: "Only you", icon: Lock },
  selected: { label: "Specific people", desc: "Only people you choose", icon: UserPlus },
  authenticated: { label: "Members", desc: "Any signed-in user", icon: Users },
  public: { label: "Public", desc: "Anyone with the link", icon: Globe },
};

export const VIS_ORDER: Visibility[] = ["private", "selected", "authenticated", "public"];

// S41 (AH30) — whose saved data a viewer may load. Offered in the visibility
// popover's "Saved data" section, only for artefacts that persist data.
export type DataVisibility = ArtefactSummary["dataVisibility"];

export const DATA_VIS: Record<DataVisibility, { label: string; desc: string }> = {
  shared: { label: "Shared with viewers", desc: "Viewers can open each other's data" },
  own: { label: "Only each viewer's own", desc: "You still see everyone's" },
};

export const DATA_VIS_ORDER: DataVisibility[] = ["own", "shared"];

// S25 — a stable per-collection hue, hashed from the id (no stored colour), so
// a collection keeps its hue for life. The six hues are the `--collection-*`
// tokens in app.css.
export const COLLECTION_HUE_COUNT = 6;
export function collectionColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `var(--collection-${(h % COLLECTION_HUE_COUNT) + 1})`;
}

/** "254 KB" / "1.2 MB" — matches the design's fmtBytes. */
export function fmtBytes(b: number): string {
  return b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.round(b / 1024) + " KB";
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

/** Relative-time label from an ISO-8601 timestamp ("2 days ago"). */
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

/** Plural helper: "1 artefact" / "3 artefacts". */
export function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
