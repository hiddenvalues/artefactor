import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import type { Adapters } from "./adapters";
import { InMemoryArtefactRepository } from "../domain/artefact/in-memory-artefact-repository";
import { InMemoryCollectionRepository } from "../domain/collection/in-memory-collection-repository";
import { InMemoryBookmarkRepository } from "../domain/bookmark/in-memory-bookmark-repository";
import { InMemoryDataRepository } from "../domain/data/in-memory-data-repository";
import { InMemoryViewRepository } from "../domain/views/in-memory-view-repository";
import { createArtefact, shareArtefact } from "../domain/artefact/artefact";
import type { PayloadStore, StoredPayload } from "../domain/artefact/ports";
import type { UserDirectory } from "./data/user-directory";

// S24 — the BFF composition accepts the domain-port adapters as injected
// dependencies. This test wires a fully in-memory adapter set into `createApp`
// and serves a public artefact end-to-end, proving the served bytes come from
// the INJECTED repo + payload store (not the default SQLite/filesystem set). If
// `createApp` ignored the injected adapters, the slug would miss the empty
// default store and 404 instead of returning the injected payload.

const PAYLOAD = "<h1>INJECTED-PAYLOAD</h1>";

class FakePayloadStore implements PayloadStore {
  constructor(private readonly html: string) {}
  async put(): Promise<StoredPayload> {
    throw new Error("not used in this test");
  }
  async get(): Promise<Uint8Array> {
    return new TextEncoder().encode(this.html);
  }
  async delete(): Promise<void> {}
}

const stubDirectory: UserDirectory = {
  async lookup() {
    return new Map();
  },
  async search() {
    return [];
  },
};

async function injectedAdapters(): Promise<Adapters> {
  const artefactRepository = new InMemoryArtefactRepository();
  let artefact = createArtefact({
    id: "art-1",
    ownerId: "owner-1",
    title: "Injected",
    kind: "prototype",
    payload: { ref: "ref-1", bytes: PAYLOAD.length, hash: "hash-1" },
  });
  // Public + active with a minted slug, so an anonymous serve is allowed (AH8).
  artefact = shareArtefact(artefact, { tier: "public", newSlug: "inj-slug" });
  await artefactRepository.save(artefact);

  return {
    artefactRepository,
    collectionRepository: new InMemoryCollectionRepository(),
    bookmarkRepository: new InMemoryBookmarkRepository(),
    dataRepository: new InMemoryDataRepository(),
    viewRepository: new InMemoryViewRepository(),
    payloadStore: new FakePayloadStore(PAYLOAD),
    userDirectory: stubDirectory,
  };
}

describe("S24 — composition injects persistence ports", () => {
  it("serves a public artefact's frame from the injected repo + payload store", async () => {
    const app = createApp(await injectedAdapters());

    const res = await app.request("/a/inj-slug/frame");

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("INJECTED-PAYLOAD");
  });

  it("renders the host shell for the injected artefact", async () => {
    const app = createApp(await injectedAdapters());

    const res = await app.request("/a/inj-slug");

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Injected"); // the artefact title in the shell
  });
});
