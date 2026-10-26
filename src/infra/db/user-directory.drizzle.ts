import { and, inArray, ne, sql } from "drizzle-orm";
import type { db as Db } from "./client";
import { user } from "./schema";
import type {
  DirectoryUser,
  UserDirectory,
  UserIdentity,
  UserSearchOptions,
} from "../../server/data/user-directory";
import type { TenantScope } from "../../domain/artefact/tenant-scope";

type Database = typeof Db;

// Default page size for the member picker — enough to choose from, small enough
// to keep the dropdown tidy. The query narrows as the owner types.
const DEFAULT_SEARCH_LIMIT = 10;

// Escape SQL LIKE wildcards in user input so `%`/`_` are matched literally.
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// Drizzle adapter for the BFF UserDirectory port — reads display identity from
// the BetterAuth `user` table to label the S12 data-context switcher.
export class DrizzleUserDirectory implements UserDirectory {
  constructor(private readonly db: Database) {}

  async lookup(ids: string[]): Promise<Map<string, UserIdentity>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(inArray(user.id, ids));
    return new Map(rows.map((r) => [r.id, { name: r.name, email: r.email }]));
  }

  // The scope is ignored: single tenant, so every registered user is in scope.
  async search(
    query: string,
    _scope: TenantScope,
    options?: UserSearchOptions,
  ): Promise<DirectoryUser[]> {
    const q = query.trim();
    if (q.length === 0) return [];
    // Substring match on name OR email. SQLite LIKE is case-insensitive for
    // ASCII, which covers the allowed-domain accounts here.
    const pattern = `%${escapeLike(q)}%`;
    // Explicit ESCAPE so the wildcards we escaped above are matched literally.
    const match = sql`(${user.name} LIKE ${pattern} ESCAPE '\\' OR ${user.email} LIKE ${pattern} ESCAPE '\\')`;
    const where = options?.excludeId
      ? and(match, ne(user.id, options.excludeId))
      : match;
    const rows = await this.db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(where)
      .orderBy(user.name)
      .limit(options?.limit ?? DEFAULT_SEARCH_LIMIT);
    return rows;
  }
}
