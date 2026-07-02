<script lang="ts">
  import type { UserRef } from "../../../shared/contracts";
  import { api, ApiError } from "../api";
  import { initials } from "../format";
  import Icon from "./Icon.svelte";

  const ALERT = ["M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20", "M12 8v4", "M12 16h.01"];
  const SEARCH = ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "M21 21l-4.3-4.3"];

  // S16/S25 — the same member picker manages an artefact's `selected`-tier list
  // and a collection root's (whose people the whole tree inherits, CL4).
  interface Props {
    target: { kind: "artefact" | "collection"; id: string; title: string };
    onClose: () => void;
  }
  let { target, onClose }: Props = $props();

  const calls = $derived(
    target.kind === "artefact"
      ? {
          get: () => api.getAccess(target.id),
          grant: (userId: string) => api.grantAccess(target.id, userId),
          revoke: (userId: string) => api.revokeAccess(target.id, userId),
        }
      : {
          get: () => api.getCollectionAccess(target.id),
          grant: (userId: string) => api.grantCollectionAccess(target.id, userId),
          revoke: (userId: string) => api.revokeCollectionAccess(target.id, userId),
        },
  );

  let members = $state<UserRef[]>([]);
  let loading = $state(true);
  let query = $state("");
  let results = $state<UserRef[]>([]);
  let searching = $state(false);
  let busyId = $state<string | null>(null);
  let error = $state<string | null>(null);

  const memberIds = $derived(new Set(members.map((m) => m.id)));
  // Hide people already on the list from the search results.
  const candidates = $derived(results.filter((u) => !memberIds.has(u.id)));

  // Load the current members once when the modal opens.
  $effect(() => {
    let cancelled = false;
    calls
      .get()
      .then((m) => {
        if (!cancelled) members = m;
      })
      .catch(() => {
        if (!cancelled) error = "Could not load the current list.";
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });
    return () => {
      cancelled = true;
    };
  });

  // Debounced directory search as the owner types.
  $effect(() => {
    const q = query.trim();
    if (!q) {
      results = [];
      searching = false;
      return;
    }
    searching = true;
    const t = setTimeout(async () => {
      try {
        results = await api.searchUsers(q);
      } catch {
        results = [];
      } finally {
        searching = false;
      }
    }, 220);
    return () => clearTimeout(t);
  });

  async function add(u: UserRef) {
    busyId = u.id;
    error = null;
    try {
      await calls.grant(u.id);
      members = [...members, u];
      query = "";
      results = [];
    } catch (e) {
      error = e instanceof ApiError ? e.message : "Could not add that person.";
    } finally {
      busyId = null;
    }
  }

  async function remove(u: UserRef) {
    busyId = u.id;
    error = null;
    try {
      await calls.revoke(u.id);
      members = members.filter((m) => m.id !== u.id);
    } catch (e) {
      error = e instanceof ApiError ? e.message : "Could not remove that person.";
    } finally {
      busyId = null;
    }
  }
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
    style="position:relative;width:100%;max-width:460px;background:var(--card);border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow-lg);animation:af-pop .16s cubic-bezier(.2,.8,.2,1);display:flex;flex-direction:column;max-height:calc(100vh - 48px);"
  >
    <!-- header -->
    <div
      style="display:flex;align-items:center;justify-content:space-between;padding:18px 20px 14px;border-bottom:1px solid var(--border);"
    >
      <div style="min-width:0;">
        <h2 style="margin:0;font-size:16px;font-weight:600;letter-spacing:-0.01em;">
          Manage access
        </h2>
        <p style="margin:3px 0 0;font-size:12.5px;color:var(--muted-fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          {target.kind === "collection"
            ? `Who can open “${target.title}” — everything inside inherits this list`
            : `Who can open “${target.title}”`}
        </p>
      </div>
      <button
        onclick={onClose}
        style="width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:8px;border:none;background:none;color:var(--muted-fg);cursor:pointer;flex-shrink:0;"
        aria-label="Close"
      >
        <Icon paths={["M18 6L6 18M6 6l12 12"]} size={17} />
      </button>
    </div>

    <div style="padding:18px 20px;display:flex;flex-direction:column;gap:14px;overflow-y:auto;">
      <!-- search -->
      <div style="position:relative;">
        <div style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--muted-fg);pointer-events:none;">
          <Icon paths={SEARCH} size={15} />
        </div>
        <input
          bind:value={query}
          placeholder="Search people by name or email…"
          autocomplete="off"
          style="width:100%;height:38px;padding:0 12px 0 34px;border:1px solid var(--border);background:var(--card);color:var(--fg);border-radius:9px;font-size:13.5px;font-family:inherit;outline:none;"
        />
        <!-- results dropdown -->
        {#if query.trim()}
          <div
            style="position:absolute;left:0;right:0;top:42px;z-index:5;background:var(--card);border:1px solid var(--border);border-radius:11px;box-shadow:var(--shadow-md);padding:5px;max-height:208px;overflow-y:auto;animation:af-menu .12s ease;"
          >
            {#if searching}
              <div style="padding:10px 9px;font-size:12.5px;color:var(--muted-fg);">Searching…</div>
            {:else if candidates.length === 0}
              <div style="padding:10px 9px;font-size:12.5px;color:var(--muted-fg);">No people found.</div>
            {:else}
              {#each candidates as u (u.id)}
                <button
                  onclick={() => add(u)}
                  disabled={busyId === u.id}
                  style="width:100%;display:flex;align-items:center;gap:10px;padding:7px 8px;border:none;background:none;color:var(--fg);border-radius:8px;cursor:pointer;text-align:left;font-family:inherit;"
                >
                  <span style="width:30px;height:30px;flex-shrink:0;border-radius:50%;background:var(--accent-soft);color:var(--primary);display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:600;">
                    {initials(u.name || u.email)}
                  </span>
                  <span style="flex:1;min-width:0;">
                    <span style="display:block;font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{u.name || u.email}</span>
                    <span style="display:block;font-size:11.5px;color:var(--muted-fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{u.email}</span>
                  </span>
                  <Icon paths={["M12 5v14M5 12h14"]} size={15} width={2.2} style="color:var(--primary);flex-shrink:0;" />
                </button>
              {/each}
            {/if}
          </div>
        {/if}
      </div>

      {#if error}
        <div style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--destructive);">
          <Icon paths={ALERT} size={13} />{error}
        </div>
      {/if}

      <!-- current members -->
      <div>
        <div style="font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--muted-fg);margin-bottom:8px;">
          People with access{members.length ? ` · ${members.length}` : ""}
        </div>
        {#if loading}
          <div style="padding:14px 0;font-size:12.5px;color:var(--muted-fg);">Loading…</div>
        {:else if members.length === 0}
          <div style="padding:18px 14px;border:1.5px dashed var(--border);border-radius:11px;text-align:center;font-size:12.5px;color:var(--muted-fg);">
            No one yet — search above to add people. Until then, only you can open it.
          </div>
        {:else}
          <div style="display:flex;flex-direction:column;gap:6px;">
            {#each members as u (u.id)}
              <div style="display:flex;align-items:center;gap:10px;padding:7px 8px;border:1px solid var(--border);border-radius:10px;background:var(--subtle);">
                <span style="width:30px;height:30px;flex-shrink:0;border-radius:50%;background:var(--muted);color:var(--fg);display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:600;">
                  {initials(u.name || u.email)}
                </span>
                <span style="flex:1;min-width:0;">
                  <span style="display:block;font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{u.name || u.email}</span>
                  <span style="display:block;font-size:11.5px;color:var(--muted-fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{u.email}</span>
                </span>
                <button
                  onclick={() => remove(u)}
                  disabled={busyId === u.id}
                  title="Remove access"
                  aria-label={`Remove ${u.name || u.email}`}
                  style="width:28px;height:28px;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:7px;border:none;background:none;color:var(--muted-fg);cursor:pointer;"
                >
                  <Icon paths={["M18 6L6 18M6 6l12 12"]} size={15} />
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <!-- footer -->
    <div style="display:flex;justify-content:flex-end;padding:14px 20px;border-top:1px solid var(--border);">
      <button
        onclick={onClose}
        style="height:38px;padding:0 18px;border:none;background:var(--primary);color:var(--primary-fg);border-radius:9px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;"
      >
        Done
      </button>
    </div>
  </div>
</div>
