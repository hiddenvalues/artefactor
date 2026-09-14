// S13 — Artefact runtime bootstrap (localStorage hijack).
//
// On serve, Artefactor injects a script — before any artefact script runs — that
// replaces `window.localStorage` with a backend-backed shim. The artefact needs
// zero code changes and sees one opaque dataset: the whole localStorage keyspace
// is modelled as a single JSON object (`{ [key]: stringValue }`) which IS the
// `DataEntry.blob`. The shim is seeded server-side (so reads are synchronous).
// Over-cap writes throw `QuotaExceededError`; a read-only context (logged-out
// viewer, or another author's data via S12) throws on write while seeded reads
// still work. No `window.ARTEFACTOR` is exposed.
//
// S36 (AD10) — the artefact runs in a sandboxed, opaque-origin frame with no
// session (AH28), so the shim never calls the API. It posts each change — the
// whole blob, debounced, and again on pagehide / visibilitychange when a change
// is still unposted — to the host shell (`window.parent`, at the app origin).
// The shell owns the S31 write discipline: the pin, no overlapping saves, and
// the 412 conflict banner (see `shell.ts`).
//
// See docs/specs/ddd/artefact-data.md §"Artefact runtime contract".

export interface BootstrapContext {
  // The seed blob: a JSON object string `{ [key]: stringValue }`. "{}" when the
  // viewer has no entry yet.
  seedBlob: string;
  // Whether the served context may persist writes (authenticated viewer of their
  // own entry). Read-only contexts throw on write.
  writable: boolean;
  // The app origin the host shell runs on — the `targetOrigin` changes are posted
  // to, so a frame embedded anywhere else never hands its data over.
  targetOrigin: string;
  // The blob byte cap; an over-cap write throws QuotaExceededError.
  maxBytes: number;
  // Debounce window before a change is posted, in ms.
  debounceMs?: number;
}

// The shim as inline JS (an IIFE). Kept free of server-only references so it can
// be unit-tested by evaluating it with injected globals. References only
// `window`, `document`, `setTimeout`, `clearTimeout`, `TextEncoder`.
export function bootstrapInnerJs(ctx: BootstrapContext): string {
  const cfg = {
    seed: ctx.seedBlob,
    writable: ctx.writable,
    targetOrigin: ctx.targetOrigin,
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
  // Whether the map holds a change the shell hasn't been handed yet.
  var dirty = false;

  function serialize(){ return JSON.stringify(map); }
  function quota(){ var e = new Error("localStorage quota exceeded"); e.name = "QuotaExceededError"; return e; }
  function denyIfReadOnly(){ if (!cfg.writable) throw quota(); }

  function post(){
    if (timer) { clearTimeout(timer); timer = null; }
    if (!cfg.writable || !dirty) return;
    dirty = false;
    try {
      window.parent.postMessage({ type: "artefactor:data-changed", blob: serialize() }, cfg.targetOrigin);
    } catch (e) {}
  }
  function schedule(){
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(post, cfg.debounceMs);
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

  window.addEventListener("pagehide", post);
  document.addEventListener("visibilitychange", function(){
    if (document.visibilityState === "hidden") post();
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
