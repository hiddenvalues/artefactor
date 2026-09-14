import { beforeEach, describe, expect, it } from "vitest";
import type { ThumbnailJob } from "../../domain/artefact/artefact-repository";
import type { ThumbnailQueue } from "../thumbnails/thumbnail-service";
import { editArtefactCommand } from "./edit-artefact.command";
import { createArtefact } from "../../domain/artefact/artefact";
import { InMemoryArtefactRepository } from "../../domain/artefact/in-memory-artefact-repository";
import { SINGLETON_SCOPE as SCOPE } from "../../domain/artefact/tenant-scope";
import { ArtefactNotFound, InvariantViolation } from "../../domain/artefact/errors";
import type { PayloadStore, StoredPayload } from "../../domain/artefact/ports";

class FakePayloadStore implements PayloadStore {
  readonly live = new Map<string, Uint8Array>();
  private seq = 0;
  async put(content: Uint8Array): Promise<StoredPayload> {
    const ref = `ref-${++this.seq}`;
    this.live.set(ref, content);
    return { ref, bytes: content.byteLength, hash: ref };
  }
  async get(ref: string): Promise<Uint8Array> {
    const f = this.live.get(ref);
    if (!f) throw new Error("missing");
    return f;
  }
  async delete(ref: string): Promise<void> {
    this.live.delete(ref);
  }
}

// S35 — a queue that records what the command enqueued.
class RecordingQueue implements ThumbnailQueue {
  readonly jobs: ThumbnailJob[] = [];
  enqueue(job: ThumbnailJob): void {
    this.jobs.push(job);
  }
}

const OWNER = "owner-1";
const bytes = (s: string) => new TextEncoder().encode(s);

describe("editArtefactCommand (S3)", () => {
  let repo: InMemoryArtefactRepository;
  let store: FakePayloadStore;

  beforeEach(async () => {
    repo = new InMemoryArtefactRepository();
    store = new FakePayloadStore();
    const initial = await store.put(bytes("<h1>old</h1>"));
    await repo.save({
      ...createArtefact({
        id: "a1",
        ownerId: OWNER,
        title: "Old",
        kind: "prototype",
        payload: { ref: "ignored", bytes: 1, hash: "ignored" },
      }),
      payloadRef: initial.ref,
      payloadBytes: initial.bytes,
      payloadHash: initial.hash,
    });
  });

  function deps() {
    return { repo, payloadStore: store };
  }

  it("updates title and kind without touching the payload", async () => {
    const edited = await editArtefactCommand(
      { artefactId: "a1", requesterId: OWNER, scope: SCOPE,title: "New", kind: "form" },
      deps(),
    );
    expect(edited.title).toBe("New");
    expect(edited.kind).toBe("form");
    expect(store.live.size).toBe(1); // payload untouched
  });

  it("replaces the payload and deletes the superseded file", async () => {
    const edited = await editArtefactCommand(
      { artefactId: "a1", requesterId: OWNER, scope: SCOPE,payload: bytes("<h1>new</h1>") },
      deps(),
    );
    expect(store.live.has(edited.payloadRef)).toBe(true);
    expect(store.live.size).toBe(1); // old one was deleted
    expect(new TextDecoder().decode(store.live.get(edited.payloadRef)!)).toBe(
      "<h1>new</h1>",
    );
  });

  it("recomputes usesStorage on a payload edit, but not on a title-only edit (AH16)", async () => {
    // Initial payload has no storage usage.
    const start = await repo.findById("a1", SCOPE);
    expect(start!.usesStorage).toBe(false);

    // Replacing with localStorage-using HTML flips it on.
    const withStorage = await editArtefactCommand(
      { artefactId: "a1", requesterId: OWNER, scope: SCOPE,payload: bytes("<script>localStorage.x=1</script>") },
      deps(),
    );
    expect(withStorage.usesStorage).toBe(true);

    // A title-only edit leaves the flag untouched.
    const titled = await editArtefactCommand(
      { artefactId: "a1", requesterId: OWNER, scope: SCOPE,title: "Renamed" },
      deps(),
    );
    expect(titled.usesStorage).toBe(true);
  });

  it("leaves no orphan and keeps the old payload when the edit is rejected", async () => {
    await expect(
      editArtefactCommand(
        { artefactId: "a1", requesterId: OWNER, scope: SCOPE,title: "  ", payload: bytes("x") },
        deps(),
      ),
    ).rejects.toBeInstanceOf(InvariantViolation);
    // The newly stored payload was cleaned up; the original remains.
    expect(store.live.size).toBe(1);
  });

  it("rejects a non-owner as not-found (AH8)", async () => {
    await expect(
      editArtefactCommand(
        { artefactId: "a1", requesterId: "intruder", scope: SCOPE, title: "x" },
        deps(),
      ),
    ).rejects.toBeInstanceOf(ArtefactNotFound);
  });

  it("rejects an unknown kind", async () => {
    await expect(
      editArtefactCommand(
        { artefactId: "a1", requesterId: OWNER, scope: SCOPE,kind: "spreadsheet" },
        deps(),
      ),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });

  describe("thumbnail enqueue (S35, AH25/AH26)", () => {
    it("replacing the HTML enqueues once with the new payload hash", async () => {
      const thumbnails = new RecordingQueue();
      const edited = await editArtefactCommand(
        { artefactId: "a1", requesterId: OWNER, scope: SCOPE, payload: bytes("<h1>new</h1>") },
        { repo, payloadStore: store, thumbnails },
      );
      expect(thumbnails.jobs).toEqual([
        {
          id: "a1",
          payloadRef: edited.payloadRef,
          payloadHash: edited.payloadHash,
          thumbnailHash: null,
        },
      ]);
    });

    it("enqueues before the previous payload is deleted, so a newer edit's job can't be overtaken", async () => {
      const thumbnails = new RecordingQueue();
      let queuedWhenDeleted = -1;
      const del = store.delete.bind(store);
      store.delete = async (ref) => {
        queuedWhenDeleted = thumbnails.jobs.length;
        await del(ref);
      };
      await editArtefactCommand(
        { artefactId: "a1", requesterId: OWNER, scope: SCOPE, payload: bytes("<h1>new</h1>") },
        { repo, payloadStore: store, thumbnails },
      );
      expect(queuedWhenDeleted).toBe(1);
    });

    it("a title/kind-only edit enqueues nothing", async () => {
      const thumbnails = new RecordingQueue();
      await editArtefactCommand(
        { artefactId: "a1", requesterId: OWNER, scope: SCOPE, title: "Renamed", kind: "form" },
        { repo, payloadStore: store, thumbnails },
      );
      expect(thumbnails.jobs).toEqual([]);
    });

    it("a throwing queue does not fail the edit", async () => {
      const edited = await editArtefactCommand(
        { artefactId: "a1", requesterId: OWNER, scope: SCOPE, payload: bytes("<h1>new</h1>") },
        {
          repo,
          payloadStore: store,
          thumbnails: {
            enqueue() {
              throw new Error("queue exploded");
            },
          },
        },
      );
      expect((await repo.findById("a1", SCOPE))!.payloadHash).toBe(edited.payloadHash);
    });
  });
});
