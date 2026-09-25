import type Database from "better-sqlite3";
import { asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createHash } from "node:crypto";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { PayloadStore } from "../../domain/artefact/ports";
import * as schema from "../db/schema";
import {
  BundleError,
  FORMAT,
  MANIFEST_FILE,
  PAYLOAD_DIR,
  RECORD_FILES,
  RECORD_KINDS,
  VERSION,
  type Manifest,
  type RecordsByKind,
} from "./format";

// S39 — write a deployment's state as an `artefactor-export` bundle
// (ddd/deployment-export.md). Reads every record inside one read transaction
// (DX3) through a connection the caller should open read-only (DX1), copies each
// distinct payload under its sha256 after checking every artefact's file against
// its `payloadHash` (DX4), and writes into `<out>.partial`, renamed to `<out>`
// only once the whole bundle is on disk.

export interface ExportBundleInput {
  sqlite: Database.Database;
  payloadStore: PayloadStore;
  out: string;
  // The source build, stamped into the manifest (the CLI passes GIT_SHA).
  build?: string;
  now?: () => Date;
  // Test seam: runs inside the read transaction, once its snapshot is open.
  afterSnapshot?: () => void;
}

type Records = { [K in keyof RecordsByKind]: RecordsByKind[K][] };

// An artefact's payload location on the source — never written to the bundle.
interface PayloadSource {
  artefactId: string;
  ref: string;
  hash: string;
  bytes: number;
}

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

export async function exportBundle(input: ExportBundleInput): Promise<Manifest> {
  const out = resolve(input.out);
  const partial = `${out}.partial`;
  await assertUsableOut(out);

  const { records, payloads } = readSnapshot(input.sqlite, input.afterSnapshot);

  await rm(partial, { recursive: true, force: true });
  await mkdir(join(partial, PAYLOAD_DIR), { recursive: true });

  const written = new Set<string>();
  for (const p of payloads) {
    let bytes: Uint8Array;
    try {
      bytes = await input.payloadStore.get(p.ref);
    } catch (e) {
      throw new BundleError("payload", `artefact ${p.artefactId}: payload ${p.ref} is unreadable (${String(e)})`);
    }
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== p.hash || bytes.byteLength !== p.bytes) {
      throw new BundleError(
        "payload",
        `artefact ${p.artefactId}: payload ${p.ref} hashes to ${hash} (${bytes.byteLength} bytes), ` +
          `the row says ${p.hash} (${p.bytes} bytes)`,
      );
    }
    if (written.has(hash)) continue;
    await writeFile(join(partial, PAYLOAD_DIR, hash), bytes);
    written.add(hash);
  }

  for (const kind of RECORD_KINDS) {
    const rows = records[kind] as unknown[];
    await writeFile(
      join(partial, RECORD_FILES[kind].file),
      rows.map((r) => `${JSON.stringify(r)}\n`).join(""),
    );
  }

  const manifest: Manifest = {
    format: FORMAT,
    version: VERSION,
    exportedAt: iso((input.now ?? (() => new Date()))()),
    source: { build: input.build ?? "unknown" },
    counts: {
      accounts: records.accounts.length,
      artefacts: records.artefacts.length,
      artefactAccess: records.artefactAccess.length,
      collections: records.collections.length,
      collectionAccess: records.collectionAccess.length,
      dataEntries: records.dataEntries.length,
      views: records.views.length,
      artefactBookmarks: records.artefactBookmarks.length,
      collectionBookmarks: records.collectionBookmarks.length,
      payloads: written.size,
    },
  };
  await writeFile(join(partial, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);

  // An existing `out` is empty (checked above); rename replaces an empty directory.
  await rename(partial, out);
  return manifest;
}

// Refuse an `out` that exists and holds anything — before writing a byte.
async function assertUsableOut(out: string): Promise<void> {
  const info = await stat(out).catch(() => undefined);
  if (!info) return;
  if (!info.isDirectory()) throw new BundleError("out", `${out} exists and is not a directory`);
  if ((await readdir(out)).length > 0) {
    throw new BundleError("out", `${out} exists and is not empty; choose a new directory`);
  }
}

// DX3 — every record comes from one read transaction. better-sqlite3 reads are
// synchronous, and a deferred transaction's snapshot opens at its first read.
function readSnapshot(
  sqlite: Database.Database,
  afterSnapshot?: () => void,
): { records: Records; payloads: PayloadSource[] } {
  const db = drizzle(sqlite, { schema });
  const read = sqlite.transaction(() => {
    const users = db.select().from(schema.user).orderBy(asc(schema.user.id)).all();
    afterSnapshot?.();
    const artefacts = db.select().from(schema.artefact).orderBy(asc(schema.artefact.id)).all();
    const artefactAccess = db
      .select()
      .from(schema.artefactAccess)
      .orderBy(asc(schema.artefactAccess.artefactId), asc(schema.artefactAccess.userId))
      .all();
    const collections = db.select().from(schema.collection).orderBy(asc(schema.collection.id)).all();
    const collectionAccess = db
      .select()
      .from(schema.collectionAccess)
      .orderBy(asc(schema.collectionAccess.collectionId), asc(schema.collectionAccess.userId))
      .all();
    const dataEntries = db.select().from(schema.dataEntry).orderBy(asc(schema.dataEntry.id)).all();
    const views = db.select().from(schema.viewEntry).orderBy(asc(schema.viewEntry.id)).all();
    const artefactBookmarks = db
      .select()
      .from(schema.artefactBookmark)
      .orderBy(asc(schema.artefactBookmark.userId), asc(schema.artefactBookmark.artefactId))
      .all();
    const collectionBookmarks = db
      .select()
      .from(schema.collectionBookmark)
      .orderBy(asc(schema.collectionBookmark.userId), asc(schema.collectionBookmark.collectionId))
      .all();
    return {
      users,
      artefacts,
      artefactAccess,
      collections,
      collectionAccess,
      dataEntries,
      views,
      artefactBookmarks,
      collectionBookmarks,
    };
  });
  const rows = read.deferred();

  const records: Records = {
    // DX2 — identity only; no credential column is ever selected into a record.
    accounts: rows.users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      emailVerified: u.emailVerified,
      image: u.image,
      createdAt: iso(u.createdAt),
    })),
    artefacts: rows.artefacts.map((a) => ({
      id: a.id,
      ownerId: a.ownerId,
      title: a.title,
      kind: a.kind,
      visibility: a.visibility,
      publicSlug: a.publicSlug,
      collectionId: a.collectionId,
      status: a.status,
      payloadHash: a.payloadHash,
      payloadBytes: a.payloadBytes,
      usesStorage: a.usesStorage,
      dataVisibility: a.dataVisibility,
      // No password and no expiry is no gate (incl. a cleared one) → null.
      linkGate:
        a.linkPasswordHash !== null || a.linkExpiresAt !== null
          ? {
              passwordHash: a.linkPasswordHash,
              expiresAt: isoOrNull(a.linkExpiresAt),
              version: a.linkGateVersion,
            }
          : null,
      createdAt: iso(a.createdAt),
      updatedAt: iso(a.updatedAt),
      archivedAt: isoOrNull(a.archivedAt),
    })),
    artefactAccess: rows.artefactAccess.map((r) => ({
      artefactId: r.artefactId,
      userId: r.userId,
      grantedAt: iso(r.grantedAt),
    })),
    collections: parentsFirst(rows.collections).map((c) => ({
      id: c.id,
      ownerId: c.ownerId,
      name: c.name,
      parentId: c.parentId,
      rootId: c.rootId,
      visibility: c.visibility,
      status: c.status,
      createdAt: iso(c.createdAt),
      updatedAt: iso(c.updatedAt),
      archivedAt: isoOrNull(c.archivedAt),
    })),
    collectionAccess: rows.collectionAccess.map((r) => ({
      collectionId: r.collectionId,
      userId: r.userId,
      grantedAt: iso(r.grantedAt),
    })),
    dataEntries: rows.dataEntries.map((d) => ({
      id: d.id,
      artefactId: d.artefactId,
      authorId: d.authorId,
      blob: d.blob,
      authoredAgainstVersion: d.authoredAgainstVersion,
      createdAt: iso(d.createdAt),
      updatedAt: iso(d.updatedAt),
    })),
    views: rows.views.map((v) => ({
      id: v.id,
      artefactId: v.artefactId,
      viewerId: v.viewerId,
      viewedAt: iso(v.viewedAt),
    })),
    artefactBookmarks: rows.artefactBookmarks.map((b) => ({
      userId: b.userId,
      artefactId: b.artefactId,
      createdAt: iso(b.createdAt),
    })),
    collectionBookmarks: rows.collectionBookmarks.map((b) => ({
      userId: b.userId,
      collectionId: b.collectionId,
      createdAt: iso(b.createdAt),
    })),
  };
  const payloads = rows.artefacts.map((a) => ({
    artefactId: a.id,
    ref: a.payloadRef,
    hash: a.payloadHash,
    bytes: a.payloadBytes,
  }));
  return { records, payloads };
}

// Collections by depth, then id (the input is already by id; sort is stable).
function parentsFirst<C extends { id: string; parentId: string | null }>(rows: C[]): C[] {
  const byId = new Map(rows.map((c) => [c.id, c]));
  const depth = new Map<string, number>();
  const depthOf = (c: C, seen = new Set<string>()): number => {
    const known = depth.get(c.id);
    if (known !== undefined) return known;
    const parent = c.parentId ? byId.get(c.parentId) : undefined;
    // A missing parent or a cycle can't come from a sound tree; keep it last-resort stable.
    const d = parent && !seen.has(parent.id) ? depthOf(parent, seen.add(c.id)) + 1 : 0;
    depth.set(c.id, d);
    return d;
  };
  return [...rows].sort((a, b) => depthOf(a) - depthOf(b));
}
