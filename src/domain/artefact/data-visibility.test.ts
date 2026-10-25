import { describe, expect, expectTypeOf, it } from "vitest";
import {
  archiveArtefact,
  createArtefact,
  setDataVisibility,
} from "./artefact";
import { canLoadAuthorData, canViewArtefact, type ViewableArtefact } from "./access";
import { ArtefactNotFound, InvariantViolation } from "./errors";
import type { DataVisibility, Visibility } from "./visibility";

// S41 — Owner-set data visibility: shared or own-only (hosting.data-visibility.owner-set, data.visibility.narrows-reads).

const OWNER = "owner-1";
const VIEWER = "viewer-2";
const OTHER = "author-3";
const CREATED = new Date("2026-01-01T00:00:00Z");
const LATER = new Date("2026-02-01T00:00:00Z");

const base = {
  id: "a1",
  ownerId: OWNER,
  title: "Survey",
  kind: "form" as const,
  payload: { ref: "r1", bytes: 10, hash: "h1" },
  now: CREATED,
};

describe("createArtefact — dataVisibility", () => {
  // r[verify hosting.data-visibility.new-default-own]
  it("defaults a new artefact to own-only", () => {
    expect(createArtefact(base).dataVisibility).toBe("own");
  });
});

describe("setDataVisibility", () => {
  // r[verify hosting.data-visibility.owner-set]
  it("lets the owner flip it, bumping updatedAt", () => {
    const a = createArtefact(base);
    const shared = setDataVisibility(a, OWNER, "shared", { now: LATER });
    expect(shared.dataVisibility).toBe("shared");
    expect(shared.updatedAt).toEqual(LATER);
  });

  // r[verify hosting.data-visibility.owner-set]
  it("is a no-op when the value is unchanged", () => {
    const a = createArtefact(base);
    const same = setDataVisibility(a, OWNER, "own", { now: LATER });
    expect(same).toBe(a);
    expect(same.updatedAt).toEqual(CREATED);
  });

  // r[verify hosting.access.no-existence-leak+3]
  // r[verify hosting.authority.owner-only]
  // r[verify hosting.data-visibility.owner-set]
  it("refuses a non-owner as not found", () => {
    const a = createArtefact(base);
    expect(() => setDataVisibility(a, VIEWER, "shared")).toThrow(ArtefactNotFound);
  });

  // r[verify hosting.lifecycle.archived-frozen]
  // r[verify hosting.data-visibility.owner-set]
  it("is blocked while archived", () => {
    const a = archiveArtefact(createArtefact(base));
    expect(() => setDataVisibility(a, OWNER, "shared")).toThrow(InvariantViolation);
  });

  // r[verify hosting.data-visibility.owner-set]
  it("is set on the artefact itself while it sits in a collection", () => {
    const contained = { ...createArtefact(base), collectionId: "c1" };
    const shared = setDataVisibility(contained, OWNER, "shared", { now: LATER });
    expect(shared.dataVisibility).toBe("shared");
    expect(shared.collectionId).toBe("c1");
  });
});

describe("dataVisibility and viewing", () => {
  // r[verify hosting.data-visibility.never-gates-viewing]
  it("is not among the fields the access matrix reads", () => {
    expectTypeOf<ViewableArtefact>().not.toHaveProperty("dataVisibility");
  });

  // r[verify hosting.data-visibility.never-gates-viewing]
  it("leaves every view decision the same under own and shared", () => {
    const tiers: Visibility[] = ["private", "authenticated", "selected", "public"];
    for (const visibility of tiers)
      for (const viewer of [OWNER, VIEWER, null]) {
        const a = { ...createArtefact(base), visibility, sharedWith: [VIEWER] };
        const own = { ...a, dataVisibility: "own" as const };
        const shared = { ...a, dataVisibility: "shared" as const };
        expect(canViewArtefact(own, viewer), `${visibility} ${viewer}`).toBe(canViewArtefact(shared, viewer));
      }
  });
});

describe("canLoadAuthorData", () => {
  function artefact(dataVisibility: DataVisibility) {
    return { ownerId: OWNER, dataVisibility };
  }

  // {shared, own} × {owner, other viewer, anonymous} × {own author, foreign author}.
  // "Own author" is the viewer themself; the anonymous have none, so theirs is
  // an arbitrary id that can never match.
  const viewers: [string, string | null][] = [
    ["owner", OWNER],
    ["other viewer", VIEWER],
    ["anonymous", null],
  ];
  const cases = (["shared", "own"] as const).flatMap((vis) =>
    viewers.flatMap(([who, viewerId]) =>
      (["own author", "foreign author"] as const).map((which) => {
        const authorId = which === "own author" ? (viewerId ?? OTHER) : OTHER;
        const expected =
          vis === "shared" ||
          viewerId === OWNER ||
          (viewerId !== null && which === "own author");
        return [vis, who, which, viewerId, authorId, expected] as const;
      }),
    ),
  );

  it.each(cases)(
    "%s · %s · %s",
    (vis, _who, _which, viewerId, authorId, expected) => {
      expect(canLoadAuthorData(artefact(vis), viewerId, authorId)).toBe(expected);
    },
  );

  // r[verify data.visibility.narrows-reads]
  it("is false only for (own, non-owner or anonymous, foreign author)", () => {
    const denied = cases.filter(([, , , , , ok]) => !ok);
    expect(denied.map(([vis, who, which]) => `${vis}/${who}/${which}`).sort()).toEqual(
      [
        "own/anonymous/foreign author",
        "own/anonymous/own author",
        "own/other viewer/foreign author",
      ].sort(),
    );
  });

  // r[verify data.visibility.narrows-reads]
  it("never treats an anonymous viewer's author as their own", () => {
    expect(canLoadAuthorData(artefact("own"), null, OTHER)).toBe(false);
  });
});
