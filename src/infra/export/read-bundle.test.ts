import { cpSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { BundleError } from "./format";
import { exportBundle } from "./export-bundle";
import { readBundle } from "./read-bundle";
import { openSource, seedDeployment, type SeededDeployment } from "./fixture";

// S39 — readBundle rejects every broken bundle, naming the failing check, and
// tolerates what a later minor version may add.

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
  // r[verify export.reader.validates-bundle]
  it("accepts the bundle an export wrote", async () => {
    const bundle = await readBundle(good);
    expect(bundle.manifest.counts.artefacts).toBe(6);
  });

  // r[verify export.reader.validates-bundle]
  it("rejects a missing manifest", async () => {
    const dir = copy();
    rmSync(join(dir, "manifest.json"));
    expect((await rejection(dir)).check).toBe("manifest");
  });

  // r[verify export.reader.validates-bundle]
  it("rejects a foreign format", async () => {
    const dir = copy();
    writeManifest(dir, { ...manifestOf(dir), format: "something-else" });
    expect((await rejection(dir)).check).toBe("manifest");
  });

  // r[verify export.format.versioned+2]
  it("rejects an unknown major version", async () => {
    const dir = copy();
    writeManifest(dir, { ...manifestOf(dir), version: "2.0" });
    const err = await rejection(dir);
    expect(err.check).toBe("version");
    expect(err.message).toContain("2.0");
  });

  // r[verify export.reader.validates-bundle]
  it("rejects a record failing its schema", async () => {
    const dir = copy();
    const artefacts = lines(dir, "artefacts.jsonl");
    artefacts[1].visibility = "everyone";
    writeLines(dir, "artefacts.jsonl", artefacts);
    const err = await rejection(dir);
    expect(err.check).toBe("schema");
    expect(err.message).toContain("artefacts.jsonl line 2");
  });

  // r[verify export.reader.validates-bundle]
  it("rejects a line that is not JSON", async () => {
    const dir = copy();
    writeFileSync(join(dir, "views.jsonl"), "{not json\n");
    expect((await rejection(dir)).check).toBe("schema");
  });

  // r[verify export.reader.validates-bundle]
  it("rejects a missing record file", async () => {
    const dir = copy();
    rmSync(join(dir, "views.jsonl"));
    expect((await rejection(dir)).check).toBe("schema");
  });

  // r[verify export.reader.validates-bundle]
  it("rejects a count that disagrees with the manifest", async () => {
    const dir = copy();
    const m = manifestOf(dir);
    writeManifest(dir, { ...m, counts: { ...m.counts, accounts: m.counts.accounts + 1 } });
    const err = await rejection(dir);
    expect(err.check).toBe("count");
    expect(err.message).toContain("accounts");
  });

  // r[verify export.reader.validates-bundle]
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

  // r[verify export.reader.validates-bundle]
  it("rejects a dangling reference: a child collection whose parent is missing", async () => {
    const dir = copy();
    const collections = lines(dir, "collections.jsonl");
    collections[1].parentId = "c-missing";
    writeLines(dir, "collections.jsonl", collections);
    expect((await rejection(dir)).check).toBe("reference");
  });

  // r[verify export.payload.reader-verifies]
  it("rejects a payload whose bytes don't hash to its name", async () => {
    const dir = copy();
    const name = readdirSync(join(dir, "payloads"))[0]!;
    writeFileSync(join(dir, "payloads", name), "<p>tampered</p>");
    const err = await rejection(dir);
    expect(err.check).toBe("payload");
    expect(err.message).toContain(name);
  });

  // r[verify export.reader.validates-bundle]
  // r[verify export.format.self-contained]
  it("rejects a payload that is a symbolic link, even to the right bytes", async () => {
    const dir = copy();
    const name = readdirSync(join(dir, "payloads"))[0]!;
    const outside = join(seed.dir, `outside-${n++}`);
    renameSync(join(dir, "payloads", name), outside);
    symlinkSync(outside, join(dir, "payloads", name));
    const err = await rejection(dir);
    expect(err.check).toBe("payload");
    expect(err.message).toContain(name);
  });

  // r[verify export.reader.validates-bundle]
  it("rejects a payloads/ directory that is a symbolic link", async () => {
    const dir = copy();
    const outside = join(seed.dir, `outside-payloads-${n++}`);
    renameSync(join(dir, "payloads"), outside);
    symlinkSync(outside, join(dir, "payloads"));
    const err = await rejection(dir);
    expect(err.check).toBe("payload");
    expect(err.message).toContain("payloads/");
  });

  // r[verify export.reader.validates-bundle]
  it("rejects a missing payloads/ directory", async () => {
    const dir = copy();
    rmSync(join(dir, "payloads"), { recursive: true });
    expect((await rejection(dir)).check).toBe("payload");
  });

  // r[verify export.reader.validates-bundle]
  // r[verify export.format.self-contained]
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

  // r[verify export.reader.validates-bundle]
  it("rejects a payload entry that is a directory, as a BundleError", async () => {
    const dir = copy();
    mkdirSync(join(dir, "payloads", "a".repeat(64)));
    expect((await rejection(dir)).check).toBe("payload");
  });

  // r[verify export.reader.validates-bundle]
  it("rejects an artefact whose payload file is missing", async () => {
    const dir = copy();
    const [artefact] = lines(dir, "artefacts.jsonl");
    rmSync(join(dir, "payloads", artefact.payloadHash));
    const m = manifestOf(dir);
    writeManifest(dir, { ...m, counts: { ...m.counts, payloads: m.counts.payloads - 1 } });
    expect((await rejection(dir)).check).toBe("payload");
  });

  // r[verify export.format.versioned+2]
  it("accepts an unknown extra field and an unknown extra .jsonl under a known major", async () => {
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

  // r[verify export.collection.link-gate]
  it("reads a 1.0 bundle, whose collections carry no linkGate, as ungated", async () => {
    const dir = copy();
    const collections = lines(dir, "collections.jsonl").map(({ linkGate: _gate, ...c }) => c);
    writeLines(dir, "collections.jsonl", collections);
    writeManifest(dir, { ...manifestOf(dir), version: "1.0" });
    const bundle = await readBundle(dir);
    const read = [];
    for await (const c of bundle.collections()) read.push(c);
    expect(read).toHaveLength(2);
    for (const c of read) expect(c.linkGate).toBeNull();
  });

  // r[verify export.collection.public-slug]
  it("reads a 1.1 bundle, whose collections carry no publicSlug, as slugless", async () => {
    const dir = copy();
    const collections = lines(dir, "collections.jsonl").map(({ publicSlug: _slug, ...c }) => c);
    writeLines(dir, "collections.jsonl", collections);
    writeManifest(dir, { ...manifestOf(dir), version: "1.1" });
    const bundle = await readBundle(dir);
    const read = [];
    for await (const c of bundle.collections()) read.push(c);
    expect(read).toHaveLength(2);
    for (const c of read) expect(c.publicSlug).toBeNull();
  });

  // r[verify export.collection.public-slug]
  it("reads a collection's publicSlug from a 1.2-or-later bundle", async () => {
    const bundle = await readBundle(copy());
    const read = [];
    for await (const c of bundle.collections()) read.push(c);
    expect(read.find((c) => c.id === "c-z-root")!.publicSlug).toBe("research-tree");
  });

  // r[verify export.collection.description]
  it("reads a 1.2 bundle, whose collections carry no description, as undescribed", async () => {
    const dir = copy();
    const collections = lines(dir, "collections.jsonl").map(({ description: _d, ...c }) => c);
    writeLines(dir, "collections.jsonl", collections);
    writeManifest(dir, { ...manifestOf(dir), version: "1.2" });
    const bundle = await readBundle(dir);
    const read = [];
    for await (const c of bundle.collections()) read.push(c);
    expect(read).toHaveLength(2);
    for (const c of read) expect(c.description).toBeNull();
  });

  // r[verify export.collection.description]
  it("reads a 1.3 bundle's collection description", async () => {
    const bundle = await readBundle(copy());
    const read = [];
    for await (const c of bundle.collections()) read.push(c);
    expect(read.find((c) => c.id === "c-z-root")!.description).toBe("Customer research, by quarter");
  });

  describe("a bundle changed after readBundle verified it", () => {
    async function drain<T>(it: AsyncIterable<T>): Promise<T[]> {
      const out: T[] = [];
      for await (const r of it) out.push(r);
      return out;
    }

    // r[verify export.reader.records-re-proved]
    it("iterates an unchanged record file in full", async () => {
      const bundle = await readBundle(copy());
      expect(await drain(bundle.artefacts())).toHaveLength(6);
    });

    // r[verify export.reader.records-re-proved]
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

    // r[verify export.reader.import-all-or-nothing]
    it("leaves no row written when an import inside one transaction throws mid-way", async () => {
      const dir = copy();
      const bundle = await readBundle(dir);
      const artefacts = lines(dir, "artefacts.jsonl");
      artefacts[artefacts.length - 1].title = "edited between verification and import";
      writeLines(dir, "artefacts.jsonl", artefacts);

      // A stand-in importer: one transaction, any throw aborts it.
      const target = new Database(":memory:");
      try {
        target.exec("create table imported (id text primary key)");
        const insert = target.prepare("insert into imported (id) values (?)");
        let inserted = 0;
        target.exec("begin");
        const err = await (async () => {
          for await (const a of bundle.artefacts()) {
            insert.run(a.id);
            inserted++;
          }
          target.exec("commit");
        })().then(
          () => undefined,
          (e: unknown) => {
            target.exec("rollback");
            return e;
          },
        );
        expect(err).toBeInstanceOf(BundleError);
        expect((err as BundleError).check).toBe("changed");
        expect(inserted).toBe(artefacts.length);
        expect(target.prepare("select count(*) as n from imported").get()).toEqual({ n: 0 });
      } finally {
        target.close();
      }
    });

    // r[verify export.reader.opens-once]
    it("fails the iterator of a record file replaced by a symlink after verification", async () => {
      const dir = copy();
      const bundle = await readBundle(dir);
      const outside = join(seed.dir, `outside-${n++}`);
      renameSync(join(dir, "views.jsonl"), outside);
      symlinkSync(outside, join(dir, "views.jsonl"));
      const err = await drain(bundle.views()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BundleError);
    });

    // r[verify export.reader.opens-once]
    it("fails, rather than hangs, on a record file swapped for a FIFO after verification", async () => {
      const dir = copy();
      const bundle = await readBundle(dir);
      rmSync(join(dir, "views.jsonl"));
      execFileSync("mkfifo", [join(dir, "views.jsonl")]);
      const err = await drain(bundle.views()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BundleError);
    }, 5000);

    // r[verify export.reader.opens-once]
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

    // r[verify export.reader.payload-re-proved]
    it("readPayload returns the verified bytes of a payload", async () => {
      const dir = copy();
      const bundle = await readBundle(dir);
      const [first] = await drain(bundle.artefacts());
      const bytes = await bundle.readPayload(first!.payloadHash);
      expect(Buffer.from(bytes).equals(readFileSync(bundle.payloadPath(first!.payloadHash)))).toBe(true);
    });

    // r[verify export.reader.payload-re-proved]
    it("readPayload rejects a payload altered after verification", async () => {
      const dir = copy();
      const bundle = await readBundle(dir);
      const [first] = await drain(bundle.artefacts());
      writeFileSync(join(dir, "payloads", first!.payloadHash), "<p>swapped</p>");
      const err = await bundle.readPayload(first!.payloadHash).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BundleError);
      expect((err as BundleError).check).toBe("changed");
    });

    // r[verify export.reader.payload-re-proved]
    it("readPayload rejects a hash the bundle doesn't hold", async () => {
      const bundle = await readBundle(copy());
      const err = await bundle.readPayload("0".repeat(64)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BundleError);
      expect((err as BundleError).check).toBe("payload");
    });
  });
});
