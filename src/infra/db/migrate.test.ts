import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";

const MIGRATIONS = "./src/infra/db/migrations";

// The migrations folder as it stood at `lastTag`: the same SQL, with the
// journal cut after that entry.
function migrationsUpTo(lastTag: string): string {
  const dir = mkdtempSync(join(tmpdir(), "artefactor-migrations-"));
  cpSync(MIGRATIONS, dir, { recursive: true });
  const journalPath = join(dir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: { tag: string }[];
  };
  const at = journal.entries.findIndex((e) => e.tag === lastTag);
  expect(at).toBeGreaterThanOrEqual(0);
  journal.entries = journal.entries.slice(0, at + 1);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

function tables(sqlite: Database.Database): string[] {
  return (
    sqlite
      .prepare("select name from sqlite_master where type = 'table'")
      .all() as { name: string }[]
  ).map((r) => r.name);
}

// S63 — the 1.7 OAuth provider replaces the OIDC plugin's tables. A deployment
// with live connections migrates cleanly: the old rows go with their tables
// (existing connections end; clients reconnect once).
describe("SQLite migration to the OAuth provider schema (S63)", () => {
  it("drops the OIDC tables, rows and all, and creates the provider's", () => {
    const dir = mkdtempSync(join(tmpdir(), "artefactor-migrate-"));
    const sqlite = new Database(join(dir, "test.db"));
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);

    migrate(db, { migrationsFolder: migrationsUpTo("0014_glamorous_queen_noir") });
    const now = Date.now();
    sqlite
      .prepare(
        "insert into user (id, name, email, email_verified, created_at, updated_at) values ('u1', 'U', 'u@example.com', 1, ?, ?)",
      )
      .run(now, now);
    sqlite
      .prepare(
        "insert into oauth_application (id, name, client_id, client_secret, redirect_urls, type, user_id) values ('a1', 'Claude', 'c1', 's', 'https://claude.ai/cb', 'public', 'u1')",
      )
      .run();
    sqlite
      .prepare(
        "insert into oauth_access_token (id, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, client_id, user_id, scopes) values ('t1', 'at', 'rt', ?, ?, 'c1', 'u1', 'openid')",
      )
      .run(now, now);
    sqlite
      .prepare(
        "insert into oauth_consent (id, client_id, user_id, scopes, consent_given) values ('k1', 'c1', 'u1', 'openid', 1)",
      )
      .run();

    migrate(db, { migrationsFolder: MIGRATIONS });

    const after = tables(sqlite);
    expect(after).not.toContain("oauth_application");
    for (const t of [
      "oauth_client",
      "oauth_resource",
      "oauth_client_resource",
      "oauth_refresh_token",
      "oauth_access_token",
      "oauth_consent",
      "oauth_client_assertion",
      "jwks",
    ]) {
      expect(after).toContain(t);
    }
    // The old tokens are gone with their table; the new one starts empty.
    expect(
      sqlite.prepare("select count(*) as n from oauth_access_token").get(),
    ).toEqual({ n: 0 });
    // The Account itself is untouched.
    expect(sqlite.prepare("select id from user").all()).toEqual([{ id: "u1" }]);
    sqlite.close();
  });
});

// S79 — Database refuses a payload ref shared by two artefacts. The index migration onto a
// database that already holds a shared ref fails rather than repairing it.
describe("SQLite migration to the payload ref index (S79)", () => {
  // r[verify hosting.payload.ref-unique-in-database]
  it("fails on a database that already holds a shared ref, leaving both rows as they were", () => {
    const dir = mkdtempSync(join(tmpdir(), "artefactor-migrate-"));
    const sqlite = new Database(join(dir, "test.db"));
    try {
      sqlite.pragma("foreign_keys = ON");
      const db = drizzle(sqlite);
      migrate(db, { migrationsFolder: migrationsUpTo("0017_aspiring_felicia_hardy") });
      const now = Date.now();
      sqlite
        .prepare(
          "insert into user (id, name, email, email_verified, created_at, updated_at) values ('u1', 'U', 'u@example.com', 1, ?, ?)",
        )
        .run(now, now);
      const insert = sqlite.prepare(
        "insert into artefact (id, owner_id, title, kind, payload_ref, payload_bytes, payload_hash, created_at, updated_at) values (?, 'u1', ?, 'other', 'ref-shared', 1, 'h', ?, ?)",
      );
      insert.run("a1", "A1", now, now);
      insert.run("a2", "A2", now, now);

      let failure: unknown;
      try {
        migrate(db, { migrationsFolder: MIGRATIONS });
      } catch (err) {
        failure = err;
      }
      expect(failure).toMatchObject({
        message: expect.stringContaining("CREATE UNIQUE INDEX `artefact_payload_ref_uq`"),
        cause: { message: expect.stringMatching(/UNIQUE constraint failed: artefact\.payload_ref/) },
      });
      expect(sqlite.prepare("select id, payload_ref from artefact order by id").all()).toEqual([
        { id: "a1", payload_ref: "ref-shared" },
        { id: "a2", payload_ref: "ref-shared" },
      ]);
      expect(
        sqlite
          .prepare("select name from sqlite_master where type = 'index' and name = 'artefact_payload_ref_uq'")
          .all(),
      ).toEqual([]);
    } finally {
      sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
