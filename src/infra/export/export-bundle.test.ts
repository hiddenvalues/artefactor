import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { BundleError } from "./format";
import { exportBundle } from "./export-bundle";
import { readBundle, type Bundle } from "./read-bundle";
import { GATE_HASH, SECRETS, openSource, seedDeployment, type SeededDeployment } from "./fixture";

// S39 — Deployment export bundle: the writer, against a seeded SQLite deployment
// (ddd/deployment-export.md, DX1–DX5).

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

function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("exportBundle (S39)", () => {
  let seed: SeededDeployment;
  let out: string;
  let bundle: Bundle;

  beforeAll(async () => {
    seed = await seedDeployment();
    out = join(seed.dir, "bundle");
    await exportOf(seed, out);
    bundle = await readBundle(out);
  });

  it("round-trips every record of the seed, field for field, with matching counts", async () => {
    expect(await allRecords(bundle)).toEqual(seed.expected);
    expect(bundle.manifest).toMatchObject({
      format: "artefactor-export",
      version: "1.0",
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

  it("writes collections parents before children", async () => {
    const ids = (await collect(bundle.collections())).map((c) => c.id);
    expect(ids).toEqual(["c-z-root", "c-a-child"]);
  });

  it("carries no Account credential anywhere in the bundle (DX2)", async () => {
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

describe("exportBundle — read-only (DX1)", () => {
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

describe("exportBundle — one snapshot (DX3)", () => {
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

describe("exportBundle — verifiable payloads (DX4)", () => {
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

  it("writes into an existing empty out directory", async () => {
    const seed = await seedDeployment();
    const out = join(seed.dir, "empty");
    mkdirSync(out);
    await exportOf(seed, out);
    expect((await readBundle(out)).manifest.counts.accounts).toBe(2);
    expect(existsSync(`${out}.partial`)).toBe(false);
  });
});
