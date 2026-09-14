import { describe, expect, it } from "vitest";
import type { ThumbnailJob } from "../../domain/artefact/artefact-repository";
import type { ThumbnailQueue } from "../thumbnails/thumbnail-service";
import { createArtefactCommand } from "./create-artefact.command";
import { InMemoryArtefactRepository } from "../../domain/artefact/in-memory-artefact-repository";
import { SINGLETON_SCOPE } from "../../domain/artefact/tenant-scope";
import { InvariantViolation } from "../../domain/artefact/errors";
import type { PayloadStore, StoredPayload } from "../../domain/artefact/ports";

// Recording in-memory payload store: tracks what is currently stored so tests
// can assert no orphan file is left behind when the aggregate is rejected.
class FakePayloadStore implements PayloadStore {
  readonly live = new Map<string, Uint8Array>();
  private seq = 0;

  async put(content: Uint8Array): Promise<StoredPayload> {
    const ref = `ref-${++this.seq}`;
    this.live.set(ref, content);
    return { ref, bytes: content.byteLength, hash: `hash-${ref}` };
  }
  async get(ref: string): Promise<Uint8Array> {
    const found = this.live.get(ref);
    if (!found) throw new Error("not found");
    return found;
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

function deps() {
  return { repo: new InMemoryArtefactRepository(), payloadStore: new FakePayloadStore() };
}

const html = new TextEncoder().encode("<!doctype html><h1>hi</h1>");

describe("createArtefactCommand (S2)", () => {
  it("creates an active, private artefact owned by the caller", async () => {
    const d = deps();
    const a = await createArtefactCommand(
      { ownerId: "user_1", title: "My deck", kind: "slide-deck", payload: html },
      d,
    );

    expect(a.ownerId).toBe("user_1"); // AH1
    expect(a.status).toBe("active");
    expect(a.visibility).toBe("private");
    expect(a.publicSlug).toBeNull();
    expect(a.payloadBytes).toBe(html.byteLength);

    // Persisted and payload retained.
    expect(await d.repo.findById(a.id, SINGLETON_SCOPE)).toMatchObject({ id: a.id });
    expect(d.payloadStore.live.size).toBe(1);
  });

  it("computes usesStorage from the payload (AH16)", async () => {
    const d = deps();
    const stat = await createArtefactCommand(
      { ownerId: "user_1", title: "Static", kind: "slide-deck", payload: html },
      d,
    );
    expect(stat.usesStorage).toBe(false);

    const persists = await createArtefactCommand(
      {
        ownerId: "user_1",
        title: "Form",
        kind: "form",
        payload: new TextEncoder().encode("<script>localStorage.setItem('k','v')</script>"),
      },
      d,
    );
    expect(persists.usesStorage).toBe(true);
  });

  it("rejects an empty title and leaves no orphan payload (AH3)", async () => {
    const d = deps();
    await expect(
      createArtefactCommand(
        { ownerId: "user_1", title: "   ", kind: "form", payload: html },
        d,
      ),
    ).rejects.toBeInstanceOf(InvariantViolation);
    expect(d.payloadStore.live.size).toBe(0);
  });

  it("rejects an empty payload before writing anything (AH2)", async () => {
    const d = deps();
    await expect(
      createArtefactCommand(
        { ownerId: "user_1", title: "Empty", kind: "other", payload: new Uint8Array() },
        d,
      ),
    ).rejects.toBeInstanceOf(InvariantViolation);
    expect(d.payloadStore.live.size).toBe(0);
  });

  it("rejects an unknown kind", async () => {
    const d = deps();
    await expect(
      createArtefactCommand(
        { ownerId: "user_1", title: "X", kind: "spreadsheet", payload: html },
        d,
      ),
    ).rejects.toBeInstanceOf(InvariantViolation);
    expect(d.payloadStore.live.size).toBe(0);
  });

  describe("thumbnail enqueue (S35, AH25)", () => {
    it("enqueues exactly one job carrying the saved payload hash, after the save", async () => {
      const d = deps();
      const thumbnails = new RecordingQueue();
      let savedWhenEnqueued = false;
      thumbnails.enqueue = (job) => {
        void d.repo.findById(job.id, SINGLETON_SCOPE).then((a) => (savedWhenEnqueued = a !== null));
        thumbnails.jobs.push(job);
      };
      const a = await createArtefactCommand(
        { ownerId: "user_1", title: "Deck", kind: "slide-deck", payload: html },
        { ...d, thumbnails },
      );
      await Promise.resolve();
      expect(thumbnails.jobs).toEqual([
        { id: a.id, payloadRef: a.payloadRef, payloadHash: a.payloadHash, thumbnailHash: null },
      ]);
      expect(savedWhenEnqueued).toBe(true);
      expect(a.thumbnailHash).toBeNull();
    });

    it("a throwing queue does not fail the create", async () => {
      const d = deps();
      const thumbnails: ThumbnailQueue = {
        enqueue() {
          throw new Error("queue exploded");
        },
      };
      const a = await createArtefactCommand(
        { ownerId: "user_1", title: "Deck", kind: "slide-deck", payload: html },
        { ...d, thumbnails },
      );
      expect(await d.repo.findById(a.id, SINGLETON_SCOPE)).not.toBeNull();
      expect(d.payloadStore.live.size).toBe(1);
    });

    it("a rejected create enqueues nothing", async () => {
      const d = deps();
      const thumbnails = new RecordingQueue();
      await expect(
        createArtefactCommand(
          { ownerId: "user_1", title: "  ", kind: "slide-deck", payload: html },
          { ...d, thumbnails },
        ),
      ).rejects.toBeInstanceOf(InvariantViolation);
      expect(thumbnails.jobs).toEqual([]);
    });
  });
});
