import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { BundleError, RECORD_FILES, RECORD_KINDS } from "./format";
import { exportBundle } from "./export-bundle";
import { readBundle, type Bundle } from "./read-bundle";
import {
  GATE_HASH,
  RAW_BLOB,
  ROOT_GATE_HASH,
  SECRETS,
  openSource,
  seedDeployment,
  type SeededDeployment,
} from "./fixture";

// S39 — Deployment export bundle: the writer, against a seeded SQLite deployment
// (ddd/deployment-export.md, the export.* requirements).

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const r of it) out.push(r);
  return out;
}

async function allRecords(bundle: Bundle) {
  return {
    accounts: await collect(bundle.accounts()),
    artefacts: await collect(bundle.artefacts()),
    artefactAccess: await collect(bundle.artefactAccess()),
    collections: await collect(bundle.collections()),
    collectionAccess: await collect(bundle.collectionAccess()),
    dataEntries: await collect(bundle.dataEntries()),
    views: await collect(bundle.views()),
    artefactBookmarks: await collect(bundle.artefactBookmarks()),
    collectionBookmarks: await collect(bundle.collectionBookmarks()),
  };
}

function exportOf(seed: SeededDeployment, out: string, extra: Partial<Parameters<typeof exportBundle>[0]> = {}) {
  const sqlite = openSource(seed.dbPath, { readonly: true });
  return exportBundle({ sqlite, payloadStore: seed.payloadStore, out, build: "test-build", ...extra }).finally(
    () => sqlite.close(),
  );
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name));
}

// Every record of every record file, as written: parsed from its own line.
function rawRecords(dir: string): { file: string; record: Record<string, unknown> }[] {
  return RECORD_KINDS.flatMap((kind) => {
    const { file } = RECORD_FILES[kind];
    return readFileSync(join(dir, file), "utf8")
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => ({ file, record: JSON.parse(l) as Record<string, unknown> }));
  });
}

function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("exportBundle (S39)", () => {
  let seed: SeededDeployment;
  let out: string;
  let bundle: Bundle;
  let records: ReturnType<typeof rawRecords>;

  beforeAll(async () => {
    seed = await seedDeployment();
    out = join(seed.dir, "bundle");
    await exportOf(seed, out);
    bundle = await readBundle(out);
    records = rawRecords(out);
  });

  // r[verify export.bundle.round-trips+2]
  // r[verify export.bundle.lossless]
  it("round-trips every record of the seed, field for field, with matching counts", async () => {
    expect(await allRecords(bundle)).toEqual(seed.expected);
    expect(bundle.manifest).toMatchObject({
      format: "artefactor-export",
      version: "1.3",
      source: { build: "test-build" },
      counts: {
        accounts: 2,
        artefacts: 6,
        artefactAccess: 1,
        collections: 2,
        collectionAccess: 1,
        dataEntries: 2,
        views: 2,
        artefactBookmarks: 2,
        collectionBookmarks: 1,
        payloads: seed.distinctPayloads,
      },
    });
  });

  // r[verify export.format.json-lines]
  it("writes each record file as JSON Lines, its last line ending in a newline", () => {
    for (const kind of RECORD_KINDS) {
      const text = readFileSync(join(out, RECORD_FILES[kind].file), "utf8");
      expect(text.endsWith("\n"), RECORD_FILES[kind].file).toBe(true);
      const lines = text.slice(0, -1).split("\n");
      expect(lines).toHaveLength(bundle.manifest.counts[kind]);
      for (const line of lines) {
        const value: unknown = JSON.parse(line);
        expect(value !== null && typeof value === "object" && !Array.isArray(value), line).toBe(true);
      }
    }
  });

  // r[verify export.format.utc-millis]
  it("writes every timestamp as UTC ISO-8601 with milliseconds", () => {
    const stamps: unknown[] = [bundle.manifest.exportedAt];
    const walk = (o: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(o)) {
        if (v !== null && typeof v === "object") walk(v as Record<string, unknown>);
        else if (k.endsWith("At") && v !== null) stamps.push(v);
      }
    };
    for (const { record } of records) walk(record);
    expect(stamps.length).toBeGreaterThan(30);
    for (const s of stamps) expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  // r[verify export.format.blob-untouched]
  it("writes a data entry's blob exactly as stored, never re-serialised", async () => {
    const written = records.find((r) => r.record.id === "d-2")!.record;
    expect(written.blob).toBe(RAW_BLOB);
    const entries = await collect(bundle.dataEntries());
    expect(entries.find((d) => d.id === "d-2")!.blob).toBe(RAW_BLOB);
  });

  // r[verify export.format.null-not-omitted]
  it("writes an absent value as null, never an omitted key", () => {
    for (const { file, record } of records) {
      const kind = RECORD_KINDS.find((k) => RECORD_FILES[k].file === file)!;
      expect(Object.keys(record).sort(), file).toEqual(Object.keys(RECORD_FILES[kind].schema.shape).sort());
    }
    const active = records.find((r) => r.record.id === "a-private")!.record;
    expect(active).toHaveProperty("archivedAt", null);
    const gated = records.find((r) => r.record.id === "a-public-gated")!.record;
    expect(Object.keys(gated.linkGate as object).sort()).toEqual(["expiresAt", "passwordHash", "version"]);
  });

  // r[verify export.format.excludes-derived]
  it("exports no thumbnail, payload storage ref or tenant id", () => {
    for (const { file, record } of records) {
      for (const key of Object.keys(record)) expect(key, file).not.toMatch(/thumbnail|ref$|tenant/i);
    }
    expect(readdirSync(out).filter((e) => /thumbnail/i.test(e))).toEqual([]);
    expect(readFileSync(join(out, "artefacts.jsonl"), "utf8")).not.toContain(seed.ref("a-private"));
  });

  // r[verify export.format.archived-included]
  it("exports archived artefacts and collections with their status and archivedAt", async () => {
    const artefact = (await collect(bundle.artefacts())).find((a) => a.id === "a-archived")!;
    expect(artefact).toMatchObject({ status: "archived", archivedAt: expect.any(String) });
    const collection = (await collect(bundle.collections())).find((c) => c.id === "c-a-child")!;
    expect(collection).toMatchObject({ status: "archived", archivedAt: "2026-02-04T08:00:00.000Z" });
  });

  // r[verify export.format.stable-order]
  it("writes collections parents before children", async () => {
    const ids = (await collect(bundle.collections())).map((c) => c.id);
    expect(ids).toEqual(["c-z-root", "c-a-child"]);
  });

  // r[verify export.account.no-credentials+2]
  it("carries no Account credential anywhere in the bundle", async () => {
    const accounts = readFileSync(join(out, "accounts.jsonl"), "utf8");
    for (const line of accounts.trim().split("\n")) {
      expect(Object.keys(JSON.parse(line)).sort()).toEqual(
        ["createdAt", "email", "emailVerified", "id", "image", "name"],
      );
    }
    const everything = filesUnder(out).map((f) => readFileSync(f, "utf8")).join("\n");
    for (const secret of Object.values(SECRETS)) expect(everything).not.toContain(secret);
    expect(readdirSync(out).sort()).toEqual([
      "accounts.jsonl",
      "artefact-access.jsonl",
      "artefact-bookmarks.jsonl",
      "artefacts.jsonl",
      "collection-access.jsonl",
      "collection-bookmarks.jsonl",
      "collections.jsonl",
      "data-entries.jsonl",
      "manifest.json",
      "payloads",
      "views.jsonl",
    ]);
  });

  // r[verify export.account.no-credentials+2]
  it("keeps a gated artefact's link-gate hash and writes null for an ungated one", async () => {
    const artefacts = await collect(bundle.artefacts());
    const gated = artefacts.find((a) => a.id === "a-public-gated")!;
    expect(gated.linkGate).toEqual({
      passwordHash: GATE_HASH,
      expiresAt: "2026-09-30T23:59:59.999Z",
      version: 3,
    });
    expect(artefacts.find((a) => a.id === "a-public-plain")!.linkGate).toBeNull();
    expect(artefacts.find((a) => a.id === "a-private")!.linkGate).toBeNull();
  });

  // r[verify export.collection.link-gate]
  it("keeps a gated collection root's link gate, writes null for an ungated one", async () => {
    const collections = await collect(bundle.collections());
    expect(collections.find((c) => c.id === "c-z-root")!.linkGate).toEqual({
      passwordHash: ROOT_GATE_HASH,
      expiresAt: "2026-09-15T12:00:00.000Z",
      version: 4,
    });
    expect(collections.find((c) => c.id === "c-a-child")!.linkGate).toBeNull();
    const raw = readFileSync(join(out, "collections.jsonl"), "utf8").trimEnd().split("\n");
    for (const line of raw) expect(Object.keys(JSON.parse(line))).toContain("linkGate");
  });

  // r[verify export.collection.public-slug]
  it("writes a root's publicSlug and null for a slugless collection", async () => {
    const collections = await collect(bundle.collections());
    expect(collections.find((c) => c.id === "c-z-root")!.publicSlug).toBe("research-tree");
    expect(collections.find((c) => c.id === "c-a-child")!.publicSlug).toBeNull();
    const raw = readFileSync(join(out, "collections.jsonl"), "utf8").trimEnd().split("\n");
    for (const line of raw) expect(Object.keys(JSON.parse(line))).toContain("publicSlug");
  });

  // r[verify export.collection.description]
  it("writes a collection's description and null for none, as format 1.3", async () => {
    const collections = await collect(bundle.collections());
    expect(collections.find((c) => c.id === "c-z-root")!.description).toBe("Customer research, by quarter");
    expect(collections.find((c) => c.id === "c-a-child")!.description).toBeNull();
    const raw = readFileSync(join(out, "collections.jsonl"), "utf8").trimEnd().split("\n");
    for (const line of raw) expect(Object.keys(JSON.parse(line))).toContain("description");
    expect(bundle.manifest.version).toBe("1.3");
  });

  // r[verify export.payload.writer-verifies]
  it("stores identical HTML once, named by its sha256, for both artefacts", async () => {
    const artefacts = await collect(bundle.artefacts());
    const a = artefacts.find((r) => r.id === "a-private")!;
    const b = artefacts.find((r) => r.id === "a-public-plain")!;
    expect(a.payloadHash).toBe(b.payloadHash);
    const payloads = readdirSync(join(out, "payloads"));
    expect(payloads).toHaveLength(seed.distinctPayloads);
    expect(payloads.filter((p) => p === a.payloadHash)).toHaveLength(1);
    expect(sha256(join(out, "payloads", a.payloadHash))).toBe(a.payloadHash);
  });

  // r[verify export.format.stable-order]
  it("is byte-identical across two exports of an unchanged deployment, apart from exportedAt", async () => {
    const second = join(seed.dir, "bundle-again");
    await exportOf(seed, second, { now: () => new Date("2031-01-01T00:00:00.000Z") });
    const rel = (dir: string) => filesUnder(dir).map((f) => f.slice(dir.length)).sort();
    expect(rel(second)).toEqual(rel(out));
    for (const f of rel(out)) {
      if (f.endsWith("manifest.json")) continue;
      expect(readFileSync(join(second, f)).equals(readFileSync(join(out, f))), f).toBe(true);
    }
    const m1 = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    const m2 = JSON.parse(readFileSync(join(second, "manifest.json"), "utf8"));
    expect(m2.exportedAt).toBe("2031-01-01T00:00:00.000Z");
    expect({ ...m2, exportedAt: m1.exportedAt }).toEqual(m1);
  });
});

describe("exportBundle — read-only", () => {
  // r[verify export.snapshot.read-only]
  it("leaves the source database file and payload directory byte-identical", async () => {
    const seed = await seedDeployment();
    const snapshot = () => ({
      db: sha256(seed.dbPath),
      payloads: Object.fromEntries(filesUnder(seed.payloadDir).map((f) => [f, sha256(f)])),
    });
    const before = snapshot();
    await exportOf(seed, join(seed.dir, "bundle"));
    expect(snapshot()).toEqual(before);
  });
});

describe("exportBundle — a record file with no records", () => {
  // r[verify export.format.json-lines]
  it("writes it as an empty file, and the bundle still verifies", async () => {
    const seed = await seedDeployment();
    const out = join(seed.dir, "bundle");
    const writer = openSource(seed.dbPath);
    writer.prepare("delete from collection_bookmark").run();
    writer.close();
    await exportOf(seed, out);
    expect(readFileSync(join(out, "collection-bookmarks.jsonl"), "utf8")).toBe("");
    expect((await readBundle(out)).manifest.counts.collectionBookmarks).toBe(0);
  });
});

describe("exportBundle — one snapshot", () => {
  // r[verify export.snapshot.one-transaction]
  it("omits a write committed after the read transaction opened, and still verifies", async () => {
    const seed = await seedDeployment();
    const out = join(seed.dir, "bundle");
    const writer = openSource(seed.dbPath);
    const late = await seed.payloadStore.put(new TextEncoder().encode("<p>late</p>"));
    await exportOf(seed, out, {
      afterSnapshot: () => {
        const now = Date.now();
        writer
          .prepare(
            `insert into artefact (id, owner_id, title, kind, payload_ref, payload_bytes, payload_hash, created_at, updated_at)
             values ('a-late', 'u-alice', 'late', 'other', ?, ?, ?, ?, ?)`,
          )
          .run(late.ref, late.bytes, late.hash, now, now);
        writer
          .prepare(
            `insert into data_entry (id, artefact_id, author_id, blob, created_at, updated_at)
             values ('d-late', 'a-late', 'u-bob', '{}', ?, ?)`,
          )
          .run(now, now);
      },
    });
    writer.close();
    const bundle = await readBundle(out);
    expect((await collect(bundle.artefacts())).map((a) => a.id)).not.toContain("a-late");
    expect((await collect(bundle.dataEntries())).map((d) => d.id)).not.toContain("d-late");
    expect(bundle.manifest.counts.artefacts).toBe(6);
  });
});

describe("exportBundle — verifiable payloads", () => {
  // r[verify export.payload.writer-verifies]
  it.each([
    ["missing", (path: string) => rmSync(path)],
    ["altered", (path: string) => writeFileSync(path, "<p>tampered</p>")],
  ] as const)("fails on a %s payload, leaving only <out>.partial", async (_label, damage) => {
    const seed = await seedDeployment();
    damage(join(seed.payloadDir, seed.ref("a-selected")));
    const out = join(seed.dir, "bundle");
    const err = await exportOf(seed, out).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BundleError);
    expect((err as BundleError).check).toBe("payload");
    expect((err as BundleError).message).toContain("a-selected");
    expect(existsSync(out)).toBe(false);
    expect(existsSync(`${out}.partial`)).toBe(true);
  });
});

describe("exportBundle — output directory", () => {
  // r[verify export.output.never-reused]
  it("refuses a non-empty out directory and writes nothing", async () => {
    const seed = await seedDeployment();
    const out = join(seed.dir, "occupied");
    mkdirSync(out);
    writeFileSync(join(out, "keep.txt"), "mine");
    const err = await exportOf(seed, out).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BundleError);
    expect((err as BundleError).check).toBe("out");
    expect(readdirSync(out)).toEqual(["keep.txt"]);
    expect(existsSync(`${out}.partial`)).toBe(false);
  });

  // r[verify export.output.never-reused]
  it("refuses when <out>.partial already exists, leaving it untouched", async () => {
    const seed = await seedDeployment();
    const out = join(seed.dir, "bundle");
    mkdirSync(`${out}.partial`);
    writeFileSync(join(`${out}.partial`, "unrelated.txt"), "not ours");
    const err = await exportOf(seed, out).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BundleError);
    expect((err as BundleError).check).toBe("out");
    expect(readdirSync(`${out}.partial`)).toEqual(["unrelated.txt"]);
    expect(existsSync(out)).toBe(false);
  });

  // r[verify export.bundle.owner-only]
  it("writes the bundle owner-only: directories 0700, files 0600", async () => {
    const seed = await seedDeployment();
    const out = join(seed.dir, "bundle");
    const umask = process.umask(0o000); // the most permissive ambient umask
    try {
      await exportOf(seed, out);
    } finally {
      process.umask(umask);
    }
    const mode = (p: string) => statSync(p).mode & 0o777;
    expect(mode(out)).toBe(0o700);
    expect(mode(join(out, "payloads"))).toBe(0o700);
    for (const f of filesUnder(out)) expect(mode(f), f).toBe(0o600);
  });

  // r[verify export.bundle.owner-only]
  it("creates missing ancestors of out owner-only too", async () => {
    const seed = await seedDeployment();
    const out = join(seed.dir, "new-parent", "nested", "bundle");
    const umask = process.umask(0o000);
    try {
      await exportOf(seed, out);
    } finally {
      process.umask(umask);
    }
    expect(statSync(join(seed.dir, "new-parent")).mode & 0o777).toBe(0o700);
    expect(statSync(join(seed.dir, "new-parent", "nested")).mode & 0o777).toBe(0o700);
  });

  // r[verify export.output.never-reused]
  it("writes into an existing empty out directory", async () => {
    const seed = await seedDeployment();
    const out = join(seed.dir, "empty");
    mkdirSync(out);
    await exportOf(seed, out);
    expect((await readBundle(out)).manifest.counts.accounts).toBe(2);
    expect(existsSync(`${out}.partial`)).toBe(false);
  });
});
