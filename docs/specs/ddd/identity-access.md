# Bounded Context: Identity & Access

Authentication and machine credentials. **Largely delegated to [BetterAuth](https://www.better-auth.com/).**
Artefactor does not hand-roll user/session/password handling.

## Delegation boundary

- **BetterAuth owns:** user records, sessions, social-provider (OAuth) linkage, and the
  login/logout flow. It persists its own tables via the **Drizzle adapter** on the shared
  SQLite database.
- **The domain owns:** the *meaning* of an account as an artefact **Owner**. The domain
  refers to a user only by their stable BetterAuth **user id** (`ownerId`). It does not
  duplicate profile/auth data.

This keeps Identity thin: there is no rich `Account` aggregate to invariant-check beyond
"this user id exists and the request is authenticated as them."

## Authentication

Two methods, both via BetterAuth:

1. **Google OAuth** (BetterAuth social sign-in) — the **default production** method. Google
   verifies the email; the domain allowlist (below) then gates who may have an account.
2. **Email + password** (BetterAuth credential provider) — the zero-config method for local dev
   and the test suite, and **off in production by default**. Which methods a deployment enables
   is **configuration**, not a hard rule of the environment: see the *configurable sign-in
   methods* amendment below (IA7), which also states why an enabled email+password path is an
   **unverified** one.

Both are additive and can link to the same user. Sessions are issued and validated by
BetterAuth and surfaced to the Hono BFF as the current authenticated user. Every BFF endpoint
that mutates or reads non-public artefacts (or writes data) requires an authenticated session
and authorizes against `ownerId` / the access matrix.

### Sign-up allowlist (email domain)

Account **creation** is restricted to a configured set of email domains
(`AUTH_ALLOWED_EMAIL_DOMAINS`, comma-separated; defaults to `example.com` for dev — set the
real org domain(s) in production). The check is a pure predicate
(`domain/identity/email-domain.ts`) enforced in BetterAuth's `databaseHooks.user.create.before`
hook — so it applies on the *create* path for **every provider** (Google and dev email+pw). A
disallowed domain can never create an account, and therefore can never sign in. Matching is
exact and case-insensitive (a subdomain like `x@sub.example.com` is **not** a match for
`example.com`). Google's single-domain `hd` option is deliberately not used, since more than
one domain may be allowed.

## Programmatic access (MCP connector)

Claude (claude.ai / Claude design) drives Artefactor through a **remote MCP server**
(see `docs/specs/fdd/slice-dag.md` S18). There is **no standalone REST API and no API-key
credential** — the pinned `better-auth` (1.6.20) does not ship the api-key plugin, and a
raw token surface was judged unnecessary baggage. Instead, programmatic callers authenticate
with **OAuth 2.1** and act *as a user*.

Use **BetterAuth's `mcp` plugin**, which embeds an **OIDC provider** (the `oidcProvider`
schema: `oauthApplication`, `oauthAccessToken`, `oauthConsent`).

- **OAuth, not keys.** A client (e.g. claude.ai) obtains a short-lived **access token** via
  the authorization-code flow and presents it as a bearer on every MCP request. The token is
  bound to exactly one Account; **every MCP operation is attributed to that Account** as the
  artefact `ownerId` / data `authorId`, with identical invariants to UI actions.
- **Dynamic client registration (DCR).** Clients self-register (`/api/auth/mcp/register`); no
  manual provisioning. Only discovery is rooted at `/.well-known/...`; registration / authorize
  / token live under `/api/auth/mcp/*`. A registered client completes the user's consent before
  it can act.
- **Discovery.** The server advertises OAuth metadata at the well-known endpoints so the
  client can discover the authorization server and protected-resource descriptor.
- **Revocation = the session/token lifecycle.** Access tokens expire; a token whose
  underlying grant is gone authenticates nothing. There is no separate key to revoke.
- Token secrets are stored hashed by the plugin; Artefactor never sees a long-lived secret.

## Invariants

1. A private artefact is readable/mutable only by a request authenticated as its `ownerId`.
2. An OAuth access token maps to exactly one Account; every MCP operation made with it is
   attributed to that Account (artefact `ownerId` / data `authorId`).
3. An expired or invalidated access token authenticates nothing; an MCP request without a
   valid bearer is rejected (401 with the protected-resource descriptor).
4. An Account may be created only with an email whose domain is in the configured
   allowlist; this holds for every authentication provider.

## Amendment (post-v0.2) — multi-tenant organizations & open signup

> **Status:** DDD amendment (FDD slice **S22**; EE context `ee/docs/specs/ddd/tenancy.md`).
> Behaviour-preserving in OSS.

OSS is single-tenant; the sign-up **domain allowlist** (IA4) is how the one deployment gates its org.
A multi-tenant superset:

- **Delegates organizations, memberships, roles, and invitations to BetterAuth's `organization`
  plugin** — mirroring the user/session delegation. The domain refers to an org only by its
  BetterAuth **org id** (`tenantId`); there is no hand-rolled org/membership aggregate.
- **Opens sign-up.** The allowlist predicate (`domain/identity/email-domain.ts`) gains an
  **allow-all** configuration — the wildcard sentinel **`"*"`** in the allowed-domains list
  (`ALLOW_ALL_DOMAINS`); a superset sets `AUTH_ALLOWED_EMAIL_DOMAINS=["*"]`. A malformed email is
  still rejected even under `*` (a real domain is required). **Org membership (via invites), not the
  email domain, then gates access** to an org's `authenticated` artefacts (see `tenancy.md` T3). OSS
  keeps its explicit domains (no `*`), so default behaviour is unchanged.

**IA5 — org delegation is thin; allowlist becomes configurable.** As with users, the domain stores
no org/membership data — it trusts BetterAuth's org id as `tenantId` and its role claims for org
administration. **IA4 still holds**: account creation is gated by the allowlist predicate; the
superset merely configures it to allow-all. An invited user may therefore sign up regardless of
email domain.

## Amendment (post-v0.2) — cookie-authenticated state changes come only from the app origin

> **Status:** DDD amendment (FDD slice **S36**; with Artefact Hosting AH28 and Artefact Data
> AD10). IA1–IA5 hold: this only narrows which browser contexts may use a session.

**Problem.** Nothing checked where a cookie-authenticated `POST`/`PUT`/`PATCH`/`DELETE` came from,
so any page able to make the browser attach the session cookie (a sandboxed artefact frame, or
another site whenever a cookie is sent cross-site) could change state as the viewer.

**IA6 — cookie-authenticated state changes come only from the app origin.** A `POST`, `PUT`,
`PATCH` or `DELETE` under `/api` is refused with **403** when:

- its `Origin` header is present and is not a **trusted app origin** — the `BETTER_AUTH_URL`
  origin and the `AUTH_TRUSTED_ORIGINS` entries; `Origin: null` is never trusted, and neither is
  the content origin (`ARTEFACTOR_CONTENT_ORIGIN`, AH28), even when listed; or
- its `Sec-Fetch-Site` header is present and is not `same-origin`.

A request with neither header (a non-browser client) passes. **Exemptions:** `GET`/`HEAD`/
`OPTIONS` are never checked; `/api/auth/*` is left to BetterAuth, which applies its own
`trustedOrigins` check; `/mcp` is not under `/api` and is authenticated by bearer only (IA2/IA3).

## Amendment (post-v0.2) — configurable sign-in methods & the sign-up gate

> **Status:** DDD amendment (FDD slice **S38**). Default behaviour is unchanged: with both flags
> unset, production is Google-only with sign-up open, and dev/test keep email+password.

**Problem.** S1 encoded "production is Google-only" as a rule of the *environment*
(`emailAndPassword.enabled = NODE_ENV !== "production"`, plus an env guard that *required* the
Google credentials in production). A deployment that does not want a Google dependency therefore
could not sign in to its own production instance at all. The rule that actually matters is
**"production has at least one working sign-in method"**.

**IA7 — a production deployment has at least one enabled sign-in method.** Which methods are
enabled is deployment configuration: `AUTH_EMAIL_PASSWORD` drives the credential provider
(defaulting to "on outside production"), and the Google provider is enabled exactly when both
Google credentials are configured. In production the configuration must yield at least one of the
two; the env schema refuses to boot otherwise, naming both ways out. The rules live in one pure
function (`domain/identity/auth-config.ts`), and the BFF advertises the resolved methods on
`GET /api/config` so the sign-in screen renders what the server will actually accept — and can
never render zero.

**IA4 (amended) — an Account may be created only when sign-up is open *and* the email's domain is
allowed; this holds for every authentication provider.** The gate (`AUTH_ALLOW_SIGNUP`) sits beside
the allowlist in the single `databaseHooks.user.create.before` hook — the one create path every
provider runs through — and is checked *first*, so a closed deployment does not disclose which
domains it allows. It gates **creation only**: accounts created earlier still sign in, and the MCP
connector's OAuth flow authorises an *existing* Account rather than creating one (IA2 unaffected).

**The gate's default tracks verification, not environment.** Unset, it is **closed** when
email+password is enabled in production and **open** otherwise. Google has already proven the
address it asserts, so a Google-only deployment creates accounts against a verified identity and
needs no gate — it behaves exactly as under S1. Email+password has no such proof while OSS carries
no mail transport, so the deployment that enables it is the one that gets a closed door; a
production deployment enabling both is closed, because the unverified path exists.

**Residual risk, stated rather than papered over.** While the gate is open, an email+password
account is **unverified** (CWE-290): whoever reaches `POST /api/auth/sign-up/email` first claims any
allowlisted address, and neither a domain nor an exact-address allowlist proves *ownership* — it
narrows the surface without closing it. A deployment that opens the gate accepts that for as long
as it stays open; the intended lifecycle is open it, create the intended accounts, close it again.
Verified email+password sign-up needs a mail transport, which OSS does not have — tracked as EE's
`EI1 — Mail transport + magic-link sign-in`.

**IA1, IA2, IA3, IA5 and IA6 are unchanged.** Nothing here changes *who* may hold an account, only
*how* they authenticate and *whether the door is open*.

## Open questions

- MCP OAuth scopes: a single implicit "act as me" grant vs. finer scopes (read-only vs.
  write). Default: **one grant**, the token can do anything its Account can; revisit if needed.
- OAuth providers beyond Google (e.g. GitHub). Default: Google only at launch.
- MCP token ↔ active org: which org an MCP `create_artefact` is stamped with when the token's
  Account belongs to several (the token's default/active org vs. an explicit tool arg). Leaning the
  Account's active org; confirm with the Tenancy context. **TBD.**
