# Legacy requirement ids

The frozen map from each context's old positional ids (`AH8`, `IA7`, …) to the dotted requirement
ids that replaced them (`docs/specs/README.md` *Requirements*). A migration CR appends one row per
old id to its context's section and never edits another; a row, once written, never changes.
This file and its EE twin (`ee/docs/specs/legacy-ids.md`) are the only places an old id may appear
(`src/specs/trace/`).

## platform

| Old | New | Summary |
| --- | --- | --- |

## export

| Old | New | Summary |
| --- | --- | --- |
| DX1 | `export.snapshot.read-only` | Read-only: an export never writes to the source |
| DX2 | `export.account.no-credentials` | No Account credentials; the link-gate hash travels |
| DX3 | `export.snapshot.one-transaction` | One snapshot: every record from one read transaction |
| DX4 | `export.payload.writer-verifies` | Verifiable; split with `export.payload.reader-verifies`, `export.output.never-reused` |
| DX5 | `export.format.versioned` | Versioned format: reject an unknown major, ignore unknowns |

## identity

| Old | New | Summary |
| --- | --- | --- |
| IA1 | `identity.access.private-owner-only` | A private artefact is readable/mutable only by its owner |
| IA2 | `identity.mcp.token-one-account` | An OAuth access token maps to one Account; MCP acts as it |
| IA3 | `identity.mcp.bearer-required` | No valid bearer, no MCP: 401 with the resource descriptor |
| IA4 | `identity.signup.domain-allowlist` | Allowlisted domain to create; amended: `identity.signup.gate`, `identity.signup.gate-default` |
| IA5 | `identity.signup.allow-all` | Allowlist accepts allow-all; split with `identity.org.delegated` |
| IA6 | `identity.origin.app-origin-only` | Cookie state changes only from the app origin; split with `identity.origin.exemptions` |
| IA7 | `identity.signin.production-needs-a-method` | Production has a sign-in method; split with `identity.signin.methods-configured` |
| IA8 | `identity.client-ip.trusted-walk` | Trusted-proxy client address; split with `identity.client-ip.resolved-once`, `.trusted-set`, `.better-auth-header`, `.unlock-limit` |
| IA9 | `identity.log.request-log-no-values` | No URL credential in the app log; split with `identity.log.auth-log-no-values` |

## hosting

| Old | New | Summary |
| --- | --- | --- |
| AH1 | `hosting.artefact.owner-required` | An owner is always present, immutable, and a valid Account |
| AH2 | `hosting.payload.size-bounds` | The payload is non-empty and at most 100 MB |
| AH3 | `hosting.artefact.title-required` | The title is non-empty |
| AH4 | `hosting.slug.shared-has-slug` | A shared tier always carries a slug |
| AH5 | `hosting.slug.minted-once-retained` | A slug is minted on first share, then immutable and retained |
| AH6 | `hosting.slug.globally-unique` | Slugs are globally unique |
| AH7 | `hosting.lifecycle.archived-not-served` | Archived is inert; split with `.archived-hidden-from-listings`, `.archived-frozen`, `.archived-data-inert` |
| AH8 | `hosting.access.matrix` | Access by visibility: the access matrix for active artefacts |
| AH9 | `hosting.authority.owner-only` | Only the owner edits, shares, archives or restores, at any tier |
| AH10 | `hosting.ingestion.parity` | API push and manual upload satisfy the same invariants |
| AH11 | `hosting.delete.archived-only` | Permanent delete is archived-only and owner-only; split with `hosting.delete.removes-everything` |
| AH12 | `hosting.slug.selected-shared-tier` | `selected` is a shared tier: it mints and retains a slug |
| AH13 | `hosting.access-list.retained` | `sharedWith` is retained across every transition, consulted only under `selected` |
| AH14 | `hosting.access-list.owner-managed-set` | Only the owner manages `sharedWith`, a set that never holds the owner |
| AH15 | `hosting.retention.invisible-to-core` | Retained prior payloads live outside the aggregate, and permanent delete purges them |
| AH16 | `hosting.uses-storage.chrome-only` | `usesStorage` is a `localStorage` heuristic that only decides host chrome |
| AH17 | `hosting.tenant.invisible-to-oss` | Under the singleton tenant and scope, `tenantId` never discriminates |
| AH18 | `hosting.access.policy-decided` | Only the `authenticated` tier's meaning is policy-decided |
| AH19 | `hosting.payload.cap-policy-decided` | The payload cap's value comes from a policy, 100 MB in OSS |
| AH20 | `hosting.access.effective-from-tree-root` | A contained artefact's access is its tree root's; split with `hosting.access.dormant-tier-frozen`, `hosting.shared.lists-effectively-shared` |
| AH21 | `hosting.slug.minted-on-move-into-shared-tree` | A slug is minted on an effective share; split with `hosting.slug.minted-on-root-share` |
| AH22 | `hosting.link-gate.narrows-public-audience` | The link gate narrows only the public cell's extra audience |
| AH23 | `hosting.link-gate.expiry-reads-as-private` | Past its expiry a gated link reads as `private`; split with `hosting.link-gate.expiry-in-future` |
| AH24 | `hosting.link-gate.no-existence-leak` | No probe the matrix denies tells a gated artefact from a missing one |
| AH25 | `hosting.thumbnail.host-chrome-only` | The thumbnail is derived host chrome; split with `.placeholder-when-missing`, `.never-blocks-command`, `.off-without-renderer` |
| AH26 | `hosting.thumbnail.pristine` | A thumbnail is pristine and payload-bound; split with `.recorded-by-compare-and-set`, `.previous-kept-until-replaced`, `.title-edit-keeps` |
| AH27 | `hosting.thumbnail.read-follows-export-matrix` | Thumbnail reads follow the export access matrix |
| AH28 | `hosting.frame.sandboxed` | Served artefact HTML never runs in the app origin; split with `.sandbox-header`, `.no-cookies`, `.content-origin-separate`, `.content-host-split` |
| AH29 | `hosting.renderer.only-isolated-renders` | Untrusted payload HTML is rendered only by an isolated renderer; split with `.holds-no-secrets`, `.sandbox-on`, `.no-app-connection`, `.no-private-network`, `.stateless`, `.input-cap` |
| AH30 | `hosting.data-visibility.owner-set` | Only the owner sets `dataVisibility`, per artefact; split with `.new-default-own`, `.legacy-rows-shared` |
| AH31 | `hosting.link-gate.public-only` | A gate lives only on a public top-level artefact; split with `.cleared-leaving-public`, `.password-rules` |

## data

| Old | New | Summary |
| --- | --- | --- |
| AD1 | `data.entry.one-per-pair` | At most one entry per `(artefact, author)`; writes upsert |
| AD2 | `data.write.author-is-caller` | The author is the authenticated writer, who writes only their own entry |
| AD3 | `data.write.requires-auth` | Every write is authenticated; no anonymous writes |
| AD4 | `data.read.follows-artefact-access` | Which entries a viewer may load follows the artefact access matrix |
| AD5 | `data.write.own-context-only` | A viewer writes only in their own data context; another author's is read-only |
| AD6 | `data.lifecycle.archived-inert` | An archived artefact's data API answers 404 for reads and writes |
| AD7 | `data.entry.lifecycle-bound` | Entries have no existence independent of their artefact |
| AD8 | `data.blob.bounded-opaque-json` | The blob is valid JSON within 5 MB, opaque to the backend |
| AD9 | `data.pin.stamped-on-write` | Every write stamps the payload hash it was written against; split with `data.pin.null-before-pin` |
| AD10 | `data.shim.posts-never-fetches` | The served shim persists through the host shell; split with `data.shell.saves-only-own-frame`, `.channel-binds-document`, `data.frame-token.signed-claims`, `.minted-for-context`, `.redeem-rechecks-access`, `.absent-invalid-expired` |
| AD11 | `data.visibility.narrows-reads` | Owner-set data visibility narrows reads; split with `.listing-filtered`, `.author-read-refused`, `.mint-refused`, `.redeem-refused`, `.refusal-no-leak` |

## views

| Old | New | Summary |
| --- | --- | --- |
| VT1 | `views.entry.one-per-pair` | At most one view entry per `(artefact, viewer)`; recording upserts |
| VT2 | `views.record.authenticated-only` | Only signed-in views are recorded; anonymous opens never |
| VT3 | `views.record.on-shell-serve` | A view is recorded on serving the host shell past the access matrix; split with `views.record.on-owner-preview` |
| VT4 | `views.viewers.follows-artefact-access` | Signed-in viewers who may view the artefact read its viewer list; split with `views.viewers.excludes-caller` |
| VT5 | `views.lifecycle.removed-with-artefact` | Permanent delete removes the artefact's view entries |
| VT6 | `views.mine.own-visible-only` | A viewer reads only their own views, for artefacts they can open now |

## collections

| Old | New | Summary |
| --- | --- | --- |
| CL1 | `collections.tree.single-owner` | A collection tree never spans owners or tenants; artefact placement is Hosting's rule |
| CL2 | `collections.collection.name-required` | A collection's name is non-empty, trimmed |
| CL3 | `collections.tree.shape-fixed` | `parentId`/`rootId` are fixed at create; the parent exists and is active |
| CL4 | `collections.access.root-governs-tree` | The root's access governs the whole tree; split with `collections.access.set-on-root-only` |
| CL5 | `collections.access.contained-own-tier-dormant` | A contained artefact's own access lies dormant; resolved at read time |
| CL6 | `collections.slug.minted-on-effective-share` | A slug is minted when an artefact's effective visibility first leaves private |
| CL7 | `collections.lifecycle.archive-cascades` | Archive cascades down; split with `collections.lifecycle.restore-cascades`, `.archived-inert` |
| CL8 | `collections.lifecycle.delete-cascades` | Delete cascades over the subtree; split with `collections.lifecycle.delete-archived-only` |
| CL9 | `collections.authority.owner-only` | Only the owner creates, edits, lifecycles a collection or moves artefacts in/out |
| CL10 | `collections.access.no-existence-leak` | A collection the root doesn't grant is indistinguishable from a missing one |
| CL11 | `collections.read.follows-root` | Signed-in viewers the root grants read the whole tree, never the grantee list |
| CL12 | `collections.contributor.on-root-access-list` | Contributors are the root's listed viewers plus the owner; placement only |
| CL13 | `collections.containment.co-owned` | The collection owner may eject any contained artefact to top level |
| CL14 | `collections.lifecycle.cascades-evict-foreign` | Archive and delete cascades evict foreign artefacts first |
| BM1 | `collections.bookmark.set-semantics` | One bookmark per `(user, target)`; add and remove are idempotent |
| BM2 | `collections.bookmark.artefact-view-gated` | Add requires view, remove is ungated; split with `collections.bookmark.collection-view-gated` |
| BM3 | `collections.bookmark.hidden-not-pruned` | Archived or no-longer-viewable targets are hidden at read, not pruned |
| BM4 | `collections.bookmark.removed-with-target` | Permanent delete of a target removes its bookmark rows |

## feedback

| Old | New | Summary |
| --- | --- | --- |
| FB1 | `feedback.thread.bound-to-one-artefact` | Bound to one artefact; split with `feedback.thread.never-empty` |
| FB2 | `feedback.author.signed-in-only` | Signed-in authors only; anonymous viewers neither read nor write |
| FB3 | `feedback.access.follows-artefact` | Thread access follows the artefact's view access and link gate |
| FB4 | `feedback.comment.owner-moderates-never-edits` | Authority; split with `feedback.thread.resolve-owner-or-creator`, `.reply-keeps-resolved` |
| FB5 | `feedback.lifecycle.inert-when-archived` | Inert when archived, for the owner too; back on restore |
| FB6 | `feedback.lifecycle.removed-with-artefact` | Permanent delete removes an artefact's threads and comments |
| FB7 | `feedback.anchor.reserved-null` | Anchor reserved: a non-null anchor is rejected until S34b |

## mcp

| Old | New | Summary |
| --- | --- | --- |
