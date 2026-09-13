import { describe, expect, it } from "vitest";
import {
  assertBlobWithinBounds,
  upsertDataEntry,
  MAX_BLOB_BYTES,
} from "./data-entry";
import { BlobTooLarge, InvalidBlob } from "./errors";
import { InMemoryDataRepository } from "./in-memory-data-repository";

describe("assertBlobWithinBounds (AD8)", () => {
  it("accepts valid JSON within the cap", () => {
    expect(() => assertBlobWithinBounds('{"cards":[1,2,3]}')).not.toThrow();
  });

  it("rejects invalid JSON", () => {
    expect(() => assertBlobWithinBounds("{not json")).toThrow(InvalidBlob);
    expect(() => assertBlobWithinBounds("")).toThrow(InvalidBlob);
  });

  it("rejects a blob over the 5 MB cap", () => {
    const huge = JSON.stringify("x".repeat(MAX_BLOB_BYTES + 1));
    expect(() => assertBlobWithinBounds(huge)).toThrow(BlobTooLarge);
  });
});

describe("upsertDataEntry (AD1)", () => {
  it("creates a new entry with matching timestamps", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const e = upsertDataEntry({
      id: "d1",
      artefactId: "a1",
      authorId: "u1",
      blob: "{}",
      authoredAgainstVersion: null,
      now,
    });
    expect(e).toMatchObject({ id: "d1", artefactId: "a1", authorId: "u1", blob: "{}" });
    expect(e.createdAt).toEqual(now);
    expect(e.updatedAt).toEqual(now);
  });

  it("updates an existing entry, preserving id/createdAt and bumping updatedAt", () => {
    const created = upsertDataEntry({
      id: "d1",
      artefactId: "a1",
      authorId: "u1",
      blob: "{}",
      authoredAgainstVersion: null,
      now: new Date("2026-01-01T00:00:00Z"),
    });
    const later = new Date("2026-02-01T00:00:00Z");
    const updated = upsertDataEntry({
      id: "ignored-on-update",
      artefactId: "a1",
      authorId: "u1",
      blob: '{"v":2}',
      authoredAgainstVersion: null,
      existing: created,
      now: later,
    });
    expect(updated.id).toBe("d1");
    expect(updated.createdAt).toEqual(created.createdAt);
    expect(updated.updatedAt).toEqual(later);
    expect(updated.blob).toBe('{"v":2}');
  });

  it("validates the blob before upserting (AD8)", () => {
    expect(() =>
      upsertDataEntry({ id: "d", artefactId: "a", authorId: "u", blob: "nope", authoredAgainstVersion: null }),
    ).toThrow(InvalidBlob);
  });
});

describe("upsertDataEntry — payload version pin (AD9)", () => {
  const base = { id: "d1", artefactId: "a1", authorId: "u1", blob: "{}" };

  it("stamps a new entry with the payload hash it was written against", () => {
    const e = upsertDataEntry({ ...base, authoredAgainstVersion: "hash-1" });
    expect(e.authoredAgainstVersion).toBe("hash-1");
  });

  it("re-stamps on update, replacing the older pin", () => {
    const created = upsertDataEntry({ ...base, authoredAgainstVersion: "hash-1" });
    const updated = upsertDataEntry({
      ...base,
      blob: '{"v":2}',
      authoredAgainstVersion: "hash-2",
      existing: created,
    });
    expect(updated.authoredAgainstVersion).toBe("hash-2");
  });

  it("stamps an entry that predates the pin (null) on its next write", () => {
    const legacy = upsertDataEntry({ ...base, authoredAgainstVersion: null });
    expect(legacy.authoredAgainstVersion).toBeNull();
    const updated = upsertDataEntry({
      ...base,
      authoredAgainstVersion: "hash-1",
      existing: legacy,
    });
    expect(updated.authoredAgainstVersion).toBe("hash-1");
  });
});

describe("InMemoryDataRepository (AD1)", () => {
  it("keeps one entry per (artefact, author) and upserts", async () => {
    const repo = new InMemoryDataRepository();
    await repo.save(
      upsertDataEntry({ id: "d1", artefactId: "a1", authorId: "u1", blob: "{}", authoredAgainstVersion: null }),
    );
    await repo.save(
      upsertDataEntry({ id: "d2", artefactId: "a1", authorId: "u1", blob: '{"v":2}', authoredAgainstVersion: null }),
    );
    const found = await repo.findByArtefactAndAuthor("a1", "u1");
    expect(found?.blob).toBe('{"v":2}');

    // Different author → separate entry.
    await repo.save(
      upsertDataEntry({ id: "d3", artefactId: "a1", authorId: "u2", blob: "[]", authoredAgainstVersion: null }),
    );
    expect((await repo.findByArtefactAndAuthor("a1", "u2"))?.blob).toBe("[]");

    await repo.deleteByArtefactAndAuthor("a1", "u1");
    expect(await repo.findByArtefactAndAuthor("a1", "u1")).toBeNull();
    expect(await repo.findByArtefactAndAuthor("a1", "u2")).not.toBeNull();
  });
});
