import type { ArtefactSummary, LinkGateSummary, SetSharingRequest, UserRef } from "../../shared/contracts";
import type { DataVisibility, Visibility } from "./format";
import {
  emptyForm,
  expiryFor,
  formError,
  formFor,
  gateChange,
  linkGateOnPublish,
  type LinkProtectionForm,
} from "./link-protection";

// S55 — Manage access dialog: one draft, saved atomically. The pure model
// behind `ArtefactAccessDialog`: every choice edits a draft, and Done turns the
// draft into one `SetSharingRequest`. Tested without a DOM.

export interface AccessDraft {
  level: Visibility;
  // The `selected` tier's people, with their display identity.
  members: UserRef[];
  // `current` is the saved gate (only while saved Public); `form` the draft of it.
  gate: { current: LinkGateSummary | null; form: LinkProtectionForm };
  dataVisibility: DataVisibility;
}

export interface AccessSections {
  link: boolean;
  viewers: boolean;
  protection: boolean;
  savedData: boolean;
}

// The saved state as a draft. `members` is the retained access list
// (hosting.access-list.retained),
// whatever the saved level.
export function draftOf(summary: ArtefactSummary, members: UserRef[]): AccessDraft {
  const current = summary.visibility === "public" ? (summary.linkGate ?? null) : null;
  return {
    level: summary.visibility,
    members,
    gate: { current, form: formFor(current) },
    dataVisibility: summary.dataVisibility,
  };
}

// Switch the draft's level. Specific people starts from the saved (remembered)
// list; Public starts with protection off unless the saved level is Public,
// whose saved protection comes back.
// r[impl hosting.access-dialog.level-change-start]
export function chooseLevel(draft: AccessDraft, saved: AccessDraft, level: Visibility): AccessDraft {
  if (level === draft.level) return draft;
  const next: AccessDraft = { ...draft, level };
  if (level === "selected") next.members = saved.members;
  if (level === "public") {
    next.gate =
      saved.level === "public"
        ? saved.gate
        : { current: null, form: emptyForm() };
  }
  return next;
}

// The draft once the saved access list has loaded: its people are the loaded
// list, then anyone added while it loaded. Nothing else changes, so an edit made
// before the list arrived keeps it rather than dropping it.
// r[impl hosting.access-dialog.load-keeps-list]
export function withLoadedMembers(draft: AccessDraft, loaded: UserRef[]): AccessDraft {
  const ids = new Set(loaded.map((u) => u.id));
  return { ...draft, members: [...loaded, ...draft.members.filter((u) => !ids.has(u.id))] };
}

// r[impl hosting.access-dialog.sections-by-level]
export function sectionsOf(draft: AccessDraft, usesStorage: boolean): AccessSections {
  const shared = draft.level !== "private";
  return {
    link: shared,
    viewers: draft.level === "selected",
    protection: draft.level === "public",
    savedData: usesStorage && shared,
  };
}

const sameMembers = (a: readonly UserRef[], b: readonly UserRef[]) => {
  const ids = new Set(a.map((u) => u.id));
  return a.length === b.length && b.every((u) => ids.has(u.id));
};

// The link-gate part of Done: on a change to Public, the gate it is published
// with; while Public, only what changed (null clears a half).
function gateRequestOf(saved: AccessDraft, draft: AccessDraft, now: Date): SetSharingRequest["linkGate"] {
  if (draft.level !== "public") return undefined;
  if (saved.level !== "public") return linkGateOnPublish(draft.gate.form, now);
  const change = gateChange(draft.gate.form, saved.gate.current, now);
  return Object.keys(change).length ? change : undefined;
}

// What Done sends, or null when nothing changed: nothing is sent before Done,
// and Cancel never calls this.
// r[impl hosting.access-dialog.draft-until-done]
export function sharingRequestOf(saved: AccessDraft, draft: AccessDraft, now: Date): SetSharingRequest | null {
  const request: SetSharingRequest = { visibility: draft.level };
  if (draft.level === "selected" && !sameMembers(saved.members, draft.members)) {
    request.members = draft.members.map((u) => u.id);
  }
  const linkGate = gateRequestOf(saved, draft, now);
  if (linkGate) request.linkGate = linkGate;
  if (draft.dataVisibility !== saved.dataVisibility) request.dataVisibility = draft.dataVisibility;
  const changed = draft.level !== saved.level || Object.keys(request).length > 1;
  return changed ? request : null;
}

const LEVEL_TOAST: Record<Visibility, (title: string) => string> = {
  private: (t) => `“${t}” is now private`,
  selected: (t) => `“${t}” is now shared with specific people`,
  authenticated: (t) => `“${t}” is now shared with org members`,
  public: (t) => `“${t}” is now public`,
};

const DATA_TOAST: Record<DataVisibility, string> = {
  shared: "Saved data is now shared with viewers",
  own: "Saved data is now each viewer's own",
};

function viewersToast(n: number, title: string): string {
  if (n === 0) return `Only you can now open “${title}”`;
  return `${n} ${n === 1 ? "person" : "people"} can now open “${title}”`;
}

// The toast after a save: its message, and the request that undoes it — null
// when the save touched a password, or left Public while one was set, since the
// stored hash can't be put back.
// r[impl hosting.access-dialog.undo-unless-password]
export function saveToastOf(
  saved: AccessDraft,
  draft: AccessDraft,
  title: string,
  now = new Date(),
): { message: string; undo: SetSharingRequest | null } {
  const request = sharingRequestOf(saved, draft, now) ?? { visibility: draft.level };
  const message =
    draft.level !== saved.level
      ? LEVEL_TOAST[draft.level](title)
      : request.members
        ? viewersToast(request.members.length, title)
        : request.linkGate
          ? "Public link settings saved"
          : DATA_TOAST[draft.dataVisibility];

  const savedGate = saved.gate.current;
  const touchesPassword = request.linkGate?.password !== undefined;
  const leftProtectedPublic = saved.level === "public" && draft.level !== "public" && !!savedGate?.passwordProtected;
  if (touchesPassword || leftProtectedPublic) return { message, undo: null };

  const undo: SetSharingRequest = { visibility: saved.level };
  if (request.members) undo.members = saved.members.map((u) => u.id);
  if (request.dataVisibility) undo.dataVisibility = saved.dataVisibility;
  // Back to saved Public: put the old expiry back when the save moved or cleared it.
  const expiryMoved = request.linkGate?.expiresAt !== undefined || draft.level !== "public";
  if (saved.level === "public" && expiryMoved && savedGate?.expiresAt) {
    undo.linkGate = { expiresAt: savedGate.expiresAt };
  } else if (saved.level === "public" && request.linkGate?.expiresAt !== undefined) {
    undo.linkGate = { expiresAt: null };
  }
  return { message, undo };
}

// The gate the draft describes, for the level trigger's lock and clock: none
// unless the draft is Public.
export function draftGateOf(draft: AccessDraft, now: Date): LinkGateSummary | null {
  if (draft.level !== "public") return null;
  const { form, current } = draft.gate;
  const expiresAt = form.keepExpiry ? (current?.expiresAt ?? null) : expiryFor(form, now);
  if (!form.requirePassword && expiresAt === null) return null;
  return { passwordProtected: form.requirePassword, expiresAt };
}

// The inline error under Link protection; Done is disabled while it is set.
export function protectionError(draft: AccessDraft, now: Date): string | null {
  if (draft.level !== "public") return null;
  const error = formError(draft.gate.form, now);
  if (error === "Pick an expiry date." || error === "The expiry must be in the future.") {
    return "Pick an expiry date in the future.";
  }
  return error;
}
