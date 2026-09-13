// S13 — Artefact runtime bootstrap (localStorage hijack).
//
// On serve, Artefactor injects a script — before any artefact script runs — that
// replaces `window.localStorage` with a backend-backed shim. The artefact needs
// zero code changes and sees one opaque dataset: the whole localStorage keyspace
// is modelled as a single JSON object (`{ [key]: stringValue }`) which IS the
// `DataEntry.blob`. The shim is seeded server-side (so reads are synchronous) and
// writes are write-through + debounced to `PUT :endpoint`, with a keepalive flush
// on pagehide/visibilitychange. Over-cap writes throw `QuotaExceededError`; a
// read-only context (logged-out viewer, or another author's data via S12) throws
// on write while seeded reads still work. No `window.ARTEFACTOR` is exposed.
//
// S31 — because the saved data can also be replaced from outside the tab (an
// agent's `set_artefact_data`), a tab must not act on a stale copy: it writes
// only when the artefact actually changed something (an idle open tab never
// writes), each write is pinned to the `updatedAt` it last knew (`If-Match`, or
// `If-None-Match: *` when it was seeded with no entry), saves never overlap, and
// a 412 makes the tab stop writing and tell the host shell
// (`postMessage({ type: "artefactor:data-conflict" })`) so it can offer a reload.
//
// See docs/specs/ddd/artefact-data.md §"Artefact runtime contract".

export interface BootstrapContext {
  // The seed blob: a JSON object string `{ [key]: stringValue }`. "{}" when the
  // viewer has no entry yet.
  seedBlob: string;
  // The seeded entry's `updatedAt` (ISO), or null when there is no entry — the
  // pin the first write is conditioned on (S31).
  seedUpdatedAt: string | null;
  // Whether the served context may persist writes (authenticated viewer of their
  // own entry). Read-only contexts throw on write.
  writable: boolean;
  // The `PUT …/data/me` target for write-through (same-origin path).
  endpoint: string;
  // The blob byte cap; an over-cap write throws QuotaExceededError.
  maxBytes: number;
  // Debounce window for write-through, in ms.
  debounceMs?: number;
}

// The shim as inline JS (an IIFE). Kept free of server-only references so it can
// be unit-tested by evaluating it with injected globals. References only
// `window`, `document`, `fetch`, `setTimeout`, `clearTimeout`, `TextEncoder`.
export function bootstrapInnerJs(ctx: BootstrapContext): string {
  const cfg = {
    seed: ctx.seedBlob,
    pin: ctx.seedUpdatedAt,
    writable: ctx.writable,
    endpoint: ctx.endpoint,
    maxBytes: ctx.maxBytes,
    debounceMs: ctx.debounceMs ?? 600,
  };
  // Escape `<` so a value containing "</script>" cannot break out of the tag.
  const cfgJson = JSON.stringify(cfg).replace(/</g, "\\u003c");

  return `(function(){
  var cfg = ${cfgJson};
  var map;
  try { map = JSON.parse(cfg.seed); } catch (e) { map = {}; }
  if (typeof map !== "object" || map === null || Array.isArray(map)) map = {};
  var enc = new TextEncoder();
  var timer = null;

  function serialize(){ return JSON.stringify(map); }
  function quota(){ var e = new Error("localStorage quota exceeded"); e.name = "QuotaExceededError"; return e; }
  function denyIfReadOnly(){ if (!cfg.writable) throw quota(); }

  // S31 write discipline: the updatedAt this tab last knew, whether it holds
  // unsaved changes, whether a save is in flight, and whether the saved data was
  // replaced elsewhere (after which this tab never writes again).
  var pin = cfg.pin;
  var dirty = false;
  var inflight = false;
  var stale = false;

  function notifyConflict(){
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "artefactor:data-conflict" }, window.location.origin);
      }
    } catch (e) {}
  }

  // \`force\` is for pagehide: the page may be gone before an in-flight save
  // settles, so send now rather than wait.
  function flush(force){
    if (timer) { clearTimeout(timer); timer = null; }
    if (!cfg.writable || stale || !dirty) return;
    if (inflight && force !== true) return; // resumes when the in-flight save settles
    dirty = false;
    var headers = { "Content-Type": "application/json" };
    if (pin) headers["If-Match"] = '"' + pin + '"';
    else headers["If-None-Match"] = "*";
    var failed = false;
    inflight = true;
    var req;
    try {
      req = fetch(cfg.endpoint, {
        method: "PUT",
        headers: headers,
        body: serialize(),
        keepalive: true,
        credentials: "same-origin"
      });
    } catch (e) { inflight = false; dirty = true; return; }
    Promise.resolve(req).then(function(r){
      if (r && r.status === 412) { stale = true; notifyConflict(); return; }
      if (!r || !r.ok) { failed = true; return; }
      return r.json().then(function(d){ if (d && d.updatedAt) pin = d.updatedAt; });
    }).catch(function(){ failed = true; }).then(function(){
      inflight = false;
      // A failed save stays dirty for the next opportunity, without a retry loop.
      if (failed) { dirty = true; return; }
      if (dirty) schedule();
    });
  }
  function schedule(){
    if (!cfg.writable) return;
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, cfg.debounceMs);
  }

  var shim = {
    getItem: function(k){
      k = String(k);
      return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null;
    },
    setItem: function(k, v){
      denyIfReadOnly();
      k = String(k);
      var nv = String(v);
      var had = Object.prototype.hasOwnProperty.call(map, k);
      var prev = map[k];
      map[k] = nv;
      if (enc.encode(serialize()).length > cfg.maxBytes) {
        if (had) { map[k] = prev; } else { delete map[k]; }
        throw quota();
      }
      schedule();
    },
    removeItem: function(k){
      denyIfReadOnly();
      delete map[String(k)];
      schedule();
    },
    clear: function(){
      denyIfReadOnly();
      map = {};
      schedule();
    },
    key: function(i){
      var ks = Object.keys(map);
      i = Number(i);
      return (i >= 0 && i < ks.length) ? ks[i] : null;
    },
    get length(){ return Object.keys(map).length; }
  };

  try {
    Object.defineProperty(window, "localStorage", { configurable: true, get: function(){ return shim; } });
  } catch (e) {
    try { window.localStorage = shim; } catch (e2) {}
  }

  window.addEventListener("pagehide", function(){ flush(true); });
  document.addEventListener("visibilitychange", function(){
    if (document.visibilityState === "hidden") flush();
  });
})();`;
}

// The bootstrap wrapped as a <script> tag for injection into served HTML.
export function bootstrapScript(ctx: BootstrapContext): string {
  return `<script>${bootstrapInnerJs(ctx)}</script>`;
}

// Inject the bootstrap so it runs before any artefact script: right after the
// opening <head> (or <html>), falling back to prepending it.
export function injectBootstrap(html: string, script: string): string {
  const head = html.match(/<head[^>]*>/i);
  if (head && head.index !== undefined) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + script + html.slice(at);
  }
  const htmlTag = html.match(/<html[^>]*>/i);
  if (htmlTag && htmlTag.index !== undefined) {
    const at = htmlTag.index + htmlTag[0].length;
    return html.slice(0, at) + script + html.slice(at);
  }
  return script + html;
}

// Render a served artefact: inject the seeded localStorage bootstrap into its
// trusted HTML.
export function renderArtefactHtml(
  payloadHtml: string,
  ctx: BootstrapContext,
): string {
  return injectBootstrap(payloadHtml, bootstrapScript(ctx));
}
