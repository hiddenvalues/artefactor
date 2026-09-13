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

// OAuth provider tables (S18 — MCP connector). Owned by BetterAuth's `mcp`
// plugin (which embeds the `oidcProvider` schema). Field *names* (the JS keys)
// must match the plugin's model fields; column names follow our snake_case
// convention. DO NOT hand-edit shapes — they mirror
// node_modules/better-auth/.../plugins/oidc-provider/schema.mjs. A registered
// OAuth client (`oauthApplication`) is created via dynamic client registration;
// each issued bearer is an `oauthAccessToken` bound to a `user`.
export const oauthApplication = sqliteTable(
  "oauth_application",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    icon: text("icon"),
    metadata: text("metadata"),
    clientId: text("client_id").notNull().unique(),
    clientSecret: text("client_secret"),
    redirectUrls: text("redirect_urls").notNull(),
    type: text("type").notNull(),
    disabled: integer("disabled", { mode: "boolean" }).default(false),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (t) => [index("oauth_application_user_idx").on(t.userId)],
);

export const oauthAccessToken = sqliteTable(
  "oauth_access_token",
  {
    id: text("id").primaryKey(),
    accessToken: text("access_token").notNull().unique(),
    refreshToken: text("refresh_token").notNull().unique(),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }).notNull(),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }).notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthApplication.clientId, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    scopes: text("scopes").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (t) => [
    index("oauth_access_token_client_idx").on(t.clientId),
    index("oauth_access_token_user_idx").on(t.userId),
  ],
);

export const oauthConsent = sqliteTable(
  "oauth_consent",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthApplication.clientId, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    scopes: text("scopes").notNull(),
    consentGiven: integer("consent_given", { mode: "boolean" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (t) => [
    index("oauth_consent_client_idx").on(t.clientId),
    index("oauth_consent_user_idx").on(t.userId),
  ],
);
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
    // S22/AH17 — owning tenant. OSS is single-tenant: every row is DEFAULT_TENANT
    // and it never discriminates. A superset stamps the creator's org + scopes by it.
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
    // AH20 (S25) — the collection the artefact lives in; NULL = top-level. While
    // set, the tree root's access governs (effective access); ON DELETE CASCADE
    // is the CL8 backstop (the delete command erases artefacts explicitly first).
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
    // AH16 (S20): does the payload appear to use localStorage? Drives the S12
    // chrome only. Defaults true so legacy rows are unaffected (the "≥1 other
    // author" rule hides the picker for them anyway — no backfill needed).
    usesStorage: integer("uses_storage", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    uniqueIndex("artefact_public_slug_uq").on(t.publicSlug),
    index("artefact_owner_idx").on(t.ownerId),
    index("artefact_status_visibility_idx").on(t.status, t.visibility),
    index("artefact_collection_idx").on(t.collectionId),
  ],
);

// Artefact Collections context (S25, ddd/artefact-collections.md). A nestable
// folder node; the tree root's (visibility + access list) governs the effective
// access of everything inside (CL4/CL5). parent_id and root_id are immutable
// (no re-parenting, CL3) — root_id is denormalized so effective access resolves
// without recursion. Self-FKs cascade as the CL8 backstop (the delete command
// removes children before parents anyway).
export const collection = sqliteTable(
  "collection",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id),
    // As on artefact (S22/AH17) — OSS: DEFAULT_TENANT, never discriminates.
    tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT),
    name: text("name").notNull(),
    parentId: text("parent_id").references((): AnySQLiteColumn => collection.id, {
      onDelete: "cascade",
    }),
    rootId: text("root_id").notNull(),
    visibility: text("visibility", {
      enum: ["private", "selected", "authenticated", "public"],
    })
      .notNull()
      .default("private"),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("collection_owner_idx").on(t.ownerId),
    index("collection_parent_idx").on(t.parentId),
    // The tree-expansion lookup (listByRoots) behind effectively-shared reads.
    index("collection_root_idx").on(t.rootId),
  ],
);

// Artefact Collections — the `selected`-tier access list on a tree root (CL4),
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

// Bookmarks context (S27, BM1–BM4). Per-user pins with set semantics — the pair
// is the identity. Rows survive archive/restore (filtered at read, BM3) and go
// with their target via ON DELETE CASCADE (BM4 backstop).
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

// Artefact Hosting — the `selected`-tier access list (S16, AH13/14). One row per
// granted (artefact, user). Membership is consulted only while the artefact's
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
    // S19 (AD9) — payload hash at the last write. Nullable: pre-existing rows
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
// upsert (VT1). Removed with the artefact via ON DELETE CASCADE; the viewer FK
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
