import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import type { Adapters } from "./adapters";
import { InMemoryArtefactRepository } from "../domain/artefact/in-memory-artefact-repository";
import { InMemoryCollectionRepository } from "../domain/collection/in-memory-collection-repository";
import { InMemoryBookmarkRepository } from "../domain/bookmark/in-memory-bookmark-repository";
import { InMemoryDataRepository } from "../domain/data/in-memory-data-repository";
import { InMemoryViewRepository } from "../domain/views/in-memory-view-repository";
import { InMemoryThumbnailStore } from "../domain/artefact/in-memory-thumbnail-store";
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
  // Public + active with a minted slug, so an anonymous serve is allowed (hosting.access.matrix).
  artefact = shareArtefact(artefact, { tier: "public", newSlug: "inj-slug" });
  await artefactRepository.save(artefact);

  return {
    artefactRepository,
    collectionRepository: new InMemoryCollectionRepository(),
    bookmarkRepository: new InMemoryBookmarkRepository(),
    dataRepository: new InMemoryDataRepository(),
    viewRepository: new InMemoryViewRepository(),
    payloadStore: new FakePayloadStore(PAYLOAD),
    thumbnailStore: new InMemoryThumbnailStore(),
    userDirectory: stubDirectory,
  };
}

describe("S24 — composition injects persistence ports", () => {
  // r[verify platform.composition.injected-adapters-serve]
  it("serves a public artefact's frame from the injected repo + payload store", async () => {
    const app = createApp(await injectedAdapters());

    const res = await app.request("/a/inj-slug/frame");

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("INJECTED-PAYLOAD");
  });

  // r[verify platform.composition.injected-adapters-serve]
  it("renders the host shell for the injected artefact", async () => {
    const app = createApp(await injectedAdapters());

    const res = await app.request("/a/inj-slug");

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Injected"); // the artefact title in the shell
  });
});

describe("S24 — the composition reports unhandled errors", () => {
  const diskOnFire = new Error("disk on fire");
  async function failingAdapters(): Promise<Adapters> {
    const adapters = await injectedAdapters();
    const payloadStore: PayloadStore = {
      ...new FakePayloadStore(PAYLOAD),
      put: adapters.payloadStore.put,
      delete: adapters.payloadStore.delete,
      get: async () => {
        throw diskOnFire;
      },
    };
    return { ...adapters, payloadStore };
  }
  // Positional, as the composition takes its seams: everything before the reporter at its default.
  const appReporting = async (report?: (err: Error) => void) =>
    createApp(await failingAdapters(), undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, report);
  const quietly = async <T>(fn: () => T | Promise<T>): Promise<T> => {
    const error = console.error;
    console.error = () => {};
    try {
      return await fn();
    } finally {
      console.error = error;
    }
  };

  // r[verify platform.composition.unhandled-error-reporter]
  it("hands the reporter each error the app answers with a 500, once", async () => {
    const reported: Error[] = [];
    const app = await appReporting((err) => void reported.push(err));

    const res = await quietly(() => app.request("/a/inj-slug/frame"));

    expect(res.status).toBe(500);
    expect(reported).toEqual([diskOnFire]);
  });

  // r[verify platform.composition.unhandled-error-reporter]
  it("keeps the 500 when the reporter throws, and reports nothing by default", async () => {
    const throwing = await appReporting(() => {
      throw new Error("monitoring down");
    });
    expect((await quietly(() => throwing.request("/a/inj-slug/frame"))).status).toBe(500);

    const silent = await appReporting();
    expect((await quietly(() => silent.request("/a/inj-slug/frame"))).status).toBe(500);
  });

  // r[verify platform.composition.unhandled-error-reporter]
  it("reports no answer that isn't an unhandled error", async () => {
    const reported: Error[] = [];
    const app = createApp(await injectedAdapters(), undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, (err) => void reported.push(err));

    expect((await app.request("/a/inj-slug/frame")).status).toBe(200);
    expect((await app.request("/a/no-such-slug")).status).not.toBe(500);
    expect(reported).toEqual([]);
  });
});

describe("S24 — route modules take their dependencies", () => {
  const SERVER = fileURLToPath(new URL(".", import.meta.url));
  const routeModules = ["routes", "mcp"].flatMap((dir) =>
    readdirSync(join(SERVER, dir))
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => join(dir, f)),
  );
  // Each import declaration up to its own module specifier (its first quote), so a match never
  // runs on into the next declaration, semicolons or not.
  const IMPORT = /^[ \t]*import\s+(type\s)?[^'"]*?(['"])([^'"]+)\2/gm;
  // The OSS adapter set, the auth instance and the database client.
  const SINGLETON = /^(?:\.\.?\/)+(?:server\/)?(?:adapters|auth|infra\/db\/client)$/;
  // A value or side-effect import of one; a type-only import carries no singleton.
  const importsSingleton = (source: string) =>
    [...source.matchAll(IMPORT)].some(([, type, , spec]) => !type && SINGLETON.test(spec!));

  // r[verify platform.composition.no-singleton-imports]
  it("no route module imports the adapter or auth singleton", () => {
    expect(routeModules.length).toBeGreaterThan(0);
    const offenders = routeModules.filter((f) => importsSingleton(readFileSync(join(SERVER, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  // r[verify platform.composition.no-singleton-imports]
  it("reads each import declaration on its own", () => {
    expect(importsSingleton(`import { defaultAdapters } from '../adapters';`)).toBe(true);
    expect(importsSingleton(`import "../auth";`)).toBe(true);
    expect(importsSingleton(`  import { auth } from "../auth";`)).toBe(true);
    expect(importsSingleton(`import type { Adapters } from "../adapters";`)).toBe(false);
    // No semicolons: a value import of something else followed by a type-only singleton import.
    expect(importsSingleton(`import { x } from "./x"\nimport type { AuthInstance } from "../auth"`)).toBe(false);
  });
});

describe("S0 — the scaffold's health endpoint", () => {
  // r[verify platform.scaffold.health]
  it("answers GET /health with 200", async () => {
    const app = createApp(await injectedAdapters());

    const res = await app.request("/health");

    expect(res.status).toBe(200);
  });
});
