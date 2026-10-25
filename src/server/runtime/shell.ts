// S12 — Host data-context switcher chrome.
//
// The served artefact stays opaque and single-dataset (it only sees
// `localStorage`). Choosing *which* author's data is loaded is a host concern
// handled OUTSIDE the artefact container (data.context.host-chosen).
// So `/a/:slug` returns this thin host shell — a toolbar + an <iframe> that
// loads the artefact itself from `/a/:slug/frame`. Picking an author mints a
// frame token for that author (S36) and reloads the iframe with it; the frame
// seeds that context read-only (only the viewer's own context is writable, data.write.own-context-only).
//
// S36 (data.shim.posts-never-fetches) — the iframe is sandboxed into an opaque origin with no
// session, so the shell is where the artefact's data gets saved: the shim posts
// each change to the shell, which accepts it only from its own frame's window
// and only in the viewer's own context, and writes it under the S31 discipline
// (see `shellFrameJs`).
//
// The shell is server-rendered (not the React SPA) because `/a/:slug` is the
// shareable link and also serves unauthenticated/public viewers, who never load
// the SPA. The picker is populated client-side from `…/data/authors`, which is
// itself access-matrix gated (data.read.follows-artefact-access).
//
// The toolbar shows the same icon / title / kind as the SPA list view (shared
// `kind-presentation`), plus — for signed-in viewers only — a back button to the
// admin UI. Anonymous (public-link) viewers have no admin UI, so it's hidden.
//
// S45 — the chrome wears Ruby in the viewer's theme: the stored SPA
// choice, else the OS (THEME_BOOT_JS sets `.dark` before first paint; the
// tokens are shell-theme.ts). The frame never does: its payload is the same
// whatever the viewer's theme.

import type { ArtefactKind } from "../../domain/artefact/kind";
import { kindPresentation } from "../../shared/kind-presentation";
import { THEME_BOOT_JS } from "../../shared/theme-boot";
import { FRAME_ALLOW, FRAME_SANDBOX_FLAGS } from "./sandbox";
import { shellThemeCss } from "./shell-theme";

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
  // list it returns already excludes the current viewer (views.viewers.excludes-caller).
  viewersEndpoint: string;
  // The signed-in viewer, or null. Used to label "your data", to know which
  // listed author is the viewer, and to show the back-to-admin button.
  viewerId: string | null;
  // The artefact owner, so the picker can tag the owner's entry.
  ownerId: string;
  // hosting.uses-storage.chrome-only, S20: whether the artefact persists data (uses localStorage).
  // When false the data-context picker is omitted entirely (and its authors fetch skipped) — there
  // is no data to switch between.
  usesStorage: boolean;
  // S32a (hosting.link-gate.expiry-reads-as-private) — the owner is previewing a public artefact
  // whose link has expired: a banner says visitors can no longer open it. Owner-only.
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

// S66 — the longest the shell holds its chrome back waiting for the frame's load,
// so an artefact with slow subresources still appears into a visible chrome.
export const FRAME_HOLD_MAX_MS = 3000;

// S81 — how long the shell holds the frame's latest change before it saves it.
// The frame posts each change at once; the debounce lives here, on the side that
// survives a top-level unload long enough to flush it.
export const SAVE_DELAY_MS = 600;

// S81 — the longest the shell waits for the saves a re-point flushed before it
// mints anyway, so a stalled PUT can't hold a context switch back.
export const MINT_WAIT_MAX_MS = 3000;

// S36 (data.shell.saves-only-own-frame) and S31 (data.shell.writes-pinned) — the
// shell's frame controller, as a JS expression evaluating to
// `{ select(authorId) }`. Kept free of server-only references so it can be
// unit-tested by evaluating it with injected globals: references only `window`,
// `document`, `fetch`, `TextEncoder`, `setTimeout` and `clearTimeout`.
//
// It releases the shell's hold (S66) on the frame's first load or at
// FRAME_HOLD_MAX_MS, whichever comes first; loads the frame; mints fresh frame
// URLs (author switch, conflict reload, expired token); and saves the viewer's
// own data under the S31 discipline: it accepts `artefactor:data-changed` only
// when `event.source` is its frame's window (the frame's origin is "null", so
// there is no origin to check), only
// when the message carries the **channel** of the frame URL it loaded — so a page
// the frame navigated itself to, which keeps the same window but never learns the
// channel, can't forge a change — and only in the viewer's own context; the endpoint is fixed here, never taken from a
// message; each PUT is pinned (`If-Match`, or `If-None-Match: *` with no entry);
// saves never overlap (the latest blob waits); a 412 stops all writing and shows
// the conflict banner. It posts nothing to the frame. S81 — it debounces: a change
// goes out SAVE_DELAY_MS after the last, or at once on its own beforeunload and
// pagehide, when it goes hidden (or a change arrives while hidden) and before it
// points the frame anywhere (a context switch, a re-mint); it mints only once the
// saves outstanding then have settled, or after MINT_WAIT_MAX_MS. Keepalive is
// used while the keepalive bodies in flight stay within KEEPALIVE_MAX_BYTES.
// r[impl hosting.shell.hold-until-frame]
// r[impl hosting.frame.shell-saves-for-frame+2]
// r[impl data.shim.writes-through-shell+2]
// r[impl data.shell.writes-pinned+2]
// r[impl data.shell.saves-only-own-frame]
// r[impl data.shell.debounces-and-flushes]
export function shellFrameJs(cfg: ShellFrameConfig): string {
  const cfgJson = JSON.stringify({
    ...cfg,
    keepaliveMax: KEEPALIVE_MAX_BYTES,
    holdMax: FRAME_HOLD_MAX_MS,
    saveDelay: SAVE_DELAY_MS,
    mintWaitMax: MINT_WAIT_MAX_MS,
  }).replace(/</g, "\\u003c");
  return `(function(){
  var cfg = ${cfgJson};
  var frame = document.getElementById("ae-frame");
  // S66 — the shell renders held (html.ae-hold); the first of the frame's load or
  // the cap shows it, once. Wired before the frame URL is assigned, for every
  // viewer; a later navigation the shell starts never holds again.
  var held = true;
  function release(){
    if (!held) return;
    held = false;
    document.documentElement.classList.remove("ae-hold");
    frame.removeAttribute("aria-busy");
  }
  frame.addEventListener("load", release, { once: true });
  setTimeout(release, cfg.holdMax);
  frame.src = cfg.frameUrl;
  // Anonymous viewers are never writable and their frames carry no token.
  if (!cfg.viewerId) return { select: function(){} };

  var conflict = document.getElementById("ae-conflict");
  var channel = cfg.channel;  // the loaded frame document's message channel
  var author = null;          // null = the viewer's own data
  var pin = cfg.seedUpdatedAt;
  // S81 — the seed the loaded frame document last reported. A reload's shell can
  // render its pin before the previous page's flush lands while its frame is
  // seeded after it: a newly reported seed is what the frame's blob is built on.
  var seen;
  var pending = null;         // the latest blob not yet sent
  var timer = null;           // the debounced save of \`pending\`
  var inflight = false;
  var stale = false;          // a 412 was seen: never write again until re-seeded
  var gen = 0;                // bumped on every re-seed; older saves are ignored
  var loads = 0;              // only the newest mint may point the frame

  var settled = 0;             // saves settled so far
  var next = null;            // the mint waiting for those saves: { seq, target, reseed, at }

  function load(authorId, reseed){
    var seq = ++loads;
    var target = authorId || null;
    // A change held for the viewer's own data goes out, under its pin, and the
    // shell mints once the saves outstanding now (one in flight, the held
    // change) have settled — not later ones — so the frame it points next is
    // seeded after them; or after mintWaitMax, so a stalled PUT can't hold it.
    var need = (inflight ? 1 : 0) + (pending !== null && !stale ? 1 : 0);
    flush(false);
    next = { seq: seq, target: target, reseed: reseed, at: settled + need };
    setTimeout(function(){ if (next && next.seq === seq) mintNext(true); }, cfg.mintWaitMax);
    mintNext(false);
  }

  function mintNext(now){
    var m = next;
    if (!m) return;
    if (m.seq !== loads) { next = null; return; }
    if (!now && inflight && settled < m.at) return;
    next = null;
    mint(m.seq, m.target, m.reseed);
  }

  function mint(seq, target, reseed){
    fetch(cfg.mintEndpoint, {
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
        idle();
      }
      frame.src = d.frameUrl;
    }).catch(function(){});
  }

  function bytes(s){ try { return new TextEncoder().encode(s).length; } catch (e) { return s.length * 3; } }

  // Send a held change now, with keepalive while the budget allows. Only
  // \`pagehide\` (\`force\`) may overlap a save in flight: the page is going and
  // won't see it settle. Going hidden, a beforeunload or a re-point may not
  // unload, so the change waits for the in-flight save rather than race it
  // under the same pin into a spurious 412.
  function flush(force){
    if (timer) { clearTimeout(timer); timer = null; }
    if (!inflight || force === true) save(true);
    idle();
  }

  // Set once the page may be going (beforeunload, hidden): a held change that
  // had to wait for an in-flight save still leaves with keepalive.
  var leaving = false;
  var keepaliveBytes = 0;     // keepalive request bodies still in flight
  // The beforeunload listener is attached only while there is something to
  // flush: an unconditional one costs the page its back/forward cache in
  // Firefox.
  function onBeforeUnload(){ leaving = true; flush(false); }
  function armed(){ window.addEventListener("beforeunload", onBeforeUnload); }
  function idle(){
    if ((stale || pending === null) && !inflight && !timer) window.removeEventListener("beforeunload", onBeforeUnload);
  }

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
    // Browsers cap the keepalive bytes in flight across requests, not per
    // request: one that would go over it is sent plain.
    var n = (force === true || leaving) ? bytes(body) : 0;
    var ka = n > 0 && keepaliveBytes + n <= cfg.keepaliveMax;
    if (ka) keepaliveBytes += n;
    inflight = true;
    var req;
    try {
      req = fetch(cfg.dataEndpoint, {
        method: "PUT",
        headers: headers,
        body: body,
        credentials: "same-origin",
        keepalive: ka
      });
    } catch (e) { if (ka) keepaliveBytes -= n; inflight = false; if (pending === null) pending = body; return; }
    Promise.resolve(req).then(function(r){
      if (mine !== gen) return;
      if (r && r.status === 412) { stale = true; pending = null; if (conflict) conflict.hidden = false; return; }
      if (!r || !r.ok) { failed = true; return; }
      return r.json().then(function(d){ if (mine === gen && d && d.updatedAt) pin = d.updatedAt; });
    }).catch(function(){ failed = true; }).then(function(){
      if (ka) keepaliveBytes -= n;
      if (mine !== gen) return;
      inflight = false;
      settled++;
      // A failed save waits for the next change, without a retry loop.
      if (failed) { if (pending === null) pending = body; }
      else save(false);
      idle();
      mintNext(false);
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
      // After a 412 nothing is written until a re-seed: hold nothing.
      if (stale) return;
      if ((typeof d.seed === "string" || d.seed === null) && d.seed !== seen) {
        seen = d.seed;
        pin = d.seed;
      }
      pending = d.blob;
      armed();
      // A change that arrives while the shell itself is unloading goes out now,
      // with keepalive — there is no later. One that arrives while it is hidden
      // goes now too: a hidden page may be frozen or discarded at any time.
      if (unloading) { flush(true); return; }
      if (document.visibilityState === "hidden") { leaving = true; flush(false); return; }
      if (timer) clearTimeout(timer);
      timer = setTimeout(function(){ timer = null; save(false); idle(); }, cfg.saveDelay);
    } else if (d.type === "artefactor:frame-token-expired") {
      // A switch still waiting to mint keeps its target: the re-mint is it.
      if (next && next.seq === loads) load(next.target, next.reseed);
      else load(author, false);
    }
  });

  var unloading = false;
  window.addEventListener("pagehide", function(){ unloading = true; flush(true); });
  window.addEventListener("pageshow", function(){ unloading = false; leaving = false; });
  document.addEventListener("visibilitychange", function(){
    if (document.visibilityState === "hidden") { leaving = true; flush(false); }
    else leaving = false;
  });

  var reload = document.getElementById("ae-conflict-reload");
  if (reload) reload.addEventListener("click", function(){ load(author, true); });

  return { select: function(authorId){
    // Back to the viewer's own data while its frame is still the live one (a
    // switch away hasn't taken effect): cancel that switch, keep the frame.
    if (!authorId && author === null && !stale) { ++loads; next = null; return; }
    load(authorId, true);
  } };
})()`;
}

// r[impl platform.theme.shell-markup]
// r[impl platform.theme.shell-follows]
// r[impl hosting.shell.viewers-count-reserved]
// r[impl data.switcher.needs-another-author]
// r[impl hosting.shell.no-third-party-chrome]
// S72 — the chrome loads nothing from another origin: no web font, its text in
// the app's sans stack (Tailwind's default `--font-sans`).
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
  // r[impl data.switcher.signed-in-only]
  // r[impl views.shell.viewed-by-widget]
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
          <span class="ae-viewers-count" id="ae-viewers-count"></span>
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
<html lang="en" class="ae-hold">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(ctx.title)}</title>
<script>${THEME_BOOT_JS}</script>
<style>
  ${shellThemeCss("class", {
    light: { kind: meta.color, "kind-tint": meta.tint },
    dark: { kind: meta.darkColor, "kind-tint": meta.darkTint },
  })}
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body { display: flex; flex-direction: column; font: 14px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', 'Noto Sans', Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'; color: var(--foreground); background: var(--background); -webkit-font-smoothing: antialiased; }
  /* S66 — held until the frame has loaded: only the body background paints, so
     the chrome and the artefact appear together (released by the frame controller). */
  html.ae-hold body > * { visibility: hidden; }
  .ae-bar { flex: 0 0 auto; display: flex; align-items: center; gap: .7rem; padding: .5rem .75rem; border-bottom: 1px solid var(--border); background: var(--background); }
  .ae-back { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; flex: 0 0 auto; border: 1px solid var(--border); border-radius: 8px; background: var(--card); color: var(--foreground); text-decoration: none; box-shadow: var(--shadow); }
  .ae-back:hover { background: var(--muted); }
  .ae-id { display: flex; align-items: center; gap: .6rem; min-width: 0; margin-right: auto; }
  .ae-tile { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; flex: 0 0 auto; border-radius: 9px; background: var(--kind-tint); }
  .ae-text { min-width: 0; }
  .ae-title { font-weight: 600; font-size: 14px; letter-spacing: -0.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ae-sub { font-size: 12px; color: var(--muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ae-bar label { color: var(--muted-foreground); font-size: 13px; }
  .ae-bar select { font: inherit; font-size: 13px; padding: .3rem .5rem; border: 1px solid var(--border); border-radius: 8px; background: var(--card); max-width: 40vw; color: var(--foreground); }
  .ae-ro { display: none; font-size: 12px; font-weight: 600; color: var(--warn-fg); background: var(--warn-bg); border: 1px solid var(--warn-border); border-radius: 999px; padding: .1rem .5rem; }
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
  .ae-viewers-btn { display: inline-flex; align-items: center; gap: .4rem; font: inherit; font-size: 13px; height: 32px; padding: 0 .6rem; border: 1px solid var(--border); border-radius: 8px; background: var(--card); color: var(--foreground); cursor: pointer; box-shadow: var(--shadow); }
  .ae-viewers-btn:hover { background: var(--muted); }
  .ae-viewers-count { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: var(--foreground); color: var(--background); font-size: 11px; font-weight: 600; line-height: 1; visibility: hidden; }
  /* S66 — the count keeps its slot from first paint; the viewers fetch fills and
     reveals it, or collapses it when there is no one to count. Revealed by
     inheriting: an explicit visible value would show it through the hold. */
  .ae-viewers-count.show { visibility: inherit; }
  .ae-viewers-count[hidden] { display: none; }
  .ae-viewers-pop { position: absolute; top: calc(100% + 6px); right: 0; z-index: 10; width: 280px; max-width: 80vw; max-height: 60vh; overflow-y: auto; background: var(--card); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--shadow-pop); padding: .5rem; }
  .ae-viewers-head { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--muted-foreground); padding: .25rem .4rem .4rem; }
  .ae-viewers-list { list-style: none; margin: 0; padding: 0; }
  .ae-viewers-list li { display: flex; flex-direction: column; gap: .1rem; padding: .4rem; border-radius: 7px; }
  .ae-viewers-list li:hover { background: var(--muted); }
  .ae-viewers-name { font-weight: 500; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ae-viewers-meta { font-size: 12px; color: var(--muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ae-viewers-empty { padding: .5rem .4rem; font-size: 13px; color: var(--muted-foreground); }
  /* The iframe's used color-scheme is the artefact's preferred one and decides
     whether its canvas shows through, so the chrome's theme stops here: the
     frame keeps the browser default whatever the viewer picked (S36, S45). */
  .ae-frame { flex: 1 1 auto; width: 100%; border: 0; color-scheme: normal; }
  .ae-conflict { flex: 0 0 auto; display: flex; align-items: center; gap: .75rem; padding: .5rem .75rem; font-size: 13px; color: var(--warn-fg); background: var(--warn-bg); border-bottom: 1px solid var(--warn-border); }
  .ae-conflict[hidden] { display: none; }
  .ae-conflict span { margin-right: auto; }
  .ae-conflict button { font: inherit; font-size: 13px; font-weight: 500; height: 28px; padding: 0 .7rem; border: 1px solid var(--warn-border); border-radius: 7px; background: var(--card); color: var(--foreground); cursor: pointer; }
  .ae-conflict button:hover { background: var(--muted); }
</style>
</head>
<body>
  <div class="ae-bar">
    ${backButton}
    <div class="ae-id">
      <div class="ae-tile">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--kind)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${kindIcon}</svg>
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
  <iframe class="ae-frame" id="ae-frame" title="Artefact" sandbox="${FRAME_SANDBOX_FLAGS}" allow="${FRAME_ALLOW}" aria-busy="true"></iframe>
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
  // excludes the current viewer), show a count, and reveal a pop-over list
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
    // Both channels set on every render: hidden collapses the count, show reveals it.
    vCount.hidden = !viewers.length;
    vCount.classList.toggle("show", !!viewers.length);
    if (!viewers.length) { vEmpty.hidden = false; return; }
    vEmpty.hidden = true;
    vCount.textContent = String(viewers.length);
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
