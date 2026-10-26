// S33b — the one test of an invitation address: an artefact share invitation's
// (its route and the access dialog) and an organization invitation's (S58's
// `admitInvite` and the invite dialog). "Well-formed" means "could be
// delivered to", not RFC 5322: one `@`, and a domain of at least two non-empty
// dot-separated labels. No character may be whitespace, a control or invisible
// format character (NUL, bidi overrides, zero-width), or address-list syntax
// (`<`, `>`, quotes, `,`, `;` …), so a mailer can't read the stored address as a
// different recipient and a pending row can't be spoofed. At most SMTP's 254
// characters, which also bounds the pattern's backtracking on a huge body.
const CHAR = String.raw`[^\s@<>()[\]\\,;:"\p{Cc}\p{Cf}]`;
const LABEL = String.raw`[^\s@<>()[\]\\,;:"\p{Cc}\p{Cf}.]+`;
const EMAIL = new RegExp(String.raw`^${CHAR}+@${LABEL}(?:\.${LABEL})+$`, "u");
const MAX_LENGTH = 254;

/** `raw` trimmed and lower-cased when it is a well-formed email, else `null`. */
export function wellFormedEmail(raw: string): string | null {
  const address = raw.trim().toLowerCase();
  return address.length <= MAX_LENGTH && EMAIL.test(address) ? address : null;
}
