# Bounded Context: Deployment Export

An operator command that writes a whole deployment's state as one self-describing, versioned
**export bundle**: Accounts (identity only), every artefact with its payload, access lists,
collections and their tree, data entries, views and bookmarks — with slugs, visibility and link
gates intact, so a moved deployment keeps its `/a/<slug>` links resolving.

It is a self-host backup/move format in its own right, and the **contract** the EE importer
(the Tenant migration context's bundle import) consumes: the reader in `src/infra/export/` is
the format's single definition, and an importer uses it instead of re-implementing the format.

This context owns no aggregate. It **reads** the aggregates of the other contexts (Identity &
Access, Artefact Hosting, Artefact Collections, Artefact Data, Artefact Views, Bookmarks) without
changing them, and exposes nothing on a request path — it is an operator CLI only, so the access
matrix is not involved. Implemented in `src/infra/export/` (slice S39 — Deployment export bundle,
`fdd/slices/platform.md`).

## Sensitivity

A bundle is **sensitive operator material**. It carries private artefacts, every user's saved
data, email addresses and the scrypt hashes of link-gate passwords. It never carries an Account
credential (`export.account.no-credentials`), but it must be stored and moved like a database
backup: never published, never left on a shared volume.

## Invariants

r[export.bundle.owner-only]
The writer creates the bundle **owner-only** whatever the ambient umask — directories `0700`
(including any missing ancestors of `<out>` it creates), files `0600` — including a failed run's
`<out>.partial`.

r[export.snapshot.read-only]
**Read-only.** An export never writes to the source database or payload store; it runs against a
live deployment without changing any aggregate. The CLI opens the database read-only.

r[export.account.no-credentials+2]
**No Account credentials.** The bundle carries Accounts as `id`, `email`, `name`, `emailVerified`,
`image`, `createdAt` only — never password hashes (`account`), sessions, verification tokens,
OAuth clients, access or refresh tokens, consents, or the OAuth signing keys (`jwks`). A public
artefact's **link-gate** password hash (`hosting.link-gate.public-only`) *does* travel: it is the
artefact's gate, not an Account credential, so a gated link stays gated after a move.

r[export.snapshot.one-transaction]
**One snapshot.** Every record is read inside **one** read transaction, so the bundle never pairs
rows from different moments (no access row for a missing artefact, no data entry whose artefact
is absent). A write committed after the snapshot opened is not in the bundle.

r[export.payload.writer-verifies]
Each payload is stored under its sha256 and must hash to the `payloadHash` of every artefact
naming it. The export fails rather than write a bundle with a missing or mismatched payload — it
writes into `<out>.partial` and renames it to `<out>` only on success, so a failed run never
leaves a complete-looking bundle.

r[export.output.never-reused]
The writer never deletes or reuses an existing directory: a non-empty `<out>`, or any existing
`<out>.partial` (a failed run's leftover, which the operator inspects and removes), refuses the
export before it writes.

## Published language

The bundle format and `readBundle` are the published contract: an importer outside this codebase
(the EE Tenant migration context's) depends on them.

### Format — `artefactor-export` 1.3

A bundle is a **directory** (operators `tar` it themselves; no compression, encryption or signing
is part of the format):

| Path | Content |
| --- | --- |
| `manifest.json` | `{ format: "artefactor-export", version: "1.3", exportedAt, source: { build }, counts }` |
| `accounts.jsonl` | `id, email, name, emailVerified, image, createdAt` |
| `artefacts.jsonl` | `id, ownerId, title, kind, visibility, publicSlug, collectionId, status, payloadHash, payloadBytes, usesStorage, dataVisibility, linkGate, createdAt, updatedAt, archivedAt` |
| `artefact-access.jsonl` | `artefactId, userId, grantedAt` |
| `collections.jsonl` | `id, ownerId, name, description, parentId, rootId, visibility, publicSlug, status, linkGate, createdAt, updatedAt, archivedAt` |
| `collection-access.jsonl` | `collectionId, userId, grantedAt` |
| `data-entries.jsonl` | `id, artefactId, authorId, blob, authoredAgainstVersion, createdAt, updatedAt` |
| `views.jsonl` | `id, artefactId, viewerId, viewedAt` |
| `artefact-bookmarks.jsonl` | `userId, artefactId, createdAt` |
| `collection-bookmarks.jsonl` | `userId, collectionId, createdAt` |
| `payloads/<sha256>` | each distinct HTML payload once, bytes as stored |

- `counts` has one entry per record file — `accounts, artefacts, artefactAccess, collections,
  collectionAccess, dataEntries, views, artefactBookmarks, collectionBookmarks` — plus
  `payloads`, the number of distinct payload files.
- `linkGate` is `{ passwordHash, expiresAt, version } | null` — `null` when the artefact has no
  password and no expiry (an ungated artefact, including one whose gate was cleared); otherwise
  the stored scrypt hash (or `null`), the expiry (or `null`) and the gate version.

### Reading a bundle

`readBundle(dir)` hands back the manifest, one async iterator per record type, and
`readPayload(hash)`. Those read the bundle again, so they re-prove it is the bundle that was
verified.

### Versioning

The format version is independent of the app's version. Each minor version's additions are a
marker of their own below (`export.collection.link-gate`, `export.collection.public-slug`).

### Invariants of the published language

r[export.bundle.lossless]
**Lossless.** Every record `readBundle` returns equals the source row it was exported from, field
for field, in the format's representation: no record is dropped, and no field the format carries
is altered.

r[export.format.json-lines]
Every record file is **JSON Lines**: one JSON object per line, each line, the last included, ending
in a newline. A file with zero records is empty.

r[export.format.utc-millis]
Every timestamp, in a record and in `manifest.exportedAt`, is an ISO-8601 string in UTC with
millisecond precision.

r[export.format.null-not-omitted]
An absent value is written as `null`, never as an omitted key: every record carries every field
of its file.

r[export.format.blob-untouched]
A data entry's `blob` is its opaque string exactly as stored — never parsed, re-serialised or
normalised (the backend never interprets it).

r[export.format.excludes-derived]
**Not exported:** thumbnails (derived; the target re-renders them), the payload's storage ref
(the bundle addresses payloads by hash), `tenantId` (a target assigns its own), and every
credential (`export.account.no-credentials`).

r[export.format.archived-included]
Archived artefacts and collections are exported like active ones, with their `status` and
`archivedAt`.

r[export.format.self-contained]
**Self-contained.** Every file of a bundle — the manifest, a record file, a payload — is a regular
file inside it: one that is a symbolic link, even to the right bytes, makes the bundle invalid.

r[export.format.stable-order]
**Stable order**, so two exports of an unchanged deployment are byte-identical apart from
`manifest.exportedAt`: collections parents-before-children (by depth, then id); every other file
by id, or by its key columns for keyless rows (access lists and bookmarks).

r[export.format.versioned+2]
**Versioned format.** `manifest.json` names `format: "artefactor-export"` and a `major.minor`
version. A **minor** bump only adds optional fields or record files, which an earlier reader of
the same major ignores; anything an earlier reader would misread — a renamed, removed or re-typed
field — bumps the **major**. A reader rejects an unknown major and ignores unknown fields and files
under a known one.

r[export.payload.reader-verifies]
The reader rejects a bundle whose payload bytes don't hash to their name.

r[export.reader.validates-bundle]
`readBundle(dir)` validates the whole bundle before it returns, and rejects it (naming the failing
check) on: a missing or malformed manifest, a foreign `format`, an unknown major version
(`export.format.versioned`); a missing record file or a record failing its schema; a count that
disagrees with the manifest; a dangling reference — every `ownerId`/`userId`/`authorId`/`viewerId`
must be an exported Account, and every `artefactId`/`collectionId`/`parentId`/`rootId` an exported
record; an artefact whose `payloadHash` names no payload file; any bundle entry that is not what it
claims — the manifest, a record file or a payload that is not a regular file, or a `payloads/` that
is not a real directory (a symbolic link is never followed); or a payload whose bytes don't hash to
its name or whose size disagrees with an artefact's `payloadBytes`
(`export.payload.reader-verifies`). It then hands back the manifest, one async iterator per record
type, and `readPayload(hash)`.

r[export.reader.records-re-proved]
`readBundle` records each record file's sha256; its iterator re-hashes the file as it streams
and, once the file ends, throws (check `changed`) if the file differs.

r[export.reader.payload-re-proved]
`readPayload` re-checks that the payload is still a regular file hashing to its name.

r[export.reader.opens-once]
Every file is opened once — never following a symlink, never blocking on a FIFO — checked through
that open descriptor and read from it, so nothing can be swapped in between the check and the
read.

r[export.reader.import-all-or-nothing]
A record iterator yields records before its file's end and throws from inside the iteration, before
it reports done, so an importer that consumes each iterator to its end inside **one transaction**
and treats any throw as an abort writes no row from a bundle that fails mid-way — a bundle edited
between verification and import imports nothing.

r[export.collection.link-gate]
**1.1 — collection link gates.** Each `collections.jsonl` record carries `linkGate`, with the
artefact record's shape and rule (`null` for an ungated collection, else the stored scrypt hash or
`null`, the expiry or `null`, and the version), so a password-protected public tree stays
protected after a move (`collections.link-gate.root-governs-tree`). The reader treats the field as
optional, so a 1.0 bundle — written before it existed — still reads, its collections ungated.

r[export.collection.public-slug]
**1.2 — collection public slugs.** Each `collections.jsonl` record carries `publicSlug`, the
root's retained slug (`collections.public-link.root-slug-minted`) or `null` for a collection that
has none, so a public tree keeps its address after a move. The reader treats the field as optional,
so a 1.0 or 1.1 bundle — written before it existed — still reads, its collections slugless.

r[export.collection.description]
**1.3 — collection descriptions.** Each `collections.jsonl` record carries `description`, the
collection's description (`collections.collection.description`) or `null`, never omitted. The
reader treats the field as optional, so a 1.0–1.2 bundle reads with its collections' descriptions
`null`.

## Decided

- **Operator CLI only** (`pnpm export:bundle`, or `node dist/server/export.js` in the image). No
  HTTP route or admin UI. `--verify` reads only the bundle, so it needs none of the server's
  configuration (no auth secret, no sign-in method).
- **A directory, not an archive.** Compression, encryption and signing are the operator's.
- **No importer here.** The EE Tenant migration context imports into the cloud; an OSS → OSS
  restore can be added later without a format change.
- **Exports from SQLite + the filesystem payload store only**; exporting from the cloud's
  Postgres adapter is out of scope.
