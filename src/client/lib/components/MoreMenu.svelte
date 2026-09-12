<script lang="ts">
  import { overlay } from "../ui.svelte";
  import {
    ARCHIVE_ICON,
    BOOKMARK_ICON,
    DOWNLOAD_ICON,
    FOLDER_ICON,
  } from "../format";
  import Icon from "./Icon.svelte";

  interface Props {
    id: string;
    isShared: boolean;
    variant?: "grid" | "list";
    onOpen: () => void;
    onCopy: () => void;
    onEdit: () => void;
    onArchive: () => void;
    // S27 — bookmark toggle (owned artefacts only; omitted elsewhere).
    bookmarked?: boolean;
    onBookmark?: () => void;
    // S25 — add/move to collection ("Move…" once it's already in one).
    inCollection?: boolean;
    onMoveToCollection?: () => void;
    // S30 — "Download HTML". A plain anchor: the export endpoint authenticates
    // on the session cookie, so no fetch/blob dance is needed. Owned artefacts
    // only in this slice (the endpoint itself honours the access matrix, so
    // widening to shared viewers is later client-only work).
    downloadHref?: string;
  }
  let {
    id,
    isShared,
    variant = "grid",
    onOpen,
    onCopy,
    onEdit,
    onArchive,
    bookmarked = false,
    onBookmark,
    inCollection = false,
    onMoveToCollection,
    downloadHref,
  }: Props = $props();

  const key = $derived(`menu:${id}`);
  const open = $derived(overlay.isOpen(key));

  const trigger = $derived(
    variant === "grid"
      ? "width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:7px;border:none;background:none;color:var(--muted-fg);cursor:pointer;"
      : "width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--muted-fg);cursor:pointer;",
  );
  const menuTop = $derived(variant === "grid" ? "32px" : "36px");
  const itemStyle =
    "width:100%;display:flex;align-items:center;gap:9px;padding:8px 9px;border:none;background:none;font-size:13px;font-family:inherit;border-radius:7px;cursor:pointer;text-align:left;";

  function run(fn: () => void) {
    overlay.close();
    fn();
  }
</script>

<div style="position:relative;flex-shrink:0;">
  <button onclick={() => overlay.toggle(key)} style={trigger} title="More">
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  </button>
  {#if open}
    <div
      style="position:absolute;right:0;top:{menuTop};z-index:35;min-width:182px;background:var(--card);border:1px solid var(--border);border-radius:11px;box-shadow:var(--shadow-md);padding:5px;animation:af-menu .12s ease;"
    >
      <button onclick={() => run(onOpen)} style="{itemStyle}color:var(--fg);">
        <Icon
          paths={[
            "M15 3h6v6",
            "M10 14L21 3",
            "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
          ]}
          size={15}
        />Open
      </button>
      {#if onBookmark}
        <button onclick={() => run(onBookmark)} style="{itemStyle}color:var(--fg);">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill={bookmarked ? "currentColor" : "none"}
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d={BOOKMARK_ICON[0]} />
          </svg>
          {bookmarked ? "Remove bookmark" : "Bookmark"}
        </button>
      {/if}
      {#if onMoveToCollection}
        <button onclick={() => run(onMoveToCollection)} style="{itemStyle}color:var(--fg);">
          <Icon paths={FOLDER_ICON} size={15} />
          {inCollection ? "Move to collection…" : "Add to collection…"}
        </button>
      {/if}
      {#if isShared}
        <button onclick={() => run(onCopy)} style="{itemStyle}color:var(--fg);">
          <Icon
            paths={[
              "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1",
              "M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
            ]}
            size={15}
          />Copy share link
        </button>
      {/if}
      <button onclick={() => run(onEdit)} style="{itemStyle}color:var(--fg);">
        <Icon
          paths={["M12 20h9", "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"]}
          size={15}
        />Edit
      </button>
      {#if downloadHref}
        <a
          href={downloadHref}
          download
          onclick={() => overlay.close()}
          style="{itemStyle}color:var(--fg);text-decoration:none;"
        >
          <Icon paths={DOWNLOAD_ICON} size={15} />Download HTML
        </a>
      {/if}
      <div style="height:1px;background:var(--border);margin:5px 6px;"></div>
      <button onclick={() => run(onArchive)} style="{itemStyle}color:var(--destructive);">
        <Icon paths={ARCHIVE_ICON} size={15} />Archive
      </button>
    </div>
  {/if}
</div>
