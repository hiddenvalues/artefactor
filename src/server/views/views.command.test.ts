import { beforeEach, describe, expect, it } from "vitest";
import {
  listArtefactViewers,
  recordArtefactView,
  type ListViewersDeps,
  type RecordViewDeps,
} from "./views.command";
import {
  createArtefact,
  shareArtefact,
  archiveArtefact,
  type Artefact,
} from "../../domain/artefact/artefact";
import { InMemoryArtefactRepository } from "../../domain/artefact/in-memory-artefact-repository";
import { InMemoryCollectionRepository } from "../../domain/collection/in-memory-collection-repository";
import { InMemoryViewRepository } from "../../domain/views/in-memory-view-repository";
import { SINGLETON_SCOPE as SCOPE } from "../../domain/artefact/tenant-scope";
import { ArtefactNotFound } from "../../domain/artefact/errors";

const OWNER = "owner-1";

describe("views commands (S21)", () => {
  let artefactRepo: InMemoryArtefactRepository;
  let viewRepo: InMemoryViewRepository;
  let recordDeps: RecordViewDeps;
  let listDeps: ListViewersDeps;

  // Seed an artefact owned by OWNER, shared at `tier` so it carries a slug.
  async function seed(
    tier: "authenticated" | "public" = "public",
    over: Partial<Artefact> = {},
  ) {
    const a = shareArtefact(
      createArtefact({
        id: "a1",
        ownerId: OWNER,
        title: "Form",
        kind: "form",
        payload: { ref: "r", bytes: 10, hash: "h" },
      }),
      { tier, newSlug: "slug1" },
    );
    await artefactRepo.save({ ...a, ...over });
    return a;
  }

  beforeEach(() => {
    artefactRepo = new InMemoryArtefactRepository();
    viewRepo = new InMemoryViewRepository();
    let n = 0;
    recordDeps = { viewRepo, newId: () => `v${++n}` };
    listDeps = {
      artefactRepo,
      collectionRepo: new InMemoryCollectionRepository(),
      viewRepo,
    };
  });

  it("records a view and lists it for another viewer (VT1)", async () => {
    await seed("authenticated");
    const at = new Date("2026-01-01T10:00:00Z");
    recordDeps.now = () => at;
    await recordArtefactView("a1", "viewer-2", recordDeps);

    const viewers = await listArtefactViewers("slug1", OWNER, SCOPE, listDeps);
    expect(viewers).toEqual([{ viewerId: "viewer-2", viewedAt: at }]);
  });

  it("keeps latest view only — a second view upserts, bumping viewedAt (VT1)", async () => {
    await seed("authenticated");
    recordDeps.now = () => new Date("2026-01-01T10:00:00Z");
    await recordArtefactView("a1", "viewer-2", recordDeps);
    const later = new Date("2026-01-02T12:00:00Z");
    recordDeps.now = () => later;
    await recordArtefactView("a1", "viewer-2", recordDeps);

    const viewers = await listArtefactViewers("slug1", OWNER, SCOPE, listDeps);
    expect(viewers).toEqual([{ viewerId: "viewer-2", viewedAt: later }]);
  });

  it("excludes the requesting viewer from the list (VT4)", async () => {
    await seed("authenticated");
    await recordArtefactView("a1", OWNER, recordDeps);
    await recordArtefactView("a1", "viewer-2", recordDeps);

    // The owner asking sees only the other viewer, never themselves.
    const asOwner = await listArtefactViewers("slug1", OWNER, SCOPE, listDeps);
    expect(asOwner.map((v) => v.viewerId)).toEqual(["viewer-2"]);
    // viewer-2 asking sees only the owner.
    const asViewer = await listArtefactViewers("slug1", "viewer-2", SCOPE, listDeps);
    expect(asViewer.map((v) => v.viewerId)).toEqual([OWNER]);
  });

  it("is not-found for an archived artefact (VT3, AH7)", async () => {
    const shared = await seed("authenticated");
    await artefactRepo.save(archiveArtefact(shared));
    await expect(
      listArtefactViewers("slug1", OWNER, SCOPE, listDeps),
    ).rejects.toBeInstanceOf(ArtefactNotFound);
  });

  it("is not-found when a non-owner targets a private artefact (VT4/AH8)", async () => {
    const shared = await seed("public");
    await artefactRepo.save({ ...shared, visibility: "private" });
    await expect(
      listArtefactViewers("slug1", "intruder", SCOPE, listDeps),
    ).rejects.toBeInstanceOf(ArtefactNotFound);
    // The owner can still read their own artefact's viewers.
    await expect(
      listArtefactViewers("slug1", OWNER, SCOPE, listDeps),
    ).resolves.toBeDefined();
  });

  it("addresses a never-shared private artefact by its id (id alias)", async () => {
    await artefactRepo.save(
      createArtefact({
        id: "never-shared",
        ownerId: OWNER,
        title: "Private",
        kind: "form",
        payload: { ref: "r", bytes: 10, hash: "h" },
      }),
    );
    await recordArtefactView("never-shared", "viewer-2", recordDeps);
    const viewers = await listArtefactViewers("never-shared", OWNER, SCOPE, listDeps);
    expect(viewers.map((v) => v.viewerId)).toEqual(["viewer-2"]);
    // A non-owner cannot reach it even with the id.
    await expect(
      listArtefactViewers("never-shared", "intruder", SCOPE, listDeps),
    ).rejects.toBeInstanceOf(ArtefactNotFound);
  });
});
