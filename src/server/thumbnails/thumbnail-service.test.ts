import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  archiveArtefact,
  createArtefact,
  editArtefact,
  MAX_RENDER_INPUT_BYTES,
  type Artefact,
} from "../../domain/artefact/artefact";
import { InMemoryArtefactRepository } from "../../domain/artefact/in-memory-artefact-repository";
import { InMemoryThumbnailStore } from "../../domain/artefact/in-memory-thumbnail-store";
import { ThumbnailRendererUnavailable } from "../../domain/artefact/errors";
import type {
  PayloadStore,
  StoredPayload,
  ThumbnailRenderer,
} from "../../domain/artefact/ports";
import { SINGLETON_SCOPE } from "../../domain/artefact/tenant-scope";
import { ThumbnailService, thumbnailJobOf } from "./thumbnail-service";

// S35 (AH25/AH26) — the in-process render queue + worker.

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

class FakePayloadStore implements PayloadStore {
  readonly live = new Map<string, Uint8Array>();
  async put(): Promise<StoredPayload> {
    throw new Error("not used");
  }
  async get(ref: string): Promise<Uint8Array> {
    const found = this.live.get(ref);
    if (!found) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return found;
  }
  async delete(ref: string): Promise<void> {
    this.live.delete(ref);
  }
}

// Renders `webp(<html>)`; a render can be held open with `hold()` to model a
// render that is still running while the artefact changes underneath it.
class FakeRenderer implements ThumbnailRenderer {
  readonly calls: string[] = [];
  failWith: Error | null = null;
  private gate: Promise<void> | null = null;
  private release: (() => void) | null = null;

  hold() {
    this.gate = new Promise((r) => (this.release = r));
  }
  let() {
    this.release?.();
    this.gate = null;
  }
  async render(html: Uint8Array): Promise<Uint8Array> {
    this.calls.push(dec(html));
    if (this.gate) await this.gate;
    if (this.failWith) throw this.failWith;
    return enc(`webp(${dec(html)})`);
  }
}

// Resolve once the renderer has been called `n` times.
async function untilRendered(renderer: FakeRenderer, n: number) {
  for (let i = 0; i < 1000 && renderer.calls.length < n; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
  expect(renderer.calls.length).toBeGreaterThanOrEqual(n);
}

describe("ThumbnailService (S35)", () => {
  let repo: InMemoryArtefactRepository;
  let payloads: FakePayloadStore;
  let thumbs: InMemoryThumbnailStore;
  let renderer: FakeRenderer;
  let logs: string[];
  let service: ThumbnailService;

  function make(r: ThumbnailRenderer | null = renderer, resumeAfterMs?: number) {
    return new ThumbnailService({
      repo,
      payloadStore: payloads,
      thumbnailStore: thumbs,
      renderer: r,
      log: (message) => logs.push(message),
      resumeAfterMs,
    });
  }

  async function seed(
    id: string,
    html: string,
    hash = `h-${html}`,
    bytes = html.length,
  ): Promise<Artefact> {
    const a = createArtefact({
      id,
      ownerId: "owner",
      title: id,
      kind: "prototype",
      payload: { ref: `ref-${hash}`, bytes, hash },
    });
    payloads.live.set(a.payloadRef, enc(html));
    await repo.save(a);
    return a;
  }

  // The edit command's persisted effect: a new payload file + saved aggregate
  // (the superseded payload file is deleted).
  async function replacePayload(a: Artefact, html: string, hash = `h-${html}`) {
    const current = (await repo.findById(a.id, SINGLETON_SCOPE))!;
    const edited = editArtefact(current, {
      payload: { ref: `ref-${hash}`, bytes: html.length, hash },
    });
    payloads.live.set(edited.payloadRef, enc(html));
    payloads.live.delete(current.payloadRef);
    await repo.save(edited);
    return edited;
  }

  const stored = async (id: string) => (await repo.findById(id, SINGLETON_SCOPE))!;

  beforeEach(() => {
    repo = new InMemoryArtefactRepository();
    payloads = new FakePayloadStore();
    thumbs = new InMemoryThumbnailStore();
    renderer = new FakeRenderer();
    logs = [];
    service = make();
  });

  it("a job carries the artefact's payload size (S37)", async () => {
    const a = await seed("a1", "<h1>one</h1>", "h1", 1234);
    expect(thumbnailJobOf(a)).toEqual({
      id: "a1",
      payloadRef: "ref-h1",
      payloadHash: "h1",
      thumbnailHash: null,
      payloadSize: 1234,
    });
  });

  it("renders the stored payload, stores the image and records its hash", async () => {
    const a = await seed("a1", "<h1>one</h1>");

    service.enqueue(thumbnailJobOf(a));
    await service.idle();

    expect(renderer.calls).toEqual(["<h1>one</h1>"]);
    expect((await stored("a1")).thumbnailHash).toBe(a.payloadHash);
    expect(dec((await thumbs.get("a1", a.payloadHash))!)).toBe("webp(<h1>one</h1>)");
  });

  it("enqueue returns before rendering and never throws", async () => {
    const a = await seed("a1", "<h1>one</h1>");
    renderer.hold();

    expect(() => service.enqueue(thumbnailJobOf(a))).not.toThrow();
    expect((await stored("a1")).thumbnailHash).toBeNull();

    renderer.let();
    await service.idle();
    expect((await stored("a1")).thumbnailHash).toBe(a.payloadHash);
  });

  it("skips a job whose thumbnail is already fresh", async () => {
    const a = await seed("a1", "<h1>one</h1>");
    service.enqueue({ ...thumbnailJobOf(a), thumbnailHash: a.payloadHash });
    await service.idle();
    expect(renderer.calls).toEqual([]);
  });

  it("dedupes queued jobs by artefact, keeping the latest", async () => {
    const busy = await seed("busy", "<p>busy</p>");
    const a = await seed("a1", "<p>v1</p>");
    renderer.hold();
    service.enqueue(thumbnailJobOf(busy));
    await untilRendered(renderer, 1);

    service.enqueue(thumbnailJobOf(a));
    const v2 = await replacePayload(a, "<p>v2</p>");
    service.enqueue(thumbnailJobOf(v2));
    renderer.let();
    await service.idle();

    expect(renderer.calls).toEqual(["<p>busy</p>", "<p>v2</p>"]);
    expect((await stored("a1")).thumbnailHash).toBe(v2.payloadHash);
  });

  it("drops a job whose payload is gone (superseded)", async () => {
    const a = await seed("a1", "<p>v1</p>");
    payloads.live.delete(a.payloadRef);
    service.enqueue(thumbnailJobOf(a));
    await service.idle();
    expect(renderer.calls).toEqual([]);
    expect(logs).toEqual([]);
  });

  it("discards a render that finishes after the payload changed, and the newer render wins", async () => {
    const a = await seed("a1", "<p>v1</p>");
    renderer.hold();
    service.enqueue(thumbnailJobOf(a));
    await untilRendered(renderer, 1);

    const v2 = await replacePayload(a, "<p>v2</p>");
    service.enqueue(thumbnailJobOf(v2));
    renderer.let();
    await service.idle();

    expect(renderer.calls).toEqual(["<p>v1</p>", "<p>v2</p>"]);
    expect((await stored("a1")).thumbnailHash).toBe(v2.payloadHash);
    expect(thumbs.hashesOf("a1")).toEqual([v2.payloadHash]);
  });

  it("removes a lost render's file even when no newer render follows", async () => {
    const a = await seed("a1", "<p>v1</p>");
    renderer.hold();
    service.enqueue(thumbnailJobOf(a));
    await untilRendered(renderer, 1);

    await replacePayload(a, "<p>v2</p>"); // no enqueue: e.g. the queue was full elsewhere
    renderer.let();
    await service.idle();

    expect((await stored("a1")).thumbnailHash).toBeNull();
    expect(thumbs.hashesOf("a1")).toEqual([]);
  });

  it("keeps serving the previous thumbnail until a re-render lands, then deletes it", async () => {
    const a = await seed("a1", "<p>v1</p>");
    service.enqueue(thumbnailJobOf(a));
    await service.idle();

    renderer.hold();
    const v2 = await replacePayload(a, "<p>v2</p>");
    service.enqueue(thumbnailJobOf(v2));
    await untilRendered(renderer, 2);
    expect(thumbs.hashesOf("a1")).toEqual([a.payloadHash]);
    expect((await stored("a1")).thumbnailHash).toBe(a.payloadHash);

    renderer.let();
    await service.idle();
    expect(thumbs.hashesOf("a1")).toEqual([v2.payloadHash]);
  });

  it("leaves thumbnailHash unchanged on a render failure and never retries that hash", async () => {
    const a = await seed("a1", "<p>v1</p>");
    renderer.failWith = new Error("page crashed");

    service.enqueue(thumbnailJobOf(a));
    await service.idle();
    service.enqueue(thumbnailJobOf(a));
    await service.idle();

    expect(renderer.calls).toEqual(["<p>v1</p>"]);
    expect((await stored("a1")).thumbnailHash).toBeNull();
    expect(thumbs.hashesOf("a1")).toEqual([]);
    expect(logs).toHaveLength(1);
  });

  it("a failed hash does not block a later payload of the same artefact", async () => {
    const a = await seed("a1", "<p>v1</p>");
    renderer.failWith = new Error("page crashed");
    service.enqueue(thumbnailJobOf(a));
    await service.idle();

    renderer.failWith = null;
    const v2 = await replacePayload(a, "<p>v2</p>");
    service.enqueue(thumbnailJobOf(v2));
    await service.idle();

    expect((await stored("a1")).thumbnailHash).toBe(v2.payloadHash);
  });

  it("start() renders active artefacts that are missing or stale, never archived or fresh ones", async () => {
    await seed("missing", "<p>missing</p>");
    const stale = await seed("stale", "<p>s1</p>");
    await repo.recordThumbnail("stale", stale.payloadHash);
    await replacePayload(stale, "<p>s2</p>");
    const fresh = await seed("fresh", "<p>fresh</p>");
    await repo.recordThumbnail("fresh", fresh.payloadHash);
    const archived = await seed("archived", "<p>archived</p>");
    await repo.save(archiveArtefact(archived));

    await service.start();

    expect(renderer.calls.sort()).toEqual(["<p>missing</p>", "<p>s2</p>"]);
  });

  it("start() pages through more artefacts than one sweep read returns", async () => {
    service = new ThumbnailService({
      repo,
      payloadStore: payloads,
      thumbnailStore: thumbs,
      renderer,
      log: (m) => logs.push(m),
      sweepPageSize: 2,
    });
    for (const n of [1, 2, 3, 4, 5]) await seed(`a${n}`, `<p>${n}</p>`);

    await service.start();

    expect(renderer.calls).toHaveLength(5);
  });

  it("start() terminates when some artefacts can never be rendered", async () => {
    service = new ThumbnailService({
      repo,
      payloadStore: payloads,
      thumbnailStore: thumbs,
      renderer,
      log: (m) => logs.push(m),
      sweepPageSize: 1,
    });
    await seed("a1", "<p>1</p>");
    renderer.failWith = new Error("page crashed");

    await service.start();

    expect(renderer.calls).toEqual(["<p>1</p>"]);
  });

  it("start() reads past artefacts that stay stale to reach the rest", async () => {
    service = new ThumbnailService({
      repo,
      payloadStore: payloads,
      thumbnailStore: thumbs,
      renderer,
      log: (m) => logs.push(m),
      sweepPageSize: 1,
    });
    await seed("a1", "<p>broken</p>");
    await seed("a2", "<p>fine</p>");
    const render = renderer.render.bind(renderer);
    renderer.render = async (html) => {
      if (dec(html) === "<p>broken</p>") {
        renderer.calls.push(dec(html));
        throw new Error("page crashed");
      }
      return render(html);
    };

    await service.start();

    expect((await stored("a2")).thumbnailHash).toBe("h-<p>fine</p>");
  });

  describe("the render input cap (S37, AH29)", () => {
    it("skips a payload over MAX_RENDER_INPUT_BYTES without reading it or calling the renderer", async () => {
      const a = await seed("big", "<p>big</p>", "h-big", MAX_RENDER_INPUT_BYTES + 1);
      const read = vi.spyOn(payloads, "get");

      service.enqueue(thumbnailJobOf(a));
      await service.idle();

      expect(read).not.toHaveBeenCalled();
      expect(renderer.calls).toEqual([]);
      expect((await stored("big")).thumbnailHash).toBeNull();
    });

    it("renders a payload of exactly MAX_RENDER_INPUT_BYTES", async () => {
      const a = await seed("edge", "<p>edge</p>", "h-edge", MAX_RENDER_INPUT_BYTES);

      service.enqueue(thumbnailJobOf(a));
      await service.idle();

      expect((await stored("edge")).thumbnailHash).toBe(a.payloadHash);
    });

    it("start() reads past an oversized artefact to reach the rest", async () => {
      service = new ThumbnailService({
        repo,
        payloadStore: payloads,
        thumbnailStore: thumbs,
        renderer,
        log: (m) => logs.push(m),
        sweepPageSize: 1,
      });
      await seed("big", "<p>big</p>", "h-big", MAX_RENDER_INPUT_BYTES + 1);
      await seed("small", "<p>small</p>");

      await service.start();

      expect(renderer.calls).toEqual(["<p>small</p>"]);
    });
  });

  describe("disabled or unavailable renderer (AH25)", () => {
    it("with no renderer: start() logs once and nothing is ever rendered", async () => {
      service = make(null);
      const a = await seed("a1", "<p>v1</p>");

      await service.start();
      service.enqueue(thumbnailJobOf(a));
      await service.idle();

      expect(logs).toHaveLength(1);
      expect((await stored("a1")).thumbnailHash).toBeNull();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    // S37 (AH25/AH29) — an unreachable renderer pauses the queue instead of
    // disabling it for the process: pending is cleared, enqueues are dropped, and
    // after `resumeAfterMs` the sweep picks up whatever is still stale.
    it("when the renderer is unavailable: logs once, clears pending, and resumes with a sweep", async () => {
      vi.useFakeTimers();
      service = make(renderer, 60_000);
      renderer.failWith = new ThumbnailRendererUnavailable("renderer unreachable");
      const a = await seed("a1", "<p>1</p>");
      const b = await seed("b1", "<p>2</p>");

      service.enqueue(thumbnailJobOf(a));
      service.enqueue(thumbnailJobOf(b)); // pending when a's render fails
      await service.idle();
      const c = await seed("c1", "<p>3</p>");
      service.enqueue(thumbnailJobOf(c)); // dropped while paused
      await service.idle();

      expect(renderer.calls).toEqual(["<p>1</p>"]);
      expect(logs).toHaveLength(1);
      expect((await stored("b1")).thumbnailHash).toBeNull();

      renderer.failWith = null;
      await vi.advanceTimersByTimeAsync(59_999);
      expect(renderer.calls).toEqual(["<p>1</p>"]);

      await vi.advanceTimersByTimeAsync(1);
      await vi.waitFor(async () => {
        expect((await stored("c1")).thumbnailHash).toBe(c.payloadHash);
      });
      await service.idle();
      expect((await stored("a1")).thumbnailHash).toBe(a.payloadHash);
      expect((await stored("b1")).thumbnailHash).toBe(b.payloadHash);
      expect(logs).toHaveLength(1);
    });

    it("pauses for five minutes by default", () => {
      expect(make().resumeAfterMs).toBe(5 * 60_000);
    });
  });
});
