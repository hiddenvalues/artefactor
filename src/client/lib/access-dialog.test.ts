import { describe, expect, it } from "vitest";
import type { ArtefactSummary, ShareInvitation, UserRef } from "../../shared/contracts";
import {
  addInvitation,
  addMember,
  chooseLevel,
  draftGateOf,
  draftOf,
  invitationChangesOf,
  doneToastOf,
  inviteOfferOf,
  pendingInvitationsOf,
  protectionError,
  removeInvitation,
  saveToastOf,
  sectionsOf,
  sharingRequestOf,
  withLoadedInvitations,
  withLoadedMembers,
  type AccessDraft,
} from "./access-dialog";
import { enablePassword } from "./link-protection";

// S55 — Manage access dialog: one draft, saved atomically. The pure model
// behind `ArtefactAccessDialog`.

const NOW = new Date("2026-06-01T12:00:00.000Z");
const LATER = "2026-07-01T12:00:00.000Z";
const u1: UserRef = { id: "u1", name: "Ada", email: "ada@example.com" };
const u2: UserRef = { id: "u2", name: "Bo", email: "bo@example.com" };
const u3: UserRef = { id: "u3", name: "Cy", email: "cy@example.com" };

function summary(over: Partial<ArtefactSummary> = {}): ArtefactSummary {
  return {
    id: "a1",
    ownerId: "me",
    title: "T",
    kind: "prototype",
    visibility: "private",
    effectiveVisibility: "private",
    collectionId: null,
    status: "active",
    publicSlug: null,
    payloadBytes: 10,
    usesStorage: false,
    dataVisibility: "own",
    thumbnailUrl: null,
    linkGate: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...over,
  };
}

const saved = (over: Partial<ArtefactSummary> = {}, members: UserRef[] = []) =>
  draftOf(summary({ effectiveVisibility: over.visibility ?? "private", ...over }), members);

const withPassword = (d: AccessDraft, pw = "abcdefgh12345678"): AccessDraft => ({
  ...d,
  gate: { ...d.gate, form: { ...enablePassword(d.gate.form), password: pw } },
});

describe("chooseLevel (S55)", () => {
  // r[verify hosting.access-dialog.level-change-start]
  it("brings the remembered list back when choosing Specific people from another level", () => {
    const s = saved({ visibility: "public", publicSlug: "s" }, [u1]);
    expect(chooseLevel(s, s, "selected").members).toEqual([u1]);
  });

  // r[verify hosting.access-dialog.level-change-start]
  it("starts empty when nobody was ever added", () => {
    const s = saved({ visibility: "public", publicSlug: "s" });
    expect(chooseLevel(s, s, "selected").members).toEqual([]);
  });

  // r[verify hosting.access-dialog.level-change-start]
  it("returns to the saved viewers after a detour through Public", () => {
    const s = saved({ visibility: "selected", publicSlug: "s" }, [u1]);
    const away = chooseLevel({ ...s, members: [u1, u2] }, s, "public");
    expect(chooseLevel(away, s, "selected").members).toEqual([u1]);
  });

  // r[verify hosting.access-dialog.level-change-start]
  it("starts Public with protection off when the saved level is another", () => {
    const s = saved({ visibility: "private" });
    const d = chooseLevel(s, s, "public");
    expect(d.gate.form.requirePassword).toBe(false);
    expect(d.gate.form.expiry).toBe("none");
    expect(d.gate.form.keepPassword).toBe(false);
  });

  // r[verify hosting.access-dialog.level-change-start]
  it("restores the saved protection when returning to saved Public", () => {
    const s = saved({ visibility: "public", publicSlug: "s", linkGate: { passwordProtected: true, expiresAt: null } });
    const back = chooseLevel(chooseLevel(s, s, "authenticated"), s, "public");
    expect(back.gate.form.keepPassword).toBe(true);
    expect(back.gate.form.requirePassword).toBe(true);
  });
});

describe("withLoadedMembers (S55)", () => {
  // r[verify hosting.access-dialog.load-keeps-list]
  it("takes the loaded list and keeps every other edit", () => {
    const s = saved({ visibility: "selected", publicSlug: "s", usesStorage: true });
    const merged = withLoadedMembers({ ...s, dataVisibility: "shared" }, [u1, u2]);
    expect(merged.members).toEqual([u1, u2]);
    expect(merged.dataVisibility).toBe("shared");
  });

  // r[verify hosting.access-dialog.load-keeps-list]
  it("keeps a person added while loading after the loaded list", () => {
    const s = saved({ visibility: "selected", publicSlug: "s" });
    expect(withLoadedMembers({ ...s, members: [u3] }, [u1, u2]).members).toEqual([u1, u2, u3]);
  });

  // r[verify hosting.access-dialog.load-keeps-list]
  it("doesn't duplicate a person added while loading who is already on the list", () => {
    const s = saved({ visibility: "selected", publicSlug: "s" });
    expect(withLoadedMembers({ ...s, members: [u1] }, [u1, u2]).members).toEqual([u1, u2]);
  });

  // r[verify hosting.access-dialog.load-keeps-list]
  it("applies whatever the draft level", () => {
    const s = saved({ visibility: "authenticated", publicSlug: "s" });
    const merged = withLoadedMembers(s, [u1]);
    expect(merged.members).toEqual([u1]);
    expect(merged.level).toBe("authenticated");
  });

  // r[verify hosting.access-dialog.load-keeps-list]
  it("leaves no members change for Done after an edit made while loading", () => {
    const over = { visibility: "selected", publicSlug: "s", usesStorage: true } as const;
    const loading = saved(over);
    const merged = withLoadedMembers({ ...loading, dataVisibility: "shared" }, [u1, u2]);
    expect(sharingRequestOf(saved(over, [u1, u2]), merged, NOW)).toEqual({
      visibility: "selected",
      dataVisibility: "shared",
    });
  });
});

describe("sectionsOf (S55)", () => {
  // r[verify hosting.access-dialog.sections-by-level]
  it("shows the sections each level calls for", () => {
    const at = (level: AccessDraft["level"]) => ({ ...saved(), level });
    const none = { link: false, viewers: false, protection: false, savedData: false };
    expect(sectionsOf(at("private"), true)).toEqual(none);
    expect(sectionsOf(at("selected"), false)).toEqual({ ...none, link: true, viewers: true });
    expect(sectionsOf(at("authenticated"), true)).toEqual({ ...none, link: true, savedData: true });
    expect(sectionsOf(at("authenticated"), false)).toEqual({ ...none, link: true });
    expect(sectionsOf(at("public"), false)).toEqual({ ...none, link: true, protection: true });
    expect(sectionsOf(at("public"), true)).toEqual({ ...none, link: true, protection: true, savedData: true });
  });
});

describe("sharingRequestOf (S55)", () => {
  // r[verify hosting.access-dialog.draft-until-done]
  it("is null when nothing changed", () => {
    const s = saved({ visibility: "public", publicSlug: "s", linkGate: { passwordProtected: true, expiresAt: LATER } });
    expect(sharingRequestOf(s, s, NOW)).toBeNull();
    const back = chooseLevel(chooseLevel(s, s, "private"), s, "public");
    expect(sharingRequestOf(s, back, NOW)).toBeNull();
  });

  // r[verify hosting.access-dialog.draft-until-done]
  it("sends only the level for a level-only change", () => {
    const s = saved({}, [u1]);
    expect(sharingRequestOf(s, chooseLevel(s, s, "authenticated"), NOW)).toEqual({ visibility: "authenticated" });
    // Specific people with the remembered list unchanged sends no members.
    expect(sharingRequestOf(s, chooseLevel(s, s, "selected"), NOW)).toEqual({ visibility: "selected" });
  });

  // r[verify hosting.access-dialog.draft-until-done]
  it("sends the full list when a viewer is added", () => {
    const s = saved({ visibility: "selected", publicSlug: "s" }, [u1]);
    expect(sharingRequestOf(s, { ...s, members: [u1, u2] }, NOW)).toEqual({ visibility: "selected", members: ["u1", "u2"] });
  });

  it("sends the gate with the change to public, and only what changed while public", () => {
    const s = saved();
    expect(sharingRequestOf(s, withPassword(chooseLevel(s, s, "public")), NOW)).toEqual({
      visibility: "public",
      linkGate: { password: "abcdefgh12345678" },
    });
    const p = saved({ visibility: "public", publicSlug: "s", linkGate: { passwordProtected: true, expiresAt: null } });
    const cleared = { ...p, gate: { ...p.gate, form: { ...p.gate.form, requirePassword: false, keepPassword: false } } };
    expect(sharingRequestOf(p, cleared, NOW)).toEqual({ visibility: "public", linkGate: { password: null } });
  });

  it("sends data visibility only when it changed", () => {
    const s = saved({ visibility: "authenticated", publicSlug: "s", usesStorage: true });
    expect(sharingRequestOf(s, { ...s, dataVisibility: "shared" }, NOW)).toEqual({
      visibility: "authenticated",
      dataVisibility: "shared",
    });
  });
});

describe("saveToastOf (S55)", () => {
  it("names the level when it changed", () => {
    const s = saved();
    expect(saveToastOf(s, chooseLevel(s, s, "public"), "T").message).toBe("“T” is now public");
    expect(saveToastOf(s, chooseLevel(s, s, "authenticated"), "T").message).toBe("“T” is now shared with org members");
  });

  it("counts the viewers when only they changed", () => {
    const s = saved({ visibility: "selected", publicSlug: "s" }, [u1]);
    expect(saveToastOf(s, { ...s, members: [u1, u2] }, "T").message).toBe("2 people can now open “T”");
  });

  it("says the public link settings were saved when only the expiry changed", () => {
    const s = saved({ visibility: "public", publicSlug: "s", linkGate: { passwordProtected: false, expiresAt: LATER } });
    const d = { ...s, gate: { ...s.gate, form: { ...s.gate.form, keepExpiry: false, expiry: "7d" as const } } };
    expect(saveToastOf(s, d, "T").message).toBe("Public link settings saved");
  });

  it("names the saved-data choice when only it changed", () => {
    const s = saved({ visibility: "authenticated", publicSlug: "s", usesStorage: true });
    expect(saveToastOf(s, { ...s, dataVisibility: "shared" }, "T").message).toBe("Saved data is now shared with viewers");
  });

  // r[verify hosting.access-dialog.undo-unless-password]
  it("offers an Undo that restores the saved state", () => {
    const s = saved({}, [u1]);
    expect(saveToastOf(s, chooseLevel(s, s, "authenticated"), "T").undo).toEqual({ visibility: "private" });
    const sel = saved({ visibility: "selected", publicSlug: "s" }, [u1]);
    expect(saveToastOf(sel, { ...sel, members: [u1, u2], dataVisibility: "shared" }, "T").undo).toEqual({
      visibility: "selected",
      members: ["u1"],
      dataVisibility: "own",
    });
  });

  // r[verify hosting.access-dialog.undo-unless-password]
  it("offers no Undo after a new password, or leaving a password-protected Public", () => {
    const s = saved();
    expect(saveToastOf(s, withPassword(chooseLevel(s, s, "public")), "T").undo).toBeNull();
    const p = saved({ visibility: "public", publicSlug: "s", linkGate: { passwordProtected: true, expiresAt: null } });
    expect(saveToastOf(p, chooseLevel(p, p, "private"), "T").undo).toBeNull();
  });

  // r[verify hosting.access-dialog.undo-unless-password]
  it("restores the old expiry after an expiry-only change", () => {
    const s = saved({ visibility: "public", publicSlug: "s", linkGate: { passwordProtected: false, expiresAt: LATER } });
    const d = { ...s, gate: { ...s.gate, form: { ...s.gate.form, keepExpiry: false, expiry: "7d" as const } } };
    expect(saveToastOf(s, d, "T").undo).toEqual({ visibility: "public", linkGate: { expiresAt: LATER } });
  });
});

describe("draftGateOf (S55)", () => {
  it("is the draft's protection while Public, for the trigger's lock and clock", () => {
    const p = saved({ visibility: "public", publicSlug: "s", linkGate: { passwordProtected: true, expiresAt: LATER } });
    expect(draftGateOf(p, NOW)).toEqual({ passwordProtected: true, expiresAt: LATER });
    expect(draftGateOf(chooseLevel(p, p, "private"), NOW)).toBeNull();
    const s = saved();
    expect(draftGateOf(chooseLevel(s, s, "public"), NOW)).toBeNull();
    expect(draftGateOf(withPassword(chooseLevel(s, s, "public")), NOW)).toEqual({ passwordProtected: true, expiresAt: null });
  });
});

describe("protectionError (S55)", () => {
  it("gives the hand-back's messages, and null for a valid form", () => {
    const s = saved();
    const pub = chooseLevel(s, s, "public");
    expect(protectionError(withPassword(pub, "abcde"), NOW)).toBe("The password needs at least 8 characters.");
    const past = { ...pub, gate: { ...pub.gate, form: { ...pub.gate.form, expiry: "custom" as const, customExpiry: "2020-01-01T00:00" } } };
    expect(protectionError(past, NOW)).toBe("Pick an expiry date in the future.");
    expect(protectionError(withPassword(pub), NOW)).toBeNull();
    // Only Public has protection to get wrong.
    expect(protectionError({ ...withPassword(pub, "abcde"), level: "private" }, NOW)).toBeNull();
  });
});

describe("share invitations (S33b)", () => {
  const pending: ShareInvitation = {
    id: "inv-1",
    email: "pending@b.co",
    createdAt: NOW.toISOString(),
    expiresAt: LATER,
  };
  const sel = draftOf(summary({ visibility: "selected", effectiveVisibility: "selected" }), [u1], [pending]);

  // r[verify hosting.invitations.sent-on-done+3]
  it("sends an added email, and nothing for one added and removed again before Done", () => {
    const added = addInvitation(addInvitation(sel, "a@b.co"), "c@d.co");
    const removed = removeInvitation(added, { email: "c@d.co", saved: null });
    expect(invitationChangesOf(sel, removed)).toEqual({ invite: ["a@b.co"], revoke: [] });
    expect(invitationChangesOf(sel, sel)).toEqual({ invite: [], revoke: [] });
  });

  // r[verify hosting.invitations.sent-on-done+3]
  it("revokes a removed saved invitation, and keeps it when it is invited again", () => {
    const row = pendingInvitationsOf(sel)[0]!;
    const removed = removeInvitation(sel, row);
    expect(pendingInvitationsOf(removed)).toEqual([]);
    expect(invitationChangesOf(sel, removed)).toEqual({ invite: [], revoke: [pending] });
    const back = addInvitation(removed, "pending@b.co");
    expect(invitationChangesOf(sel, back)).toEqual({ invite: [], revoke: [] });
  });

  // r[verify hosting.invitations.sent-on-done+3]
  it("invites only from Specific people, but revokes at any level", () => {
    const added = addInvitation(sel, "a@b.co");
    expect(invitationChangesOf(sel, { ...added, level: "public" })).toEqual({ invite: [], revoke: [] });
    const removed = removeInvitation(sel, pendingInvitationsOf(sel)[0]!);
    expect(invitationChangesOf(sel, { ...removed, level: "private" })).toEqual({ invite: [], revoke: [pending] });
  });

  // r[verify hosting.invitations.invite-affordance+3]
  it("offers a well-formed email no result, person or pending invitation has", () => {
    expect(inviteOfferOf(" A@B.co ", [], sel)).toBe("a@b.co");
    expect(inviteOfferOf("nope", [], sel)).toBeNull();
    // A query matching a directory user by email offers no Invite.
    expect(inviteOfferOf("BO@example.com", [u2], sel)).toBeNull();
    expect(inviteOfferOf(u1.email, [], sel)).toBeNull();
    expect(inviteOfferOf("pending@b.co", [], sel)).toBeNull();
    expect(inviteOfferOf("a@b.co", [], addInvitation(sel, "a@b.co"))).toBeNull();
  });

  // r[verify hosting.invitations.sent-on-done+3]
  it("reports a Done in one toast that keeps the save's Undo", () => {
    const none = { sent: [], removed: 0, failed: [] };
    const undo = { visibility: "public" as const };
    const save = { message: "“P” is now shared with specific people", undo };
    expect(doneToastOf(null, none)).toBeNull();
    expect(doneToastOf(save, none)).toEqual({ message: save.message, error: false, undo });
    // Invitations only: just their part, without Undo.
    expect(doneToastOf(null, { ...none, sent: ["a@b.co"] })).toEqual({
      message: "Invitation sent to a@b.co",
      error: false,
      undo: null,
    });
    expect(doneToastOf(null, { ...none, removed: 1 })?.message).toBe("Invitation removed");
    expect(doneToastOf(null, { ...none, removed: 3 })?.message).toBe("3 invitations removed");
    // With a save: its message first, then the invitations, Undo kept.
    expect(doneToastOf(save, { ...none, sent: ["a@b.co", "c@d.co"], removed: 1 })).toEqual({
      message: `${save.message} · 2 invitations sent · Invitation removed`,
      error: false,
      undo,
    });
    // A failure makes it an error naming the email, still with the save and its Undo.
    expect(
      doneToastOf(save, { sent: ["c@d.co"], removed: 0, failed: ["Couldn't send the invitation to a@b.co."] }),
    ).toEqual({ message: `${save.message} · Couldn't send the invitation to a@b.co.`, error: true, undo });
  });

  it("keeps invites made while the saved invitations load", () => {
    const loading = addInvitation(draftOf(summary(), []), "a@b.co");
    expect(pendingInvitationsOf(withLoadedInvitations(loading, [pending])).map((p) => p.email)).toEqual([
      "pending@b.co",
      "a@b.co",
    ]);
  });

  it("folds an invite made while loading into the saved invitation with that email", () => {
    const loading = addInvitation(draftOf(summary(), []), "pending@b.co");
    const loaded = withLoadedInvitations(loading, [pending]);
    expect(pendingInvitationsOf(loaded).map((p) => p.saved?.id ?? null)).toEqual([pending.id]);
    // Removing that one row revokes it, with nothing left to invite.
    const removed = removeInvitation(loaded, pendingInvitationsOf(loaded)[0]!);
    expect(pendingInvitationsOf(removed)).toEqual([]);
  });

  it("drops an unsaved invite of a person then added from the directory", () => {
    const invited = addInvitation(sel, "bo@example.com");
    const added = addMember(invited, u2);
    expect(added.members).toContainEqual(u2);
    expect(pendingInvitationsOf(added).map((p) => p.email)).toEqual(["pending@b.co"]);
  });

  it("offers no Invite for the owner's own email, which the route refuses", () => {
    expect(inviteOfferOf(" Me@Acme.se ", [], sel, "me@acme.se")).toBeNull();
    expect(inviteOfferOf("a@b.co", [], sel, "me@acme.se")).toBe("a@b.co");
  });
});
