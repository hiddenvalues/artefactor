import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemPayloadStore } from "../storage/payload-store";
import * as schema from "../db/schema";

// S39 test fixture — a small, fully populated SQLite deployment (two Accounts,
// every visibility tier, a gated public artefact, an archived one, a two-level
// collection tree with a root access list, data from two authors, views, both
// bookmark kinds) plus a value in every credential table. `expected` is what
// the export bundle must hold for it, record for record.

const T = (s: string) => new Date(`2026-0${s}Z`);
const iso = (d: Date | null) => (d ? d.toISOString() : null);

// Every value an export must never carry (DX2).
export const SECRETS = {
  passwordHash: "scrypt-account-password-SECRET-1",
  accountAccessToken: "account-access-token-SECRET-2",
  accountRefreshToken: "account-refresh-token-SECRET-3",
  accountIdToken: "account-id-token-SECRET-4",
  sessionToken: "session-token-SECRET-5",
  verificationValue: "verification-value-SECRET-6",
  verificationIdentifier: "verification-identifier-SECRET-7",
  clientSecret: "oauth-client-secret-SECRET-8",
  clientId: "oauth-client-id-SECRET-9",
  oauthAccessToken: "oauth-access-token-SECRET-10",
  oauthRefreshToken: "oauth-refresh-token-SECRET-11",
  consentScopes: "consent-scopes-SECRET-12",
} as const;

export const GATE_HASH = "scrypt$16384$8$1$c2FsdA$aGFzaA";

const SHARED_HTML = "<!doctype html><title>same</title><p>identical payload</p>";

export interface SeededDeployment {
  dir: string;
  dbPath: string;
  payloadDir: string;
  payloadStore: FilesystemPayloadStore;
  // artefact id → payload ref on disk
  refs: Record<string, string>;
  ref(artefactId: string): string;
  expected: {
    accounts: unknown[];
    artefacts: unknown[];
    artefactAccess: unknown[];
    collections: unknown[];
    collectionAccess: unknown[];
    dataEntries: unknown[];
    views: unknown[];
    artefactBookmarks: unknown[];
    collectionBookmarks: unknown[];
  };
  distinctPayloads: number;
}

export function openSource(dbPath: string, options?: Database.Options) {
  const sqlite = new Database(dbPath, options);
  if (!options?.readonly) {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
  }
  return sqlite;
}

export async function seedDeployment(): Promise<SeededDeployment> {
  const dir = mkdtempSync(join(tmpdir(), "artefactor-export-"));
  const dbPath = join(dir, "source.db");
  const payloadDir = join(dir, "payloads");
  const payloadStore = new FilesystemPayloadStore(payloadDir);
  const sqlite = openSource(dbPath);
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./src/infra/db/migrations" });

  const users = [
    {
      id: "u-alice",
      name: "Alice",
      email: "alice@example.com",
      emailVerified: true,
      image: "https://example.com/alice.png",
      createdAt: T("1-01T09:00:00.123"),
      updatedAt: T("1-02T09:00:00.000"),
    },
    {
      id: "u-bob",
      name: "Bob",
      email: "bob@example.org",
      emailVerified: false,
      image: null,
      createdAt: T("1-03T10:00:00.456"),
      updatedAt: T("1-03T10:00:00.456"),
    },
  ];
  db.insert(schema.user).values(users).run();

  // Credential tables — none of these may reach the bundle.
  db.insert(schema.account)
    .values({
      id: "acct-1",
      accountId: "u-alice",
      providerId: "credential",
      userId: "u-alice",
      password: SECRETS.passwordHash,
      accessToken: SECRETS.accountAccessToken,
      refreshToken: SECRETS.accountRefreshToken,
      idToken: SECRETS.accountIdToken,
      createdAt: T("1-01T09:00:00.000"),
      updatedAt: T("1-01T09:00:00.000"),
    })
    .run();
  db.insert(schema.session)
    .values({
      id: "sess-1",
      token: SECRETS.sessionToken,
      userId: "u-alice",
      expiresAt: T("9-01T00:00:00.000"),
      updatedAt: T("1-01T09:00:00.000"),
    })
    .run();
  db.insert(schema.verification)
    .values({
      id: "verif-1",
      identifier: SECRETS.verificationIdentifier,
      value: SECRETS.verificationValue,
      expiresAt: T("9-01T00:00:00.000"),
    })
    .run();
  db.insert(schema.oauthApplication)
    .values({
      id: "app-1",
      name: "Claude",
      clientId: SECRETS.clientId,
      clientSecret: SECRETS.clientSecret,
      redirectUrls: "https://claude.ai/cb",
      type: "web",
      userId: "u-alice",
    })
    .run();
  db.insert(schema.oauthAccessToken)
    .values({
      id: "oat-1",
      accessToken: SECRETS.oauthAccessToken,
      refreshToken: SECRETS.oauthRefreshToken,
      accessTokenExpiresAt: T("9-01T00:00:00.000"),
      refreshTokenExpiresAt: T("9-01T00:00:00.000"),
      clientId: SECRETS.clientId,
      userId: "u-alice",
      scopes: "openid",
    })
    .run();
  db.insert(schema.oauthConsent)
    .values({
      id: "consent-1",
      clientId: SECRETS.clientId,
      userId: "u-alice",
      scopes: SECRETS.consentScopes,
      consentGiven: true,
    })
    .run();

  // A two-level tree whose child id sorts before its root, so "parents first"
  // is observable. The root carries a `selected` access list.
  const collections = [
    {
      id: "c-z-root",
      ownerId: "u-alice",
      name: "Research",
      parentId: null,
      rootId: "c-z-root",
      visibility: "selected" as const,
      status: "active" as const,
      createdAt: T("2-01T08:00:00.000"),
      updatedAt: T("2-02T08:00:00.000"),
      archivedAt: null,
    },
    {
      id: "c-a-child",
      ownerId: "u-alice",
      name: "Interviews",
      parentId: "c-z-root",
      rootId: "c-z-root",
      visibility: "private" as const,
      status: "archived" as const,
      createdAt: T("2-03T08:00:00.000"),
      updatedAt: T("2-04T08:00:00.000"),
      archivedAt: T("2-04T08:00:00.000"),
    },
  ];
  db.insert(schema.collection).values(collections).run();
  const collectionAccess = [
    { collectionId: "c-z-root", userId: "u-bob", grantedAt: T("2-05T08:00:00.000") },
  ];
  db.insert(schema.collectionAccess).values(collectionAccess).run();

  const html: Record<string, string> = {
    "a-private": SHARED_HTML,
    "a-public-plain": SHARED_HTML,
    "a-selected": "<p>selected</p>",
    "a-auth": "<script>localStorage.setItem('k','v')</script>",
    "a-public-gated": "<h1>gated</h1>",
    "a-archived": "<p>archived by bob</p>",
  };
  const stored = new Map<string, { ref: string; bytes: number; hash: string }>();
  for (const [id, content] of Object.entries(html)) {
    stored.set(id, await payloadStore.put(new TextEncoder().encode(content)));
  }
  const payloadOf = (id: string) => stored.get(id)!;
  const refs = Object.fromEntries([...stored].map(([id, p]) => [id, p.ref]));

  type Row = typeof schema.artefact.$inferInsert;
  const base = (id: string, over: Partial<Row>): Row => ({
    id,
    ownerId: "u-alice",
    tenantId: "default",
    title: `Title of ${id}`,
    kind: "prototype",
    visibility: "private",
    publicSlug: null,
    collectionId: null,
    status: "active",
    payloadRef: payloadOf(id).ref,
    payloadBytes: payloadOf(id).bytes,
    payloadHash: payloadOf(id).hash,
    usesStorage: true,
    thumbnailHash: "thumb-hash-not-exported",
    dataVisibility: "shared",
    linkPasswordHash: null,
    linkExpiresAt: null,
    linkGateVersion: 0,
    createdAt: T("3-01T12:00:00.000"),
    updatedAt: T("3-02T12:00:00.000"),
    archivedAt: null,
    ...over,
  });
  const artefacts: Row[] = [
    base("a-private", { kind: "other" }),
    base("a-selected", { visibility: "selected", publicSlug: "sel-slug", kind: "form" }),
    base("a-auth", {
      visibility: "authenticated",
      publicSlug: "auth-slug",
      collectionId: "c-a-child",
      kind: "interactive-doc",
    }),
    base("a-public-gated", {
      visibility: "public",
      publicSlug: "pub-slug",
      kind: "slide-deck",
      dataVisibility: "own",
      linkPasswordHash: GATE_HASH,
      linkExpiresAt: T("9-30T23:59:59.999"),
      linkGateVersion: 3,
    }),
    // A cleared gate keeps its bumped version but gates nothing → `null`.
    base("a-public-plain", { visibility: "public", publicSlug: "pub2", linkGateVersion: 2 }),
    base("a-archived", {
      ownerId: "u-bob",
      visibility: "authenticated",
      publicSlug: "arch-slug",
      status: "archived",
      usesStorage: false,
      archivedAt: T("3-05T12:00:00.000"),
    }),
  ];
  db.insert(schema.artefact).values(artefacts).run();

  const artefactAccess = [
    { artefactId: "a-selected", userId: "u-bob", grantedAt: T("3-03T12:00:00.000") },
  ];
  db.insert(schema.artefactAccess).values(artefactAccess).run();

  const dataEntries = [
    {
      id: "d-1",
      artefactId: "a-auth",
      authorId: "u-alice",
      blob: '{"k":"v","nested":{"a":[1,2]}}',
      authoredAgainstVersion: payloadOf("a-auth").hash,
      createdAt: T("4-01T12:00:00.000"),
      updatedAt: T("4-02T12:00:00.000"),
    },
    {
      id: "d-2",
      artefactId: "a-auth",
      authorId: "u-bob",
      blob: '{"bob":true}',
      authoredAgainstVersion: null,
      createdAt: T("4-03T12:00:00.000"),
      updatedAt: T("4-03T12:00:00.000"),
    },
  ];
  db.insert(schema.dataEntry).values(dataEntries).run();

  const views = [
    { id: "v-1", artefactId: "a-public-gated", viewerId: "u-bob", viewedAt: T("5-01T12:00:00.000") },
    { id: "v-2", artefactId: "a-auth", viewerId: "u-bob", viewedAt: T("5-02T12:00:00.000") },
  ];
  db.insert(schema.viewEntry).values(views).run();

  const artefactBookmarks = [
    { userId: "u-bob", artefactId: "a-auth", createdAt: T("6-01T12:00:00.000") },
    { userId: "u-alice", artefactId: "a-selected", createdAt: T("6-02T12:00:00.000") },
  ];
  db.insert(schema.artefactBookmark).values(artefactBookmarks).run();
  const collectionBookmarks = [
    { userId: "u-bob", collectionId: "c-z-root", createdAt: T("6-03T12:00:00.000") },
  ];
  db.insert(schema.collectionBookmark).values(collectionBookmarks).run();
  sqlite.close();

  const byId = <R extends { id: string }>(rows: R[]) =>
    [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
  const byKeys = <R>(rows: R[], key: (r: R) => string) =>
    [...rows].sort((a, b) => (key(a) < key(b) ? -1 : 1));

  return {
    dir,
    dbPath,
    payloadDir,
    payloadStore,
    refs,
    ref: (artefactId) => {
      const r = refs[artefactId];
      if (!r) throw new Error(`no seeded artefact ${artefactId}`);
      return r;
    },
    distinctPayloads: 5,
    expected: {
      accounts: byId(users).map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        emailVerified: u.emailVerified,
        image: u.image,
        createdAt: iso(u.createdAt),
      })),
      artefacts: byId(artefacts as (Row & { id: string })[]).map((a) => ({
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
        linkGate:
          a.linkPasswordHash || a.linkExpiresAt
            ? {
                passwordHash: a.linkPasswordHash,
                expiresAt: iso(a.linkExpiresAt ?? null),
                version: a.linkGateVersion,
              }
            : null,
        createdAt: iso(a.createdAt),
        updatedAt: iso(a.updatedAt),
        archivedAt: iso(a.archivedAt ?? null),
      })),
      artefactAccess: artefactAccess.map((r) => ({ ...r, grantedAt: iso(r.grantedAt) })),
      // parents first: the root, then its child
      collections: collections.map((c) => ({
        ...c,
        createdAt: iso(c.createdAt),
        updatedAt: iso(c.updatedAt),
        archivedAt: iso(c.archivedAt),
      })),
      collectionAccess: collectionAccess.map((r) => ({ ...r, grantedAt: iso(r.grantedAt) })),
      dataEntries: byId(dataEntries).map((d) => ({
        ...d,
        createdAt: iso(d.createdAt),
        updatedAt: iso(d.updatedAt),
      })),
      views: byId(views).map((v) => ({ ...v, viewedAt: iso(v.viewedAt) })),
      artefactBookmarks: byKeys(artefactBookmarks, (b) => `${b.userId}\0${b.artefactId}`).map(
        (b) => ({ ...b, createdAt: iso(b.createdAt) }),
      ),
      collectionBookmarks: collectionBookmarks.map((b) => ({ ...b, createdAt: iso(b.createdAt) })),
    },
  };
}
