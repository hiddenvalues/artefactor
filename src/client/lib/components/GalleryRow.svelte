<script lang="ts">
  import type { SharedArtefactSummary } from "../../../shared/contracts";
  import {
    kindMeta,
    initials,
    relativeTime,
    BOOKMARK_ICON,
    STORAGE_ICON,
    STORAGE_LABEL,
  } from "../format";
  import Icon from "./Icon.svelte";

  interface Props {
    g: SharedArtefactSummary;
    onOpen: () => void;
    // S27 (BM2) — shared artefacts are bookmarkable too.
    bookmarked?: boolean;
    onBookmark?: () => void;
    // S29 (CL13) — on the caller's own collection page: eject this foreign
    // artefact back to its owner's top level.
    onEject?: () => void;
  }
  let { g, onOpen, bookmarked = false, onBookmark, onEject }: Props = $props();

  const m = $derived(kindMeta(g.kind));
  const ownerName = $derived(g.owner.name || g.owner.email || "Unknown");
</script>

<div
  style="display:flex;align-items:center;gap:14px;padding:11px 14px;background:var(--card);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow);"
>
  <!-- icon — clickable; opens the artefact -->
  <button
    type="button"
    onclick={onOpen}
    aria-label={`Open ${g.title}`}
    style="width:42px;height:42px;border-radius:10px;background:{m.tint};display:flex;align-items:center;justify-content:center;flex-shrink:0;border:none;padding:0;cursor:pointer;"
  >
    <Icon paths={m.icon} size={20} width={1.7} color={m.color} />
  </button>
  <div style="flex:1;min-width:0;">
    <div
      style="font-size:14px;font-weight:600;letter-spacing:-0.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
    >
      {g.title}
    </div>
    <div style="display:flex;align-items:center;gap:7px;margin-top:3px;font-size:11.5px;color:var(--muted-fg);">
      <span>{m.label}</span>
      {#if g.usesStorage}
        <span title={STORAGE_LABEL} aria-label={STORAGE_LABEL} style="display:inline-flex;align-items:center;color:var(--muted-fg);">
          <Icon paths={STORAGE_ICON} size={12} width={1.8} />
        </span>
      {/if}
      <span style="opacity:.5;">·</span>
      <span>Shared by {ownerName}</span><span style="opacity:.5;">·</span>
      <span>{relativeTime(g.updatedAt)}</span>
    </div>
  </div>
  <div
    style="width:24px;height:24px;border-radius:50%;background:var(--muted);color:var(--muted-fg);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;flex-shrink:0;"
  >
    {initials(ownerName)}
  </div>
  {#if onEject}
    <button
      onclick={onEject}
      title="Remove from collection"
      aria-label={`Remove ${g.title} from this collection`}
      style="display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 11px;border:1px solid var(--border);background:var(--card);color:var(--muted-fg);border-radius:8px;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;flex-shrink:0;"
    >
      <Icon paths={["M18 6L6 18M6 6l12 12"]} size={12} />
      Remove
    </button>
  {/if}
  {#if onBookmark}
    <button
      onclick={onBookmark}
      title={bookmarked ? "Remove bookmark" : "Bookmark"}
      aria-label={bookmarked ? "Remove bookmark" : "Bookmark"}
      style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:1px solid var(--border);background:var(--card);border-radius:8px;cursor:pointer;flex-shrink:0;color:{bookmarked ? 'var(--primary)' : 'var(--muted-fg)'};"
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill={bookmarked ? "currentColor" : "none"}
        stroke="currentColor"
        stroke-width="2"
        stroke-linejoin="round"
      >
        <path d={BOOKMARK_ICON[0]} />
      </svg>
    </button>
  {/if}
  <button
    onclick={onOpen}
    style="display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 13px;border:1px solid var(--border);background:var(--card);color:var(--fg);border-radius:8px;font-size:12.5px;font-weight:500;cursor:pointer;font-family:inherit;flex-shrink:0;"
  >
    <Icon
      paths={[
        "M15 3h6v6",
        "M10 14L21 3",
        "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
      ]}
      size={14}
    />
    Open
  </button>
</div>
