import { beforeEach, describe, expect, it } from "vitest";
import { setArtefactVisibilityCommand } from "./set-visibility.command";
import { clearLinkGateCommand, setLinkGateCommand } from "./link-gate.command";
import { createArtefact } from "../../domain/artefact/artefact";
import { InMemoryArtefactRepository } from "../../domain/artefact/in-memory-artefact-repository";
import { SINGLETON_SCOPE as SCOPE } from "../../domain/artefact/tenant-scope";
import { ArtefactNotFound, InvariantViolation } from "../../domain/artefact/errors";
import type { LinkPasswordHasher } from "../../domain/artefact/link-gate";

// S32a (hosting.link-gate.public-only) — the application commands behind the BFF's link-gate routes
// and the gate input on `PUT …/visibility`.

const OWNER = "owner-1";
const NOW = new Date("2026-06-01T12:00:00Z");
const FUTURE = new Date("2026-06-08T12:00:00Z");
const hasher: LinkPasswordHasher = {
  hash: async (pw) => `hashed:${pw}`,
  verify: async (pw, hash) => hash === `hashed:${pw}`,
};
const deps = (repo: InMemoryArtefactRepository) => ({
  repo,
  hasher,
  now: () => NOW,
  generateSlug: () => "slug-1",
});

describe("setArtefactVisibilityCommand with a link gate (S32a)", () => {
  let repo: InMemoryArtefactRepository;
  beforeEach(async () => {
    repo = new InMemoryArtefactRepository();
    await repo.save(
      createArtefact({
        id: "a1",
        ownerId: OWNER,
        title: "Demo",
        kind: "prototype",
        payload: { ref: "r", bytes: 10, hash: "h" },
      }),
    );
  });

  // r[verify hosting.link-gate.public-only]
  it("private → public with a gate sets tier and gate atomically", async () => {
    const a = await setArtefactVisibilityCommand(
      {
        artefactId: "a1",
        requesterId: OWNER,
        visibility: "public",
        scope: SCOPE,
        linkGate: { password: "correct-horse", expiresAt: FUTURE },
      },
      deps(repo),
    );
    expect(a.visibility).toBe("public");
    expect(a.linkGate).toEqual({ passwordHash: "hashed:correct-horse", expiresAt: FUTURE, version: 1 });
    expect((await repo.findById("a1", SCOPE))!.linkGate).toEqual(a.linkGate);
  });

  // r[verify hosting.link-gate.public-only]
  it("refuses a gate with a non-public tier, changing nothing", async () => {
    await expect(
      setArtefactVisibilityCommand(
        {
          artefactId: "a1",
          requesterId: OWNER,
          visibility: "authenticated",
          scope: SCOPE,
          linkGate: { password: "correct-horse" },
        },
        deps(repo),
      ),
    ).rejects.toBeInstanceOf(InvariantViolation);
    expect((await repo.findById("a1", SCOPE))!.visibility).toBe("private");
  });

  // r[verify hosting.link-gate.password-rules]
  it("refuses a bad gate without sharing the artefact", async () => {
    await expect(
      setArtefactVisibilityCommand(
        {
          artefactId: "a1",
          requesterId: OWNER,
          visibility: "public",
          scope: SCOPE,
          linkGate: { password: "short" },
        },
        deps(repo),
      ),
    ).rejects.toBeInstanceOf(InvariantViolation);
    expect((await repo.findById("a1", SCOPE))!.visibility).toBe("private");
  });
});

describe("setLinkGateCommand / clearLinkGateCommand (S32a)", () => {
  let repo: InMemoryArtefactRepository;
  beforeEach(async () => {
    repo = new InMemoryArtefactRepository();
    await repo.save({
      ...createArtefact({
        id: "a1",
        ownerId: OWNER,
        title: "Demo",
        kind: "prototype",
        payload: { ref: "r", bytes: 10, hash: "h" },
      }),
      visibility: "public",
      publicSlug: "slug-1",
    });
  });

  it("sets and persists either half", async () => {
    const a = await setLinkGateCommand(
      { artefactId: "a1", requesterId: OWNER, scope: SCOPE, password: "correct-horse", expiresAt: FUTURE },
      deps(repo),
    );
    expect(a.linkGate).toEqual({ passwordHash: "hashed:correct-horse", expiresAt: FUTURE, version: 1 });
    expect((await repo.findById("a1", SCOPE))!.linkGate).toEqual(a.linkGate);
  });

  it("clears both and persists", async () => {
    await setLinkGateCommand(
      { artefactId: "a1", requesterId: OWNER, scope: SCOPE, password: "correct-horse" },
      deps(repo),
    );
    const a = await clearLinkGateCommand({ artefactId: "a1", requesterId: OWNER, scope: SCOPE }, deps(repo));
    expect(a.linkGate).toEqual({ passwordHash: null, expiresAt: null, version: 2 });
    expect((await repo.findById("a1", SCOPE))!.linkGate).toEqual(a.linkGate);
  });

  // r[verify hosting.artefact.updated-at-bumped+2]
  it("clearing an unset gate saves nothing and answers the artefact", async () => {
    const before = (await repo.findById("a1", SCOPE))!;
    const a = await clearLinkGateCommand(
      { artefactId: "a1", requesterId: OWNER, scope: SCOPE },
      { ...deps(repo), now: () => new Date("2030-01-01T00:00:00Z") },
    );
    expect(a).toEqual(before);
    const after = (await repo.findById("a1", SCOPE))!;
    expect(after.revision).toBe(before.revision);
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(after.linkGate.version).toBe(before.linkGate.version);
  });

  // r[verify hosting.link-gate.public-only]
  it("refuses an unknown or foreign artefact as not found", async () => {
    await expect(
      setLinkGateCommand({ artefactId: "nope", requesterId: OWNER, scope: SCOPE, password: "correct-horse" }, deps(repo)),
    ).rejects.toBeInstanceOf(ArtefactNotFound);
    await expect(
      clearLinkGateCommand({ artefactId: "a1", requesterId: "someone", scope: SCOPE }, deps(repo)),
    ).rejects.toBeInstanceOf(ArtefactNotFound);
  });
});
