<script lang="ts">
  import type { ArtefactSummary } from "../../../shared/contracts";
  import {
    kindMeta,
    fmtBytes,
    relativeTime,
    collectionColor,
    BOOKMARK_ICON,
    FOLDER_ICON,
    STORAGE_ICON,
    STORAGE_LABEL,
    type Visibility,
  } from "../format";
  import { overlay } from "../ui.svelte";
  import Icon from "./Icon.svelte";
  import MoreMenu from "./MoreMenu.svelte";
  import VisibilityControl from "./VisibilityControl.svelte";

  interface Props {
    a: ArtefactSummary;
    onOpen: () => void;
    onCopy: () => void;
    onEdit: () => void;
    onArchive: () => void;
    onVisibility: (v: Visibility) => void;
    onManage: () => void;
    // S25/S27 — collections + bookmarks.
    collectionName?: string | null;
    onOpenCollection?: () => void;
    bookmarked?: boolean;
    onBookmark?: () => void;
    onMoveToCollection?: () => void;
    // Hide the "in <Collection>" chip when the card already sits on that
    // collection's page.
    showCollectionChip?: boolean;
  }
  let {
    a,
    onOpen,
    onCopy,
    onEdit,
    onArchive,
    onVisibility,
    onManage,
    collectionName = null,
    onOpenCollection,
    bookmarked = false,
    onBookmark,
    onMoveToCollection,
    showCollectionChip = true,
  }: Props = $props();

  const m = $derived(kindMeta(a.kind));
  const inherited = $derived(a.collectionId !== null);
  // Link reachability follows the *effective* tier (AH20).
  const isShared = $derived(a.effectiveVisibility !== "private" && !!a.publicSlug);
  const raised = $derived(
    overlay.isOpen(`menu:${a.id}`) || overlay.isOpen(`vis:${a.id}`),
  );
</script>

<!-- Grid card: base look + hover "pop" come from `.af-card-grid` (app.css). When a
     menu/visibility picker is open the card is raised above neighbours (z 50, beating
     the hover z 20) so the dropdown isn't clipped. -->
<div class="af-card-grid" style={raised ? "z-index:50;" : ""}>
  <!-- thumbnail — clickable upper half; opens the artefact like the title does -->
  <button
    type="button"
    onclick={onOpen}
    aria-label={`Open ${a.title}`}
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
    <span style="position:absolute;top:9px;right:9px;display:inline-flex;gap:5px;">
      {#if bookmarked}
        <span
          title="Bookmarked"
          aria-label="Bookmarked"
          style="display:inline-flex;align-items:center;justify-content:center;padding:4px;border-radius:7px;background:var(--card);color:var(--primary);box-shadow:var(--shadow);"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
            <path d={BOOKMARK_ICON[0]} />
          </svg>
        </span>
      {/if}
      {#if a.usesStorage}
        <span
          title={STORAGE_LABEL}
          aria-label={STORAGE_LABEL}
          style="display:inline-flex;align-items:center;justify-content:center;padding:4px;border-radius:7px;background:var(--card);color:var(--muted-fg);box-shadow:var(--shadow);"
        >
          <Icon paths={STORAGE_ICON} size={13} width={1.8} />
        </span>
      {/if}
    </span>
  </button>

  <!-- body -->
  <div style="padding:13px 14px 12px;display:flex;flex-direction:column;gap:10px;">
    <div style="display:flex;align-items:flex-start;gap:8px;">
      <button
        onclick={onOpen}
        style="flex:1;min-width:0;text-align:left;background:none;border:none;padding:0;cursor:pointer;font-family:inherit;color:var(--fg);font-size:14px;font-weight:600;letter-spacing:-0.01em;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
      >
        {a.title}
      </button>
      <MoreMenu
        id={a.id}
        {isShared}
        variant="grid"
        {onOpen}
        {onCopy}
        {onEdit}
        {onArchive}
        {bookmarked}
        {onBookmark}
        inCollection={inherited}
        {onMoveToCollection}
      />
    </div>

    <VisibilityControl
      id={a.id}
      visibility={a.effectiveVisibility}
      variant="block"
      onChoose={onVisibility}
      {onManage}
      {inherited}
      inheritedFrom={collectionName ?? ""}
      {onOpenCollection}
    />

    <!-- footer meta -->
    <div style="display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--muted-fg);flex-wrap:wrap;">
      {#if inherited && collectionName && showCollectionChip}
        <button
          onclick={onOpenCollection}
          title={`Open “${collectionName}”`}
          style="display:inline-flex;align-items:center;gap:4px;max-width:130px;background:none;border:none;padding:0;cursor:pointer;font-family:inherit;font-size:11.5px;color:var(--muted-fg);"
        >
          <Icon paths={FOLDER_ICON} size={11} width={1.8} color={collectionColor(a.collectionId!)} style="flex-shrink:0;" />
          <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">in {collectionName}</span>
        </button>
        <span style="opacity:.5;">·</span>
      {/if}
      <span>Updated {relativeTime(a.updatedAt)}</span>
      <span style="opacity:.5;">·</span>
      <span style="font-family:'Geist Mono',monospace;">{fmtBytes(a.payloadBytes)}</span>
      {#if isShared}
        <button
          onclick={onCopy}
          title={`Copy ${location.origin}/a/${a.publicSlug}`}
          style="margin-left:auto;display:inline-flex;align-items:center;gap:4px;color:var(--primary);background:none;border:none;padding:0;cursor:pointer;font-family:inherit;"
        >
          <Icon
            paths={[
              "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1",
              "M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
            ]}
            size={12}
          />
          <span style="font-family:'Geist Mono',monospace;font-size:11px;">/a/{a.publicSlug}</span>
        </button>
      {/if}
    </div>
  </div>
</div>
