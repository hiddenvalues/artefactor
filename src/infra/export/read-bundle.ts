import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, type FileHandle } from "node:fs/promises";
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
  type BundleCheck,
  type Manifest,
  type RecordKind,
  type RecordsByKind,
} from "./format";

// S39 — read and verify an `artefactor-export` bundle (ddd/deployment-export.md).
// `readBundle` validates the whole bundle before it returns — manifest, format
// and major version (DX5), every record against its schema, counts, referential
// closure and every payload's sha256 (DX4) — and rejects it with a BundleError
// naming the failing check. The EE importer (EM1) reads bundles through this.
//
// What it hands back reads the bundle again, so it re-proves that the bytes are
// the ones it verified: each record iterator re-hashes its file as it streams
// and throws (`changed`) once the file ends if it differs from what was
// verified, and `readPayload` re-hashes every payload it returns. A consumer
// imports inside one transaction and treats a throw as an abort — records are
// yielded before their file's end is reached.

export type Bundle = {
  manifest: Manifest;
  // A payload's verified bytes, by the `payloadHash` an artefact names.
  readPayload(hash: string): Promise<Uint8Array>;
  // Where a payload lives on disk. Reading it here bypasses the re-check —
  // prefer readPayload.
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

  // record kind → the sha256 of the file as verified
  const digests = new Map<RecordKind, string>();

  for (const kind of RECORD_KINDS) {
    const { file } = RECORD_FILES[kind];
    let count = 0;
    for await (const { line, record } of readRecords(dir, kind, { seen: (d) => digests.set(kind, d) })) {
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

  const payloads = await verifyPayloads(dir, manifest, payloadUses);

  const bundle = {
    manifest,
    readPayload: (hash: string) => readPayload(dir, payloads, hash),
    payloadPath: (hash: string) => join(dir, PAYLOAD_DIR, hash),
  } as Bundle;
  for (const kind of RECORD_KINDS) {
    (bundle as Record<RecordKind, unknown>)[kind] = () => records(dir, kind, digests.get(kind)!);
  }
  return bundle;
}

async function readManifest(dir: string): Promise<Manifest> {
  let raw: unknown;
  try {
    const handle = await openFile(join(dir, MANIFEST_FILE), "manifest", MANIFEST_FILE);
    try {
      raw = JSON.parse(await handle.readFile("utf8"));
    } finally {
      await handle.close();
    }
  } catch (e) {
    if (e instanceof BundleError) throw e;
    throw new BundleError("manifest", `${MANIFEST_FILE} is not JSON (${String(e)})`);
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

// Every line of a record file, parsed and validated; `line` is 1-based. The
// file's sha256 is computed as it streams: handed to `seen` once the file ends,
// and compared with `expect` there (a mismatch throws `changed`).
async function* readRecords<K extends RecordKind>(
  dir: string,
  kind: K,
  digest: { seen?: (sha256: string) => void; expect?: string } = {},
): AsyncGenerator<{ line: number; record: RecordsByKind[K] }> {
  const { file, schema } = RECORD_FILES[kind];
  const path = join(dir, file);
  const stream = (await openFile(path, "schema", file)).createReadStream({ autoClose: true });
  const hash = createHash("sha256");
  stream.on("data", (chunk) => hash.update(chunk));
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
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
  const sha256 = hash.digest("hex");
  digest.seen?.(sha256);
  if (digest.expect !== undefined && sha256 !== digest.expect) {
    throw new BundleError("changed", `${file} changed after readBundle verified it`);
  }
}

async function* records<K extends RecordKind>(
  dir: string,
  kind: K,
  verified: string,
): AsyncGenerator<RecordsByKind[K]> {
  for await (const { record } of readRecords(dir, kind, { expect: verified })) yield record;
}

// A payload's bytes, re-checked: still a regular file among the verified ones,
// still hashing to its name.
async function readPayload(dir: string, verified: Set<string>, hash: string): Promise<Uint8Array> {
  if (!verified.has(hash)) {
    throw new BundleError("payload", `${PAYLOAD_DIR}/${hash} is not a payload of this bundle`);
  }
  const handle = await openFile(join(dir, PAYLOAD_DIR, hash), "changed", `${PAYLOAD_DIR}/${hash}`);
  try {
    const bytes = new Uint8Array(await handle.readFile());
    if (createHash("sha256").update(bytes).digest("hex") !== hash) {
      throw new BundleError("changed", `${PAYLOAD_DIR}/${hash} changed after readBundle verified it`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

// DX4 — each payload file hashes to its name, the manifest counts them, and
// every artefact's payloadHash names one whose size matches its payloadBytes.
async function verifyPayloads(
  dir: string,
  manifest: Manifest,
  uses: Map<string, { artefactId: string; bytes: number }[]>,
): Promise<Set<string>> {
  const root = join(dir, PAYLOAD_DIR);
  await assertEntry(root, "directory", "payload", `${PAYLOAD_DIR}/`);
  const names = await readdir(root);
  const sizes = new Map<string, number>();
  for (const name of names.sort()) {
    const path = join(root, name);
    const { hash, bytes } = await hashFile(await openFile(path, "payload", `${PAYLOAD_DIR}/${name}`));
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
  return new Set(sizes.keys());
}

// Every entry the reader opens must be what it claims, inside the bundle: a
// regular file or a real directory, never a symlink (which could point at the
// right bytes elsewhere and verify a bundle that doesn't carry them, DX4).
async function assertEntry(
  path: string,
  kind: "file" | "directory",
  check: BundleCheck,
  label: string,
): Promise<void> {
  const info = await lstat(path).catch(() => undefined);
  if (!info) throw new BundleError(check, `${label} is missing`);
  const ok = kind === "file" ? info.isFile() : info.isDirectory();
  if (!ok) {
    throw new BundleError(
      check,
      `${label} is not a ${kind === "file" ? "regular file" : "directory"}${info.isSymbolicLink() ? " (a symbolic link)" : ""}`,
    );
  }
}

// A bundle file, opened once and checked through that descriptor, so nothing
// can be swapped in between the check and the read: O_NOFOLLOW refuses a
// symlink, O_NONBLOCK keeps a FIFO from blocking the open, and the descriptor
// must be a regular file. The caller reads from — and closes — the handle.
async function openFile(path: string, check: BundleCheck, label: string): Promise<FileHandle> {
  let handle: FileHandle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new BundleError(check, `${label} is missing`);
    if (code === "ELOOP") throw new BundleError(check, `${label} is not a regular file (a symbolic link)`);
    throw new BundleError(check, `${label} is unreadable (${String(e)})`);
  }
  const isFile = await handle.stat().then(
    (info) => info.isFile(),
    () => false,
  );
  if (!isFile) {
    await handle.close();
    throw new BundleError(check, `${label} is not a regular file`);
  }
  return handle;
}

async function hashFile(handle: FileHandle): Promise<{ hash: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of handle.createReadStream({ autoClose: true })) {
    hash.update(chunk as Buffer);
    bytes += (chunk as Buffer).byteLength;
  }
  return { hash: hash.digest("hex"), bytes };
}

function issues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "(record)"}: ${i.message}`).join("; ");
}
