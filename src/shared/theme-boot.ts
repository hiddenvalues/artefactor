// S45 — App dark mode with a UI toggle: the pre-paint theme boot script.
//
// One dependency-free script, inlined in two `<head>`s before any stylesheet —
// the SPA's index.html (vite.config.ts's `transformIndexHtml`) and the
// server-rendered host shell (src/server/runtime/shell.ts) — so neither paints
// light before going dark. It reads the SPA's `artefactor:theme` preference
// (src/client/lib/theme.ts; a throw counts as `system`), resolves it against
// the OS and sets `.dark` on `<html>` synchronously. On every OS change it
// re-reads the preference, so it follows the OS only while that is `system` —
// an explicit choice the SPA stores later is never undone by it.
//
// It references only the `localStorage`, `matchMedia` and `document` globals,
// so a test can evaluate it with injected ones. It themes the host chrome only:
// nothing here ever reaches an artefact's frame (S36).
export const THEME_BOOT_JS = `(function(){
  var root = document.documentElement;
  var mq = matchMedia("(prefers-color-scheme: dark)");
  function apply(){
    var pref = null;
    try { pref = localStorage.getItem("artefactor:theme"); } catch (e) {}
    root.classList.toggle("dark", pref === "dark" || (pref !== "light" && mq.matches));
  }
  apply();
  if (mq.addEventListener) mq.addEventListener("change", apply);
  else if (mq.addListener) mq.addListener(apply);
})();`;
