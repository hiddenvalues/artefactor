import { beforeEach, describe, expect, it } from "vitest";
import { createArtefact, type Artefact } from "../../domain/artefact/artefact";
import { ArtefactConflict, ArtefactNotFound } from "../../domain/artefact/errors";
import { InMemoryArtefactRepository } from "../../domain/artefact/in-memory-artefact-repository";
import type { PayloadStore, StoredPayload } from "../../domain/artefact/ports";
import { SINGLETON_SCOPE as SCOPE } from "../../domain/artefact/tenant-scope";
import { editArtefactCommand } from "./edit-artefact.command";
import { archiveArtefactCommand } from "./lifecycle.command";
import { revokeAccessCommand } from "./manage-access.command";
import { setDataVisibilityCommand } from "./set-data-visibility.command";
import { setArtefactVisibilityCommand } from "./set-visibility.command";

// S60 — Save concurrency: a save never overwrites a newer artefact. Each test lands a competing
// command between an edit's load and its save; the edit re-applies its own change to the fresh
// aggregate (hosting.save.reapply-on-conflict) instead of writing its stale copy back.

const OWNER = "owner-1";
const MEMBER = "member-1";
const bytes = (s: string) => new TextEncoder().encode(s);

// Runs `competing` right before the next `times` saves reach the store, so each of those saves
// was loaded before the competing write landed.
class RacingRepo extends InMemoryArtefactRepository {
  private competing: (() => Promise<unknown>) | null = null;
  private times = 0;
  race(competing: () => Promise<unknown>, times = 1) {
    this.competing = competing;
    this.times = times;
  }
  override async save(a: Artefact): Promise<Artefact> {
    const competing = this.competing;
    if (competing && this.times > 0) {
      this.times -= 1;
      this.competing = null; // the competing command saves without racing itself
      await competing();
      if (this.times > 0) this.competing = competing;
    }
    return super.save(a);
  }
}

class FakePayloadStore implements PayloadStore {
  readonly live = new Map<string, Uint8Array>();
  puts = 0;
  // Runs inside `put`, standing in for a slow upload.
  onPut: (() => Promise<unknown>) | null = null;
  private seq = 0;
  async put(content: Uint8Array): Promise<StoredPayload> {
    this.puts += 1;
    const hook = this.onPut;
    this.onPut = null;
    if (hook) await hook();
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

describe("commands re-apply their intent on a save conflict (S60)", () => {
  let repo: RacingRepo;
  let store: FakePayloadStore;
  let originalRef: string;

  const stored = async () => (await repo.findById("a1", SCOPE))!;
  const ids = { artefactId: "a1", requesterId: OWNER, scope: SCOPE };
  const edit = (change: { title?: string; html?: string }) =>
    editArtefactCommand(
      { ...ids, title: change.title, payload: change.html ? bytes(change.html) : undefined },
      { repo, payloadStore: store },
    );

  async function seed(over: Partial<Artefact> = {}) {
    const initial = await store.put(bytes("<h1>old</h1>"));
    originalRef = initial.ref;
    store.puts = 0;
    await repo.save({
      ...createArtefact({
        id: "a1",
        ownerId: OWNER,
        title: "Old",
        kind: "prototype",
        payload: initial,
      }),
      ...over,
    });
  }

  beforeEach(() => {
    repo = new RacingRepo();
    store = new FakePayloadStore();
  });

  // r[verify hosting.save.reapply-on-conflict]
  it("an edit with a slow upload keeps a data-visibility flip that landed meanwhile", async () => {
    await seed({ dataVisibility: "shared" });
    store.onPut = () => setDataVisibilityCommand({ ...ids, dataVisibility: "own" }, { repo });
    const result = await edit({ html: "<h1>new</h1>" });
    const after = await stored();
    expect(after.dataVisibility).toBe("own");
    expect(after.payloadRef).toBe(result.payloadRef);
    expect(new TextDecoder().decode(store.live.get(after.payloadRef))).toBe("<h1>new</h1>");
  });

  // r[verify hosting.save.reapply-on-conflict]
  it("an edit racing an unshare leaves it private, with the payload stored once", async () => {
    await seed({ visibility: "public", publicSlug: "slug-a1" });
    repo.race(() => setArtefactVisibilityCommand({ ...ids, visibility: "private" }, { repo }));
    await edit({ title: "New", html: "<h1>new</h1>" });
    const after = await stored();
    expect(after).toMatchObject({ visibility: "private", title: "New", publicSlug: "slug-a1" });
    expect(store.puts).toBe(1);
  });

  // r[verify hosting.save.reapply-on-conflict]
  it("an edit racing a revoke leaves the member revoked", async () => {
    await seed({ visibility: "selected", publicSlug: "slug-a1", sharedWith: [MEMBER] });
    repo.race(() => revokeAccessCommand({ ...ids, userId: MEMBER }, { repo }));
    await edit({ title: "New" });
    const after = await stored();
    expect(after.sharedWith).not.toContain(MEMBER);
    expect(after.title).toBe("New");
  });

  // r[verify hosting.save.reapply-on-conflict]
  it("an edit racing an archive is not found, deletes its new payload and leaves the archive", async () => {
    await seed();
    repo.race(() => archiveArtefactCommand(ids, { repo }));
    await expect(edit({ html: "<h1>new</h1>" })).rejects.toBeInstanceOf(ArtefactNotFound);
    const after = await stored();
    expect(after.status).toBe("archived");
    expect(after.payloadRef).toBe(originalRef);
    expect([...store.live.keys()]).toEqual([originalRef]);
  });

  // r[verify hosting.save.reapply-on-conflict]
  it("an edit whose 3 attempts all conflict surfaces the conflict and deletes its new payload", async () => {
    await seed();
    let bumps = 0;
    repo.race(async () => {
      const current = await stored();
      await repo.save({ ...current, title: `bump-${++bumps}` });
    }, 3);
    await expect(edit({ html: "<h1>new</h1>" })).rejects.toBeInstanceOf(ArtefactConflict);
    expect(bumps).toBe(3);
    expect((await stored()).payloadRef).toBe(originalRef);
    expect([...store.live.keys()]).toEqual([originalRef]);
  });

  // r[verify hosting.save.reapply-on-conflict]
  it("an edit saved on its second attempt deletes the payload it finally replaced", async () => {
    await seed();
    let competingRef = "";
    repo.race(async () => {
      const competing = await edit({ html: "<h1>competing</h1>" });
      competingRef = competing.payloadRef;
    });
    const mine = await edit({ html: "<h1>mine</h1>" });
    expect(competingRef).not.toBe("");
    expect((await stored()).payloadRef).toBe(mine.payloadRef);
    expect(store.live.has(competingRef)).toBe(false);
    expect(store.live.has(originalRef)).toBe(false);
    expect(store.live.has(mine.payloadRef)).toBe(true);
  });
});
