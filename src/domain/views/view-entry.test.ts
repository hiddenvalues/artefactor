import { describe, expect, it } from "vitest";
import { recordView } from "./view-entry";

describe("recordView", () => {
  // r[verify views.entry.one-per-pair]
  it("creates an entry on the first view", () => {
    const at = new Date("2026-01-01T10:00:00Z");
    const entry = recordView({
      id: "v1",
      artefactId: "a1",
      viewerId: "u1",
      now: at,
    });
    expect(entry).toEqual({
      id: "v1",
      artefactId: "a1",
      viewerId: "u1",
      viewedAt: at,
    });
  });

  // r[verify views.entry.one-per-pair]
  it("upserts a later view — preserves id, bumps viewedAt (latest only)", () => {
    const first = recordView({
      id: "v1",
      artefactId: "a1",
      viewerId: "u1",
      now: new Date("2026-01-01T10:00:00Z"),
    });
    const later = new Date("2026-01-02T12:00:00Z");
    const second = recordView({
      // A fresh id is offered but must be ignored — the pair already has identity.
      id: "v2",
      artefactId: "a1",
      viewerId: "u1",
      existing: first,
      now: later,
    });
    expect(second.id).toBe("v1");
    expect(second.viewedAt).toEqual(later);
    expect(second.artefactId).toBe("a1");
    expect(second.viewerId).toBe("u1");
  });
});
