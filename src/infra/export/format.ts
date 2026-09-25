import { z } from "zod";
import { ARTEFACT_KINDS } from "../../domain/artefact/kind";
import { DATA_VISIBILITIES, STATUSES, VISIBILITIES } from "../../domain/artefact/visibility";

// S39 — the `artefactor-export` bundle format (ddd/deployment-export.md). These
// schemas are the format's single definition: the writer emits records of these
// shapes, and `readBundle` — which the EE importer (EM1) consumes — validates
// against them. Objects are non-strict, so a later minor version's extra fields
// are accepted and dropped (DX5).

export const FORMAT = "artefactor-export";
export const VERSION = "1.0";
export const SUPPORTED_MAJOR = 1;

// A failed export or a rejected bundle. `check` names what failed, so the CLI
// (and an importer) can say which rule the bundle broke.
export type BundleCheck =
  | "out"
  | "manifest"
  | "version"
  | "schema"
  | "count"
  | "duplicate"
  | "reference"
  | "payload";

export class BundleError extends Error {
  constructor(
    readonly check: BundleCheck,
    message: string,
  ) {
    super(message);
    this.name = "BundleError";
  }
}

const timestamp = z.iso.datetime();
const id = z.string().min(1);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/, "a lowercase hex sha256");

export const accountRecord = z.object({
  id,
  email: z.string(),
  name: z.string(),
  emailVerified: z.boolean(),
  image: z.string().nullable(),
  createdAt: timestamp,
});

export const linkGateRecord = z.object({
  passwordHash: z.string().nullable(),
  expiresAt: timestamp.nullable(),
  version: z.number().int().nonnegative(),
});

export const artefactRecord = z.object({
  id,
  ownerId: id,
  title: z.string(),
  kind: z.enum(ARTEFACT_KINDS),
  visibility: z.enum(VISIBILITIES),
  publicSlug: z.string().nullable(),
  collectionId: id.nullable(),
  status: z.enum(STATUSES),
  payloadHash: sha256,
  payloadBytes: z.number().int().nonnegative(),
  usesStorage: z.boolean(),
  dataVisibility: z.enum(DATA_VISIBILITIES),
  linkGate: linkGateRecord.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
  archivedAt: timestamp.nullable(),
});

export const artefactAccessRecord = z.object({
  artefactId: id,
  userId: id,
  grantedAt: timestamp,
});

export const collectionRecord = z.object({
  id,
  ownerId: id,
  name: z.string(),
  parentId: id.nullable(),
  rootId: id,
  visibility: z.enum(VISIBILITIES),
  status: z.enum(STATUSES),
  createdAt: timestamp,
  updatedAt: timestamp,
  archivedAt: timestamp.nullable(),
});

export const collectionAccessRecord = z.object({
  collectionId: id,
  userId: id,
  grantedAt: timestamp,
});

export const dataEntryRecord = z.object({
  id,
  artefactId: id,
  authorId: id,
  // The opaque blob, untouched — the backend never interprets it.
  blob: z.string(),
  authoredAgainstVersion: z.string().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const viewRecord = z.object({
  id,
  artefactId: id,
  viewerId: id,
  viewedAt: timestamp,
});

export const artefactBookmarkRecord = z.object({
  userId: id,
  artefactId: id,
  createdAt: timestamp,
});

export const collectionBookmarkRecord = z.object({
  userId: id,
  collectionId: id,
  createdAt: timestamp,
});

export type AccountRecord = z.infer<typeof accountRecord>;
export type LinkGateRecord = z.infer<typeof linkGateRecord>;
export type ArtefactRecord = z.infer<typeof artefactRecord>;
export type ArtefactAccessRecord = z.infer<typeof artefactAccessRecord>;
export type CollectionRecord = z.infer<typeof collectionRecord>;
export type CollectionAccessRecord = z.infer<typeof collectionAccessRecord>;
export type DataEntryRecord = z.infer<typeof dataEntryRecord>;
export type ViewRecord = z.infer<typeof viewRecord>;
export type ArtefactBookmarkRecord = z.infer<typeof artefactBookmarkRecord>;
export type CollectionBookmarkRecord = z.infer<typeof collectionBookmarkRecord>;

// Every record file of format 1.x: its manifest count key, file name and schema.
// Written, counted and validated in this order.
export const RECORD_FILES = {
  accounts: { file: "accounts.jsonl", schema: accountRecord },
  artefacts: { file: "artefacts.jsonl", schema: artefactRecord },
  artefactAccess: { file: "artefact-access.jsonl", schema: artefactAccessRecord },
  collections: { file: "collections.jsonl", schema: collectionRecord },
  collectionAccess: { file: "collection-access.jsonl", schema: collectionAccessRecord },
  dataEntries: { file: "data-entries.jsonl", schema: dataEntryRecord },
  views: { file: "views.jsonl", schema: viewRecord },
  artefactBookmarks: { file: "artefact-bookmarks.jsonl", schema: artefactBookmarkRecord },
  collectionBookmarks: { file: "collection-bookmarks.jsonl", schema: collectionBookmarkRecord },
} as const;

export type RecordKind = keyof typeof RECORD_FILES;
export const RECORD_KINDS = Object.keys(RECORD_FILES) as RecordKind[];

export interface RecordsByKind {
  accounts: AccountRecord;
  artefacts: ArtefactRecord;
  artefactAccess: ArtefactAccessRecord;
  collections: CollectionRecord;
  collectionAccess: CollectionAccessRecord;
  dataEntries: DataEntryRecord;
  views: ViewRecord;
  artefactBookmarks: ArtefactBookmarkRecord;
  collectionBookmarks: CollectionBookmarkRecord;
}

export const MANIFEST_FILE = "manifest.json";
export const PAYLOAD_DIR = "payloads";

const count = z.number().int().nonnegative();

export const manifestSchema = z.object({
  format: z.literal(FORMAT),
  version: z.string().regex(/^\d+\.\d+$/, "a major.minor version"),
  exportedAt: timestamp,
  source: z.object({ build: z.string() }),
  counts: z.object({
    accounts: count,
    artefacts: count,
    artefactAccess: count,
    collections: count,
    collectionAccess: count,
    dataEntries: count,
    views: count,
    artefactBookmarks: count,
    collectionBookmarks: count,
    payloads: count,
  }),
});

export type Manifest = z.infer<typeof manifestSchema>;
export type ManifestCounts = Manifest["counts"];
