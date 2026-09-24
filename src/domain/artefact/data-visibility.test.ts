import { describe, expect, it } from "vitest";
import {
  archiveArtefact,
  createArtefact,
  setDataVisibility,
} from "./artefact";
import { canLoadAuthorData } from "./access";
import { ArtefactNotFound, InvariantViolation } from "./errors";
import type { DataVisibility } from "./visibility";

// S41 — Owner-set data visibility: shared or own-only (AH30, AD11).

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

describe("createArtefact — dataVisibility (AH30)", () => {
  it("defaults a new artefact to own-only", () => {
    expect(createArtefact(base).dataVisibility).toBe("own");
  });
});

describe("setDataVisibility (AH30)", () => {
  it("lets the owner flip it, bumping updatedAt", () => {
    const a = createArtefact(base);
    const shared = setDataVisibility(a, OWNER, "shared", { now: LATER });
    expect(shared.dataVisibility).toBe("shared");
    expect(shared.updatedAt).toEqual(LATER);
  });

  it("is a no-op when the value is unchanged", () => {
    const a = createArtefact(base);
    const same = setDataVisibility(a, OWNER, "own", { now: LATER });
    expect(same).toBe(a);
    expect(same.updatedAt).toEqual(CREATED);
  });

  it("refuses a non-owner as not found (AH8/AH9)", () => {
    const a = createArtefact(base);
    expect(() => setDataVisibility(a, VIEWER, "shared")).toThrow(ArtefactNotFound);
  });

  it("is blocked while archived (AH7)", () => {
    const a = archiveArtefact(createArtefact(base));
    expect(() => setDataVisibility(a, OWNER, "shared")).toThrow(InvariantViolation);
  });
});

describe("canLoadAuthorData (AD11)", () => {
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

  it("never treats an anonymous viewer's author as their own", () => {
    expect(canLoadAuthorData(artefact("own"), null, OTHER)).toBe(false);
  });
});
