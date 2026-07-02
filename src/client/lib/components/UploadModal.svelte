<script lang="ts">
  import type { ArtefactSummary } from "../../../shared/contracts";
  import type { ArtefactKind } from "../../../domain/artefact/kind";
  import { KINDS, KIND_ORDER, VIS, fmtBytes } from "../format";
  import Icon from "./Icon.svelte";

  // Glyphs whose circle/rect the path-only Icon can't express otherwise.
  const ALERT = ["M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20", "M12 8v4", "M12 16h.01"];

  interface Props {
    /** Mounted only when the modal is open (App wraps it in `{#if}`). When
     *  `editing` is set we're in edit mode; otherwise it's a new upload. */
    editing: ArtefactSummary | null;
    busy: boolean;
    serverError: string | null;
    onClose: () => void;
    onSubmit: (input: {
      title: string;
      kind: ArtefactKind;
      file: File | null;
    }) => void;
  }
  let { editing, busy, serverError, onClose, onSubmit }: Props = $props();

  const isEdit = $derived(!!editing);

  // Seeded once from `editing` on mount; the modal is remounted per open, so the
  // one-time read of the prop here is intentional.
  // svelte-ignore state_referenced_locally
  let title = $state(editing?.title ?? "");
  // svelte-ignore state_referenced_locally
  let kind = $state<ArtefactKind>((editing?.kind as ArtefactKind) ?? "prototype");
  let picked = $state<File | null>(null);
  let dragActive = $state(false);
  let titleError = $state<string | null>(null);
  let fileError = $state<string | null>(null);
  let fileInput: HTMLInputElement;

  function slugName(t: string): string {
    return (
      t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 18) ||
      "artefact"
    ) + ".html";
  }

  // Something occupies the file slot when a new file is picked, or (in edit mode)
  // the existing payload is shown as "current" until replaced.
  const hasFile = $derived(!!picked || isEdit);
  const fileName = $derived(picked ? picked.name : isEdit ? slugName(editing!.title) : "");
  const fileMeta = $derived(
    picked
      ? `${fmtBytes(picked.size)} · HTML`
      : isEdit
        ? `${fmtBytes(editing!.payloadBytes)} · current payload`
        : "",
  );

  const isHtml = (name: string) => /\.html?$/i.test(name);

  function setFile(f: File | null) {
    picked = f;
    fileError = f && !isHtml(f.name)
      ? "That isn’t an .html file. Upload a single HTML deliverable."
      : null;
  }

  function onPick(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0] ?? null;
    if (f) setFile(f);
  }
  function clearFile(e: MouseEvent) {
    e.stopPropagation();
    picked = null;
    fileError = null;
    if (fileInput) fileInput.value = "";
  }
  function onDragOver(e: DragEvent) {
    e.preventDefault();
    dragActive = true;
  }
  function onDragLeave(e: DragEvent) {
    e.preventDefault();
    dragActive = false;
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragActive = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) setFile(f);
  }

  function submit() {
    titleError = title.trim() ? null : "Give your artefact a title.";
    if (!isEdit) {
      if (!picked) fileError = "Choose an .html file to upload.";
      else if (!isHtml(picked.name))
        fileError = "That isn’t an .html file. Upload a single HTML deliverable.";
    }
    if (titleError || fileError) return;
    onSubmit({ title: title.trim(), kind, file: picked });
  }

  const dropBorder = $derived(
    fileError ? "var(--destructive)" : dragActive ? "var(--primary)" : "var(--border-strong)",
  );
  const dropBg = $derived(dragActive ? "var(--accent-soft)" : "var(--subtle)");
</script>

<div
  style="position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:24px;animation:af-fade .14s ease;"
>
  <div
    onclick={onClose}
    role="presentation"
    style="position:absolute;inset:0;background:rgba(9,9,11,0.5);backdrop-filter:blur(2px);"
  ></div>
  <div
    style="position:relative;width:100%;max-width:460px;background:var(--card);border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow-lg);animation:af-pop .16s cubic-bezier(.2,.8,.2,1);"
  >
    <div
      style="display:flex;align-items:center;justify-content:space-between;padding:18px 20px 14px;border-bottom:1px solid var(--border);"
    >
      <div>
        <h2 style="margin:0;font-size:16px;font-weight:600;letter-spacing:-0.01em;">
          {isEdit ? "Edit artefact" : "New artefact"}
        </h2>
        <p style="margin:3px 0 0;font-size:12.5px;color:var(--muted-fg);">
          {isEdit
            ? "Update the title, kind, or replace the HTML file."
            : "Upload a self-contained HTML deliverable."}
        </p>
      </div>
      <button
        onclick={onClose}
        style="width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:8px;border:none;background:none;color:var(--muted-fg);cursor:pointer;"
        aria-label="Close"
      >
        <Icon paths={["M18 6L6 18M6 6l12 12"]} size={17} />
      </button>
    </div>

    <div style="padding:20px;display:flex;flex-direction:column;gap:18px;">
      <!-- Title -->
      <div>
        <label for="up-title" style="display:block;font-size:12.5px;font-weight:500;margin-bottom:7px;">
          Title <span style="color:var(--destructive);">*</span>
        </label>
        <input
          id="up-title"
          bind:value={title}
          oninput={() => (titleError = null)}
          placeholder="e.g. Pricing Page Redesign"
          style="width:100%;height:38px;padding:0 12px;border:1px solid {titleError
            ? 'var(--destructive)'
            : 'var(--border)'};background:var(--card);color:var(--fg);border-radius:9px;font-size:13.5px;font-family:inherit;outline:none;"
        />
        {#if titleError}
          <div style="display:flex;align-items:center;gap:5px;margin-top:6px;font-size:11.5px;color:var(--destructive);">
            <Icon paths={ALERT} size={13} />{titleError}
          </div>
        {/if}
      </div>

      <!-- Kind -->
      <div>
        <span style="display:block;font-size:12.5px;font-weight:500;margin-bottom:7px;">Kind</span>
        <div style="display:flex;flex-wrap:wrap;gap:7px;">
          {#each KIND_ORDER as k (k)}
            {@const m = KINDS[k]}
            {@const active = kind === k}
            <button
              onclick={() => (kind = k)}
              style="display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 11px;border-radius:8px;font-size:12.5px;font-weight:500;cursor:pointer;font-family:inherit;border:1px solid {active
                ? m.color
                : 'var(--border)'};background:{active ? m.tint : 'var(--card)'};color:var(--fg);"
            >
              <Icon paths={m.icon} size={14} width={1.9} color={active ? m.color : 'var(--muted-fg)'} />
              {m.label}
            </button>
          {/each}
        </div>
      </div>

      <!-- File dropzone -->
      <div>
        <label for="up-file" style="display:block;font-size:12.5px;font-weight:500;margin-bottom:7px;">
          HTML file {#if !isEdit}<span style="color:var(--destructive);">*</span>{/if}
        </label>
        <input
          id="up-file"
          bind:this={fileInput}
          type="file"
          accept=".html,.htm,text/html"
          onchange={onPick}
          style="display:none;"
        />
        <div
          role="button"
          tabindex="0"
          ondragover={onDragOver}
          ondragleave={onDragLeave}
          ondrop={onDrop}
          onclick={() => fileInput?.click()}
          onkeydown={(e) => (e.key === "Enter" || e.key === " ") && fileInput?.click()}
          style="border:1.5px dashed {dropBorder};background:{dropBg};border-radius:12px;padding:22px 16px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:border-color .12s, background .12s;min-height:96px;"
        >
          {#if hasFile}
            <div style="display:flex;align-items:center;gap:11px;width:100%;">
              <div style="width:38px;height:38px;border-radius:9px;background:var(--accent-soft);color:var(--primary);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <Icon paths={["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6"]} size={18} width={1.8} />
              </div>
              <div style="flex:1;min-width:0;text-align:left;">
                <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{fileName}</div>
                <div style="font-size:11.5px;color:var(--muted-fg);">{fileMeta}</div>
              </div>
              {#if picked}
                <button
                  onclick={clearFile}
                  style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:7px;border:none;background:none;color:var(--muted-fg);cursor:pointer;flex-shrink:0;"
                  aria-label="Remove file"
                >
                  <Icon paths={["M18 6L6 18M6 6l12 12"]} size={15} />
                </button>
              {/if}
            </div>
          {:else}
            <div style="display:flex;flex-direction:column;align-items:center;gap:7px;pointer-events:none;">
              <div style="width:40px;height:40px;border-radius:10px;background:var(--muted);color:var(--muted-fg);display:flex;align-items:center;justify-content:center;">
                <Icon paths={["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M17 8l-5-5-5 5", "M12 3v12"]} size={19} width={1.8} />
              </div>
              <div style="font-size:13px;">
                <span style="color:var(--primary);font-weight:600;">Click to upload</span>
                <span style="color:var(--muted-fg);"> or drag and drop</span>
              </div>
              <div style="font-size:11.5px;color:var(--muted-fg);">
                A single self-contained <span style="font-family:'Geist Mono',monospace;">.html</span> file
              </div>
            </div>
          {/if}
        </div>
        {#if fileError}
          <div style="display:flex;align-items:center;gap:5px;margin-top:6px;font-size:11.5px;color:var(--destructive);">
            <Icon paths={ALERT} size={13} />{fileError}
          </div>
        {/if}
      </div>

      {#if !isEdit}
        <div style="display:flex;align-items:center;gap:9px;padding:11px 12px;background:var(--muted);border-radius:10px;font-size:12px;color:var(--muted-fg);">
          <Icon paths={VIS.private.icon} size={15} width={1.9} style="flex-shrink:0;" />
          <span>
            New artefacts start
            <strong style="color:var(--fg);font-weight:600;">Private</strong> — you
            can share them or add them to a collection after uploading.
          </span>
        </div>
      {/if}

      {#if serverError}
        <div style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--destructive);">
          <Icon paths={ALERT} size={13} />{serverError}
        </div>
      {/if}
    </div>

    <div style="display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid var(--border);">
      <button
        onclick={onClose}
        style="height:38px;padding:0 16px;border:1px solid var(--border);background:var(--card);color:var(--fg);border-radius:9px;font-size:13px;font-weight:500;cursor:pointer;font-family:inherit;"
      >
        Cancel
      </button>
      <button
        onclick={submit}
        disabled={busy}
        style="height:38px;padding:0 18px;border:none;background:var(--primary);color:var(--primary-fg);border-radius:9px;font-size:13px;font-weight:600;cursor:{busy
          ? 'default'
          : 'pointer'};font-family:inherit;opacity:{busy ? 0.7 : 1};"
      >
        {busy ? "Working…" : isEdit ? "Save changes" : "Upload artefact"}
      </button>
    </div>
  </div>
</div>
