import { describe, expect, it } from "vitest";
import { createArtefact, type Artefact } from "./artefact";
import { grantAccess, revokeAccess } from "./access-list";
import { InvariantViolation } from "./errors";

const OWNER = "owner-1";

function make(over: Partial<Artefact> = {}): Artefact {
  return {
    ...createArtefact({
      id: "a1",
      ownerId: OWNER,
      title: "Demo",
      kind: "prototype",
      payload: { ref: "r", bytes: 10, hash: "h" },
    }),
    ...over,
  };
}

// r[verify hosting.access-list.owner-managed-set]
describe("grantAccess (S16)", () => {
  it("adds a user to the access list and bumps updatedAt", () => {
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-02T00:00:00Z");
    const a = make({ updatedAt: t0 });
    const next = grantAccess(a, "user-2", t1);
    expect(next.sharedWith).toEqual(["user-2"]);
    expect(next.updatedAt).toEqual(t1);
  });

  it("is idempotent — granting an existing member is a no-op", () => {
    const a = make({ sharedWith: ["user-2"] });
    const next = grantAccess(a, "user-2");
    expect(next).toBe(a); // unchanged reference, no updatedAt bump
    expect(next.sharedWith).toEqual(["user-2"]);
  });

  // r[verify hosting.access-list.owner-never-member]
  it("rejects granting the owner (they always have access)", () => {
    expect(() => grantAccess(make(), OWNER)).toThrow(InvariantViolation);
  });

  // r[verify hosting.lifecycle.archived-frozen]
  it("cannot change access while archived", () => {
    const a = make({ status: "archived" });
    expect(() => grantAccess(a, "user-2")).toThrow(InvariantViolation);
  });

  // r[verify hosting.access-list.retained]
  it("retains the list independent of the visibility tier", () => {
    // Granting works at any tier — the list is only *consulted* under `selected`.
    const a = make({ visibility: "private" });
    expect(grantAccess(a, "user-2").sharedWith).toEqual(["user-2"]);
  });
});

// r[verify hosting.access-list.owner-managed-set]
describe("revokeAccess (S16)", () => {
  it("removes a user from the access list and bumps updatedAt", () => {
    const t1 = new Date("2026-01-02T00:00:00Z");
    const a = make({ sharedWith: ["user-2", "user-3"] });
    const next = revokeAccess(a, "user-2", t1);
    expect(next.sharedWith).toEqual(["user-3"]);
    expect(next.updatedAt).toEqual(t1);
  });

  it("is a no-op when revoking a non-member", () => {
    const a = make({ sharedWith: ["user-2"] });
    const next = revokeAccess(a, "ghost");
    expect(next).toBe(a);
    expect(next.sharedWith).toEqual(["user-2"]);
  });

  // r[verify hosting.lifecycle.archived-frozen]
  it("cannot change access while archived", () => {
    const a = make({ status: "archived", sharedWith: ["user-2"] });
    expect(() => revokeAccess(a, "user-2")).toThrow(InvariantViolation);
  });
});
