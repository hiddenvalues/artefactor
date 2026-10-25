import { describe, expect, it } from "vitest";
import { admitInvite } from "./invite";

// S58 — Organization settings screen and its administration seam: whether an
// address may be invited to the active org, decided in core before the
// provider is called.
const ORG = {
  inviteDomains: ["acme.se"],
  members: [{ email: "owner@acme.se" }],
  invitations: [{ email: "pending@acme.se" }],
};

// r[verify identity.org-admin.invite-domain+2]
describe("admitInvite", () => {
  it("admits a valid address at an invite domain, trimmed and lower-cased", () => {
    expect(admitInvite("  Ada@Acme.se ", ORG)).toEqual({ email: "ada@acme.se" });
  });

  it.each(["not-an-email", "", "ada@", "@acme.se", "a b@acme.se", "ada@acme"])(
    "refuses %j as invalid-email",
    (email) => {
      expect(admitInvite(email, ORG)).toEqual({ refused: "invalid-email" });
    },
  );

  it("refuses another domain, and a subdomain, as outside-domains", () => {
    expect(admitInvite("ada@gmail.com", ORG)).toEqual({ refused: "outside-domains" });
    expect(admitInvite("ada@sub.acme.se", ORG)).toEqual({ refused: "outside-domains" });
  });

  it("admits no one when the org has no invite domains, and never by wildcard", () => {
    expect(admitInvite("ada@acme.se", { ...ORG, inviteDomains: [] })).toEqual({ refused: "outside-domains" });
    expect(admitInvite("ada@acme.se", { ...ORG, inviteDomains: ["*"] })).toEqual({ refused: "outside-domains" });
  });

  it("matches invite domains case-insensitively", () => {
    expect(admitInvite("ada@acme.se", { ...ORG, inviteDomains: ["ACME.se"] })).toEqual({ email: "ada@acme.se" });
  });

  it("refuses a member's address as already-member, and a pending one as already-invited", () => {
    expect(admitInvite("Owner@acme.se", ORG)).toEqual({ refused: "already-member" });
    expect(admitInvite("pending@ACME.se", ORG)).toEqual({ refused: "already-invited" });
  });
});
