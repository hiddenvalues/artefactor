import { afterEach, describe, expect, it, vi } from "vitest";
import { createArtefact } from "../../domain/artefact/artefact";
import { InMemoryArtefactRepository } from "../../domain/artefact/in-memory-artefact-repository";
import { InMemoryThumbnailStore } from "../../domain/artefact/in-memory-thumbnail-store";
import type { PayloadStore, ThumbnailRenderer } from "../../domain/artefact/ports";
import { SINGLETON_SCOPE } from "../../domain/artefact/tenant-scope";

// S37 (AH25/AH29) — thumbnails render only through an isolated renderer: with
// ARTEFACTOR_RENDERER_URL unset no renderer is built, the service logs once
// (naming the variable) and never renders, and every card keeps the kind
// placeholder. S35's ARTEFACTOR_THUMBNAILS switch is gone.
describe("thumbnails follow ARTEFACTOR_RENDERER_URL (S37)", () => {
  const saved = process.env.ARTEFACTOR_RENDERER_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.ARTEFACTOR_RENDERER_URL;
    else process.env.ARTEFACTOR_RENDERER_URL = saved;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function freshEnv(value: string | undefined) {
    vi.resetModules();
    if (value === undefined) delete process.env.ARTEFACTOR_RENDERER_URL;
    else process.env.ARTEFACTOR_RENDERER_URL = value;
    return (await import("../env")).env;
  }

  it("with the variable unset: no renderer, one log line naming it, nothing rendered", async () => {
    const env = await freshEnv(undefined);
    const { thumbnailRendererFor, ThumbnailService } = await import("./thumbnail-service");
    let built = 0;
    const renderer = thumbnailRendererFor(env.ARTEFACTOR_RENDERER_URL, (): ThumbnailRenderer => {
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
    service.enqueue({ id: "a1", payloadRef: "r", payloadHash: "h", thumbnailHash: null, payloadSize: 1 });
    await service.idle();

    expect(logs).toEqual([expect.stringMatching(/ARTEFACTOR_RENDERER_URL/)]);
    expect((await repo.findById("a1", SINGLETON_SCOPE))!.thumbnailHash).toBeNull();
  });

  it("an empty value counts as unset", async () => {
    expect((await freshEnv("")).ARTEFACTOR_RENDERER_URL).toBeUndefined();
  });

  it("with ARTEFACTOR_RENDERER_URL set, the adapters build an HttpThumbnailRenderer for it", async () => {
    const env = await freshEnv("http://renderer:3001");
    expect(env.ARTEFACTOR_RENDERER_URL).toBe("http://renderer:3001");
    const { thumbnailRenderer } = await import("../adapters");
    // Imported after the module reset, so it is the class the adapters used.
    const { HttpThumbnailRenderer } = await import("../../infra/render/http-thumbnail-renderer");
    expect(thumbnailRenderer).toBeInstanceOf(HttpThumbnailRenderer);
    expect((thumbnailRenderer as InstanceType<typeof HttpThumbnailRenderer>).url).toBe(
      "http://renderer:3001",
    );
  });

  it("rejects a value that is not an absolute http(s) URL at startup", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exited");
    }) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(freshEnv("renderer:3001")).rejects.toThrow("exited");
    await expect(freshEnv("ftp://renderer")).rejects.toThrow("exited");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("ignores a leftover ARTEFACTOR_THUMBNAILS", async () => {
    process.env.ARTEFACTOR_THUMBNAILS = "on";
    try {
      const env = await freshEnv(undefined);
      expect(env).not.toHaveProperty("ARTEFACTOR_THUMBNAILS");
      const { thumbnailRenderer } = await import("../adapters");
      expect(thumbnailRenderer).toBeNull();
    } finally {
      delete process.env.ARTEFACTOR_THUMBNAILS;
    }
  });
});
