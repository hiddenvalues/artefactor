// An artefact's share link, `/a/<slug>` on the app origin — built here and nowhere else, by the
// server (the serving mount, the connector's absolute `url`, the unlock and frame sub-paths) and
// the client (open, copy) alike. `share-link.test.ts` fails on a link built by hand.

export const SHARE_LINK_BASE = "/a";

// r[impl hosting.url.share-link]
export function shareLinkPath(slug: string): string {
  return `${SHARE_LINK_BASE}/${encodeURIComponent(slug)}`;
}

// A share link built by hand: `/a/` followed by a template interpolation (`/a/${`) or a JSX
// expression (`/a/{`), or a string ending in `/a/` that is concatenated (`"/a/" +`,
// `` `${origin}/a/` + ``, `"/a/".concat(`), or the base joined to a slug by hand
// (`${SHARE_LINK_BASE}/${`). Comments are ignored. Returns `file:line` per hit.
const HAND_BUILT = [
  /\/a\/\$\{/,
  /\/a\/\{/,
  /\/a\/["'`]\s*(\+|\.concat\()/,
  /\$\{SHARE_LINK_BASE\}\/\$\{/,
];

export function findHandBuiltShareLinks(file: string, source: string): string[] {
  return source.split(/\r?\n/).flatMap((line, i) => {
    const code = line.replace(/\/\*.*?\*\//g, "").trimStart();
    if (/^(\/\/|\/\*|\*)/.test(code)) return [];
    const stripped = code.replace(/\s\/\/.*$/, "");
    return HAND_BUILT.some((re) => re.test(stripped)) ? [`${file}:${i + 1}`] : [];
  });
}
