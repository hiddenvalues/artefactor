import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  primaryKey,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { DEFAULT_TENANT } from "../../domain/artefact/artefact";

// ── Identity & Access (S1) ──────────────────────────────────────────────────
// These tables are owned by BetterAuth (https://www.better-auth.com). The
// definitions are emitted by `@better-auth/cli generate` against src/server/
// auth.ts — DO NOT hand-edit field shapes; regenerate and reconcile if the auth
// config changes (e.g. adding the api-key plugin in S8). The domain never writes
// them directly — it only references `user.id` as the stable `ownerId`/`authorId`
// (see docs/specs/ddd/identity-access.md).

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .default(false)
    .notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

// OAuth provider tables (S18/S63 — MCP connector). Owned by `@better-auth/mcp`
// (the `@better-auth/oauth-provider` schema) and the `jwt` plugin (`jwks`).
// Field *names* (the JS keys) must match the plugins' model fields; column
// names follow our snake_case convention. DO NOT hand-edit shapes — they mirror
// node_modules/@better-auth/oauth-provider/dist (`schema`) and
// node_modules/better-auth/dist/plugins/jwt/schema.mjs. SQLite has no arrays or
// JSON, so the adapter stores `string[]` and `json` fields as JSON text. A
// registered client (`oauthClient`) comes from dynamic client registration;
// access tokens for `/mcp` are JWTs signed with a `jwks` key, so
// `oauthAccessToken` holds only the opaque tokens issued without a resource.
export const oauthClient = sqliteTable(
  "oauth_client",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().unique(),
    clientSecret: text("client_secret"),
    clientDiscoveryId: text("client_discovery_id"),
    disabled: integer("disabled", { mode: "boolean" }).default(false),
    skipConsent: integer("skip_consent", { mode: "boolean" }),
    enableEndSession: integer("enable_end_session", { mode: "boolean" }),
    subjectType: text("subject_type"),
    scopes: text("scopes"),
    clientCredentialsScopes: text("client_credentials_scopes"),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts"),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("software_id"),
    softwareVersion: text("software_version"),
    softwareStatement: text("software_statement"),
    redirectUris: text("redirect_uris").notNull(),
    postLogoutRedirectUris: text("post_logout_redirect_uris"),
    backchannelLogoutUri: text("backchannel_logout_uri"),
    backchannelLogoutSessionRequired: integer(
      "backchannel_logout_session_required",
      { mode: "boolean" },
    ),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
    applicationType: text("application_type"),
    jwks: text("jwks"),
    jwksUri: text("jwks_uri"),
    grantTypes: text("grant_types"),
    responseTypes: text("response_types"),
    requirePKCE: integer("require_pkce", { mode: "boolean" }),
    dpopBoundAccessTokens: integer("dpop_bound_access_tokens", {
      mode: "boolean",
    }).default(false),
    referenceId: text("reference_id"),
    metadata: text("metadata"),
  },
  (t) => [index("oauth_client_user_idx").on(t.userId)],
);

export const oauthResource = sqliteTable("oauth_resource", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull().unique(),
  name: text("name").notNull(),
  accessTokenTtl: integer("access_token_ttl"),
  refreshTokenTtl: integer("refresh_token_ttl"),
  signingAlgorithm: text("signing_algorithm"),
  signingKeyId: text("signing_key_id"),
  allowedScopes: text("allowed_scopes"),
  customClaims: text("custom_claims"),
  dpopBoundAccessTokensRequired: integer("dpop_bound_access_tokens_required", {
    mode: "boolean",
  }).default(false),
  disabled: integer("disabled", { mode: "boolean" }).default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
  policyVersion: integer("policy_version").default(1),
  metadata: text("metadata"),
});

export const oauthClientResource = sqliteTable(
  "oauth_client_resource",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => oauthResource.identifier, { onDelete: "cascade" }),
    metadata: text("metadata"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("oauth_client_resource_client_idx").on(t.clientId),
    index("oauth_client_resource_resource_idx").on(t.resourceId),
    uniqueIndex("oauth_client_resource_pair_uidx").on(t.clientId, t.resourceId),
  ],
);

export const oauthRefreshToken = sqliteTable(
  "oauth_refresh_token",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => session.id, {
      onDelete: "set null",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources"),
    requestedUserInfoClaims: text("requested_user_info_claims"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
    revoked: integer("revoked", { mode: "timestamp_ms" }),
    rotatedAt: integer("rotated_at", { mode: "timestamp_ms" }),
    rotationReplayResponse: text("rotation_replay_response"),
    rotationReplayExpiresAt: integer("rotation_replay_expires_at", {
      mode: "timestamp_ms",
    }),
    authTime: integer("auth_time", { mode: "timestamp_ms" }),
    confirmation: text("confirmation"),
    scopes: text("scopes").notNull(),
  },
  (t) => [
    index("oauth_refresh_token_client_idx").on(t.clientId),
    index("oauth_refresh_token_session_idx").on(t.sessionId),
    index("oauth_refresh_token_user_idx").on(t.userId),
    index("oauth_refresh_token_code_idx").on(t.authorizationCodeId),
  ],
);

export const oauthAccessToken = sqliteTable(
  "oauth_access_token",
  {
    id: text("id").primaryKey(),
    token: text("token").unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => session.id, {
      onDelete: "set null",
    }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources"),
    requestedUserInfoClaims: text("requested_user_info_claims"),
    refreshId: text("refresh_id").references(() => oauthRefreshToken.id, {
      onDelete: "cascade",
    }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
    revoked: integer("revoked", { mode: "timestamp_ms" }),
    confirmation: text("confirmation"),
    scopes: text("scopes").notNull(),
  },
  (t) => [
    index("oauth_access_token_client_idx").on(t.clientId),
    index("oauth_access_token_session_idx").on(t.sessionId),
    index("oauth_access_token_user_idx").on(t.userId),
    index("oauth_access_token_code_idx").on(t.authorizationCodeId),
    index("oauth_access_token_refresh_idx").on(t.refreshId),
  ],
);

export const oauthConsent = sqliteTable(
  "oauth_consent",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    resources: text("resources"),
    requestedUserInfoClaims: text("requested_user_info_claims"),
    scopes: text("scopes").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("oauth_consent_client_idx").on(t.clientId),
    index("oauth_consent_user_idx").on(t.userId),
  ],
);

export const oauthClientAssertion = sqliteTable("oauth_client_assertion", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});

// The `jwt` plugin's signing keys. `privateKey` is a secret; it never leaves
// in an export (`export.account.no-credentials`).
export const jwks = sqliteTable("jwks", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  alg: text("alg"),
  crv: text("crv"),
});
// ────────────────────────────────────────────────────────────────────────────

// Artefact Hosting context. The 100 MB HTML payload itself lives on the
// filesystem (see infra/storage); the row holds only a reference + size + hash.
export const artefact = sqliteTable(
  "artefact",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id),
    // S22, hosting.tenant.invisible-to-oss — owning tenant. OSS is single-tenant: every row is
    // DEFAULT_TENANT and it never discriminates. A superset stamps the creator's org + scopes by
    // it.
    tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT),
    title: text("title").notNull(),
    kind: text("kind", {
      enum: ["prototype", "slide-deck", "form", "interactive-doc", "other"],
    }).notNull(),
    visibility: text("visibility", {
      enum: ["private", "selected", "authenticated", "public"],
    })
      .notNull()
      .default("private"),
    publicSlug: text("public_slug"),
    // hosting.access.effective-from-tree-root (S25) — the collection the artefact lives in; NULL =
    // top-level. While set, the tree root's access governs (effective access); ON DELETE CASCADE is
    // the collections.lifecycle.delete-cascades backstop (the delete command erases artefacts explicitly first).
    collectionId: text("collection_id").references(
      (): AnySQLiteColumn => collection.id,
      { onDelete: "cascade" },
    ),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    payloadRef: text("payload_ref").notNull(),
    payloadBytes: integer("payload_bytes").notNull(),
    payloadHash: text("payload_hash").notNull(),
    // hosting.uses-storage.chrome-only (S20): does the payload appear to use localStorage? Drives
    // the S12 chrome only. Defaults true so legacy rows are unaffected (the "≥1 other author" rule
    // hides the picker for them anyway — no backfill needed).
    usesStorage: integer("uses_storage", { mode: "boolean" })
      .notNull()
      .default(true),
    // S35 (hosting.thumbnail.recorded-by-compare-and-set): the payload_hash the recorded thumbnail was rendered from; NULL
    // until the first render. Written only by the recordThumbnail compare-and-set.
    thumbnailHash: text("thumbnail_hash"),
    // hosting.data-visibility.owner-set (S41): whether a non-owner may load other authors' saved
    // data (data.visibility.narrows-reads). New artefacts are created `own`; the default keeps pre-S41 rows `shared`, so no
    // live behaviour changes.
    // r[impl hosting.data-visibility.legacy-rows-shared]
    dataVisibility: text("data_visibility", { enum: ["shared", "own"] })
      .notNull()
      .default("shared"),
    // hosting.link-gate.public-only (S32a): the link gate on a public artefact — scrypt hash of the
    // owner-set password (never mapped into any summary), the expiry, and the
    // version every pass carries. NULL / NULL / 0 = no gate, as for legacy rows.
    linkPasswordHash: text("link_password_hash"),
    linkExpiresAt: integer("link_expires_at", { mode: "timestamp_ms" }),
    // r[impl hosting.link-gate.migrated-rows-ungated]
    linkGateVersion: integer("link_gate_version").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
    // S60 (hosting.save.no-lost-update) — the save's compare-and-set token. Rows that predate the
    // column start at 1, as if saved once.
    revision: integer("revision").notNull().default(1),
  },
  (t) => [
    uniqueIndex("artefact_public_slug_uq").on(t.publicSlug),
    // r[impl hosting.payload.ref-unique-in-database]
    uniqueIndex("artefact_payload_ref_uq").on(t.payloadRef),
    index("artefact_owner_idx").on(t.ownerId),
    index("artefact_status_visibility_idx").on(t.status, t.visibility),
    index("artefact_collection_idx").on(t.collectionId),
  ],
);

// Artefact Collections context (S25, ddd/artefact-collections.md). A nestable
// folder node; the tree root's (visibility + access list) governs the effective
// access of everything inside (collections.access.root-governs-tree, collections.access.contained-own-tier-dormant). parent_id and root_id are immutable
// (no re-parenting, collections.tree.shape-fixed) — root_id is denormalized so effective access resolves
// without recursion. Self-FKs cascade as the collections.lifecycle.delete-cascades backstop (the delete command
// removes children before parents anyway).
export const collection = sqliteTable(
  "collection",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id),
    // As on artefact (S22, hosting.tenant.invisible-to-oss) — OSS: DEFAULT_TENANT, never
    // discriminates.
    tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT),
    name: text("name").notNull(),
    // S74: the optional blurb (collections.collection.description); NULL = none.
    description: text("description"),
    parentId: text("parent_id").references((): AnySQLiteColumn => collection.id, {
      onDelete: "cascade",
    }),
    rootId: text("root_id").notNull(),
    visibility: text("visibility", {
      enum: ["private", "selected", "authenticated", "public"],
    })
      .notNull()
      .default("private"),
    // S44: a root's retained slug — NULL until its first share, always NULL on
    // a non-root. Unique among collections (artefact slugs are their own space).
    publicSlug: text("public_slug"),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    // S32b: the link gate on a public root, which its whole tree follows — as
    // on artefact (S32a). NULL / NULL / 0 = no gate, as for legacy rows.
    linkPasswordHash: text("link_password_hash"),
    linkExpiresAt: integer("link_expires_at", { mode: "timestamp_ms" }),
    // r[impl hosting.link-gate.migrated-roots-ungated]
    linkGateVersion: integer("link_gate_version").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("collection_owner_idx").on(t.ownerId),
    index("collection_parent_idx").on(t.parentId),
    // The tree-expansion lookup (listByRoots) behind effectively-shared reads.
    index("collection_root_idx").on(t.rootId),
    uniqueIndex("collection_public_slug_uq").on(t.publicSlug),
  ],
);

// Artefact Collections — the `selected`-tier access list on a tree root (collections.access.root-governs-tree),
// mirroring artefact_access exactly.
export const collectionAccess = sqliteTable(
  "collection_access",
  {
    collectionId: text("collection_id")
      .notNull()
      .references(() => collection.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    grantedAt: integer("granted_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.collectionId, t.userId] }),
    index("collection_access_user_idx").on(t.userId),
  ],
);

// Bookmarks context (S27). Per-user pins with set semantics — the pair
// is the identity. Rows survive archive/restore (filtered at read, collections.bookmark.hidden-not-pruned) and go
// with their target via ON DELETE CASCADE (collections.bookmark.removed-with-target backstop).
export const artefactBookmark = sqliteTable(
  "artefact_bookmark",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    artefactId: text("artefact_id")
      .notNull()
      .references(() => artefact.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.artefactId] }),
    index("artefact_bookmark_artefact_idx").on(t.artefactId),
  ],
);

export const collectionBookmark = sqliteTable(
  "collection_bookmark",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    collectionId: text("collection_id")
      .notNull()
      .references(() => collection.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.collectionId] }),
    index("collection_bookmark_collection_idx").on(t.collectionId),
  ],
);

// Artefact Hosting — the `selected`-tier access list (S16,
// hosting.access-list.retained, hosting.access-list.owner-managed-set). One row
// per granted (artefact, user). Membership is consulted only while the artefact's
// visibility is `selected`, but rows are retained across tier changes. Removed
// with the artefact via ON DELETE CASCADE; user FK keeps grants referentially
// sound. Indexed on user_id for the "shared with me" lookup in listShared.
export const artefactAccess = sqliteTable(
  "artefact_access",
  {
    artefactId: text("artefact_id")
      .notNull()
      .references(() => artefact.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    grantedAt: integer("granted_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.artefactId, t.userId] }),
    index("artefact_access_user_idx").on(t.userId),
  ],
);

// Artefact Data context. One opaque JSON blob per (artefact, author), upsert.
export const dataEntry = sqliteTable(
  "data_entry",
  {
    id: text("id").primaryKey(),
    artefactId: text("artefact_id")
      .notNull()
      .references(() => artefact.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    blob: text("blob").notNull(),
    // r[impl data.pin.null-before-pin]
    // S19a — payload hash at the last write. Nullable: pre-existing rows
    // keep `null` (no backfill — we can't know which payload they were written
    // against).
    authoredAgainstVersion: text("authored_against_version"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("data_entry_artefact_author_uq").on(t.artefactId, t.authorId),
  ],
);

// Artefact Views context (S21). One row per (artefact, viewer) recording the
// most recent time a signed-in viewer opened the artefact — latest view only,
// upsert (views.entry.one-per-pair). Removed with the artefact via ON DELETE CASCADE; the viewer FK
// keeps it referentially sound. Indexed on artefact_id for the "viewed by" list.
export const viewEntry = sqliteTable(
  "view_entry",
  {
    id: text("id").primaryKey(),
    artefactId: text("artefact_id")
      .notNull()
      .references(() => artefact.id, { onDelete: "cascade" }),
    viewerId: text("viewer_id")
      .notNull()
      .references(() => user.id),
    viewedAt: integer("viewed_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("view_entry_artefact_viewer_uq").on(t.artefactId, t.viewerId),
    index("view_entry_artefact_idx").on(t.artefactId),
  ],
);

// NOTE: owner_id / author_id are foreign keys to the BetterAuth `user` table
// above — the authenticated user id is the domain's stable `ownerId`/`authorId`.
