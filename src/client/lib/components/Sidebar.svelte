<script lang="ts">
  import type {
    ArtefactSummary,
    CollectionSummary,
  } from "../../../shared/contracts";
  import {
    kindMeta,
    collectionColor,
    BOOKMARK_ICON,
    FOLDER_ICON,
  } from "../format";
  import Icon from "./Icon.svelte";

  // S25/S27 — the collections + bookmarks sidebar (hamburger-toggled, closed by
  // default). Sections top→bottom: Home, Bookmarks (collections before
  // artefacts), the Collections tree, and an Archive footer with a count.
  interface Props {
    view: "dashboard" | "gallery" | "collection" | "archive";
    collections: CollectionSummary[]; // active only
    activeCollectionId: string | null;
    expanded: Record<string, boolean>;
    bookmarkedArtefacts: ArtefactSummary[];
    bookmarkedCollections: CollectionSummary[];
    archivedCount: number;
    onHome: () => void;
    onOpenCollection: (id: string) => void;
    onOpenArchive: () => void;
    onNewCollection: () => void;
    onToggleExpand: (id: string) => void;
    onOpenArtefact: (a: ArtefactSummary) => void;
    onRemoveBookmark: (kind: "artefact" | "collection", id: string) => void;
  }
  let {
    view,
    collections,
    activeCollectionId,
    expanded,
    bookmarkedArtefacts,
    bookmarkedCollections,
    archivedCount,
    onHome,
    onOpenCollection,
    onOpenArchive,
    onNewCollection,
    onToggleExpand,
    onOpenArtefact,
    onRemoveBookmark,
  }: Props = $props();

  interface TreeNode {
    c: CollectionSummary;
    depth: number;
    hasChildren: boolean;
  }

  // Flatten the tree respecting the expand/collapse state, depth-first,
  // name-ordered per level.
  const tree = $derived.by(() => {
    const byParent = new Map<string | null, CollectionSummary[]>();
    for (const c of collections) {
      const list = byParent.get(c.parentId) ?? [];
      list.push(c);
      byParent.set(c.parentId, list);
    }
    for (const list of byParent.values())
      list.sort((a, b) => a.name.localeCompare(b.name));
    const out: TreeNode[] = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const c of byParent.get(parentId) ?? []) {
        const hasChildren = (byParent.get(c.id) ?? []).length > 0;
        out.push({ c, depth, hasChildren });
        if (hasChildren && expanded[c.id]) walk(c.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  });

  const bookmarkedIds = $derived(
    new Set(bookmarkedCollections.map((c) => c.id)),
  );
  const hasBookmarks = $derived(
    bookmarkedArtefacts.length > 0 || bookmarkedCollections.length > 0,
  );

  const navRow = (active: boolean) =>
    `width:100%;display:flex;align-items:center;gap:9px;padding:7px 9px;border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-size:13px;text-align:left;${
      active
        ? "background:var(--accent-soft);color:var(--fg);font-weight:600;"
        : "background:none;color:var(--fg);"
    }`;
  const sectionLabel =
    "font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted-fg);";
</script>

<aside
  style="width:264px;flex-shrink:0;border-right:1px solid var(--border);background:var(--card);display:flex;flex-direction:column;position:sticky;top:0;height:100vh;overflow-y:auto;"
>
  <div style="flex:1;padding:14px 10px;display:flex;flex-direction:column;gap:18px;">
    <!-- Home -->
    <div>
      <button onclick={onHome} style={navRow(view === "dashboard" || view === "gallery")}>
        <Icon paths={["M3 10.5 12 3l9 7.5", "M5 9.5V21h14V9.5"]} size={15} />
        Home
      </button>
    </div>

    <!-- Bookmarks -->
    {#if hasBookmarks}
      <div>
        <div style="{sectionLabel}padding:0 9px 7px;">Bookmarks</div>
        {#each bookmarkedCollections as c (c.id)}
          <div style="display:flex;align-items:center;">
            <button
              onclick={() => onOpenCollection(c.id)}
              style="{navRow(view === 'collection' && activeCollectionId === c.id)}flex:1;min-width:0;"
            >
              <Icon paths={FOLDER_ICON} size={14} width={1.8} color={collectionColor(c.id)} style="flex-shrink:0;" />
              <span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{c.name}</span>
            </button>
            <button
              onclick={() => onRemoveBookmark("collection", c.id)}
              title="Remove bookmark"
              aria-label={`Remove bookmark for ${c.name}`}
              style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;border:none;background:none;color:var(--primary);cursor:pointer;border-radius:6px;flex-shrink:0;"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
                <path d={BOOKMARK_ICON[0]} />
              </svg>
            </button>
          </div>
        {/each}
        {#each bookmarkedArtefacts as a (a.id)}
          {@const m = kindMeta(a.kind)}
          <div style="display:flex;align-items:center;">
            <button
              onclick={() => onOpenArtefact(a)}
              style="{navRow(false)}flex:1;min-width:0;"
            >
              <Icon paths={m.icon} size={14} width={1.8} color={m.color} style="flex-shrink:0;" />
              <span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{a.title}</span>
            </button>
            <button
              onclick={() => onRemoveBookmark("artefact", a.id)}
              title="Remove bookmark"
              aria-label={`Remove bookmark for ${a.title}`}
              style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;border:none;background:none;color:var(--primary);cursor:pointer;border-radius:6px;flex-shrink:0;"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
                <path d={BOOKMARK_ICON[0]} />
              </svg>
            </button>
          </div>
        {/each}
      </div>
    {/if}

    <!-- Collections tree -->
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:0 4px 7px 9px;">
        <span style={sectionLabel}>Collections</span>
        <button
          onclick={onNewCollection}
          title="New collection"
          aria-label="New collection"
          style="width:24px;height:24px;display:flex;align-items:center;justify-content:center;border:none;background:none;color:var(--muted-fg);cursor:pointer;border-radius:6px;"
        >
          <Icon paths={["M12 5v14M5 12h14"]} size={14} width={2.2} />
        </button>
      </div>
      {#if tree.length === 0}
        <div style="padding:2px 9px;font-size:12.5px;color:var(--muted-fg);">
          No collections yet.
        </div>
      {:else}
        {#each tree as node (node.c.id)}
          {@const active = view === "collection" && activeCollectionId === node.c.id}
          <div style="display:flex;align-items:center;padding-left:{node.depth * 15}px;">
            {#if node.hasChildren}
              <button
                onclick={() => onToggleExpand(node.c.id)}
                title={expanded[node.c.id] ? "Collapse" : "Expand"}
                aria-label={expanded[node.c.id] ? "Collapse" : "Expand"}
                style="width:20px;height:26px;display:flex;align-items:center;justify-content:center;border:none;background:none;color:var(--muted-fg);cursor:pointer;flex-shrink:0;"
              >
                <Icon
                  paths={["M9 18l6-6-6-6"]}
                  size={12}
                  style="transition:transform .12s ease;transform:rotate({expanded[node.c.id] ? 90 : 0}deg);"
                />
              </button>
            {:else}
              <span style="width:20px;flex-shrink:0;"></span>
            {/if}
            <button
              onclick={() => onOpenCollection(node.c.id)}
              style="{navRow(active)}flex:1;min-width:0;padding:6px 8px;"
            >
              <Icon paths={FOLDER_ICON} size={14} width={1.8} color={collectionColor(node.c.id)} style="flex-shrink:0;" />
              <span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{node.c.name}</span>
              {#if bookmarkedIds.has(node.c.id)}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round" style="color:var(--primary);flex-shrink:0;">
                  <path d={BOOKMARK_ICON[0]} />
                </svg>
              {/if}
            </button>
          </div>
        {/each}
      {/if}
    </div>
  </div>

  <!-- Archive footer -->
  {#if archivedCount > 0}
    <div style="padding:10px;border-top:1px solid var(--border);">
      <button onclick={onOpenArchive} style={navRow(view === "archive")}>
        <Icon paths={["M2 4h20", "M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9", "M10 13h4"]} size={15} />
        <span style="flex:1;">Archive</span>
        <span style="font-size:11px;font-weight:600;padding:1px 7px;border-radius:999px;background:var(--muted);color:var(--muted-fg);">
          {archivedCount}
        </span>
      </button>
    </div>
  {/if}
</aside>
