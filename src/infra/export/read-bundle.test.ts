import { cpSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { BundleError } from "./format";
import { exportBundle } from "./export-bundle";
import { readBundle } from "./read-bundle";
import { openSource, seedDeployment, type SeededDeployment } from "./fixture";

// S39 — readBundle rejects every broken bundle, naming the failing check, and
// tolerates what a later minor version may add (DX4, DX5).

let seed: SeededDeployment;
let good: string;
let n = 0;

beforeAll(async () => {
  seed = await seedDeployment();
  good = join(seed.dir, "good");
  const sqlite = openSource(seed.dbPath, { readonly: true });
  await exportBundle({ sqlite, payloadStore: seed.payloadStore, out: good });
  sqlite.close();
});

// A fresh copy of the good bundle to tamper with.
function copy(): string {
  const dir = join(seed.dir, `copy-${n++}`);
  cpSync(good, dir, { recursive: true });
  return dir;
}

const manifestOf = (dir: string) => JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const writeManifest = (dir: string, m: unknown) =>
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(m));
const lines = (dir: string, file: string) =>
  readFileSync(join(dir, file), "utf8").trimEnd().split("\n").map((l) => JSON.parse(l));
const writeLines = (dir: string, file: string, records: unknown[]) =>
  writeFileSync(join(dir, file), records.map((r) => `${JSON.stringify(r)}\n`).join(""));

async function rejection(dir: string): Promise<BundleError> {
  const err = await readBundle(dir).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BundleError);
  return err as BundleError;
}

describe("readBundle (S39)", () => {
  it("accepts the bundle an export wrote", async () => {
    const bundle = await readBundle(good);
    expect(bundle.manifest.counts.artefacts).toBe(6);
  });

  it("rejects a missing manifest", async () => {
    const dir = copy();
    rmSync(join(dir, "manifest.json"));
    expect((await rejection(dir)).check).toBe("manifest");
  });

  it("rejects a foreign format", async () => {
    const dir = copy();
    writeManifest(dir, { ...manifestOf(dir), format: "something-else" });
    expect((await rejection(dir)).check).toBe("manifest");
  });

  it("rejects an unknown major version (DX5)", async () => {
    const dir = copy();
    writeManifest(dir, { ...manifestOf(dir), version: "2.0" });
    const err = await rejection(dir);
    expect(err.check).toBe("version");
    expect(err.message).toContain("2.0");
  });

  it("rejects a record failing its schema", async () => {
    const dir = copy();
    const artefacts = lines(dir, "artefacts.jsonl");
    artefacts[1].visibility = "everyone";
    writeLines(dir, "artefacts.jsonl", artefacts);
    const err = await rejection(dir);
    expect(err.check).toBe("schema");
    expect(err.message).toContain("artefacts.jsonl line 2");
  });

  it("rejects a line that is not JSON", async () => {
    const dir = copy();
    writeFileSync(join(dir, "views.jsonl"), "{not json\n");
    expect((await rejection(dir)).check).toBe("schema");
  });

  it("rejects a missing record file", async () => {
    const dir = copy();
    rmSync(join(dir, "views.jsonl"));
    expect((await rejection(dir)).check).toBe("schema");
  });

  it("rejects a count that disagrees with the manifest", async () => {
    const dir = copy();
    const m = manifestOf(dir);
    writeManifest(dir, { ...m, counts: { ...m.counts, accounts: m.counts.accounts + 1 } });
    const err = await rejection(dir);
    expect(err.check).toBe("count");
    expect(err.message).toContain("accounts");
  });

  it("rejects a dangling reference: an access row for an unexported user", async () => {
    const dir = copy();
    const access = lines(dir, "artefact-access.jsonl");
    access.push({ artefactId: "a-private", userId: "u-ghost", grantedAt: "2026-01-01T00:00:00.000Z" });
    writeLines(dir, "artefact-access.jsonl", access);
    const m = manifestOf(dir);
    writeManifest(dir, { ...m, counts: { ...m.counts, artefactAccess: access.length } });
    const err = await rejection(dir);
    expect(err.check).toBe("reference");
    expect(err.message).toContain("u-ghost");
  });

  it("rejects a dangling reference: a child collection whose parent is missing", async () => {
    const dir = copy();
    const collections = lines(dir, "collections.jsonl");
    collections[1].parentId = "c-missing";
    writeLines(dir, "collections.jsonl", collections);
    expect((await rejection(dir)).check).toBe("reference");
  });

  it("rejects a payload whose bytes don't hash to its name (DX4)", async () => {
    const dir = copy();
    const name = readdirSync(join(dir, "payloads"))[0]!;
    writeFileSync(join(dir, "payloads", name), "<p>tampered</p>");
    const err = await rejection(dir);
    expect(err.check).toBe("payload");
    expect(err.message).toContain(name);
  });

  it("rejects a payload that is a symbolic link, even to the right bytes (DX4)", async () => {
    const dir = copy();
    const name = readdirSync(join(dir, "payloads"))[0]!;
    const outside = join(seed.dir, `outside-${n++}`);
    renameSync(join(dir, "payloads", name), outside);
    symlinkSync(outside, join(dir, "payloads", name));
    const err = await rejection(dir);
    expect(err.check).toBe("payload");
    expect(err.message).toContain(name);
  });

  it("rejects a payloads/ directory that is a symbolic link (DX4)", async () => {
    const dir = copy();
    const outside = join(seed.dir, `outside-payloads-${n++}`);
    renameSync(join(dir, "payloads"), outside);
    symlinkSync(outside, join(dir, "payloads"));
    const err = await rejection(dir);
    expect(err.check).toBe("payload");
    expect(err.message).toContain("payloads/");
  });

  it("rejects a missing payloads/ directory", async () => {
    const dir = copy();
    rmSync(join(dir, "payloads"), { recursive: true });
    expect((await rejection(dir)).check).toBe("payload");
  });

  it.each(["manifest.json", "artefacts.jsonl"])(
    "rejects %s when it is a symbolic link, even to the right content",
    async (file) => {
      const dir = copy();
      const outside = join(seed.dir, `outside-${n++}`);
      renameSync(join(dir, file), outside);
      symlinkSync(outside, join(dir, file));
      const err = await rejection(dir);
      expect(err.message).toContain(file);
    },
  );

  it("rejects a payload entry that is a directory, as a BundleError", async () => {
    const dir = copy();
    mkdirSync(join(dir, "payloads", "a".repeat(64)));
    expect((await rejection(dir)).check).toBe("payload");
  });

  it("rejects an artefact whose payload file is missing (DX4)", async () => {
    const dir = copy();
    const [artefact] = lines(dir, "artefacts.jsonl");
    rmSync(join(dir, "payloads", artefact.payloadHash));
    const m = manifestOf(dir);
    writeManifest(dir, { ...m, counts: { ...m.counts, payloads: m.counts.payloads - 1 } });
    expect((await rejection(dir)).check).toBe("payload");
  });

  it("accepts an unknown extra field and an unknown extra .jsonl under a known major (DX5)", async () => {
    const dir = copy();
    const artefacts = lines(dir, "artefacts.jsonl").map((a) => ({ ...a, futureField: { x: 1 } }));
    writeLines(dir, "artefacts.jsonl", artefacts);
    writeLines(dir, "widgets.jsonl", [{ id: "w-1" }]);
    const m = manifestOf(dir);
    writeManifest(dir, {
      ...m,
      version: "1.7",
      futureManifestField: true,
      counts: { ...m.counts, widgets: 1 },
    });
    const bundle = await readBundle(dir);
    expect(bundle.manifest.version).toBe("1.7");
    const read = [];
    for await (const a of bundle.artefacts()) read.push(a);
    expect(read).toHaveLength(6);
    expect(read[0]).not.toHaveProperty("futureField");
  });

  describe("a bundle changed after readBundle verified it", () => {
    async function drain<T>(it: AsyncIterable<T>): Promise<T[]> {
      const out: T[] = [];
      for await (const r of it) out.push(r);
      return out;
    }

    it("iterates an unchanged record file in full", async () => {
      const bundle = await readBundle(copy());
      expect(await drain(bundle.artefacts())).toHaveLength(6);
    });

    it("fails the iterator of a record file edited after verification", async () => {
      const dir = copy();
      const bundle = await readBundle(dir);
      const artefacts = lines(dir, "artefacts.jsonl");
      artefacts[0].title = "swapped in after verify"; // still schema-valid
      writeLines(dir, "artefacts.jsonl", artefacts);
      const err = await drain(bundle.artefacts()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BundleError);
      expect((err as BundleError).check).toBe("changed");
      expect((err as BundleError).message).toContain("artefacts.jsonl");
    });

    it("fails the iterator of a record file replaced by a symlink after verification", async () => {
      const dir = copy();
      const bundle = await readBundle(dir);
      const outside = join(seed.dir, `outside-${n++}`);
      renameSync(join(dir, "views.jsonl"), outside);
      symlinkSync(outside, join(dir, "views.jsonl"));
      const err = await drain(bundle.views()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BundleError);
    });

    it("fails, rather than hangs, on a record file swapped for a FIFO after verification", async () => {
      const dir = copy();
      const bundle = await readBundle(dir);
      rmSync(join(dir, "views.jsonl"));
      execFileSync("mkfifo", [join(dir, "views.jsonl")]);
      const err = await drain(bundle.views()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BundleError);
    }, 5000);

    it("readPayload fails, rather than hangs, on a payload swapped for a FIFO", async () => {
      const dir = copy();
      const bundle = await readBundle(dir);
      const [first] = await drain(bundle.artefacts());
      rmSync(join(dir, "payloads", first!.payloadHash));
      execFileSync("mkfifo", [join(dir, "payloads", first!.payloadHash)]);
      const err = await bundle.readPayload(first!.payloadHash).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BundleError);
      expect((err as BundleError).check).toBe("changed");
    }, 5000);

    it("readPayload returns the verified bytes of a payload", async () => {
      const dir = copy();
      const bundle = await readBundle(dir);
      const [first] = await drain(bundle.artefacts());
      const bytes = await bundle.readPayload(first!.payloadHash);
      expect(Buffer.from(bytes).equals(readFileSync(bundle.payloadPath(first!.payloadHash)))).toBe(true);
    });

    it("readPayload rejects a payload altered after verification", async () => {
      const dir = copy();
      const bundle = await readBundle(dir);
      const [first] = await drain(bundle.artefacts());
      writeFileSync(join(dir, "payloads", first!.payloadHash), "<p>swapped</p>");
      const err = await bundle.readPayload(first!.payloadHash).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BundleError);
      expect((err as BundleError).check).toBe("changed");
    });

    it("readPayload rejects a hash the bundle doesn't hold", async () => {
      const bundle = await readBundle(copy());
      const err = await bundle.readPayload("0".repeat(64)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BundleError);
      expect((err as BundleError).check).toBe("payload");
    });
  });
});
