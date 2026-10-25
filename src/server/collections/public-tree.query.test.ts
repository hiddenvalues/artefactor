import { beforeEach, describe, expect, it } from "vitest";
import { readPublicCollectionTree } from "./public-tree.query";
import { createArtefact, type Artefact } from "../../domain/artefact/artefact";
import { InMemoryArtefactRepository } from "../../domain/artefact/in-memory-artefact-repository";
import { InMemoryCollectionRepository } from "../../domain/collection/in-memory-collection-repository";
import { createCollection, type Collection } from "../../domain/collection/collection";
import { CollectionNotFound } from "../../domain/collection/errors";

// S44 — the anonymous read of a public collection tree by its root slug
// (`collections.public-link.*`), against the in-memory repositories.

const OWNER = "owner-1";
const CONTRIBUTOR = "contrib-2";
const TENANT = "tenant-a";
const HOUR = 60 * 60 * 1000;

let collectionRepo: InMemoryCollectionRepository;
let artefactRepo: InMemoryArtefactRepository;

beforeEach(() => {
  collectionRepo = new InMemoryCollectionRepository();
  artefactRepo = new InMemoryArtefactRepository();
});

const deps = () => ({ collectionRepo, artefactRepo });

async function collection(
  id: string,
  over: Partial<Collection> = {},
  parent: Collection | null = null,
): Promise<Collection> {
  const c: Collection = {
    ...createCollection({ id, ownerId: OWNER, name: id, parent, tenantId: TENANT }),
    ...over,
  };
  await collectionRepo.save(c);
  return c;
}

async function publicRoot(over: Partial<Collection> = {}): Promise<Collection> {
  return collection("Landing", { visibility: "public", publicSlug: "landing", ...over });
}

async function artefact(id: string, collectionId: string, over: Partial<Artefact> = {}): Promise<Artefact> {
  const a: Artefact = {
    ...createArtefact({
      id,
      ownerId: OWNER,
      title: `Title ${id}`,
      kind: "prototype",
      payload: { ref: `ref-${id}`, bytes: 10, hash: `hash-${id}` },
      tenantId: TENANT,
    }),
    collectionId,
    publicSlug: `s-${id}`,
    updatedAt: new Date("2026-09-01T10:00:00.000Z"),
    ...over,
  };
  await artefactRepo.save(a);
  if (over.thumbnailHash) await artefactRepo.recordThumbnail(id, over.thumbnailHash);
  return a;
}

describe("readPublicCollectionTree (S44)", () => {
  // r[verify collections.public-link.anonymous-projection+2]
  it("returns names, structure and the per-artefact projection, and nothing else", async () => {
    const root = await publicRoot();
    const howTos = await collection("How-tos", {}, root);
    await artefact("a1", root.id, { thumbnailHash: "hash-a1" });
    await artefact("a2", howTos.id, { kind: "slide-deck" });

    const tree = await readPublicCollectionTree("landing", deps());

    expect(tree).toEqual({
      name: "Landing",
      description: null,
      children: [
        {
          name: "How-tos",
          description: null,
          children: [],
          artefacts: [
            {
              title: "Title a2",
              kind: "slide-deck",
              slug: "s-a2",
              updatedAt: "2026-09-01T10:00:00.000Z",
              thumbnailUrl: null,
            },
          ],
        },
      ],
      artefacts: [
        {
          title: "Title a1",
          kind: "prototype",
          slug: "s-a1",
          updatedAt: "2026-09-01T10:00:00.000Z",
          thumbnailUrl: "/api/artefacts/s-a1/thumbnail?v=hash-a1",
        },
      ],
    });
    const json = JSON.stringify(tree);
    for (const leak of ["\"id\"", "ownerId", OWNER, "sharedWith", "linkGate", "tenant", "@", "payload"]) {
      expect(json, leak).not.toContain(leak);
    }
  });

  // r[verify collections.public-link.anonymous-projection+2]
  it("carries each node's description, or null (S74)", async () => {
    const root = await publicRoot({ description: "Everything about Artefactor" });
    await collection("Getting started", { description: "Your first artefact" }, root);
    await collection("Reference", {}, root);

    const tree = await readPublicCollectionTree("landing", deps());

    expect(tree.description).toBe("Everything about Artefactor");
    expect(tree.children.map((c) => [c.name, c.description])).toEqual([
      ["Getting started", "Your first artefact"],
      ["Reference", null],
    ]);
    const json = JSON.stringify(tree);
    for (const leak of ["\"id\"", "ownerId", OWNER, "sharedWith", "visibility", "linkGate", "status"]) {
      expect(json, leak).not.toContain(leak);
    }
  });

  // r[verify collections.public-link.anonymous-projection+2]
  it("excludes archived sub-collections, archived artefacts and slugless artefacts", async () => {
    const root = await publicRoot();
    const gone = await collection("Old", { status: "archived", archivedAt: new Date() }, root);
    await artefact("in-gone", gone.id);
    await artefact("archived", root.id, { status: "archived", archivedAt: new Date() });
    await artefact("slugless", root.id, { publicSlug: null });
    await artefact("kept", root.id);

    const tree = await readPublicCollectionTree("landing", deps());

    expect(tree.children).toEqual([]);
    expect(tree.artefacts.map((a) => a.slug)).toEqual(["s-kept"]);
  });

  // r[verify collections.public-link.anonymous-projection+2]
  it("lists a contained artefact whose own (dormant) link gate is set", async () => {
    const root = await publicRoot();
    await artefact("gated-own", root.id, {
      linkGate: { passwordHash: "scrypt$x", expiresAt: new Date(Date.now() + HOUR), version: 1 },
    });
    const tree = await readPublicCollectionTree("landing", deps());
    expect(tree.artefacts.map((a) => a.slug)).toEqual(["s-gated-own"]);
  });

  // r[verify collections.public-link.anonymous-projection+2]
  it("lists a contributor's artefact like the owner's", async () => {
    const root = await publicRoot();
    await artefact("theirs", root.id, { ownerId: CONTRIBUTOR });
    const tree = await readPublicCollectionTree("landing", deps());
    expect(tree.artefacts.map((a) => a.slug)).toEqual(["s-theirs"]);
  });

  it("orders sub-collections by name and artefacts by title", async () => {
    const root = await publicRoot();
    await collection("b-gallery", {}, root);
    await collection("a-how-tos", {}, root);
    await artefact("z", root.id, { title: "Zebra" });
    await artefact("y", root.id, { title: "Aardvark" });
    const tree = await readPublicCollectionTree("landing", deps());
    expect(tree.children.map((c) => c.name)).toEqual(["a-how-tos", "b-gallery"]);
    expect(tree.artefacts.map((a) => a.title)).toEqual(["Aardvark", "Zebra"]);
  });

  // r[verify collections.public-link.anonymous-tree-read]
  it.each<[string, () => Promise<unknown>]>([
    ["an unknown slug", async () => publicRoot()],
    ["a selected root", async () => publicRoot({ visibility: "selected", publicSlug: "unknown" })],
    ["an authenticated root", async () => publicRoot({ visibility: "authenticated", publicSlug: "unknown" })],
    ["a private root", async () => publicRoot({ visibility: "private", publicSlug: "unknown" })],
    ["an archived root", async () => publicRoot({ status: "archived", archivedAt: new Date(), publicSlug: "unknown" })],
    [
      "a root with a password",
      async () =>
        publicRoot({ publicSlug: "unknown", linkGate: { passwordHash: "scrypt$x", expiresAt: null, version: 1 } }),
    ],
    [
      "a root with only an expiry",
      async () =>
        publicRoot({
          publicSlug: "unknown",
          linkGate: { passwordHash: null, expiresAt: new Date(Date.now() + HOUR), version: 0 },
        }),
    ],
  ])("%s → CollectionNotFound", async (_label, seed) => {
    await seed();
    await expect(readPublicCollectionTree("unknown", deps())).rejects.toBeInstanceOf(CollectionNotFound);
  });

  // r[verify collections.public-link.anonymous-tree-read]
  it("a sub-collection is never addressable, even if it somehow carried a slug", async () => {
    const root = await publicRoot();
    await collection("Child", { publicSlug: "child" }, root);
    await expect(readPublicCollectionTree("child", deps())).rejects.toBeInstanceOf(CollectionNotFound);
  });
});
