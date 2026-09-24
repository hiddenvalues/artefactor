<script lang="ts">
  import type { LinkGateSummary } from "../../../shared/contracts";
  import { isExpired } from "../link-protection";
  import Icon from "./Icon.svelte";

  // S32a — the owner's lock / clock badges for a protected public link. A card
  // shows them as chips over the thumbnail; a row inline in its meta line.
  interface Props {
    gate: LinkGateSummary | null | undefined;
    variant: "chip" | "inline";
  }
  let { gate, variant }: Props = $props();

  const LOCK = ["M5 11h14v10H5z", "M8 11V7a4 4 0 0 1 8 0v4"];
  const CLOCK = ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 6v6l4 2"];

  const expired = $derived(isExpired(gate, new Date()));
  const clockLabel = $derived(
    gate?.expiresAt
      ? expired
        ? "Link expired"
        : `Link expires ${new Date(gate.expiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
      : "",
  );
  const style = $derived(
    variant === "chip"
      ? "display:inline-flex;align-items:center;justify-content:center;padding:4px;border-radius:7px;background:var(--card);box-shadow:var(--shadow);"
      : "display:inline-flex;align-items:center;",
  );
</script>

{#if gate?.passwordProtected}
  <span title="Password protected" aria-label="Password protected" style="{style}color:var(--muted-fg);">
    <Icon paths={LOCK} size={variant === "chip" ? 13 : 12} width={1.8} />
  </span>
{/if}
{#if gate?.expiresAt}
  <span
    title={clockLabel}
    aria-label={clockLabel}
    style="{style}color:{expired ? 'var(--destructive)' : 'var(--muted-fg)'};"
  >
    <Icon paths={CLOCK} size={variant === "chip" ? 13 : 12} width={1.8} />
  </span>
{/if}
