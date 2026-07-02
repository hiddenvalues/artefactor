<script lang="ts">
  import type {
    ArtefactSummary,
    CollectionSummary,
  } from "../../../shared/contracts";
  import { collectionColor, FOLDER_ICON, HOME_ICON } from "../format";
  import Icon from "./Icon.svelte";

  // S25 — the add/move-to-collection modal: a nested single-select tree picker
  // with a "Top level (no collection)" option and an inline "New collection"
  // that creates under the selected target without leaving the modal.
  interface Props {
    artefact: ArtefactSummary;
    // Active targets: the viewer's own collections plus contributable shared
    // trees (S29/CL12) — mixed in one forest, distinguished by ownerId.
    collections: CollectionSummary[];
    // The signed-in user — gates the inline "New collection" (own targets only:
    // creating nodes inside someone else's tree is owner-only, CL9).
    viewerId: string;
    busy?: boolean;
    onClose: () => void;
    onConfirm: (targetId: string | null) => void;
    // Creates a collection (name, parent) and returns the summary so the picker
    // can select it. The caller owns the collections list refresh.
    onCreate: (name: string, parentId: string | null) => Promise<CollectionSummary>;
  }
  let {
    artefact,
    collections,
    viewerId,
    busy = false,
    onClose,
    onConfirm,
    onCreate,
  }: Props = $props();

  let target = $state<string | null>(null);
  let expanded = $state<Record<string, boolean>>({});
  let inlineOpen = $state(false);
  let inlineName = $state("");
  let inlineBusy = $state(false);
  let inlineError = $state<string | null>(null);

  // Preselect the artefact's current collection and expand its ancestors.
  $effect(() => {
    target = artefact.collectionId;
    const byId = new Map(collections.map((c) => [c.id, c]));
    const open: Record<string, boolean> = {};
    let node = artefact.collectionId ? byId.get(artefact.collectionId) : undefined;
    while (node) {
      open[node.id] = true;
      node = node.parentId ? byId.get(node.parentId) : undefined;
    }
    expanded = open;
  });

  interface TreeNode {
    c: CollectionSummary;
    depth: number;
    hasChildren: boolean;
  }
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

  const byId = $derived(new Map(collections.map((c) => [c.id, c])));
  const targetName = $derived(target ? (byId.get(target)?.name ?? "") : null);
  const unchanged = $derived(target === artefact.collectionId);
  // Inline create works at top level or under the viewer's own nodes (CL9).
  const canCreateHere = $derived(
    target === null || byId.get(target)?.ownerId === viewerId,
  );
  const confirmLabel = $derived(
    target === null ? "Move to top level" : `Add to ${targetName}`,
  );
  const inlineHint = $derived(
    target === null ? "at top level" : `in ${targetName}`,
  );

  async function createInline() {
    const name = inlineName.trim();
    if (!name) return;
    inlineBusy = true;
    inlineError = null;
    try {
      const created = await onCreate(name, target);
      if (target) expanded = { ...expanded, [target]: true };
      target = created.id;
      inlineOpen = false;
      inlineName = "";
    } catch {
      inlineError = "Could not create the collection.";
    } finally {
      inlineBusy = false;
    }
  }

  const rowStyle = (active: boolean) =>
    `flex:1;min-width:0;display:flex;align-items:center;gap:8px;padding:7px 9px;border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-size:13px;text-align:left;${
      active
        ? "background:var(--accent-soft);color:var(--fg);font-weight:600;"
        : "background:none;color:var(--fg);"
    }`;
</script>

<div style="position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:24px;animation:af-fade .14s ease;">
  <div
    onclick={() => !busy && onClose()}
    role="presentation"
    style="position:absolute;inset:0;background:rgba(9,9,11,0.5);backdrop-filter:blur(2px);"
  ></div>
  <div
    style="position:relative;width:100%;max-width:440px;background:var(--card);border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow-lg);animation:af-pop .16s cubic-bezier(.2,.8,.2,1);display:flex;flex-direction:column;max-height:calc(100vh - 48px);"
  >
    <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 20px 14px;border-bottom:1px solid var(--border);">
      <div style="min-width:0;">
        <h2 style="margin:0;font-size:16px;font-weight:600;letter-spacing:-0.01em;">
          {artefact.collectionId ? "Move to collection" : "Add to collection"}
        </h2>
        <p style="margin:3px 0 0;font-size:12.5px;color:var(--muted-fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          “{artefact.title}”
        </p>
      </div>
      <button
        onclick={onClose}
        aria-label="Close"
        style="width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:8px;border:none;background:none;color:var(--muted-fg);cursor:pointer;flex-shrink:0;"
      >
        <Icon paths={["M18 6L6 18M6 6l12 12"]} size={17} />
      </button>
    </div>

    <div style="padding:12px;overflow-y:auto;">
      <!-- Top level -->
      <div style="display:flex;align-items:center;">
        <span style="width:20px;flex-shrink:0;"></span>
        <button onclick={() => (target = null)} style={rowStyle(target === null)}>
          <Icon paths={HOME_ICON} size={14} style="flex-shrink:0;" />
          <span style="flex:1;">Top level (no collection)</span>
          {#if target === null}
            <Icon paths={["M20 6L9 17l-5-5"]} size={14} width={2.4} color="var(--primary)" style="flex-shrink:0;" />
          {/if}
        </button>
      </div>

      <!-- Tree -->
      {#each tree as node (node.c.id)}
        {@const active = target === node.c.id}
        <div style="display:flex;align-items:center;padding-left:{node.depth * 15}px;">
          {#if node.hasChildren}
            <button
              onclick={() => (expanded = { ...expanded, [node.c.id]: !expanded[node.c.id] })}
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
          <button onclick={() => (target = node.c.id)} style={rowStyle(active)}>
            <Icon paths={FOLDER_ICON} size={14} width={1.8} color={collectionColor(node.c.id)} style="flex-shrink:0;" />
            <span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{node.c.name}</span>
            {#if node.c.ownerId !== viewerId}
              <span style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;padding:1px 6px;border-radius:999px;background:var(--muted);color:var(--muted-fg);flex-shrink:0;">
                Shared
              </span>
            {/if}
            {#if active}
              <Icon paths={["M20 6L9 17l-5-5"]} size={14} width={2.4} color="var(--primary)" style="flex-shrink:0;" />
            {/if}
          </button>
        </div>
      {/each}

      <!-- Inline new collection (own targets only, CL9) -->
      <div style="margin-top:10px;padding:0 0 0 20px;">
        {#if !canCreateHere}
          <!-- Creating inside someone else's tree is theirs to do. -->
        {:else if inlineOpen}
          <div style="display:flex;align-items:center;gap:7px;">
            <input
              bind:value={inlineName}
              placeholder={`Name ${inlineHint}`}
              onkeydown={(e) => e.key === "Enter" && createInline()}
              style="flex:1;height:32px;padding:0 10px;border:1px solid var(--border);background:var(--card);color:var(--fg);border-radius:8px;font-size:12.5px;font-family:inherit;outline:none;"
            />
            <button
              onclick={createInline}
              disabled={inlineBusy || !inlineName.trim()}
              style="height:32px;padding:0 12px;border:none;background:var(--primary);color:var(--primary-fg);border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;opacity:{inlineBusy || !inlineName.trim() ? 0.6 : 1};"
            >
              Create
            </button>
            <button
              onclick={() => {
                inlineOpen = false;
                inlineName = "";
                inlineError = null;
              }}
              aria-label="Cancel"
              style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:none;background:none;color:var(--muted-fg);cursor:pointer;border-radius:7px;"
            >
              <Icon paths={["M18 6L6 18M6 6l12 12"]} size={14} />
            </button>
          </div>
          {#if inlineError}
            <div style="margin-top:5px;font-size:11.5px;color:var(--destructive);">{inlineError}</div>
          {/if}
        {:else}
          <button
            onclick={() => (inlineOpen = true)}
            style="width:100%;display:flex;align-items:center;gap:8px;padding:8px 9px;border:1.5px dashed var(--border-strong);background:none;color:var(--muted-fg);border-radius:9px;font-size:12.5px;cursor:pointer;font-family:inherit;"
          >
            <Icon paths={["M12 5v14M5 12h14"]} size={13} width={2.2} />
            New collection <span style="opacity:.75;">{inlineHint}</span>
          </button>
        {/if}
      </div>
    </div>

    <div style="display:flex;justify-content:flex-end;gap:9px;padding:14px 20px;border-top:1px solid var(--border);">
      <button
        onclick={onClose}
        disabled={busy}
        style="height:38px;padding:0 15px;border:1px solid var(--border);background:var(--card);color:var(--fg);border-radius:9px;font-size:13px;font-weight:500;cursor:pointer;font-family:inherit;"
      >
        Cancel
      </button>
      <button
        onclick={() => !unchanged && onConfirm(target)}
        disabled={busy || unchanged}
        style="height:38px;padding:0 15px;border:none;background:{unchanged ? 'var(--muted)' : 'var(--primary)'};color:{unchanged ? 'var(--muted-fg)' : 'var(--primary-fg)'};border-radius:9px;font-size:13px;font-weight:600;cursor:{busy || unchanged ? 'default' : 'pointer'};font-family:inherit;opacity:{busy ? 0.7 : 1};"
      >
        {confirmLabel}
      </button>
    </div>
  </div>
</div>
