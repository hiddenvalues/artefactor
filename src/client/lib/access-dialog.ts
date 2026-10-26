import type {
  ArtefactSummary,
  LinkGateSummary,
  SetSharingRequest,
  ShareInvitation,
  UserRef,
} from "../../shared/contracts";
import { wellFormedEmail } from "../../shared/email";
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
  // S33b — the pending share invitations: the saved ones, the emails to invite
  // on Done and the saved ones to revoke (by id). Empty where the deployment
  // offers no invitations.
  invitations: { saved: ShareInvitation[]; add: string[]; revoke: string[] };
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
export function draftOf(
  summary: ArtefactSummary,
  members: UserRef[],
  invitations: ShareInvitation[] = [],
): AccessDraft {
  const current = summary.visibility === "public" ? (summary.linkGate ?? null) : null;
  return {
    level: summary.visibility,
    members,
    gate: { current, form: formFor(current) },
    dataVisibility: summary.dataVisibility,
    invitations: { saved: invitations, add: [], revoke: [] },
  };
}

// Switch the draft's level. Specific people starts from the saved (remembered)
// list; Public starts with protection off unless the saved level is Public,
// whose saved protection comes back.
// r[impl hosting.access-dialog.level-change-start]
export function chooseLevel(draft: AccessDraft, saved: AccessDraft, level: Visibility): AccessDraft {
  if (level === draft.level) return draft;
  const next: AccessDraft = { ...draft, level };
  if (level === "selected") {
    next.members = saved.members;
    next.invitations = saved.invitations;
  }
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

// The draft once the saved invitations have loaded: the invites and revokes
// made meanwhile stay, but an invite of an email already pending folds into
// that saved invitation, so it shows one row.
export function withLoadedInvitations(draft: AccessDraft, loaded: ShareInvitation[]): AccessDraft {
  const pending = new Set(loaded.map((i) => i.email.toLowerCase()));
  const add = draft.invitations.add.filter((email) => !pending.has(email));
  return { ...draft, invitations: { ...draft.invitations, saved: loaded, add } };
}

// S33b — one pending invitation under People with access: a saved one, or an
// email the draft will invite on Done.
export interface PendingInvitation {
  email: string;
  saved: ShareInvitation | null;
}

// The draft's pending invitations: the saved ones still kept, then the new ones.
export function pendingInvitationsOf(draft: AccessDraft): PendingInvitation[] {
  const { saved, add, revoke } = draft.invitations;
  return [
    ...saved.filter((i) => !revoke.includes(i.id)).map((i) => ({ email: i.email, saved: i })),
    ...add.map((email) => ({ email, saved: null })),
  ];
}

// The email the Viewers search offers to invite, or null: a well-formed query
// that no result, person or pending invitation in the draft already has, and
// that isn't the owner's own (`ownEmail`; the directory search leaves the owner
// out, and the route refuses it).
export function inviteOfferOf(
  query: string,
  results: readonly UserRef[],
  draft: AccessDraft,
  ownEmail?: string,
): string | null {
  const email = wellFormedEmail(query);
  if (!email || email === ownEmail?.trim().toLowerCase()) return null;
  const taken = [...results, ...draft.members, ...pendingInvitationsOf(draft)].some(
    (p) => p.email.trim().toLowerCase() === email,
  );
  return taken ? null : email;
}

// A directory person added as a viewer: an unsaved invite of their email is
// dropped, since adding them grants the access the invite would have.
export function addMember(draft: AccessDraft, person: UserRef): AccessDraft {
  const email = person.email.trim().toLowerCase();
  const add = draft.invitations.add.filter((e) => e !== email);
  return { ...draft, members: [...draft.members, person], invitations: { ...draft.invitations, add } };
}

export function addInvitation(draft: AccessDraft, email: string): AccessDraft {
  const { saved, add, revoke } = draft.invitations;
  const kept = saved.find((i) => i.email.toLowerCase() === email);
  // Inviting a saved invitation removed in this draft keeps it instead.
  if (kept) return { ...draft, invitations: { ...draft.invitations, revoke: revoke.filter((id) => id !== kept.id) } };
  if (add.includes(email)) return draft;
  return { ...draft, invitations: { ...draft.invitations, add: [...add, email] } };
}

export function removeInvitation(draft: AccessDraft, pending: PendingInvitation): AccessDraft {
  const { add, revoke } = draft.invitations;
  return {
    ...draft,
    invitations: pending.saved
      ? { ...draft.invitations, revoke: [...revoke, pending.saved.id] }
      : { ...draft.invitations, add: add.filter((e) => e !== pending.email) },
  };
}

// What Done sends after the sharing save: the emails to invite and the saved
// invitations to revoke. Invites go out, like the viewers, only while the draft
// is Specific people; a revoke goes out at any level, since pending invitations
// are kept like the retained access list. An email invited and removed again
// before Done sends nothing.
// r[impl hosting.invitations.sent-on-done+3]
export function invitationChangesOf(
  saved: AccessDraft,
  draft: AccessDraft,
): { invite: string[]; revoke: ShareInvitation[] } {
  const pending = new Set(saved.invitations.saved.map((i) => i.email.toLowerCase()));
  return {
    invite: draft.level === "selected" ? draft.invitations.add.filter((email) => !pending.has(email)) : [],
    revoke: saved.invitations.saved.filter((i) => draft.invitations.revoke.includes(i.id)),
  };
}

// The one toast a Done shows (toasts show one at a time): the sharing save's
// message, keeping its Undo, then what happened to the invitations — or, when
// one failed, an error naming each failed email in their place. Null when
// nothing was saved or sent.
export function doneToastOf(
  save: { message: string; undo: SetSharingRequest | null } | null,
  invited: { sent: readonly string[]; removed: number; failed: readonly string[] },
): { message: string; error: boolean; undo: SetSharingRequest | null } | null {
  const { sent, removed, failed } = invited;
  const parts = save ? [save.message] : [];
  if (failed.length) parts.push(...failed);
  else {
    if (sent.length) parts.push(sent.length === 1 ? `Invitation sent to ${sent[0]}` : `${sent.length} invitations sent`);
    if (removed) parts.push(removed === 1 ? "Invitation removed" : `${removed} invitations removed`);
  }
  if (parts.length === 0) return null;
  return { message: parts.join(" · "), error: failed.length > 0, undo: save?.undo ?? null };
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
