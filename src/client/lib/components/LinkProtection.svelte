<script lang="ts">
  import type { LinkGateSummary } from "../../../shared/contracts";
  import {
    EXPIRY_CHOICES,
    copyText,
    enablePassword,
    formError,
    formFor,
    type LinkProtectionForm,
  } from "../link-protection";
  import Icon from "./Icon.svelte";

  // S32a — the "Link protection" section of the visibility picker: a password
  // and/or an expiry on a public link. `publish` rides along with the change to
  // Public; `edit` changes the gate of an artefact that is already public.
  interface Props {
    mode: "publish" | "edit";
    current?: LinkGateSummary | null;
    submitLabel: string;
    onSubmit: (form: LinkProtectionForm) => void;
    onCancel: () => void;
  }
  let { mode, current = null, submitLabel, onSubmit, onCancel }: Props = $props();

  // Seeded once from the gate being edited; the owner's edits live here after.
  // svelte-ignore state_referenced_locally
  let form = $state<LinkProtectionForm>(formFor(mode === "edit" ? current : null));
  let copyLabel = $state<"Copy" | "Copied" | "Copy failed">("Copy");
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  const error = $derived(formError(form, new Date()));
  const LOCK = ["M5 11h14v10H5z", "M8 11V7a4 4 0 0 1 8 0v4"];
  const CLOCK = ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 6v6l4 2"];
  const COPY = ["M9 9h11v11H9z", "M5 15H4V4h11v1"];

  function togglePassword(on: boolean) {
    form = on ? enablePassword(form) : { ...form, requirePassword: false, keepPassword: false };
  }

  async function copy() {
    copyLabel = await copyText(navigator.clipboard, form.password);
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copyLabel = "Copy"), 1600);
  }

  function fmtDate(iso: string): string {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }

  const label =
    "display:block;font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--muted-fg);";
  const input =
    "width:100%;height:30px;padding:0 8px;border:1px solid var(--border);background:var(--card);color:var(--fg);border-radius:7px;font-size:12px;font-family:inherit;outline:none;";
  const small =
    "height:26px;padding:0 9px;border:1px solid var(--border);background:var(--card);color:var(--fg);border-radius:7px;font-size:11.5px;font-weight:500;cursor:pointer;font-family:inherit;white-space:nowrap;";
</script>

<div style="display:flex;flex-direction:column;gap:10px;padding:8px 9px 6px;">
  <span style={label}>Link protection</span>

  <!-- password -->
  <div style="display:flex;flex-direction:column;gap:6px;">
    {#if form.keepPassword}
      <div style="display:flex;align-items:center;gap:6px;font-size:12px;">
        <Icon paths={LOCK} size={13} />
        <span style="flex:1;">Password set</span>
        <button style={small} onclick={() => togglePassword(true)}>Change</button>
        <button style={small} onclick={() => togglePassword(false)}>Clear</button>
      </div>
    {:else}
      <label style="display:flex;align-items:center;gap:7px;font-size:12px;cursor:pointer;">
        <input
          type="checkbox"
          checked={form.requirePassword}
          onchange={(e) => togglePassword(e.currentTarget.checked)}
        />
        Require a password
      </label>
      {#if form.requirePassword}
        <div style="display:flex;gap:6px;">
          <input
            type="text"
            bind:value={form.password}
            aria-label="Link password"
            autocomplete="off"
            spellcheck="false"
            style="{input}font-family:'Geist Mono',monospace;"
          />
          <button style={small} onclick={copy} title="Copy the password">
            <span style="display:inline-flex;align-items:center;gap:4px;">
              <Icon paths={COPY} size={12} />{copyLabel}
            </span>
          </button>
        </div>
        <span style="font-size:11px;color:var(--muted-fg);">
          Share it with the people you send the link to. It is shown only now.
        </span>
      {/if}
    {/if}
  </div>

  <!-- expiry -->
  <div style="display:flex;flex-direction:column;gap:6px;">
    {#if form.keepExpiry}
      <div style="display:flex;align-items:center;gap:6px;font-size:12px;">
        <Icon paths={CLOCK} size={13} />
        <span style="flex:1;">
          {current?.expiresAt ? `Expires ${fmtDate(current.expiresAt)}` : "Never expires"}
        </span>
        <button style={small} onclick={() => (form = { ...form, keepExpiry: false })}>Change</button>
      </div>
    {:else}
      <label style="display:flex;align-items:center;gap:7px;font-size:12px;">
        <span style="flex-shrink:0;">Link expires</span>
        <select bind:value={form.expiry} style="{input}width:auto;flex:1;">
          {#each EXPIRY_CHOICES as choice (choice.value)}
            <option value={choice.value}>{choice.label}</option>
          {/each}
        </select>
      </label>
      {#if form.expiry === "custom"}
        <input type="datetime-local" bind:value={form.customExpiry} aria-label="Expiry" style={input} />
      {/if}
    {/if}
  </div>

  {#if error}
    <span style="font-size:11.5px;color:var(--destructive);">{error}</span>
  {/if}

  <div style="display:flex;justify-content:flex-end;gap:6px;">
    <button style={small} onclick={onCancel}>Cancel</button>
    <button
      disabled={error !== null}
      onclick={() => onSubmit(form)}
      style="{small}border:none;background:var(--primary);color:var(--primary-fg);font-weight:600;opacity:{error
        ? 0.5
        : 1};"
    >
      {submitLabel}
    </button>
  </div>
</div>
