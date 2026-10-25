import { beforeEach, describe, expect, it, vi } from "vitest";
import { createArtefact, type Artefact } from "../../domain/artefact/artefact";
import { ArtefactConflict, ArtefactNotFound } from "../../domain/artefact/errors";
import { InMemoryArtefactRepository } from "../../domain/artefact/in-memory-artefact-repository";
import { SINGLETON_SCOPE } from "../../domain/artefact/tenant-scope";
import { mutateArtefact } from "./mutate-artefact";

// S60 — Save concurrency: a save never overwrites a newer artefact. `mutateArtefact` re-applies a
// command's intent to a freshly loaded aggregate when its save conflicts
// (hosting.save.reapply-on-conflict).

describe("mutateArtefact (S60)", () => {
  let repo: InMemoryArtefactRepository;

  const load = async () => {
    const found = await repo.findById("a1", SINGLETON_SCOPE);
    if (!found) throw new ArtefactNotFound("a1");
    return found;
  };

  beforeEach(async () => {
    repo = new InMemoryArtefactRepository();
    await repo.save(
      createArtefact({
        id: "a1",
        ownerId: "owner",
        title: "T",
        kind: "prototype",
        payload: { ref: "r", bytes: 1, hash: "h" },
      }),
    );
  });

  // r[verify hosting.save.reapply-on-conflict]
  it("skips the save when apply returns the same object", async () => {
    const save = vi.spyOn(repo, "save");
    const loaded = await load();
    const result = await mutateArtefact(repo, { load: async () => loaded, apply: (a) => a });
    expect(save).not.toHaveBeenCalled();
    expect(result).toBe(loaded);
  });

  // r[verify hosting.save.reapply-on-conflict]
  it("reloads and re-applies after a conflict, returning the saved aggregate", async () => {
    const seen: Artefact[] = [];
    let raced = false;
    const result = await mutateArtefact(repo, {
      load,
      apply: async (a) => {
        seen.push(a);
        if (!raced) {
          raced = true;
          // A competing save lands between this attempt's load and its save.
          await repo.save({ ...(await load()), visibility: "authenticated", publicSlug: "s" });
        }
        return { ...a, title: "New" };
      },
    });
    expect(seen.map((a) => a.revision)).toEqual([1, 2]);
    expect(seen[1]!.visibility).toBe("authenticated");
    expect(result).toMatchObject({ title: "New", visibility: "authenticated", revision: 3 });
    expect(await load()).toEqual(result);
  });

  // r[verify hosting.save.reapply-on-conflict]
  it("rethrows ArtefactConflict after exactly 3 loads", async () => {
    const loads = vi.fn(load);
    repo.save = async (a) => {
      throw new ArtefactConflict(a.id);
    };
    await expect(
      mutateArtefact(repo, { load: loads, apply: (a) => ({ ...a, title: "x" }) }),
    ).rejects.toBeInstanceOf(ArtefactConflict);
    expect(loads).toHaveBeenCalledTimes(3);
  });

  // r[verify hosting.save.reapply-on-conflict]
  it("propagates a reload's ArtefactNotFound with no further attempt", async () => {
    let calls = 0;
    const loads = vi.fn(async () => {
      calls += 1;
      if (calls > 1) throw new ArtefactNotFound("a1");
      return load();
    });
    const apply = vi.fn(async (a: Artefact) => {
      await repo.save({ ...(await load()), title: "racing" });
      return { ...a, title: "mine" };
    });
    await expect(mutateArtefact(repo, { load: loads, apply })).rejects.toBeInstanceOf(
      ArtefactNotFound,
    );
    expect(loads).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
