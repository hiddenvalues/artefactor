// S12 — Host data-context switcher chrome.
//
// The served artefact stays opaque and single-dataset (it only sees
// `localStorage`). Choosing *which* author's data is loaded is a host concern
// handled OUTSIDE the artefact container (DDD artefact-data.md §"Data context").
// So `/a/:slug` returns this thin host shell — a toolbar + an <iframe> that
// loads the artefact itself from `/a/:slug/frame`. Picking an author mints a
// frame token for that author (S36) and reloads the iframe with it; the frame
// seeds that context read-only (only the viewer's own context is writable, AD5).
//
// S36 (AH28, AD10) — the iframe is sandboxed into an opaque origin with no
// session, so the shell is where the artefact's data gets saved: the shim posts
// each change to the shell, which accepts it only from its own frame's window
// and only in the viewer's own context, and writes it under the S31 discipline
// (see `shellFrameJs`).
//
// The shell is server-rendered (not the Svelte SPA) because `/a/:slug` is the
// shareable link and also serves unauthenticated/public viewers, who never load
// the SPA. The picker is populated client-side from `…/data/authors`, which is
// itself access-matrix gated (AD4).
//
// The toolbar shows the same icon / title / kind as the SPA list view (shared
// `kind-presentation`), plus — for signed-in viewers only — a back button to the
// admin UI. Anonymous (public-link) viewers have no admin UI, so it's hidden.

import type { ArtefactKind } from "../../domain/artefact/kind";
import { kindPresentation } from "../../shared/kind-presentation";
import { FRAME_ALLOW, FRAME_SANDBOX_FLAGS } from "./sandbox";

export interface HostShellContext {
  title: string;
  kind: ArtefactKind;
  // ISO-8601 timestamp; rendered as a relative "Updated …" label.
  updatedAt: string;
  // S36 — the first frame URL: tokened for a signed-in viewer's own context,
  // token-less for an anonymous viewer; absolute when frames live on a content
  // origin.
  frameUrl: string;
  // S36 — that frame URL's message channel (null for an anonymous, token-less
  // frame): what the shell requires on a change before it saves it.
  channel: string | null;
  // S36 — `POST …/frame-token`: a fresh frame URL for another author, a reload,
  // or an expired token.
  mintEndpoint: string;
  // S36 — the `PUT …/data/me` the shell saves the viewer's own data to.
  dataEndpoint: string;
  // S31 — the viewer's own entry's `updatedAt` the first frame was seeded with
  // (null when none): the pin of the first save.
  seedUpdatedAt: string | null;
  // The `…/data/authors` endpoint that populates the picker.
  authorsEndpoint: string;
  // S21 — the `…/viewers` endpoint that populates the "viewed by" widget. The
  // list it returns already excludes the current viewer (VT4).
  viewersEndpoint: string;
  // The signed-in viewer, or null. Used to label "your data", to know which
  // listed author is the viewer, and to show the back-to-admin button.
  viewerId: string | null;
  // The artefact owner, so the picker can tag the owner's entry.
  ownerId: string;
  // AH16/S20: whether the artefact persists data (uses localStorage). When
  // false the data-context picker is omitted entirely (and its authors fetch
  // skipped) — there is no data to switch between.
  usesStorage: boolean;
  // S32a (AH23) — the owner is previewing a public artefact whose link has
  // expired: a banner says visitors can no longer open it. Owner-only.
  linkExpired?: boolean;
}

// S36 — what the shell's frame controller needs.
export interface ShellFrameConfig {
  frameUrl: string;
  viewerId: string | null;
  mintEndpoint: string;
  dataEndpoint: string;
  seedUpdatedAt: string | null;
  // S36 — the message channel of the frame URL above (null for an anonymous,
  // token-less frame): what the shell requires on every change it saves.
  channel: string | null;
}

// Chrome caps a keepalive request's body (64 KiB across in-flight ones); a larger
// pagehide flush goes out as a plain request, best effort.
const KEEPALIVE_MAX_BYTES = 60 * 1024;

// S36 (AD10) — the shell's frame controller, as a JS expression evaluating to
// `{ select(authorId) }`. Kept free of server-only references so it can be
// unit-tested by evaluating it with injected globals: references only `window`,
// `document`, `fetch`, `TextEncoder`.
//
// It loads the frame, mints fresh frame URLs (author switch, conflict reload,
// expired token), and saves the viewer's own data under the S31 discipline: it
// accepts `artefactor:data-changed` only when `event.source` is its frame's
// window (the frame's origin is "null", so there is no origin to check), only
// when the message carries the **channel** of the frame URL it loaded — so a page
// the frame navigated itself to, which keeps the same window but never learns the
// channel, can't forge a change — and only in the viewer's own context; the endpoint is fixed here, never taken from a
// message; each PUT is pinned (`If-Match`, or `If-None-Match: *` with no entry);
// saves never overlap (the latest blob waits); a 412 stops all writing and shows
// the conflict banner. It posts nothing to the frame.
export function shellFrameJs(cfg: ShellFrameConfig): string {
  const cfgJson = JSON.stringify({ ...cfg, keepaliveMax: KEEPALIVE_MAX_BYTES }).replace(
    /</g,
    "\\u003c",
  );
  return `(function(){
  var cfg = ${cfgJson};
  var frame = document.getElementById("ae-frame");
  frame.src = cfg.frameUrl;
  // Anonymous viewers are never writable and their frames carry no token.
  if (!cfg.viewerId) return { select: function(){} };

  var conflict = document.getElementById("ae-conflict");
  var channel = cfg.channel;  // the loaded frame document's message channel
  var author = null;          // null = the viewer's own data
  var pin = cfg.seedUpdatedAt;
  var pending = null;         // the latest blob not yet sent
  var inflight = false;
  var stale = false;          // a 412 was seen: never write again until re-seeded
  var gen = 0;                // bumped on every re-seed; older saves are ignored
  var loads = 0;              // only the newest mint may point the frame

  function load(authorId, reseed){
    var seq = ++loads;
    var target = authorId || null;
    return fetch(cfg.mintEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(target ? { author: target } : {})
    }).then(function(r){ return r && r.ok ? r.json() : null; }).then(function(d){
      if (!d || seq !== loads || typeof d.frameUrl !== "string") return;
      // The context changes only once its frame is really loading: a failed
      // mint leaves the current frame, and its saves, as they were.
      author = target;
      channel = typeof d.channel === "string" ? d.channel : null;
      if (reseed && target === null) {
        gen++;
        pin = d.seedUpdatedAt || null;
        pending = null;
        inflight = false;
        stale = false;
        if (conflict) conflict.hidden = true;
      }
      frame.src = d.frameUrl;
    }).catch(function(){});
  }

  function bytes(s){ try { return new TextEncoder().encode(s).length; } catch (e) { return s.length * 3; } }

  // \`force\` is for pagehide: the page may be gone before an in-flight save
  // settles, so send now rather than wait.
  function save(force){
    if (stale || pending === null) return;
    if (inflight && force !== true) return;
    var body = pending;
    pending = null;
    var headers = { "Content-Type": "application/json" };
    if (pin) headers["If-Match"] = '"' + pin + '"';
    else headers["If-None-Match"] = "*";
    var mine = gen;
    var failed = false;
    inflight = true;
    var req;
    try {
      req = fetch(cfg.dataEndpoint, {
        method: "PUT",
        headers: headers,
        body: body,
        credentials: "same-origin",
        keepalive: force === true && bytes(body) <= cfg.keepaliveMax
      });
    } catch (e) { inflight = false; if (pending === null) pending = body; return; }
    Promise.resolve(req).then(function(r){
      if (mine !== gen) return;
      if (r && r.status === 412) { stale = true; pending = null; if (conflict) conflict.hidden = false; return; }
      if (!r || !r.ok) { failed = true; return; }
      return r.json().then(function(d){ if (mine === gen && d && d.updatedAt) pin = d.updatedAt; });
    }).catch(function(){ failed = true; }).then(function(){
      if (mine !== gen) return;
      inflight = false;
      // A failed save waits for the next change, without a retry loop.
      if (failed) { if (pending === null) pending = body; return; }
      save(false);
    });
  }

  window.addEventListener("message", function(e){
    if (e.source !== frame.contentWindow) return;
    var d = e.data;
    if (!d || typeof d !== "object") return;
    if (d.type === "artefactor:data-changed") {
      if (author !== null || typeof d.blob !== "string") return;
      // Only the document the current frame URL loaded knows this.
      if (!channel || d.channel !== channel) return;
      pending = d.blob;
      // A change that arrives while the shell itself is unloading goes out now,
      // with keepalive — there is no later.
      save(unloading);
    } else if (d.type === "artefactor:frame-token-expired") {
      load(author, false);
    }
  });

  var unloading = false;
  window.addEventListener("pagehide", function(){ unloading = true; save(true); });
  window.addEventListener("pageshow", function(){ unloading = false; });

  var reload = document.getElementById("ae-conflict-reload");
  if (reload) reload.addEventListener("click", function(){ load(author, true); });

  return { select: function(authorId){ load(authorId, true); } };
})()`;
}

export function renderHostShell(ctx: HostShellContext): string {
  const cfg = {
    title: ctx.title,
    viewerId: ctx.viewerId,
    ownerId: ctx.ownerId,
    authorsEndpoint: ctx.authorsEndpoint,
    viewersEndpoint: ctx.viewersEndpoint,
    usesStorage: ctx.usesStorage,
  };
  // Escape `<` so a title containing "</script>" cannot break out of the tag.
  const cfgJson = JSON.stringify(cfg).replace(/</g, "\\u003c");

  const meta = kindPresentation(ctx.kind);
  const kindIcon = meta.icon
    .map((d) => `<path d="${d}"></path>`)
    .join("");
  const updatedLabel = relativeTime(ctx.updatedAt);
  const subLabel = updatedLabel
    ? `${meta.label} · Updated ${updatedLabel}`
    : meta.label;

  // Signed-in viewers can return to the admin UI (the SPA at "/"); anonymous
  // public-link viewers cannot, so the button is omitted entirely.
  const backButton = ctx.viewerId
    ? `<a class="ae-back" href="/" title="Back to your artefacts" aria-label="Back to your artefacts">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"></path><path d="M12 19l-7-7 7-7"></path></svg>
      </a>`
    : "";

  // Host tools: the data-context switcher and (later) more widgets beside it.
  // Rendered only for signed-in viewers; anonymous public viewers never see any
  // of them. Add future widgets as siblings of `.ae-switch` inside `.ae-tools`.
  const hostTools = ctx.viewerId
    ? `<div class="ae-tools" id="ae-tools">
      <div class="ae-switch" id="ae-switch">
        <label for="ae-ctx">Data context</label>
        <select id="ae-ctx" aria-label="Data context"></select>
        <span class="ae-ro" id="ae-ro">read-only</span>
      </div>
      <div class="ae-viewers" id="ae-viewers">
        <button type="button" class="ae-viewers-btn" id="ae-viewers-btn" aria-haspopup="dialog" aria-expanded="false" title="Who has viewed this">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"></path><circle cx="12" cy="12" r="3"></circle></svg>
          <span class="ae-viewers-count" id="ae-viewers-count" hidden></span>
          <span class="ae-viewers-label">Viewed by</span>
        </button>
        <div class="ae-viewers-pop" id="ae-viewers-pop" role="dialog" aria-label="Who has viewed this" hidden>
          <div class="ae-viewers-head">Viewed by</div>
          <ul class="ae-viewers-list" id="ae-viewers-list"></ul>
          <div class="ae-viewers-empty" id="ae-viewers-empty" hidden>No one else has viewed this yet.</div>
        </div>
      </div>
    </div>`
    : "";

  // S31 — shown when the framed artefact's saves were refused because the saved
  // data was replaced elsewhere (e.g. by an agent). Signed-in only: anonymous
  // contexts are never writable, so they can never conflict.
  const conflictBanner = ctx.viewerId
    ? `<div class="ae-conflict" id="ae-conflict" role="alert" hidden>
    <span>Your data for this artefact was changed elsewhere, so changes made here since are no longer being saved. Reload to see the latest version.</span>
    <button type="button" id="ae-conflict-reload">Reload</button>
  </div>`
    : "";

  const linkExpiredBanner = ctx.linkExpired
    ? `<div class="ae-conflict ae-expired" role="status">
    <span><strong>Link expired.</strong> Visitors can no longer open this public link. Extend or clear the expiry under Link protection in Artefactor.</span>
  </div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(ctx.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --fg: #09090b; --muted-fg: #71717a; --border: #e9e9ec; --card: #fff;
    --muted: #f4f4f5; --shadow: 0 1px 2px rgba(16,17,18,0.05);
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body { display: flex; flex-direction: column; font: 14px/1.4 "Geist", -apple-system, system-ui, "Segoe UI", Roboto, sans-serif; color: var(--fg); background: #fff; -webkit-font-smoothing: antialiased; }
  .ae-bar { flex: 0 0 auto; display: flex; align-items: center; gap: .7rem; padding: .5rem .75rem; border-bottom: 1px solid var(--border); background: var(--card); }
  .ae-back { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; flex: 0 0 auto; border: 1px solid var(--border); border-radius: 8px; background: var(--card); color: var(--fg); text-decoration: none; box-shadow: var(--shadow); }
  .ae-back:hover { background: var(--muted); }
  .ae-id { display: flex; align-items: center; gap: .6rem; min-width: 0; margin-right: auto; }
  .ae-tile { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; flex: 0 0 auto; border-radius: 9px; background: ${meta.tint}; }
  .ae-text { min-width: 0; }
  .ae-title { font-weight: 600; font-size: 14px; letter-spacing: -0.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ae-sub { font-size: 12px; color: var(--muted-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ae-bar label { color: var(--muted-fg); font-size: 13px; }
  .ae-bar select { font: inherit; font-size: 13px; padding: .3rem .5rem; border: 1px solid var(--border); border-radius: 8px; background: var(--card); max-width: 40vw; color: var(--fg); }
  .ae-ro { display: none; font-size: 12px; font-weight: 600; color: #9a6700; background: #fff8c5; border: 1px solid #eac54f; border-radius: 999px; padding: .1rem .5rem; }
  .ae-ro.show { display: inline; }
  /* The data-context picker is hidden until there is another author to switch
     to (S20); a non-persisting artefact never reveals it. */
  .ae-switch { display: none; align-items: center; gap: .6rem; }
  .ae-switch.show { display: flex; }
  /* Signed-in-only host tools: the data-context switcher plus (later) more
     widgets beside it. The whole group is omitted for anonymous viewers, so a
     public link stays chrome-light. */
  .ae-tools { display: flex; align-items: center; gap: .6rem; }
  /* S21 "viewed by" widget — a button beside the data-context switcher that
     opens a pop-over listing who else has viewed the artefact. */
  .ae-viewers { position: relative; }
  .ae-viewers-btn { display: inline-flex; align-items: center; gap: .4rem; font: inherit; font-size: 13px; height: 32px; padding: 0 .6rem; border: 1px solid var(--border); border-radius: 8px; background: var(--card); color: var(--fg); cursor: pointer; box-shadow: var(--shadow); }
  .ae-viewers-btn:hover { background: var(--muted); }
  .ae-viewers-count { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: var(--fg); color: #fff; font-size: 11px; font-weight: 600; line-height: 1; }
  .ae-viewers-pop { position: absolute; top: calc(100% + 6px); right: 0; z-index: 10; width: 280px; max-width: 80vw; max-height: 60vh; overflow-y: auto; background: var(--card); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 8px 24px rgba(16,17,18,0.12); padding: .5rem; }
  .ae-viewers-head { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--muted-fg); padding: .25rem .4rem .4rem; }
  .ae-viewers-list { list-style: none; margin: 0; padding: 0; }
  .ae-viewers-list li { display: flex; flex-direction: column; gap: .1rem; padding: .4rem; border-radius: 7px; }
  .ae-viewers-list li:hover { background: var(--muted); }
  .ae-viewers-name { font-weight: 500; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ae-viewers-meta { font-size: 12px; color: var(--muted-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ae-viewers-empty { padding: .5rem .4rem; font-size: 13px; color: var(--muted-fg); }
  .ae-frame { flex: 1 1 auto; width: 100%; border: 0; }
  .ae-conflict { flex: 0 0 auto; display: flex; align-items: center; gap: .75rem; padding: .5rem .75rem; font-size: 13px; color: #6b4a00; background: #fff8c5; border-bottom: 1px solid #eac54f; }
  .ae-conflict[hidden] { display: none; }
  .ae-conflict span { margin-right: auto; }
  .ae-conflict button { font: inherit; font-size: 13px; font-weight: 500; height: 28px; padding: 0 .7rem; border: 1px solid #d4a72c; border-radius: 7px; background: #fff; color: var(--fg); cursor: pointer; }
  .ae-conflict button:hover { background: var(--muted); }
</style>
</head>
<body>
  <div class="ae-bar">
    ${backButton}
    <div class="ae-id">
      <div class="ae-tile">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${meta.color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${kindIcon}</svg>
      </div>
      <div class="ae-text">
        <div class="ae-title">${escapeHtml(ctx.title)}</div>
        <div class="ae-sub">${escapeHtml(subLabel)}</div>
      </div>
    </div>
    ${hostTools}
  </div>
  ${linkExpiredBanner}
  ${conflictBanner}
  <iframe class="ae-frame" id="ae-frame" title="Artefact" sandbox="${FRAME_SANDBOX_FLAGS}" allow="${FRAME_ALLOW}"></iframe>
<script>
(function(){
  var cfg = ${cfgJson};
  // S36 — loads the frame (its first, server-minted URL) and saves the viewer's
  // own data for it.
  var frameCtl = ${shellFrameJs({
    frameUrl: ctx.frameUrl,
    viewerId: ctx.viewerId,
    mintEndpoint: ctx.mintEndpoint,
    dataEndpoint: ctx.dataEndpoint,
    seedUpdatedAt: ctx.seedUpdatedAt,
    channel: ctx.channel,
  })};

  // Anonymous viewers get no host tools (data-context switcher / future
  // widgets) — just the artefact in its default read-only context.
  if (!cfg.viewerId) return;

  var sel = document.getElementById("ae-ctx");
  var ro = document.getElementById("ae-ro");
  var switcher = document.getElementById("ae-switch");

  function seed(authorId){
    frameCtl.select(authorId);
    ro.classList.toggle("show", !!authorId);
  }

  function rel(iso){
    try {
      var d = new Date(iso), s = (Date.now() - d.getTime()) / 1000;
      if (s < 60) return "just now";
      if (s < 3600) return Math.floor(s/60) + "m ago";
      if (s < 86400) return Math.floor(s/3600) + "h ago";
      if (s < 2592000) return Math.floor(s/86400) + "d ago";
      return d.toLocaleDateString();
    } catch (e) { return ""; }
  }

  function label(a){
    var who = a.name || a.email || ("Author " + a.authorId.slice(0, 6));
    if (a.email && a.name) who += " (" + a.email + ")";
    var tags = [];
    if (a.authorId === cfg.ownerId) tags.push("owner");
    var suffix = tags.length ? " \\u00b7 " + tags.join(", ") : "";
    return who + suffix + " \\u00b7 " + rel(a.updatedAt);
  }

  // Default context = the viewer's own data (read-write when signed in).
  var def = document.createElement("option");
  def.value = "";
  def.textContent = "Your data";
  sel.appendChild(def);

  // The default context is already loading (the frame controller pointed the
  // frame at its server-minted URL), even if the authors list fails to load.

  // S20: only fetch authors / reveal the picker for artefacts that persist data
  // (usesStorage). A non-persisting artefact never has a context to switch to.
  if (cfg.usesStorage) {
    fetch(cfg.authorsEndpoint, { credentials: "same-origin" })
      .then(function(r){ return r.ok ? r.json() : { authors: [] }; })
      .then(function(data){
        var others = 0;
        (data.authors || []).forEach(function(a){
          // The viewer's own entry is already covered by the default option.
          if (a.authorId === cfg.viewerId) return;
          var opt = document.createElement("option");
          opt.value = a.authorId;
          opt.textContent = label(a);
          sel.appendChild(opt);
          others++;
        });
        // Reveal the picker only when there is another author to switch to.
        if (others > 0) switcher.classList.add("show");
      })
      .catch(function(){});
  }

  sel.addEventListener("change", function(){ seed(sel.value); });

  // S21 — "viewed by" widget. Fetch the other viewers (the endpoint already
  // excludes the current viewer, VT4), show a count, and reveal a pop-over list
  // on click. Best-effort: any failure just leaves the widget showing nothing.
  var vBtn = document.getElementById("ae-viewers-btn");
  var vPop = document.getElementById("ae-viewers-pop");
  var vList = document.getElementById("ae-viewers-list");
  var vEmpty = document.getElementById("ae-viewers-empty");
  var vCount = document.getElementById("ae-viewers-count");

  function viewerName(v){
    return v.name || v.email || ("User " + v.viewerId.slice(0, 6));
  }

  function renderViewers(viewers){
    vList.textContent = "";
    if (!viewers.length) { vEmpty.hidden = false; return; }
    vEmpty.hidden = true;
    vCount.textContent = String(viewers.length);
    vCount.hidden = false;
    viewers.forEach(function(v){
      var li = document.createElement("li");
      var name = document.createElement("div");
      name.className = "ae-viewers-name";
      name.textContent = viewerName(v);
      var meta = document.createElement("div");
      meta.className = "ae-viewers-meta";
      // Email (when we also have a name) plus when they last viewed.
      var bits = [];
      if (v.email && v.name) bits.push(v.email);
      bits.push("viewed " + rel(v.viewedAt));
      meta.textContent = bits.join(" \\u00b7 ");
      li.appendChild(name);
      li.appendChild(meta);
      vList.appendChild(li);
    });
  }

  fetch(cfg.viewersEndpoint, { credentials: "same-origin" })
    .then(function(r){ return r.ok ? r.json() : { viewers: [] }; })
    .then(function(data){ renderViewers(data.viewers || []); })
    .catch(function(){ renderViewers([]); });

  function setOpen(open){
    vPop.hidden = !open;
    vBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }
  vBtn.addEventListener("click", function(e){
    e.stopPropagation();
    setOpen(vPop.hidden);
  });
  // Dismiss on an outside click or Escape.
  document.addEventListener("click", function(e){
    if (!vPop.hidden && !vPop.contains(e.target) && e.target !== vBtn && !vBtn.contains(e.target)) {
      setOpen(false);
    }
  });
  document.addEventListener("keydown", function(e){
    if (e.key === "Escape") setOpen(false);
  });
})();
</script>
</body>
</html>`;
}

// Relative "Updated …" label for the toolbar, computed at render time.
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.round(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
