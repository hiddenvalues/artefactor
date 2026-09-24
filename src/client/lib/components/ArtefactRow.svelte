<script lang="ts">
  import type { ArtefactSummary, SetLinkGateRequest } from "../../../shared/contracts";
  import {
    kindMeta,
    fmtBytes,
    relativeTime,
    collectionColor,
    BOOKMARK_ICON,
    FOLDER_ICON,
    STORAGE_ICON,
    STORAGE_LABEL,
    type DataVisibility,
    type Visibility,
  } from "../format";
  import { overlay } from "../ui.svelte";
  import Icon from "./Icon.svelte";
  import MoreMenu from "./MoreMenu.svelte";
  import VisibilityControl from "./VisibilityControl.svelte";
  import LinkGateBadges from "./LinkGateBadges.svelte";

  interface Props {
    a: ArtefactSummary;
    onOpen: () => void;
    onCopy: () => void;
    onEdit: () => void;
    onArchive: () => void;
    onVisibility: (v: Visibility, linkGate?: { password?: string; expiresAt?: string }) => void;
    // S32a — change the link protection of this (public) artefact.
    onLinkGate?: (change: SetLinkGateRequest) => void;
    onManage: () => void;
    // S41 — whether viewers may load each other's saved data.
    onDataVisibility?: (v: DataVisibility) => void;
    // S25/S27 — collections + bookmarks.
    collectionName?: string | null;
    onOpenCollection?: () => void;
    bookmarked?: boolean;
    onBookmark?: () => void;
    onMoveToCollection?: () => void;
    showCollectionChip?: boolean;
  }
  let {
    a,
    onOpen,
    onCopy,
    onEdit,
    onArchive,
    onVisibility,
    onLinkGate,
    onManage,
    onDataVisibility,
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

<div
  style="position:relative;display:flex;align-items:center;gap:14px;padding:11px 14px;background:var(--card);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow);{raised
    ? 'z-index:50;'
    : ''}"
>
  <!-- icon — clickable; opens the artefact like the title does -->
  <button
    type="button"
    onclick={onOpen}
    aria-label={`Open ${a.title}`}
    style="width:42px;height:42px;border-radius:10px;background:{m.tint};display:flex;align-items:center;justify-content:center;flex-shrink:0;border:none;padding:0;cursor:pointer;"
  >
    <Icon paths={m.icon} size={20} width={1.7} color={m.color} />
  </button>
  <div style="flex:1;min-width:0;">
    <button
      onclick={onOpen}
      style="display:block;max-width:100%;text-align:left;background:none;border:none;padding:0;cursor:pointer;font-family:inherit;color:var(--fg);font-size:14px;font-weight:600;letter-spacing:-0.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
    >
      {a.title}
      {#if bookmarked}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="currentColor"
          stroke="currentColor"
          stroke-width="2"
          stroke-linejoin="round"
          style="vertical-align:-1px;margin-left:5px;color:var(--primary);"
        >
          <path d={BOOKMARK_ICON[0]} />
        </svg>
      {/if}
    </button>
    <div
      style="display:flex;align-items:center;gap:7px;margin-top:3px;font-size:11.5px;color:var(--muted-fg);flex-wrap:wrap;"
    >
      <span>{m.label}</span>
      {#if inherited && collectionName && showCollectionChip}
        <span style="opacity:.5;">·</span>
        <button
          onclick={onOpenCollection}
          title={`Open “${collectionName}”`}
          style="display:inline-flex;align-items:center;gap:4px;max-width:150px;background:none;border:none;padding:0;cursor:pointer;font-family:inherit;font-size:11.5px;color:var(--muted-fg);"
        >
          <Icon paths={FOLDER_ICON} size={11} width={1.8} color={collectionColor(a.collectionId!)} style="flex-shrink:0;" />
          <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">in {collectionName}</span>
        </button>
      {/if}
      <LinkGateBadges gate={a.linkGate} variant="inline" />
      {#if a.usesStorage}
        <span title={STORAGE_LABEL} aria-label={STORAGE_LABEL} style="display:inline-flex;align-items:center;color:var(--muted-fg);">
          <Icon paths={STORAGE_ICON} size={12} width={1.8} />
        </span>
      {/if}
      <span style="opacity:.5;">·</span>
      <span>Updated {relativeTime(a.updatedAt)}</span><span style="opacity:.5;">·</span>
      <span style="font-family:'Geist Mono',monospace;">{fmtBytes(a.payloadBytes)}</span>
      {#if isShared}
        <span style="opacity:.5;">·</span>
        <button
          onclick={onCopy}
          title={`Copy ${location.origin}/a/${a.publicSlug}`}
          style="display:inline-flex;align-items:center;gap:4px;color:var(--primary);background:none;border:none;padding:0;cursor:pointer;font-family:inherit;font-size:11.5px;"
        >
          <Icon
            paths={[
              "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1",
              "M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
            ]}
            size={11}
          />
          <span style="font-family:'Geist Mono',monospace;">/a/{a.publicSlug}</span>
        </button>
      {/if}
    </div>
  </div>
  <VisibilityControl
    id={a.id}
    visibility={a.effectiveVisibility}
    variant="pill"
    onChoose={onVisibility}
    {onManage}
    {inherited}
    inheritedFrom={collectionName ?? ""}
    {onOpenCollection}
    usesStorage={a.usesStorage}
    dataVisibility={a.dataVisibility}
    onChooseData={onDataVisibility}
    linkProtection={onLinkGate
      ? {
          current: a.linkGate ?? null,
          onPublish: (gate) => onVisibility("public", gate),
          onSave: onLinkGate,
        }
      : undefined}
  />
  <MoreMenu
    id={a.id}
    {isShared}
    variant="list"
    {onOpen}
    {onCopy}
    {onEdit}
    {onArchive}
    {bookmarked}
    {onBookmark}
    inCollection={inherited}
    {onMoveToCollection}
    downloadHref="/api/artefacts/{a.id}/download"
  />
</div>
