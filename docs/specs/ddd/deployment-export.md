# Bounded Context: Deployment Export

An operator command that writes a whole deployment's state as one self-describing, versioned
**export bundle**: Accounts (identity only), every artefact with its payload, access lists,
collections and their tree, data entries, views and bookmarks — with slugs, visibility and link
gates intact, so a moved deployment keeps its `/a/<slug>` links resolving.

It is a self-host backup/move format in its own right, and the **contract** the EE importer
(EM1 — Import an OSS export bundle as a cloud org) consumes: the reader in `src/infra/export/` is
the format's single definition, and an importer uses it instead of re-implementing the format.

This context owns no aggregate. It **reads** the aggregates of the other contexts (Identity &
Access, Artefact Hosting, Artefact Collections, Artefact Data, Artefact Views, Bookmarks) without
changing them, and exposes nothing on a request path — it is an operator CLI only, so the access
matrix is not involved. Implemented in `src/infra/export/` (slice S39 — Deployment export bundle,
`fdd/slices/platform.md`).

## Sensitivity

A bundle is **sensitive operator material**. It carries private artefacts, every user's saved
data, email addresses and the scrypt hashes of link-gate passwords. It never carries an Account
credential (DX2), but it must be stored and moved like a database backup: never published, never
left on a shared volume. The writer creates it **owner-only** whatever the ambient umask —
directories `0700` (including any missing ancestors of `<out>` it creates), files `0600` —
including a failed run's `<out>.partial`.

## Format — `artefactor-export` 1.0

A bundle is a **directory** (operators `tar` it themselves; no compression, encryption or signing
is part of the format):

| Path | Content |
| --- | --- |
| `manifest.json` | `{ format: "artefactor-export", version: "1.0", exportedAt, source: { build }, counts }` |
| `accounts.jsonl` | `id, email, name, emailVerified, image, createdAt` |
| `artefacts.jsonl` | `id, ownerId, title, kind, visibility, publicSlug, collectionId, status, payloadHash, payloadBytes, usesStorage, dataVisibility, linkGate, createdAt, updatedAt, archivedAt` |
| `artefact-access.jsonl` | `artefactId, userId, grantedAt` |
| `collections.jsonl` | `id, ownerId, name, parentId, rootId, visibility, status, createdAt, updatedAt, archivedAt` |
| `collection-access.jsonl` | `collectionId, userId, grantedAt` |
| `data-entries.jsonl` | `id, artefactId, authorId, blob, authoredAgainstVersion, createdAt, updatedAt` |
| `views.jsonl` | `id, artefactId, viewerId, viewedAt` |
| `artefact-bookmarks.jsonl` | `userId, artefactId, createdAt` |
| `collection-bookmarks.jsonl` | `userId, collectionId, createdAt` |
| `payloads/<sha256>` | each distinct HTML payload once, bytes as stored |

- `counts` has one entry per record file — `accounts, artefacts, artefactAccess, collections,
  collectionAccess, dataEntries, views, artefactBookmarks, collectionBookmarks` — plus
  `payloads`, the number of distinct payload files.
- **JSON Lines**: one record per line, each a JSON object; every file ends with a newline after
  its last record (an empty file for zero records). Timestamps are ISO-8601 strings (UTC,
  millisecond precision); an absent value is `null`, never an omitted key.
- `linkGate` is `{ passwordHash, expiresAt, version } | null` — `null` when the artefact has no
  password and no expiry (an ungated artefact, including one whose gate was cleared); otherwise
  the stored scrypt hash (or `null`), the expiry (or `null`) and the gate version.
- `blob` is the data entry's opaque string, untouched (AD — the backend never interprets it).
- **Not exported:** thumbnails (derived; the target re-renders them), the payload's storage ref
  (the bundle addresses payloads by hash), `tenantId` (a target assigns its own), and every
  credential (DX2).
- **Archived** artefacts and collections are included, with their `status` and `archivedAt`.
- **Self-contained.** Every entry is a regular file or a real directory inside the bundle; a
  symbolic link anywhere in it makes the bundle invalid.
- **Stable order**, so two exports of an unchanged deployment are byte-identical apart from
  `manifest.exportedAt`: collections parents-before-children (by depth, then id); every other
  file by id, or by its key columns for keyless rows (access lists and bookmarks).

## Invariants

1. **DX1 — Read-only.** An export never writes to the source database or payload store; it runs
   against a live deployment without changing any aggregate. The CLI opens the database
   read-only.
2. **DX2 — No Account credentials.** The bundle carries Accounts as `id`, `email`, `name`,
   `emailVerified`, `image`, `createdAt` only — never password hashes (`account`), sessions,
   verification tokens, or OAuth clients, tokens or consents. A public artefact's **link-gate**
   password hash (AH31) *does* travel: it is the artefact's gate, not an Account credential, so a
   gated link stays gated after a move.
3. **DX3 — One snapshot.** Every record is read inside **one** read transaction, so the bundle
   never pairs rows from different moments (no access row for a missing artefact, no data entry
   whose artefact is absent). A write committed after the snapshot opened is not in the bundle.
4. **DX4 — Verifiable.** Each payload is stored under its sha256 and must hash to the
   `payloadHash` of every artefact naming it. The export fails rather than write a bundle with a
   missing or mismatched payload — it writes into `<out>.partial` and renames it to `<out>` only
   on success, so a failed run never leaves a complete-looking bundle — and the reader rejects a
   bundle whose payload bytes don't hash to their name. The writer never deletes or reuses an
   existing directory: a non-empty `<out>`, or any existing `<out>.partial` (a failed run's
   leftover, which the operator inspects and removes), refuses the export before it writes.
5. **DX5 — Versioned format.** `manifest.json` names `format: "artefactor-export"` and a
   `major.minor` version. A **minor** bump only adds optional fields or record types; a reader
   rejects an unknown **major** and ignores unknown fields and files under a known one.

## Reading a bundle

`readBundle(dir)` validates the whole bundle before it returns, and rejects it (naming the
failing check) on: a missing or malformed manifest, a foreign `format`, an unknown major version
(DX5); a missing record file or a record failing its schema; a count that disagrees with the
manifest; a dangling reference — every `ownerId`/`userId`/`authorId`/`viewerId` must be an
exported Account, and every `artefactId`/`collectionId`/`parentId`/`rootId` an exported record;
an artefact whose `payloadHash` names no payload file; any bundle entry that is not what it claims
— the manifest, a record file or a payload that is not a regular file, or a `payloads/` that is not
a real directory (a symbolic link is never followed); or a payload whose bytes don't hash to its
name or whose size disagrees with an artefact's `payloadBytes` (DX4). It then hands back the
manifest and one async iterator per record type.

## Versioning

The format version is independent of the app's version. A change that only adds an optional field
or a new record file bumps the **minor** (a 1.0 reader still reads it, ignoring what it doesn't
know); anything a 1.0 reader would misread — a renamed, removed or re-typed field — bumps the
**major**. Pending: S32b's collection link-gate fields join `collections.jsonl` as an optional
`linkGate`, bumping the format to `1.1`.

## Decided

- **Operator CLI only** (`pnpm export:bundle`, or `node dist/server/export.js` in the image). No
  HTTP route or admin UI. `--verify` reads only the bundle, so it needs none of the server's
  configuration (no auth secret, no sign-in method).
- **A directory, not an archive.** Compression, encryption and signing are the operator's.
- **No importer here.** EM1 imports into the cloud; an OSS → OSS restore can be added later
  without a format change.
- **Exports from SQLite + the filesystem payload store only**; exporting from the cloud's
  Postgres adapter is out of scope.
