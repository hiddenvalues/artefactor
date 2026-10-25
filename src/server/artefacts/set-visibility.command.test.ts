import { beforeEach, describe, expect, it } from "vitest";
import { setArtefactVisibilityCommand } from "./set-visibility.command";
import { createArtefact } from "../../domain/artefact/artefact";
import { InMemoryArtefactRepository } from "../../domain/artefact/in-memory-artefact-repository";
import { SINGLETON_SCOPE as SCOPE } from "../../domain/artefact/tenant-scope";
import { ArtefactNotFound, InvariantViolation } from "../../domain/artefact/errors";

const OWNER = "owner-1";

function seed(repo: InMemoryArtefactRepository, id = "a1") {
  return repo.save(
    createArtefact({
      id,
      ownerId: OWNER,
      title: "Demo",
      kind: "prototype",
      payload: { ref: "r", bytes: 10, hash: "h" },
    }),
  );
}

describe("setArtefactVisibilityCommand (S5)", () => {
  let repo: InMemoryArtefactRepository;
  beforeEach(async () => {
    repo = new InMemoryArtefactRepository();
    await seed(repo);
  });

  // r[verify hosting.slug.shared-has-slug]
  // r[verify hosting.share.sets-tier]
  it("mints a unique slug on first share and raises visibility", async () => {
    const a = await setArtefactVisibilityCommand(
      { artefactId: "a1", requesterId: OWNER, visibility: "public", scope: SCOPE },
      { repo, generateSlug: () => "slug-1" },
    );
    expect(a.visibility).toBe("public");
    expect(a.publicSlug).toBe("slug-1");
    expect((await repo.findBySlug("slug-1"))?.id).toBe("a1");
  });

  // r[verify hosting.artefact.updated-at-bumped+2]
  it.each([
    ["the current tier", "authenticated", "authenticated"],
    ["private on a private artefact", "private", "private"],
  ] as const)("setting %s saves nothing and answers the artefact", async (_, from, to) => {
    if (from !== "private") {
      await setArtefactVisibilityCommand(
        { artefactId: "a1", requesterId: OWNER, visibility: from, scope: SCOPE },
        { repo, generateSlug: () => "slug-1" },
      );
    }
    const before = (await repo.findById("a1", SCOPE))!;
    const a = await setArtefactVisibilityCommand(
      { artefactId: "a1", requesterId: OWNER, visibility: to, scope: SCOPE },
      { repo, now: () => new Date("2030-01-01T00:00:00Z") },
    );
    expect(a).toEqual(before);
    const after = (await repo.findById("a1", SCOPE))!;
    expect(after.revision).toBe(before.revision);
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  // r[verify hosting.slug.minted-once-retained]
  it("reuses the retained slug across unshare → re-share", async () => {
    await setArtefactVisibilityCommand(
      { artefactId: "a1", requesterId: OWNER, visibility: "public", scope: SCOPE },
      { repo, generateSlug: () => "slug-1" },
    );
    const priv = await setArtefactVisibilityCommand(
      { artefactId: "a1", requesterId: OWNER, visibility: "private", scope: SCOPE },
      { repo },
    );
    expect(priv.visibility).toBe("private");
    expect(priv.publicSlug).toBe("slug-1"); // retained

    // Re-share must reuse the slug, not mint a new one.
    const reshared = await setArtefactVisibilityCommand(
      { artefactId: "a1", requesterId: OWNER, visibility: "authenticated", scope: SCOPE },
      { repo, generateSlug: () => "should-not-be-used" },
    );
    expect(reshared.publicSlug).toBe("slug-1");
    expect(reshared.visibility).toBe("authenticated");
  });

  // r[verify hosting.slug.globally-unique]
  it("regenerates on slug collision until unique", async () => {
    // Pre-occupy the first generated slug with another artefact.
    await repo.save({
      ...createArtefact({
        id: "other",
        ownerId: OWNER,
        title: "Other",
        kind: "form",
        payload: { ref: "r2", bytes: 5, hash: "h2" },
      }),
      publicSlug: "taken",
      visibility: "public",
    });
    const slugs = ["taken", "free"];
    let i = 0;
    const a = await setArtefactVisibilityCommand(
      { artefactId: "a1", requesterId: OWNER, visibility: "public", scope: SCOPE },
      { repo, generateSlug: () => slugs[i++]! },
    );
    expect(a.publicSlug).toBe("free");
  });

  // r[verify hosting.access.no-existence-leak+3]
  // r[verify hosting.authority.owner-only]
  it("treats a non-owner request as not-found", async () => {
    await expect(
      setArtefactVisibilityCommand(
        { artefactId: "a1", requesterId: "intruder", visibility: "public", scope: SCOPE },
        { repo },
      ),
    ).rejects.toBeInstanceOf(ArtefactNotFound);
  });

  it("throws not-found for an unknown id", async () => {
    await expect(
      setArtefactVisibilityCommand(
        { artefactId: "missing", requesterId: OWNER, visibility: "public", scope: SCOPE },
        { repo },
      ),
    ).rejects.toBeInstanceOf(ArtefactNotFound);
  });

  // r[verify hosting.access.dormant-tier-frozen]
  it("refuses to change a contained artefact's dormant tier, leaving it as it was", async () => {
    const before = (await repo.findById("a1", SCOPE))!;
    await repo.save({ ...before, collectionId: "c1" });
    await expect(
      setArtefactVisibilityCommand(
        { artefactId: "a1", requesterId: OWNER, visibility: "public", scope: SCOPE },
        { repo, generateSlug: () => "slug-1" },
      ),
    ).rejects.toBeInstanceOf(InvariantViolation);
    const after = (await repo.findById("a1", SCOPE))!;
    expect(after.visibility).toBe("private");
    expect(after.publicSlug).toBeNull();
  });
});
