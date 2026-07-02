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

<!-- Grid card: base look + hover "pop" come from `.af-card-grid` (app.css). -->
<div class="af-card-grid">
  <!-- thumbnail — clickable upper half; opens the artefact -->
  <button
    type="button"
    onclick={onOpen}
    aria-label={`Open ${g.title}`}
    style="position:relative;width:100%;height:108px;padding:0;display:flex;align-items:center;justify-content:center;background:{m.tint};--thumb-stripe:{m.color};border:none;border-bottom:1px solid var(--border);overflow:hidden;border-top-left-radius:12px;border-top-right-radius:12px;cursor:pointer;font-family:inherit;"
  >
    <div
      style="position:absolute;inset:0;opacity:.5;background-image:repeating-linear-gradient(135deg, transparent 0 9px, var(--thumb-stripe) 9px 10px);"
    ></div>
    <Icon paths={m.icon} size={30} width={1.7} color={m.color} style="position:relative;" />
    <span
      style="position:absolute;top:9px;left:9px;display:inline-flex;align-items:center;padding:3px 8px;border-radius:7px;background:var(--card);color:{m.color};box-shadow:var(--shadow);"
    >
      <span style="font-family:'Geist Mono',monospace;font-size:10.5px;letter-spacing:0.02em;">
        {m.label}
      </span>
    </span>
    {#if g.usesStorage}
      <span
        title={STORAGE_LABEL}
        aria-label={STORAGE_LABEL}
        style="position:absolute;top:9px;right:9px;display:inline-flex;align-items:center;justify-content:center;padding:4px;border-radius:7px;background:var(--card);color:var(--muted-fg);box-shadow:var(--shadow);"
      >
        <Icon paths={STORAGE_ICON} size={13} width={1.8} />
      </span>
    {/if}
  </button>
  {#if onBookmark}
    <!-- Sits over the thumbnail's lower-right, outside the open-button so a
         mis-click never opens the artefact. -->
    <button
      onclick={onBookmark}
      title={bookmarked ? "Remove bookmark" : "Bookmark"}
      aria-label={bookmarked ? "Remove bookmark" : "Bookmark"}
      style="position:absolute;top:76px;right:9px;display:inline-flex;align-items:center;justify-content:center;padding:5px;border-radius:7px;border:none;background:var(--card);box-shadow:var(--shadow);cursor:pointer;color:{bookmarked ? 'var(--primary)' : 'var(--muted-fg)'};"
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
  <div style="padding:13px 14px 13px;display:flex;flex-direction:column;gap:11px;">
    <div
      style="font-size:14px;font-weight:600;letter-spacing:-0.01em;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
    >
      {g.title}
    </div>
    <div style="display:flex;align-items:center;gap:8px;">
      <div
        style="width:22px;height:22px;border-radius:50%;background:var(--muted);color:var(--muted-fg);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;flex-shrink:0;"
      >
        {initials(ownerName)}
      </div>
      <span
        style="font-size:12px;color:var(--muted-fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
      >
        {ownerName}
      </span>
      <span style="font-size:11.5px;color:var(--muted-fg);margin-left:auto;flex-shrink:0;">
        {relativeTime(g.updatedAt)}
      </span>
    </div>
    <div style="display:flex;gap:7px;">
      <button
        onclick={onOpen}
        style="flex:1;height:34px;display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid var(--border);background:var(--card);color:var(--fg);border-radius:8px;font-size:12.5px;font-weight:500;cursor:pointer;font-family:inherit;"
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
      {#if onEject}
        <button
          onclick={onEject}
          title="Remove from collection"
          aria-label={`Remove ${g.title} from this collection`}
          style="height:34px;padding:0 11px;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--border);background:var(--card);color:var(--muted-fg);border-radius:8px;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;"
        >
          <Icon paths={["M18 6L6 18M6 6l12 12"]} size={12} />
          Remove
        </button>
      {/if}
    </div>
  </div>
</div>
