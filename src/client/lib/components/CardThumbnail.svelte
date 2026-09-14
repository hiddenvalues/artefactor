<script lang="ts">
  import type { Snippet } from "svelte";
  import { kindMeta } from "../format";
  import Icon from "./Icon.svelte";

  // S35 — the preview area atop a grid card (dashboard, collection page, "Shared
  // with you"). Shows the rendered thumbnail when there is one; with none, or when
  // the image fails to load (e.g. access changed since the list was fetched), the
  // striped kind placeholder. The kind badge and the card's chips stay overlaid.
  interface Props {
    kind: string;
    title: string;
    thumbnailUrl: string | null;
    onOpen: () => void;
    // The upper-right chips (bookmark / storage indicators).
    chips?: Snippet;
  }
  let { kind, title, thumbnailUrl, onOpen, chips }: Props = $props();

  const m = $derived(kindMeta(kind));
  // Remember the URL that failed, so a newer render (a new `?v=`) is tried again.
  let failedUrl = $state<string | null>(null);
  const showImage = $derived(thumbnailUrl !== null && thumbnailUrl !== failedUrl);
</script>

<!-- clickable upper part; opens the artefact like the title does -->
<button
  type="button"
  onclick={onOpen}
  aria-label={`Open ${title}`}
  style="position:relative;display:flex;width:100%;aspect-ratio:16 / 10;padding:0;align-items:center;justify-content:center;background:{m.tint};--thumb-stripe:{m.color};border:none;border-bottom:1px solid var(--border);overflow:hidden;border-top-left-radius:12px;border-top-right-radius:12px;cursor:pointer;font-family:inherit;"
>
  {#if showImage}
    <img
      src={thumbnailUrl}
      alt=""
      loading="lazy"
      decoding="async"
      onerror={() => (failedUrl = thumbnailUrl)}
      style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top;"
    />
  {:else}
    <div
      style="position:absolute;inset:0;opacity:.5;background-image:repeating-linear-gradient(135deg, transparent 0 9px, var(--thumb-stripe) 9px 10px);"
    ></div>
    <Icon paths={m.icon} size={30} width={1.7} color={m.color} style="position:relative;" />
  {/if}
  <span
    style="position:absolute;top:9px;left:9px;display:inline-flex;align-items:center;padding:3px 8px;border-radius:7px;background:var(--card);color:{m.color};box-shadow:var(--shadow);"
  >
    <span style="font-family:'Geist Mono',monospace;font-size:10.5px;letter-spacing:0.02em;">
      {m.label}
    </span>
  </span>
  {#if chips}
    <span style="position:absolute;top:9px;right:9px;display:inline-flex;gap:5px;">
      {@render chips()}
    </span>
  {/if}
</button>
