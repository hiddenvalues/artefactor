import { Hono } from "hono";
import type { UserDirectory } from "../data/user-directory";
import { ownerId, requireAuth, type AuthEnv } from "../middleware/auth";
import type { TenantScopeResolver } from "../middleware/tenant-scope";
import type { UserSearchResponse } from "../../shared/contracts";

export interface UserRoutesDeps {
  userDirectory: UserDirectory;
  resolveScope: TenantScopeResolver;
}

// S16 — user directory search for the add-member picker. Auth-gated: any
// signed-in user may look up other registered users by name/email so they can
// share an artefact with them (the directory is small and domain-restricted).
// The caller is excluded from their own results. A blank query returns nothing.
// The search runs under the caller's tenant scope, resolved as for every scoped
// read; a resolver refusal (a superset's 403) answers instead.
export function createUserRoutes(deps: UserRoutesDeps) {
  const r = new Hono<AuthEnv>();

  // r[impl hosting.access-list.directory-search+3]
  r.get("/search", requireAuth, async (c) => {
    const q = c.req.query("q") ?? "";
    const scope = await deps.resolveScope(c);
    const users = await deps.userDirectory.search(q, scope, {
      excludeId: ownerId(c),
    });
    return c.json<UserSearchResponse>({ users });
  });

  return r;
}
