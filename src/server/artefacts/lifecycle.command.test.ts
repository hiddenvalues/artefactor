import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryThumbnailStore } from "../../domain/artefact/in-memory-thumbnail-store";
import {
  archiveArtefactCommand,
  deleteArtefactCommand,
  restoreArtefactCommand,
} from "./lifecycle.command";
import { createArtefact, shareArtefact } from "../../domain/artefact/artefact";
import { InMemoryArtefactRepository } from "../../domain/artefact/in-memory-artefact-repository";
import { InMemoryDataRepository } from "../../domain/data/in-memory-data-repository";
import { InMemoryViewRepository } from "../../domain/views/in-memory-view-repository";
import { InMemoryBookmarkRepository } from "../../domain/bookmark/in-memory-bookmark-repository";
import type { PayloadStore, StoredPayload } from "../../domain/artefact/ports";
import { SINGLETON_SCOPE as SCOPE } from "../../domain/artefact/tenant-scope";
import { ArtefactNotFound, InvariantViolation } from "../../domain/artefact/errors";

const OWNER = "owner-1";

function base(id = "a1") {
  return createArtefact({
    id,
    ownerId: OWNER,
    title: "Demo",
    kind: "prototype",
    payload: { ref: "r", bytes: 10, hash: "h" },
  });
}

describe("archive / restore commands (S7)", () => {
  let repo: InMemoryArtefactRepository;
  beforeEach(() => {
    repo = new InMemoryArtefactRepository();
  });

  it("archives an owned active artefact", async () => {
    await repo.save(shareArtefact(base(), { tier: "public", newSlug: "s" }));
    const archived = await archiveArtefactCommand(
      { artefactId: "a1", requesterId: OWNER, scope: SCOPE },
      { repo },
    );
    expect(archived.status).toBe("archived");
    expect(archived.archivedAt).not.toBeNull();
    expect((await repo.findById("a1", SCOPE))?.status).toBe("archived");
  });

  it("round-trips archive → restore back to the prior visibility (AH9)", async () => {
    await repo.save(shareArtefact(base(), { tier: "authenticated", newSlug: "s" }));
    await archiveArtefactCommand({ artefactId: "a1", requesterId: OWNER, scope: SCOPE }, { repo });
    const restored = await restoreArtefactCommand(
      { artefactId: "a1", requesterId: OWNER, scope: SCOPE },
      { repo },
    );
    expect(restored.status).toBe("active");
    expect(restored.archivedAt).toBeNull();
    expect(restored.visibility).toBe("authenticated");
  });

  it("treats a non-owner archive as not-found (AH8)", async () => {
    await repo.save(base());
    await expect(
      archiveArtefactCommand({ artefactId: "a1", requesterId: "intruder", scope: SCOPE }, { repo }),
    ).rejects.toBeInstanceOf(ArtefactNotFound);
  });

  it("archiving an already-archived artefact is not-found (not active)", async () => {
    await repo.save({ ...base(), status: "archived", archivedAt: new Date() });
    await expect(
      archiveArtefactCommand({ artefactId: "a1", requesterId: OWNER, scope: SCOPE }, { repo }),
    ).rejects.toBeInstanceOf(ArtefactNotFound);
  });

  it("rejects restoring an artefact that is not archived", async () => {
    await repo.save(base());
    await expect(
      restoreArtefactCommand({ artefactId: "a1", requesterId: OWNER, scope: SCOPE }, { repo }),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });
});

// A PayloadStore double that records which refs were deleted.
class FakePayloadStore implements PayloadStore {
  deleted: string[] = [];
  async put(): Promise<StoredPayload> {
    return { ref: "r", bytes: 0, hash: "h" };
  }
  async get(): Promise<Uint8Array> {
    return new Uint8Array();
  }
  async delete(ref: string): Promise<void> {
    this.deleted.push(ref);
  }
}

describe("delete command (S15, AH11)", () => {
  let repo: InMemoryArtefactRepository;
  let dataRepo: InMemoryDataRepository;
  let viewRepo: InMemoryViewRepository;
  let payloadStore: FakePayloadStore;
  beforeEach(() => {
    repo = new InMemoryArtefactRepository();
    dataRepo = new InMemoryDataRepository();
    viewRepo = new InMemoryViewRepository();
    payloadStore = new FakePayloadStore();
  });

  async function seedArchivedWithData() {
    await repo.save({ ...base(), status: "archived", archivedAt: new Date() });
    const now = new Date();
    await dataRepo.save({
      id: "d1", artefactId: "a1", authorId: OWNER, blob: "[1]", authoredAgainstVersion: null,
      createdAt: now, updatedAt: now,
    });
    await dataRepo.save({
      id: "d2", artefactId: "a1", authorId: "viewer-2", blob: "[2]", authoredAgainstVersion: null,
      createdAt: now, updatedAt: now,
    });
    // A view entry too — permanent delete must remove these as well (VT5).
    await viewRepo.save({
      id: "v1", artefactId: "a1", viewerId: "viewer-2", viewedAt: now,
    });
  }

  it("deletes an archived artefact, its payload, and all its data + view entries", async () => {
    await seedArchivedWithData();
    await deleteArtefactCommand(
      { artefactId: "a1", requesterId: OWNER, scope: SCOPE },
      { repo, dataRepo, viewRepo, bookmarkRepo: new InMemoryBookmarkRepository(), payloadStore, thumbnailStore: new InMemoryThumbnailStore() },
    );
    expect(await repo.findById("a1", SCOPE)).toBeNull();
    expect(payloadStore.deleted).toEqual(["r"]);
    expect(await dataRepo.findByArtefactAndAuthor("a1", OWNER)).toBeNull();
    expect(await dataRepo.findByArtefactAndAuthor("a1", "viewer-2")).toBeNull();
    expect(await viewRepo.listViewersByArtefact("a1")).toEqual([]);
  });

  it("refuses to delete an active artefact (AH11)", async () => {
    await repo.save(base());
    await expect(
      deleteArtefactCommand(
        { artefactId: "a1", requesterId: OWNER, scope: SCOPE },
        { repo, dataRepo, viewRepo, bookmarkRepo: new InMemoryBookmarkRepository(), payloadStore, thumbnailStore: new InMemoryThumbnailStore() },
      ),
    ).rejects.toBeInstanceOf(InvariantViolation);
    expect(await repo.findById("a1", SCOPE)).not.toBeNull();
    expect(payloadStore.deleted).toEqual([]);
  });

  it("treats a non-owner delete as not-found (AH8)", async () => {
    await repo.save({ ...base(), status: "archived", archivedAt: new Date() });
    await expect(
      deleteArtefactCommand(
        { artefactId: "a1", requesterId: "intruder", scope: SCOPE },
        { repo, dataRepo, viewRepo, bookmarkRepo: new InMemoryBookmarkRepository(), payloadStore, thumbnailStore: new InMemoryThumbnailStore() },
      ),
    ).rejects.toBeInstanceOf(ArtefactNotFound);
    expect(await repo.findById("a1", SCOPE)).not.toBeNull();
  });

  it("removes every thumbnail file of the deleted artefact and no other (AH11, S35)", async () => {
    await seedArchivedWithData();
    const thumbnailStore = new InMemoryThumbnailStore();
    await thumbnailStore.put("a1", "h", new Uint8Array([1]));
    await thumbnailStore.put("a1", "older", new Uint8Array([2]));
    await thumbnailStore.put("other", "h", new Uint8Array([3]));
    await deleteArtefactCommand(
      { artefactId: "a1", requesterId: OWNER, scope: SCOPE },
      { repo, dataRepo, viewRepo, bookmarkRepo: new InMemoryBookmarkRepository(), payloadStore, thumbnailStore },
    );
    expect(thumbnailStore.hashesOf("a1")).toEqual([]);
    expect(thumbnailStore.hashesOf("other")).toEqual(["h"]);
  });
});
