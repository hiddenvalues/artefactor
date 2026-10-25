// hosting.uses-storage.chrome-only — detect whether an artefact's HTML appears to use the
// `localStorage` persistence API. Pure heuristic used ONLY to drive host chrome (the S12
// data-context switcher) — never an access, serving, or persistence decision, so a rare miss is
// harmless (the served artefact behaves identically).
//
// A word-boundary match, so `sessionStorage` (which Artefactor does NOT persist)
// does not count, and an identifier like `localStorageManager` is not mistaken
// for the API. Dynamically-constructed access (e.g. `window['local'+'Storage']`)
// is a tolerated false negative.
const LOCAL_STORAGE = /\blocalStorage\b/;

// r[impl hosting.uses-storage.chrome-only]
export function detectUsesStorage(html: string): boolean {
  return LOCAL_STORAGE.test(html);
}

// Convenience for callers holding the raw payload bytes (the create/edit
// commands, which already buffer the HTML to store it).
export function payloadUsesStorage(payload: Uint8Array): boolean {
  return detectUsesStorage(new TextDecoder().decode(payload));
}
