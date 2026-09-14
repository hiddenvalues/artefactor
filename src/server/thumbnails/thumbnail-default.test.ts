import { afterEach, describe, expect, it, vi } from "vitest";
import { createArtefact } from "../../domain/artefact/artefact";
import { InMemoryArtefactRepository } from "../../domain/artefact/in-memory-artefact-repository";
import { InMemoryThumbnailStore } from "../../domain/artefact/in-memory-thumbnail-store";
import type { PayloadStore, ThumbnailRenderer } from "../../domain/artefact/ports";
import { SINGLETON_SCOPE } from "../../domain/artefact/tenant-scope";

// S35 (AH25) — rendering is opt-in until renderer isolation lands: with
// ARTEFACTOR_THUMBNAILS unset no renderer is built, the service logs once and
// never renders, and every card keeps the kind placeholder.
describe("thumbnails are off by default (S35)", () => {
  const saved = process.env.ARTEFACTOR_THUMBNAILS;
  afterEach(() => {
    if (saved === undefined) delete process.env.ARTEFACTOR_THUMBNAILS;
    else process.env.ARTEFACTOR_THUMBNAILS = saved;
    vi.resetModules();
  });

  async function freshEnv(value: string | undefined) {
    vi.resetModules();
    if (value === undefined) delete process.env.ARTEFACTOR_THUMBNAILS;
    else process.env.ARTEFACTOR_THUMBNAILS = value;
    return (await import("../env")).env;
  }

  it("resolves an unset ARTEFACTOR_THUMBNAILS to off, and an explicit on to on", async () => {
    expect((await freshEnv(undefined)).ARTEFACTOR_THUMBNAILS).toBe("off");
    expect((await freshEnv("on")).ARTEFACTOR_THUMBNAILS).toBe("on");
  });

  it("with the variable unset: no renderer, one log line, nothing rendered", async () => {
    const env = await freshEnv(undefined);
    const { thumbnailRendererFor, ThumbnailService } = await import("./thumbnail-service");
    let built = 0;
    const renderer = thumbnailRendererFor(env.ARTEFACTOR_THUMBNAILS, (): ThumbnailRenderer => {
      built++;
      return { render: async () => new Uint8Array([1]) };
    });
    expect(renderer).toBeNull();
    expect(built).toBe(0);

    const repo = new InMemoryArtefactRepository();
    const a = createArtefact({
      id: "a1",
      ownerId: "o",
      title: "t",
      kind: "prototype",
      payload: { ref: "r", bytes: 1, hash: "h" },
    });
    await repo.save(a);
    const payloadStore: PayloadStore = {
      put: async () => ({ ref: "r", bytes: 1, hash: "h" }),
      get: async () => new Uint8Array([60]),
      delete: async () => {},
    };
    const logs: string[] = [];
    const service = new ThumbnailService({
      repo,
      payloadStore,
      thumbnailStore: new InMemoryThumbnailStore(),
      renderer,
      log: (m) => logs.push(m),
    });

    await service.start();
    service.enqueue({ id: "a1", payloadRef: "r", payloadHash: "h", thumbnailHash: null });
    await service.idle();

    expect(logs).toEqual([expect.stringMatching(/disabled/)]);
    expect((await repo.findById("a1", SINGLETON_SCOPE))!.thumbnailHash).toBeNull();
  });

  it("with ARTEFACTOR_THUMBNAILS=on the renderer is built", async () => {
    const env = await freshEnv("on");
    const { thumbnailRendererFor } = await import("./thumbnail-service");
    const made: ThumbnailRenderer = { render: async () => new Uint8Array() };
    expect(thumbnailRendererFor(env.ARTEFACTOR_THUMBNAILS, () => made)).toBe(made);
  });
});
