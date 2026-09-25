import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { z } from "zod";
import {
  BundleError,
  FORMAT,
  MANIFEST_FILE,
  PAYLOAD_DIR,
  RECORD_FILES,
  RECORD_KINDS,
  SUPPORTED_MAJOR,
  manifestSchema,
  type Manifest,
  type RecordKind,
  type RecordsByKind,
} from "./format";

// S39 — read and verify an `artefactor-export` bundle (ddd/deployment-export.md).
// `readBundle` validates the whole bundle before it returns — manifest, format
// and major version (DX5), every record against its schema, counts, referential
// closure and every payload's sha256 (DX4) — and rejects it with a BundleError
// naming the failing check. The EE importer (EM1) reads bundles through this.

export type Bundle = {
  manifest: Manifest;
  // Where a payload's bytes live, by the `payloadHash` an artefact names.
  payloadPath(hash: string): string;
} & { [K in RecordKind]: () => AsyncIterable<RecordsByKind[K]> };

export async function readBundle(dir: string): Promise<Bundle> {
  const manifest = await readManifest(dir);

  const ids = {
    accounts: new Set<string>(),
    artefacts: new Set<string>(),
    collections: new Set<string>(),
    dataEntries: new Set<string>(),
    views: new Set<string>(),
  };
  // (file, line, field, value, the id set it must be in)
  const refs: { file: string; line: number; field: string; value: string; target: keyof typeof ids }[] = [];
  const ref = (file: string, line: number, field: string, value: string | null, target: keyof typeof ids) => {
    if (value !== null) refs.push({ file, line, field, value, target });
  };
  // payloadHash → the artefacts naming it, with the size each one records
  const payloadUses = new Map<string, { artefactId: string; bytes: number }[]>();

  for (const kind of RECORD_KINDS) {
    const { file } = RECORD_FILES[kind];
    let count = 0;
    for await (const { line, record } of readRecords(dir, kind)) {
      count++;
      const r = record as Record<string, unknown> & RecordsByKind[RecordKind];
      if (kind in ids && typeof r.id === "string") {
        const set = ids[kind as keyof typeof ids];
        if (set.has(r.id)) throw new BundleError("duplicate", `${file} line ${line}: id ${r.id} appears twice`);
        set.add(r.id);
      }
      switch (kind) {
        case "artefacts": {
          const a = record as RecordsByKind["artefacts"];
          ref(file, line, "ownerId", a.ownerId, "accounts");
          ref(file, line, "collectionId", a.collectionId, "collections");
          const uses = payloadUses.get(a.payloadHash) ?? [];
          uses.push({ artefactId: a.id, bytes: a.payloadBytes });
          payloadUses.set(a.payloadHash, uses);
          break;
        }
        case "artefactAccess": {
          const a = record as RecordsByKind["artefactAccess"];
          ref(file, line, "artefactId", a.artefactId, "artefacts");
          ref(file, line, "userId", a.userId, "accounts");
          break;
        }
        case "collections": {
          const c = record as RecordsByKind["collections"];
          ref(file, line, "ownerId", c.ownerId, "accounts");
          ref(file, line, "parentId", c.parentId, "collections");
          ref(file, line, "rootId", c.rootId, "collections");
          break;
        }
        case "collectionAccess": {
          const c = record as RecordsByKind["collectionAccess"];
          ref(file, line, "collectionId", c.collectionId, "collections");
          ref(file, line, "userId", c.userId, "accounts");
          break;
        }
        case "dataEntries": {
          const d = record as RecordsByKind["dataEntries"];
          ref(file, line, "artefactId", d.artefactId, "artefacts");
          ref(file, line, "authorId", d.authorId, "accounts");
          break;
        }
        case "views": {
          const v = record as RecordsByKind["views"];
          ref(file, line, "artefactId", v.artefactId, "artefacts");
          ref(file, line, "viewerId", v.viewerId, "accounts");
          break;
        }
        case "artefactBookmarks": {
          const b = record as RecordsByKind["artefactBookmarks"];
          ref(file, line, "userId", b.userId, "accounts");
          ref(file, line, "artefactId", b.artefactId, "artefacts");
          break;
        }
        case "collectionBookmarks": {
          const b = record as RecordsByKind["collectionBookmarks"];
          ref(file, line, "userId", b.userId, "accounts");
          ref(file, line, "collectionId", b.collectionId, "collections");
          break;
        }
      }
    }
    if (count !== manifest.counts[kind]) {
      throw new BundleError("count", `${file} holds ${count} records; the manifest's counts.${kind} says ${manifest.counts[kind]}`);
    }
  }

  for (const r of refs) {
    if (!ids[r.target].has(r.value)) {
      throw new BundleError(
        "reference",
        `${r.file} line ${r.line}: ${r.field} ${r.value} is not an exported ${r.target === "accounts" ? "account" : r.target.replace(/s$/, "")}`,
      );
    }
  }

  await verifyPayloads(dir, manifest, payloadUses);

  const bundle = {
    manifest,
    payloadPath: (hash: string) => join(dir, PAYLOAD_DIR, hash),
  } as Bundle;
  for (const kind of RECORD_KINDS) {
    (bundle as Record<RecordKind, unknown>)[kind] = () => records(dir, kind);
  }
  return bundle;
}

async function readManifest(dir: string): Promise<Manifest> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(dir, MANIFEST_FILE), "utf8"));
  } catch (e) {
    throw new BundleError("manifest", `${MANIFEST_FILE} is missing or not JSON (${String(e)})`);
  }
  const head = raw as { format?: unknown; version?: unknown } | null;
  if (typeof head !== "object" || head === null || head.format !== FORMAT) {
    throw new BundleError("manifest", `${MANIFEST_FILE} does not name format "${FORMAT}"`);
  }
  const major = typeof head.version === "string" ? Number(head.version.split(".")[0]) : NaN;
  if (major !== SUPPORTED_MAJOR) {
    throw new BundleError(
      "version",
      `format version ${String(head.version)} is not readable here (major ${SUPPORTED_MAJOR} only)`,
    );
  }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BundleError("manifest", `${MANIFEST_FILE}: ${issues(parsed.error)}`);
  }
  return parsed.data;
}

// Every line of a record file, parsed and validated; `line` is 1-based.
async function* readRecords<K extends RecordKind>(
  dir: string,
  kind: K,
): AsyncGenerator<{ line: number; record: RecordsByKind[K] }> {
  const { file, schema } = RECORD_FILES[kind];
  const path = join(dir, file);
  if (!(await stat(path).catch(() => undefined))?.isFile()) {
    throw new BundleError("schema", `${file} is missing`);
  }
  const lines = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  let line = 0;
  for await (const text of lines) {
    line++;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new BundleError("schema", `${file} line ${line}: not a JSON record`);
    }
    const parsed = (schema as unknown as z.ZodType<RecordsByKind[K]>).safeParse(json);
    if (!parsed.success) {
      throw new BundleError("schema", `${file} line ${line}: ${issues(parsed.error)}`);
    }
    yield { line, record: parsed.data };
  }
}

async function* records<K extends RecordKind>(dir: string, kind: K): AsyncGenerator<RecordsByKind[K]> {
  for await (const { record } of readRecords(dir, kind)) yield record;
}

// DX4 — each payload file hashes to its name, the manifest counts them, and
// every artefact's payloadHash names one whose size matches its payloadBytes.
async function verifyPayloads(
  dir: string,
  manifest: Manifest,
  uses: Map<string, { artefactId: string; bytes: number }[]>,
): Promise<void> {
  const root = join(dir, PAYLOAD_DIR);
  const names = await readdir(root).catch(() => {
    throw new BundleError("payload", `${PAYLOAD_DIR}/ is missing`);
  });
  const sizes = new Map<string, number>();
  for (const name of names.sort()) {
    const path = join(root, name);
    // A payload is a regular file inside the bundle — never a symlink to bytes
    // elsewhere, which would verify a bundle that doesn't carry its payload.
    if (!(await lstat(path)).isFile()) {
      throw new BundleError("payload", `${PAYLOAD_DIR}/${name} is not a regular file`);
    }
    const { hash, bytes } = await hashFile(path);
    if (hash !== name) {
      throw new BundleError("payload", `${PAYLOAD_DIR}/${name} hashes to ${hash}, not its name`);
    }
    sizes.set(name, bytes);
  }
  if (sizes.size !== manifest.counts.payloads) {
    throw new BundleError(
      "count",
      `${PAYLOAD_DIR}/ holds ${sizes.size} payloads; the manifest's counts.payloads says ${manifest.counts.payloads}`,
    );
  }
  for (const [hash, list] of uses) {
    const size = sizes.get(hash);
    for (const u of list) {
      if (size === undefined) {
        throw new BundleError("payload", `artefact ${u.artefactId}: payload ${hash} is missing`);
      }
      if (size !== u.bytes) {
        throw new BundleError(
          "payload",
          `artefact ${u.artefactId}: payload ${hash} is ${size} bytes, the record says ${u.bytes}`,
        );
      }
    }
  }
}

async function hashFile(path: string): Promise<{ hash: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
    bytes += (chunk as Buffer).byteLength;
  }
  return { hash: hash.digest("hex"), bytes };
}

function issues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "(record)"}: ${i.message}`).join("; ");
}
