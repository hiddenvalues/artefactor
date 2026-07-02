<script lang="ts">
  import type { CollectionSummary } from "../../../shared/contracts";
  import { VIS, VIS_ORDER, type Visibility } from "../format";
  import Icon from "./Icon.svelte";

  // S25 — create / edit ("Rename & access") a collection. Access is chosen on
  // tree roots only (CL4): a nested collection — created under a parent, or
  // edited while nested — shows an inherit note instead of the tier radios.
  interface Props {
    // Editing an existing collection, or creating (with an optional parent).
    editing?: CollectionSummary | null;
    parent?: CollectionSummary | null;
    busy?: boolean;
    serverError?: string | null;
    onClose: () => void;
    onSubmit: (input: { name: string; visibility?: Visibility }) => void;
  }
  let {
    editing = null,
    parent = null,
    busy = false,
    serverError = null,
    onClose,
    onSubmit,
  }: Props = $props();

  // The modal mounts fresh per open ({#if} in App.svelte), so capturing the
  // initial `editing` values is intended — the form is then user-owned state.
  // svelte-ignore state_referenced_locally
  let name = $state(editing?.name ?? "");
  // svelte-ignore state_referenced_locally
  let visibility = $state<Visibility>(editing?.visibility ?? "private");
  let nameError = $state<string | null>(null);

  const isRoot = $derived(editing ? editing.parentId === null : parent === null);
  const title = $derived(
    editing ? "Rename & access" : parent ? "New sub-collection" : "New collection",
  );
  const subtitle = $derived(
    editing
      ? "Update the name and access level."
      : parent
        ? `Inside “${parent.name}”`
        : "A new top-level collection.",
  );

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      nameError = "Give your collection a name.";
      return;
    }
    nameError = null;
    onSubmit({ name: trimmed, visibility: isRoot ? visibility : undefined });
  }
</script>

<div style="position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:24px;animation:af-fade .14s ease;">
  <div
    onclick={() => !busy && onClose()}
    role="presentation"
    style="position:absolute;inset:0;background:rgba(9,9,11,0.5);backdrop-filter:blur(2px);"
  ></div>
  <div
    style="position:relative;width:100%;max-width:420px;background:var(--card);border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow-lg);padding:22px;animation:af-pop .16s cubic-bezier(.2,.8,.2,1);"
  >
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
      <div style="min-width:0;">
        <h2 style="margin:0;font-size:16px;font-weight:600;letter-spacing:-0.01em;">{title}</h2>
        <p style="margin:4px 0 0;font-size:12.5px;color:var(--muted-fg);">{subtitle}</p>
      </div>
      <button
        onclick={onClose}
        aria-label="Close"
        style="width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:8px;border:none;background:none;color:var(--muted-fg);cursor:pointer;flex-shrink:0;"
      >
        <Icon paths={["M18 6L6 18M6 6l12 12"]} size={17} />
      </button>
    </div>

    <div style="margin-top:16px;display:flex;flex-direction:column;gap:14px;">
      <div>
        <label for="collection-name" style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;">Name</label>
        <input
          id="collection-name"
          bind:value={name}
          placeholder="e.g. Q4 Experiments"
          onkeydown={(e) => e.key === "Enter" && submit()}
          style="width:100%;height:38px;padding:0 12px;border:1px solid {nameError ? 'var(--destructive)' : 'var(--border)'};background:var(--card);color:var(--fg);border-radius:9px;font-size:13.5px;font-family:inherit;outline:none;"
        />
        {#if nameError}
          <div style="margin-top:5px;font-size:11.5px;color:var(--destructive);">{nameError}</div>
        {/if}
      </div>

      {#if isRoot}
        <div>
          <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Access</div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            {#each VIS_ORDER as v (v)}
              {@const vm = VIS[v]}
              {@const active = visibility === v}
              <button
                onclick={() => (visibility = v)}
                style="display:flex;align-items:flex-start;gap:9px;padding:9px 10px;border:1px solid {active ? 'var(--primary)' : 'var(--border)'};background:{active ? 'var(--accent-soft)' : 'var(--card)'};color:var(--fg);border-radius:10px;cursor:pointer;text-align:left;font-family:inherit;"
              >
                <Icon paths={vm.icon} size={15} style="margin-top:1px;flex-shrink:0;" />
                <span style="flex:1;min-width:0;">
                  <span style="display:block;font-size:12.5px;font-weight:500;">{vm.label}</span>
                  <span style="display:block;font-size:11px;color:var(--muted-fg);">{vm.desc}</span>
                </span>
                {#if active}
                  <Icon paths={["M20 6L9 17l-5-5"]} size={14} width={2.4} color="var(--primary)" style="flex-shrink:0;margin-top:2px;" />
                {/if}
              </button>
            {/each}
          </div>
          <p style="margin:8px 0 0;font-size:11.5px;line-height:1.5;color:var(--muted-fg);">
            Artefacts and sub-collections inside inherit this access level.
          </p>
        </div>
      {:else}
        <div style="padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--subtle);font-size:12px;line-height:1.5;color:var(--muted-fg);">
          Access is inherited from the top-level collection — everything in the
          tree follows it.
        </div>
      {/if}

      {#if serverError}
        <div style="font-size:12px;color:var(--destructive);">{serverError}</div>
      {/if}
    </div>

    <div style="display:flex;justify-content:flex-end;gap:9px;margin-top:20px;">
      <button
        onclick={onClose}
        disabled={busy}
        style="height:38px;padding:0 15px;border:1px solid var(--border);background:var(--card);color:var(--fg);border-radius:9px;font-size:13px;font-weight:500;cursor:pointer;font-family:inherit;"
      >
        Cancel
      </button>
      <button
        onclick={submit}
        disabled={busy}
        style="height:38px;padding:0 15px;border:none;background:var(--primary);color:var(--primary-fg);border-radius:9px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;opacity:{busy ? 0.7 : 1};"
      >
        {editing ? "Save" : "Create collection"}
      </button>
    </div>
  </div>
</div>
