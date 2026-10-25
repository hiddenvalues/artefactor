import { beforeEach, describe, expect, it } from "vitest";
import { createArtefact, type Artefact } from "../../domain/artefact/artefact";
import { InMemoryArtefactRepository } from "../../domain/artefact/in-memory-artefact-repository";
import { SINGLETON_SCOPE as SCOPE } from "../../domain/artefact/tenant-scope";
import { ArtefactNotFound, InvariantViolation } from "../../domain/artefact/errors";
import type { LinkPasswordHasher } from "../../domain/artefact/link-gate";
import { setSharingCommand, UnknownMember } from "./set-sharing.command";

// S55 — Manage access dialog: one draft, saved atomically.

const OWNER = "owner-1";
const NOW = new Date("2026-06-01T12:00:00Z");
const FUTURE = new Date("2026-07-01T00:00:00Z");

const hasher: LinkPasswordHasher = {
  hash: async (pw) => `hashed:${pw}`,
  verify: async (pw, hash) => hash === `hashed:${pw}`,
};

// A repository double that counts writes.
class CountingRepo extends InMemoryArtefactRepository {
  saves = 0;
  override async save(a: Artefact): Promise<Artefact> {
    this.saves++;
    return super.save(a);
  }
}

const KNOWN = new Set(["u1", "u2"]);
const knownUsers = async (ids: readonly string[]) => new Set(ids.filter((id) => KNOWN.has(id)));

describe("setSharingCommand (S55)", () => {
  let repo: CountingRepo;
  const deps = () => ({ repo, hasher, knownUsers, generateSlug: () => "slug-1", now: () => NOW });

  beforeEach(async () => {
    repo = new CountingRepo();
    await repo.save(
      createArtefact({
        id: "a1",
        ownerId: OWNER,
        title: "Demo",
        kind: "prototype",
        payload: { ref: "r", bytes: 10, hash: "h" },
        usesStorage: true,
      }),
    );
    repo.saves = 0;
  });

  // r[verify hosting.sharing.atomic-save]
  it("saves exactly once and returns every changed field", async () => {
    const a = await setSharingCommand(
      {
        artefactId: "a1",
        requesterId: OWNER,
        scope: SCOPE,
        change: { visibility: "selected", members: ["u1", "u2"], dataVisibility: "shared" },
      },
      deps(),
    );
    expect(repo.saves).toBe(1);
    expect(a).toMatchObject({ visibility: "selected", sharedWith: ["u1", "u2"], publicSlug: "slug-1", dataVisibility: "shared" });
    expect(await repo.findById("a1", SCOPE)).toEqual(a);
  });

  it("sets the gate with the change to public in the same save", async () => {
    const a = await setSharingCommand(
      {
        artefactId: "a1",
        requesterId: OWNER,
        scope: SCOPE,
        change: { visibility: "public", linkGate: { password: "long-enough", expiresAt: FUTURE } },
      },
      deps(),
    );
    expect(repo.saves).toBe(1);
    expect(a.linkGate.passwordHash).toBe("hashed:long-enough");
  });

  // r[verify hosting.sharing.atomic-save]
  it("leaves the stored artefact byte-identical when one part is refused", async () => {
    const before = structuredClone(await repo.findById("a1", SCOPE));
    await expect(
      setSharingCommand(
        {
          artefactId: "a1",
          requesterId: OWNER,
          scope: SCOPE,
          change: { visibility: "public", members: ["u1"], dataVisibility: "shared", linkGate: { password: "short" } },
        },
        deps(),
      ),
    ).rejects.toThrow(InvariantViolation);
    expect(repo.saves).toBe(0);
    expect(await repo.findById("a1", SCOPE)).toEqual(before);
  });

  // r[verify hosting.sharing.members-replace]
  it("refuses an added member the user directory doesn't know, saving nothing", async () => {
    await expect(
      setSharingCommand(
        { artefactId: "a1", requesterId: OWNER, scope: SCOPE, change: { visibility: "selected", members: ["u1", "ghost"] } },
        deps(),
      ),
    ).rejects.toThrow(UnknownMember);
    expect(repo.saves).toBe(0);
  });

  it("checks only added members: a retained member the directory no longer knows stays", async () => {
    const stored = (await repo.findById("a1", SCOPE))!;
    await repo.save({ ...stored, sharedWith: ["gone"] });
    const a = await setSharingCommand(
      { artefactId: "a1", requesterId: OWNER, scope: SCOPE, change: { visibility: "selected", members: ["gone", "u1"] } },
      deps(),
    );
    expect(a.sharedWith).toEqual(["gone", "u1"]);
  });

  it("refuses a non-owner and an unknown id as not found", async () => {
    await expect(
      setSharingCommand({ artefactId: "a1", requesterId: "intruder", scope: SCOPE, change: { visibility: "public" } }, deps()),
    ).rejects.toThrow(ArtefactNotFound);
    await expect(
      setSharingCommand({ artefactId: "nope", requesterId: OWNER, scope: SCOPE, change: { visibility: "public" } }, deps()),
    ).rejects.toThrow(ArtefactNotFound);
    expect(repo.saves).toBe(0);
  });
});
