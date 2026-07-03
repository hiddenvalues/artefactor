import { describe, expect, it } from "vitest";
import {
  canViewArtefact,
  canViewArtefactUnder,
  defaultAccessPolicy,
  type AccessPolicy,
  type ViewableArtefact,
} from "./access";
import { DEFAULT_TENANT } from "./artefact";

const OWNER = "owner-1";
const OTHER = "user-2";
const MEMBER = "member-3";

function artefact(
  visibility: ViewableArtefact["visibility"],
  status: ViewableArtefact["status"] = "active",
  sharedWith: string[] = [],
  tenantId: string = DEFAULT_TENANT,
): ViewableArtefact {
  return { visibility, status, ownerId: OWNER, sharedWith, tenantId };
}

describe("canViewArtefact — access matrix (S6, AH8)", () => {
  it("public is viewable by anyone, including the unauthenticated", () => {
    expect(canViewArtefact(artefact("public"), null)).toBe(true);
    expect(canViewArtefact(artefact("public"), OTHER)).toBe(true);
    expect(canViewArtefact(artefact("public"), OWNER)).toBe(true);
  });

  it("authenticated is viewable by any signed-in user, not the anonymous", () => {
    expect(canViewArtefact(artefact("authenticated"), null)).toBe(false);
    expect(canViewArtefact(artefact("authenticated"), OTHER)).toBe(true);
    expect(canViewArtefact(artefact("authenticated"), OWNER)).toBe(true);
  });

  it("selected is viewable by the owner and members only (AH8/13)", () => {
    const a = artefact("selected", "active", [MEMBER]);
    expect(canViewArtefact(a, OWNER)).toBe(true); // owner always
    expect(canViewArtefact(a, MEMBER)).toBe(true); // granted member
    expect(canViewArtefact(a, OTHER)).toBe(false); // signed-in non-member
    expect(canViewArtefact(a, null)).toBe(false); // anonymous
  });

  it("selected with an empty access list is owner-only (AH13)", () => {
    const a = artefact("selected", "active", []);
    expect(canViewArtefact(a, OWNER)).toBe(true);
    expect(canViewArtefact(a, OTHER)).toBe(false);
  });

  it("private is viewable only by the owner", () => {
    expect(canViewArtefact(artefact("private"), null)).toBe(false);
    expect(canViewArtefact(artefact("private"), OTHER)).toBe(false);
    expect(canViewArtefact(artefact("private"), OWNER)).toBe(true);
  });

  it("archived is never viewable, owner included (AH7)", () => {
    expect(canViewArtefact(artefact("public", "archived"), OWNER)).toBe(false);
    expect(canViewArtefact(artefact("public", "archived"), null)).toBe(false);
    expect(canViewArtefact(artefact("private", "archived"), OWNER)).toBe(false);
  });
});

// S22 part B (AH18) — the access decision is policy-decided, but only the
// `authenticated` tier's meaning is overridable. Everything else — AH7, AH8's
// per-tier semantics and no-leak uniformity, and the owner's view of their own
// artefact — is fixed under any policy.
describe("canViewArtefactUnder — AccessPolicy seam (S22, AH18)", () => {
  // A stub multi-tenant policy: the `authenticated` tier is granted to a fixed
  // co-member list of one tenant (the EE ET3 shape). The owner is deliberately
  // NOT on the list, to prove owner view is fixed, not policy-granted.
  const ORG_A = "org-a";
  const coMemberPolicy: AccessPolicy = {
    grantsAuthenticatedTier: (viewerId, tenantId) =>
      tenantId === ORG_A && viewerId === MEMBER,
  };
  const denyAll: AccessPolicy = { grantsAuthenticatedTier: () => false };
  const allowAll: AccessPolicy = { grantsAuthenticatedTier: () => true };

  it("under the default policy, every decision equals the OSS matrix", async () => {
    const cases: [ViewableArtefact, string | null][] = [];
    for (const a of [
      artefact("public"),
      artefact("authenticated"),
      artefact("selected", "active", [MEMBER]),
      artefact("private"),
      artefact("public", "archived"),
      artefact("authenticated", "archived"),
    ]) {
      for (const viewer of [null, OWNER, MEMBER, OTHER]) {
        cases.push([a, viewer]);
      }
    }
    for (const [a, viewer] of cases) {
      expect(await canViewArtefactUnder(defaultAccessPolicy, a, viewer)).toBe(
        canViewArtefact(a, viewer),
      );
    }
  });

  it("authenticated tier: the policy grants co-members and denies others (T3)", async () => {
    const a = artefact("authenticated", "active", [], ORG_A);
    expect(await canViewArtefactUnder(coMemberPolicy, a, MEMBER)).toBe(true);
    expect(await canViewArtefactUnder(coMemberPolicy, a, OTHER)).toBe(false);
  });

  it("authenticated tier: a viewer who is co-member of a different tenant is denied", async () => {
    const elsewhere = artefact("authenticated", "active", [], "org-b");
    expect(await canViewArtefactUnder(coMemberPolicy, elsewhere, MEMBER)).toBe(
      false,
    );
  });

  it("the owner's view of their own artefact is never policy-denied (AH9)", async () => {
    const a = artefact("authenticated", "active", [], ORG_A);
    expect(await canViewArtefactUnder(coMemberPolicy, a, OWNER)).toBe(true);
    expect(await canViewArtefactUnder(denyAll, a, OWNER)).toBe(true);
  });

  it("the anonymous are never policy-granted the authenticated tier (AH8)", async () => {
    const a = artefact("authenticated", "active", [], ORG_A);
    expect(await canViewArtefactUnder(allowAll, a, null)).toBe(false);
  });

  it("public/selected/private semantics are fixed — the policy is not consulted", async () => {
    const consulted: string[] = [];
    const spying: AccessPolicy = {
      grantsAuthenticatedTier: (viewerId) => {
        consulted.push(viewerId);
        return false;
      },
    };
    expect(await canViewArtefactUnder(spying, artefact("public"), null)).toBe(
      true,
    );
    expect(await canViewArtefactUnder(spying, artefact("public"), OTHER)).toBe(
      true,
    );
    const selected = artefact("selected", "active", [MEMBER]);
    expect(await canViewArtefactUnder(spying, selected, MEMBER)).toBe(true);
    expect(await canViewArtefactUnder(spying, selected, OTHER)).toBe(false);
    expect(await canViewArtefactUnder(spying, artefact("private"), OWNER)).toBe(
      true,
    );
    expect(await canViewArtefactUnder(spying, artefact("private"), OTHER)).toBe(
      false,
    );
    expect(consulted).toEqual([]);
  });

  it("archived is never viewable under any policy (AH7)", async () => {
    const a = artefact("authenticated", "archived", [], ORG_A);
    expect(await canViewArtefactUnder(allowAll, a, MEMBER)).toBe(false);
    expect(await canViewArtefactUnder(allowAll, a, OWNER)).toBe(false);
  });

  it("supports an async policy (EE membership lookups hit a store)", async () => {
    const asyncPolicy: AccessPolicy = {
      grantsAuthenticatedTier: async (viewerId) => viewerId === MEMBER,
    };
    const a = artefact("authenticated");
    expect(await canViewArtefactUnder(asyncPolicy, a, MEMBER)).toBe(true);
    expect(await canViewArtefactUnder(asyncPolicy, a, OTHER)).toBe(false);
  });
});
