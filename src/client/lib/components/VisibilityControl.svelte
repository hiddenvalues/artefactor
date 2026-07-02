<script lang="ts">
  import { VIS, VIS_ORDER, type Visibility } from "../format";
  import { overlay } from "../ui.svelte";
  import Icon from "./Icon.svelte";

  interface Props {
    id: string;
    visibility: Visibility;
    variant?: "block" | "pill";
    onChoose: (v: Visibility) => void;
    // S16 — opens the "Manage access" panel; shown only while `selected`.
    onManage?: () => void;
    // S25 (AH20) — the access is inherited from a collection: the control is
    // read-only; `visibility` is the effective tier; the popover explains and
    // links to the collection instead of offering the tier radios.
    inherited?: boolean;
    inheritedFrom?: string;
    onOpenCollection?: () => void;
    // S25 — an explanatory line atop the tier menu (the collection header uses
    // it to say everything inside inherits the choice).
    note?: string;
  }
  let {
    id,
    visibility,
    variant = "block",
    onChoose,
    onManage,
    inherited = false,
    inheritedFrom = "",
    onOpenCollection,
    note = "",
  }: Props = $props();

  const key = $derived(`vis:${id}`);
  const open = $derived(overlay.isOpen(key));
  const meta = $derived(VIS[visibility]);

  const btnStyle = $derived(
    variant === "block"
      ? "width:100%;display:flex;align-items:center;gap:7px;height:30px;padding:0 9px;border:1px solid var(--border);background:var(--subtle);color:var(--fg);border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit;"
      : "display:flex;align-items:center;gap:6px;height:32px;padding:0 11px;border:1px solid var(--border);background:var(--subtle);color:var(--fg);border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap;",
  );
  const menuStyle = $derived(
    variant === "block"
      ? "position:absolute;left:0;right:0;top:36px;z-index:36;background:var(--card);border:1px solid var(--border);border-radius:11px;box-shadow:var(--shadow-md);padding:5px;animation:af-menu .12s ease;"
      : "position:absolute;right:0;top:38px;z-index:36;min-width:236px;background:var(--card);border:1px solid var(--border);border-radius:11px;box-shadow:var(--shadow-md);padding:5px;animation:af-menu .12s ease;",
  );

  // S16 — when shared with specific people, offer a way back into the picker.
  // Never while inherited: the people list belongs to the collection then.
  const showManage = $derived(
    visibility === "selected" && !!onManage && !inherited,
  );
  const MANAGE_ICON = [
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
    "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  ];

  function choose(v: Visibility) {
    overlay.close();
    if (v !== visibility) onChoose(v);
  }
</script>

<div
  style={variant === "block"
    ? "display:flex;flex-direction:column;gap:6px;"
    : "display:inline-flex;align-items:center;gap:6px;flex-shrink:0;"}
>
  {#if showManage && variant === "pill"}
    <button
      onclick={onManage}
      title="Manage who has access"
      style="display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 11px;border:1px solid var(--border);background:var(--card);color:var(--fg);border-radius:8px;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;white-space:nowrap;"
    >
      <Icon paths={MANAGE_ICON} size={13} />
      Manage
    </button>
  {/if}
  <div style="position:relative;{variant === 'block' ? '' : 'flex-shrink:0;'}">
  <button onclick={() => overlay.toggle(key)} style={btnStyle}>
    <Icon paths={meta.icon} size={13} />
    <span style="font-weight:500;">{meta.label}</span>
    {#if inherited}
      <span
        style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;padding:1px 6px;border-radius:999px;background:var(--muted);color:var(--muted-fg);{variant === 'block' ? 'margin-left:auto;' : ''}"
      >
        Inherited
      </span>
    {:else}
      <Icon
        paths={["M6 9l6 6 6-6"]}
        size={12}
        style="color:var(--muted-fg);{variant === 'block' ? 'margin-left:auto;' : ''}"
      />
    {/if}
  </button>
  {#if open && inherited}
    <div style={menuStyle}>
      <div style="padding:9px 10px;">
        <div style="font-size:12.5px;font-weight:600;">Access inherited</div>
        <div style="margin-top:3px;font-size:11.5px;line-height:1.5;color:var(--muted-fg);">
          This artefact is in “{inheritedFrom}” and follows its access. Change it
          on the collection.
        </div>
        {#if onOpenCollection}
          <button
            onclick={() => {
              overlay.close();
              onOpenCollection();
            }}
            style="margin-top:9px;width:100%;display:flex;align-items:center;justify-content:center;gap:7px;height:30px;border:1px solid var(--border);background:var(--card);color:var(--fg);border-radius:8px;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;"
          >
            Open “{inheritedFrom}”
          </button>
        {/if}
      </div>
    </div>
  {:else if open}
    <div style={menuStyle}>
      {#if note}
        <div style="padding:8px 10px 9px;border-bottom:1px solid var(--border);margin-bottom:5px;font-size:11.5px;line-height:1.5;color:var(--muted-fg);">
          {note}
        </div>
      {/if}
      {#each VIS_ORDER as v (v)}
        {@const vm = VIS[v]}
        {@const active = visibility === v}
        <button
          onclick={() => choose(v)}
          style="width:100%;display:flex;align-items:flex-start;gap:9px;padding:8px 9px;border:none;background:{active
            ? 'var(--accent-soft)'
            : 'none'};color:var(--fg);border-radius:8px;cursor:pointer;text-align:left;font-family:inherit;"
        >
          <Icon paths={vm.icon} size={15} style="margin-top:1px;flex-shrink:0;" />
          <span style="flex:1;min-width:0;">
            <span style="display:block;font-size:12.5px;font-weight:500;">{vm.label}</span>
            <span style="display:block;font-size:11px;color:var(--muted-fg);">{vm.desc}</span>
          </span>
          {#if active}
            <Icon
              paths={["M20 6L9 17l-5-5"]}
              size={14}
              width={2.4}
              color="var(--primary)"
              style="flex-shrink:0;margin-top:2px;"
            />
          {/if}
        </button>
      {/each}
    </div>
  {/if}
  </div>
  {#if showManage && variant === "block"}
    <button
      onclick={onManage}
      style="width:100%;display:flex;align-items:center;justify-content:center;gap:7px;height:30px;padding:0 9px;border:1px solid var(--border);background:var(--card);color:var(--fg);border-radius:8px;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;"
    >
      <Icon paths={MANAGE_ICON} size={13} />
      Manage access
    </button>
  {/if}
</div>
