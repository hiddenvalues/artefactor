import type { LinkGateSummary, SetLinkGateRequest } from "../../shared/contracts";

// S32a — Link controls on public artefacts: the client-side logic behind the
// "Link protection" section. Pure, so it is tested without a DOM.

// No 0/O, 1/l/I: a password read aloud or copied by hand survives.
export const UNAMBIGUOUS_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
export const GENERATED_PASSWORD_LENGTH = 16;
export const LINK_PASSWORD_MIN = 8;
export const LINK_PASSWORD_MAX = 128;

// A random password from the unambiguous alphabet, drawn with the browser's
// CSPRNG. Rejection sampling keeps every character equally likely.
export function generatePassword(length = GENERATED_PASSWORD_LENGTH): string {
  const n = UNAMBIGUOUS_ALPHABET.length;
  const limit = 256 - (256 % n);
  let out = "";
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of bytes) {
      if (b < limit && out.length < length) out += UNAMBIGUOUS_ALPHABET[b % n];
    }
  }
  return out;
}

export type ExpiryChoice = "none" | "1d" | "7d" | "30d" | "custom";

export const EXPIRY_CHOICES: { value: ExpiryChoice; label: string }[] = [
  { value: "none", label: "Never" },
  { value: "1d", label: "1 day" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "custom", label: "Custom" },
];

const PRESET_DAYS: Record<"1d" | "7d" | "30d", number> = { "1d": 1, "7d": 7, "30d": 30 };
const DAY_MS = 24 * 60 * 60 * 1000;

export interface LinkProtectionForm {
  requirePassword: boolean;
  // The new password (generated or typed). Ignored while `keepPassword`.
  password: string;
  // Editing a gate whose password is already set: leave it as it is.
  keepPassword: boolean;
  expiry: ExpiryChoice;
  // A `datetime-local` value, used when `expiry` is "custom".
  customExpiry: string;
  // Editing a gate: leave the saved expiry as it is.
  keepExpiry: boolean;
}

export function emptyForm(): LinkProtectionForm {
  return {
    requirePassword: false,
    password: "",
    keepPassword: false,
    expiry: "none",
    customExpiry: "",
    keepExpiry: false,
  };
}

// The form for editing the gate a public artefact already has.
export function formFor(current: LinkGateSummary | null | undefined): LinkProtectionForm {
  if (!current) return emptyForm();
  return {
    requirePassword: current.passwordProtected,
    password: "",
    keepPassword: current.passwordProtected,
    expiry: current.expiresAt ? "custom" : "none",
    customExpiry: current.expiresAt ? toLocalInput(new Date(current.expiresAt)) : "",
    keepExpiry: true,
  };
}

// "Require a password" / "Change password": pre-fill a generated one.
export function enablePassword(form: LinkProtectionForm): LinkProtectionForm {
  return { ...form, requirePassword: true, keepPassword: false, password: generatePassword() };
}

// The expiry the form describes, as an ISO string; null = never.
export function expiryFor(form: LinkProtectionForm, now: Date): string | null {
  if (form.expiry === "none") return null;
  if (form.expiry === "custom") {
    const at = new Date(form.customExpiry);
    return Number.isNaN(at.getTime()) ? null : at.toISOString();
  }
  return new Date(now.getTime() + PRESET_DAYS[form.expiry] * DAY_MS).toISOString();
}

// A client-side check mirroring the server's AH31 guards, for the inline error.
export function formError(form: LinkProtectionForm, now: Date): string | null {
  if (form.requirePassword && !form.keepPassword) {
    const length = [...form.password].length;
    if (length < LINK_PASSWORD_MIN) return `The password needs at least ${LINK_PASSWORD_MIN} characters.`;
    if (length > LINK_PASSWORD_MAX) return `The password can have at most ${LINK_PASSWORD_MAX} characters.`;
  }
  if (!form.keepExpiry && form.expiry === "custom") {
    const at = expiryFor(form, now);
    if (at === null) return "Pick an expiry date.";
    if (Date.parse(at) <= now.getTime()) return "The expiry must be in the future.";
  }
  return null;
}

// What `PUT …/visibility` sends with the change to public; undefined = no gate.
export function linkGateOnPublish(
  form: LinkProtectionForm,
  now: Date,
): { password?: string; expiresAt?: string } | undefined {
  const gate: { password?: string; expiresAt?: string } = {};
  if (form.requirePassword) gate.password = form.password;
  const expiresAt = expiryFor(form, now);
  if (expiresAt !== null) gate.expiresAt = expiresAt;
  return Object.keys(gate).length ? gate : undefined;
}

// What `PUT …/link-gate` sends for an edit: only what changed, null to clear.
export function gateChange(
  form: LinkProtectionForm,
  current: LinkGateSummary | null | undefined,
  now: Date,
): SetLinkGateRequest {
  const change: SetLinkGateRequest = {};
  if (form.requirePassword) {
    if (!form.keepPassword) change.password = form.password;
  } else if (current?.passwordProtected) {
    change.password = null;
  }
  if (!form.keepExpiry) {
    const expiresAt = expiryFor(form, now);
    if (expiresAt !== null) change.expiresAt = expiresAt;
    else if (current?.expiresAt) change.expiresAt = null;
  }
  return change;
}

export function isExpired(gate: LinkGateSummary | null | undefined, now: Date): boolean {
  return !!gate?.expiresAt && Date.parse(gate.expiresAt) <= now.getTime();
}

// How long until the gate expires, for a timer that re-renders the expiry
// indicators at that instant (time is not reactive state). null = nothing to
// wait for; capped to the largest delay `setTimeout` holds (it then re-arms).
export function expiryTimerDelay(gate: LinkGateSummary | null | undefined, now: Date): number | null {
  if (!gate?.expiresAt) return null;
  const ms = Date.parse(gate.expiresAt) - now.getTime();
  return ms > 0 ? Math.min(ms, 2 ** 31 - 1) : null;
}

// The copy button: writes exactly `text`, reports the label to flash.
export async function copyText(
  clipboard: Pick<Clipboard, "writeText"> | undefined,
  text: string,
): Promise<"Copied" | "Copy failed"> {
  try {
    if (!clipboard) return "Copy failed";
    await clipboard.writeText(text);
    return "Copied";
  } catch {
    return "Copy failed";
  }
}

// A Date as a `datetime-local` input value in the browser's time zone.
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
