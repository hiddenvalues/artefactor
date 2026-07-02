<script lang="ts">
  import { initials } from "../format";
  import { overlay } from "../ui.svelte";
  import Icon from "./Icon.svelte";

  interface Props {
    view: "dashboard" | "gallery" | "collection" | "archive";
    query: string;
    searchPlaceholder: string;
    user: { name: string; email: string };
    onSearch: (q: string) => void;
    onGoDashboard: () => void;
    onGoGallery: () => void;
    onOpenUpload: () => void;
    onSignOut: () => void;
    // S25 — toggles the collections/bookmarks sidebar (closed by default).
    onToggleSidebar: () => void;
  }
  let {
    view,
    query,
    searchPlaceholder,
    user,
    onSearch,
    onGoDashboard,
    onGoGallery,
    onOpenUpload,
    onSignOut,
    onToggleSidebar,
  }: Props = $props();

  const accountOpen = $derived(overlay.isOpen("account"));
  const displayName = $derived(user.name || user.email);

  const tab = (active: boolean) =>
    `height:30px;padding:0 14px;border:none;border-radius:7px;font-size:13px;font-weight:500;cursor:pointer;font-family:inherit;${
      active
        ? "background:var(--card);color:var(--fg);box-shadow:var(--shadow);"
        : "background:none;color:var(--muted-fg);"
    }`;
</script>

<header
  style="position:sticky;top:0;z-index:20;background:color-mix(in srgb, var(--bg) 86%, transparent);backdrop-filter:saturate(160%) blur(10px);border-bottom:1px solid var(--border);"
>
  <div style="display:flex;align-items:center;gap:14px;padding:11px 24px;">
    <button
      onclick={onToggleSidebar}
      title="Toggle sidebar"
      aria-label="Toggle sidebar"
      style="width:34px;height:34px;display:flex;align-items:center;justify-content:center;border:none;background:none;color:var(--muted-fg);border-radius:8px;cursor:pointer;flex-shrink:0;"
    >
      <Icon paths={["M4 6h16", "M4 12h16", "M4 18h16"]} size={17} />
    </button>
    <div style="display:flex;align-items:center;gap:10px;margin-right:4px;">
      <div style="width:28px;height:28px;border-radius:7px;background:var(--primary);display:flex;align-items:center;justify-content:center;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <rect x="4" y="3" width="12" height="15" rx="2.5" fill="var(--primary-fg)" opacity="0.5" />
          <rect x="8" y="6" width="12" height="15" rx="2.5" fill="var(--primary-fg)" />
        </svg>
      </div>
      <span style="font-size:15px;font-weight:600;letter-spacing:-0.02em;">Artefactor</span>
    </div>

    <div style="display:flex;align-items:center;gap:2px;background:var(--muted);padding:3px;border-radius:9px;">
      <button onclick={onGoDashboard} style={tab(view === "dashboard")}>Your artefacts</button>
      <button onclick={onGoGallery} style={tab(view === "gallery")}>Shared with you</button>
    </div>

    <div style="position:relative;flex:1;max-width:420px;">
      <svg
        style="position:absolute;left:11px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--muted-fg);"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
      <input
        value={query}
        oninput={(e) => onSearch(e.currentTarget.value)}
        placeholder={searchPlaceholder}
        style="width:100%;height:36px;padding:0 12px 0 33px;border:1px solid var(--border);background:var(--card);color:var(--fg);border-radius:9px;font-size:13px;font-family:inherit;outline:none;"
      />
    </div>

    <div style="flex:1;"></div>

    <button
      onclick={onOpenUpload}
      style="display:inline-flex;align-items:center;gap:7px;height:36px;padding:0 14px;border-radius:9px;background:var(--primary);color:var(--primary-fg);font-weight:600;font-size:13px;border:none;cursor:pointer;box-shadow:var(--shadow);font-family:inherit;"
    >
      <Icon paths={["M12 5v14M5 12h14"]} size={16} width={2.2} />
      New artefact
    </button>

    <div style="position:relative;flex-shrink:0;">
      <button
        onclick={() => overlay.toggle("account")}
        title="Account"
        style="display:flex;align-items:center;gap:7px;height:36px;padding:0 9px 0 6px;border:1px solid var(--border);background:var(--card);color:var(--fg);border-radius:9px;cursor:pointer;font-family:inherit;"
      >
        <span style="width:24px;height:24px;border-radius:50%;background:var(--accent-soft);color:var(--primary);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;">
          {initials(displayName)}
        </span>
        <Icon paths={["M6 9l6 6 6-6"]} size={13} style="color:var(--muted-fg);" />
      </button>
      {#if accountOpen}
        <div
          style="position:absolute;right:0;top:44px;z-index:40;min-width:230px;background:var(--card);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow-md);padding:6px;animation:af-menu .12s ease;"
        >
          <div style="display:flex;align-items:center;gap:10px;padding:8px 8px 10px;">
            <div style="width:34px;height:34px;border-radius:50%;background:var(--accent-soft);color:var(--primary);display:flex;align-items:center;justify-content:center;font-size:12.5px;font-weight:600;flex-shrink:0;">
              {initials(displayName)}
            </div>
            <div style="min-width:0;">
              <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                {displayName}
              </div>
              <div style="font-size:11.5px;color:var(--muted-fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                {user.email}
              </div>
            </div>
          </div>
          <div style="height:1px;background:var(--border);margin:2px 4px 6px;"></div>
          <button
            onclick={() => {
              overlay.close();
              onSignOut();
            }}
            style="width:100%;display:flex;align-items:center;gap:9px;padding:8px 9px;border:none;background:none;color:var(--destructive);font-size:13px;font-family:inherit;border-radius:7px;cursor:pointer;text-align:left;"
          >
            <Icon
              paths={["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "M16 17l5-5-5-5", "M21 12H9"]}
              size={15}
            />Sign out
          </button>
        </div>
      {/if}
    </div>
  </div>
</header>
