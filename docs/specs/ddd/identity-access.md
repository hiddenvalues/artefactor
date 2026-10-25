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
   methods* amendment below (`identity.signin.production-needs-a-method`), which also states why
   an enabled email+password path is an **unverified** one.

Both are additive and can link to the same user. Sessions are issued and validated by
BetterAuth and surfaced to the Hono BFF as the current authenticated user, which authorizes
against `ownerId` and the access matrix.

### Sign-up allowlist (email domain)

Account **creation** is restricted to a configured set of email domains
(`AUTH_ALLOWED_EMAIL_DOMAINS`, comma-separated; defaults to `example.com` for dev — set the
real org domain(s) in production). The check is a pure predicate
(`domain/identity/email-domain.ts`) enforced in BetterAuth's `databaseHooks.user.create.before`
hook — so it applies on the *create* path for **every provider** (Google and dev email+pw); an
account that is never created never signs in. Google's single-domain `hd` option is not used,
since more than one domain may be allowed. The allowlist is never disclosed: neither the sign-in
screen nor the public config names it, and a refusal by the allowlist answers with one fixed
message.

## Invariants

r[identity.session.owner-id]
An authenticated session exposes a stable `ownerId` to the BFF.

r[identity.session.authenticated-principal]
Every mutation under `/api`, and every read under `/api` of something that is not public, needs an
authenticated principal: a session, or for the owner's raw frame its frame token. A request with
neither is refused. BetterAuth's own `/api/auth/*` is outside this rule, and `/mcp` needs a bearer
instead (`identity.mcp.bearer-required`).

r[identity.access.private-owner-only]
A private artefact is readable/mutable only by a request authenticated as its `ownerId`.

r[identity.signup.domain-allowlist+2]
An Account may be created only with an email whose domain is in the configured allowlist; this
holds for every authentication provider. Matching is exact and case-insensitive: `x@Example.COM`
matches `example.com`, and a subdomain such as `x@sub.example.com` does not.

r[identity.signup.refusal-names-no-domain]
A sign-up refused because its email domain is not allowed answers with one fixed message that
names no domain, whichever provider and deployment mode refused it.

r[identity.signup.malformed-email-refused]
An email with no local part or no domain (`x`, `@example.com`, `x@`) never creates an Account,
whatever the allowlist holds — the wildcard `*` included.

## Published language

What a client outside the codebase depends on: BetterAuth's `/api/auth/*` surface, the MCP
endpoint `/mcp` and its OAuth discovery, and which origins may send a cookie-authenticated state
change (the *cookie-authenticated state changes* amendment below gives the reason).

### Programmatic access (MCP connector)

Claude (claude.ai / Claude design) drives Artefactor through a **remote MCP server**
(see `docs/specs/fdd/slice-dag.md` S18, S63). There is **no standalone REST API and no API-key
credential** — better-auth core ships no api-key plugin, and a raw token surface was judged
unnecessary baggage. Instead, programmatic callers authenticate with **OAuth 2.1** and act *as a
user*.

The authorization server is **`@better-auth/mcp`**, a layer over `@better-auth/oauth-provider`,
with BetterAuth's `jwt` plugin signing the access tokens. Its schema is `oauthClient`,
`oauthResource`, `oauthClientResource`, `oauthAccessToken`, `oauthRefreshToken`, `oauthConsent`,
`oauthClientAssertion` and the `jwt` plugin's `jwks`.

- **OAuth, not keys.** A client (e.g. claude.ai) obtains a short-lived **access token** via
  the authorization-code flow (PKCE) and presents it as a bearer on every MCP request. The token
  is bound to exactly one Account; **every MCP operation is attributed to that Account** as the
  artefact `ownerId` / data `authorId`, with identical invariants to UI actions.
- **Dynamic client registration (DCR).** Clients self-register at `/api/auth/oauth2/register`
  without a session; no manual provisioning. Authorize, token and consent live under
  `/api/auth/oauth2/*`; only discovery is rooted at `/.well-known/...`.
- **Consent.** An authorize request from a signed-in Account goes to the consent screen at
  `/oauth/consent`, which names the client and the Account it will act as. Allowing it issues
  the authorization code; denying it returns `access_denied`. No client skips it
  (`identity.mcp.consent-required`). A signed-out request goes to the sign-in screen first and
  resumes the authorize request after sign-in.
- **Discovery.** The server advertises the authorization-server metadata and the
  protected-resource descriptor (RFC 9728, also at its `/mcp`-suffixed path) at the well-known
  endpoints, so the client can discover where to register and authorize.
- **Audience-bound JWTs, verified in-process.** Every access token is a JWT bound to the
  deployment's `/mcp` resource. `/mcp` verifies it against the deployment's own signing keys,
  read in-process (never fetched over HTTP), refuses a token bound to a client key (`cnf`, as
  DPoP binds one), then checks that its Account still exists (`identity.mcp.token-audience`,
  `identity.mcp.bearer-required`).
- **Revocation = the grant/token lifecycle.** Access tokens expire after the provider's lifetime
  (1 hour). Revoking a grant stops it at its next refresh; the live access token stays valid until
  it expires. There is no separate key to revoke.
- Client secrets and refresh tokens are stored by the provider; Artefactor never sees a
  long-lived secret, and none of it leaves in an export (`export.account.no-credentials`).

### Invariants — MCP connector

r[identity.mcp.consent-required]
An OAuth client obtains an authorization code only after the signed-in Account accepts it on the
consent screen; denying returns `access_denied` to the client and issues no code. No client skips
consent.

r[identity.mcp.token-audience]
`/mcp` accepts an access token only when its signature verifies against the deployment's own
signing keys, its issuer is the deployment, and its audience includes the deployment's `/mcp`
resource; a token minted for any other resource authenticates nothing.

r[identity.mcp.token-one-account]
An OAuth access token maps to exactly one Account; every MCP operation made with it is attributed
to that Account (artefact `ownerId` / data `authorId`).

r[identity.mcp.bearer-required+4]
An MCP request without a valid bearer is rejected (401 with the protected-resource descriptor). A
bearer that is expired or carries no expiry, fails `identity.mcp.token-audience`, names an
Account that no longer exists, or is bound to a client key (a `cnf` confirmation, such as a
DPoP-bound token) authenticates nothing: `/mcp` accepts plain bearer tokens only. Revoking a grant
stops it at its next refresh: a live access token stays valid until it expires (the provider's
access-token lifetime, 1 hour).

### Invariants — app origin

r[identity.origin.app-origin-only+2]
A `POST`, `PUT`, `PATCH` or `DELETE` under `/api` is refused with **403** when its `Origin` header
is present and is not a **trusted app origin** — the `BETTER_AUTH_URL` origin and the
`AUTH_TRUSTED_ORIGINS` entries; `Origin: null` is never trusted, and neither is the content origin
(`ARTEFACTOR_CONTENT_ORIGIN`, `hosting.frame.content-origin-separate`), even when listed — or when
its `Sec-Fetch-Site` header is present and is not `same-origin`.

r[identity.origin.exemptions]
A request with neither header (a non-browser client) passes. **Exemptions:** `GET`/`HEAD`/
`OPTIONS` are never checked; `/api/auth/*` is left to BetterAuth, which applies its own
`trustedOrigins` check; `/mcp` is not under `/api` and is authenticated by bearer only
(`identity.mcp.token-one-account`, `identity.mcp.bearer-required`).

## Amendment (post-v0.2) — multi-tenant organizations & open signup

> **Status:** DDD amendment (FDD slice **S22**; EE context `ee/docs/specs/ddd/tenancy.md`).
> Behaviour-preserving in OSS.

OSS is single-tenant; the sign-up **domain allowlist** (`identity.signup.domain-allowlist`) is how
the one deployment gates its org. A multi-tenant superset:

- **Delegates organizations, memberships, roles, and invitations to BetterAuth's `organization`
  plugin** — mirroring the user/session delegation. The domain refers to an org only by its
  BetterAuth **org id** (`tenantId`); there is no hand-rolled org/membership aggregate.
- **Opens sign-up.** The allowlist predicate (`domain/identity/email-domain.ts`) gains an
  **allow-all** configuration — the wildcard sentinel **`"*"`** in the allowed-domains list
  (`ALLOW_ALL_DOMAINS`); a superset sets `AUTH_ALLOWED_EMAIL_DOMAINS=["*"]`. A malformed email is
  still refused (`identity.signup.malformed-email-refused`). **Org membership (via invites), not the
  email domain, then gates access** to an org's `authenticated` artefacts (the EE Tenancy context,
  `tenancy.md`). OSS keeps its explicit domains (no `*`), so default behaviour is unchanged.

**The organization context is a seam (S53).** The app shell shows which org is active and the
caller's role in it, and lets them switch. That context comes from an injected
`OrganizationContextProvider` (`src/server/org-context.ts`), an enabler seam beside
`TenantScopeResolver` and `AccessPolicy`: the superset supplies BetterAuth's memberships (ET7), and
the domain still stores none. The role is shown; the switch never consults it
(`identity.org-context.switch-own-membership`).

**The organization administration is a seam (S58).** The Organization settings screen shows the
active org's members and lets an owner or admin rename it, invite people and revoke a pending
invitation. The org data comes from, and the changes are carried out by, an injected
`OrganizationAdministration` (`src/server/org-admin.ts`), beside the organization context: the
superset supplies BetterAuth's organization plugin (ET4), and the domain still stores no org,
membership or invitation data. Authority is decided in core, never by the provider: which org a
route acts on comes from the org context, and so does the caller's role in it. An invite only
**records and notifies**; what an accepted invitation *grants* is the superset's (ET4). The org role
governs org administration only (`identity.org.delegated`).

### Invariants — organizations

r[identity.org.delegated+2]
As with users, the domain stores no org/membership data — it trusts BetterAuth's org id as
`tenantId`, and its role claims for org administration only: the org role grants no artefact
authority.

r[identity.org-context.oss-absent+2]
With the default provider (`noOrganizationContext`) there is no organization context: the caller
has no active org and no memberships, and no org can be made active.

r[identity.org-context.switch-own-membership+2]
A caller can make active only an org listed among their own memberships, as the provider reports
them, whatever their role in it; any other org is refused without calling the provider's
`activate`. Core decides this, never the provider.

r[identity.org-admin.oss-absent+2]
With the default provider (`noOrganizationAdministration`), or with no organization context, there
is no org administration: nothing is read or changed, and the provider is never called.

r[identity.org-admin.active-org-only+2]
Org administration acts only on the caller's active org, the org context's `activeId`; it never
takes an org id from the client.

r[identity.org-admin.owner-or-admin+2]
Renaming the org, inviting, revoking an invitation and reading the pending invitations and invite
domains need role `owner` or `admin` in the active org, as the org context lists it. A `member` is
refused, and the provider's `rename`, `invite` and `revoke` are not called.

r[identity.org-admin.invite-domain+2]
An invite's address, trimmed and lower-cased, must be a valid email whose domain exactly matches
one of the org's invite domains (no subdomain, no wildcard; an empty list admits none), and must
not already be a member's or have a pending invitation. Otherwise the invite is refused as
`invalid-email`, `outside-domains`, `already-member` or `already-invited`, without calling the
provider's `invite`.

r[identity.signup.allow-all]
The domain allowlist still holds: account creation is gated by the allowlist predicate; the
superset merely configures it to allow-all. An invited user may therefore sign up regardless of
email domain.

## Amendment (post-v0.2) — cookie-authenticated state changes come only from the app origin

> **Status:** DDD amendment (FDD slice **S36**; with Artefact Hosting `hosting.frame.*` and Artefact
> Data *persistence through the host shell*). The requirements above hold: this only narrows which
> browser contexts may use a session.

**Problem.** Nothing checked where a cookie-authenticated `POST`/`PUT`/`PATCH`/`DELETE` came from,
so any page able to make the browser attach the session cookie (a sandboxed artefact frame, or
another site whenever a cookie is sent cross-site) could change state as the viewer.

**Cookie-authenticated state changes come only from the app origin.** The rules are published
language, under *Invariants — app origin* above.

## Amendment (post-v0.2) — configurable sign-in methods & the sign-up gate

> **Status:** DDD amendment (FDD slice **S38**). Default behaviour is unchanged: with both flags
> unset, production is Google-only with sign-up open, and dev/test keep email+password.

**Problem.** S1 encoded "production is Google-only" as a rule of the *environment*
(`emailAndPassword.enabled = NODE_ENV !== "production"`, plus an env guard that *required* the
Google credentials in production). A deployment that does not want a Google dependency therefore
could not sign in to its own production instance at all. The rule that actually matters is
**"production has at least one working sign-in method"**.

**A production deployment has at least one enabled sign-in method.**

The rules live in one pure function (`domain/identity/auth-config.ts`), resolved once as
`authConfig`; the BFF advertises the resolved methods so the sign-in screen renders what the server
will actually accept (`identity.config.methods-from-auth-config`). `capabilities.magicLinkSignIn` on
the same response (S33a) is a presentation signal like the method flags: it says a superset has
registered magic-link sign-in, whose endpoint exists only then and whose account creation still
passes the sign-up hook below. `capabilities.verifiedSignUp` and `capabilities.passwordReset` (S48)
are presentation signals of the same kind, for link-first sign-up and password reset
(`identity.capabilities.superset-only`); every account a link creates still passes the sign-up hook.

**The domain allowlist, amended.** An Account is created only when sign-up is open *and* the
email's domain is allowed, whatever the authentication provider (`identity.signup.gate`).

**The gate's default tracks verification, not environment** (`identity.signup.gate-default`).
Google has already proven the address it asserts, so a Google-only deployment creates accounts
against a verified identity and needs no gate — it behaves exactly as under S1. Email+password has
no such proof while OSS carries no mail transport, so the deployment that enables it is the one
that gets a closed door; a production deployment enabling both is closed, because the unverified
path exists.

**Residual risk, stated rather than papered over.** While the gate is open, an email+password
account is **unverified** (CWE-290): whoever reaches `POST /api/auth/sign-up/email` first claims any
allowlisted address, and neither a domain nor an exact-address allowlist proves *ownership* — it
narrows the surface without closing it. A deployment that opens the gate accepts that for as long as
it stays open, so a deployment for a fixed team opens it, creates its accounts and closes it again.
Verified email+password needs a mail transport, which OSS does not have: a superset that has one
closes the unverified path (the EE Share invitations context's verified password sign-up and
password reset).

**The private-artefact, MCP-token, org-delegation and app-origin requirements are unchanged.**
Nothing here changes *who* may hold an account, only *how* they authenticate and *whether the door
is open*.

### Invariants — sign-in methods and the sign-up gate

r[identity.signin.methods-configured]
Which methods are enabled is deployment configuration: `AUTH_EMAIL_PASSWORD` drives the credential
provider (defaulting to "on outside production"), and the Google provider is enabled exactly when
both Google credentials are configured.

r[identity.signin.production-needs-a-method]
In production the configuration must yield at least one of the two; the env schema refuses to boot
otherwise, naming both ways out.

r[identity.config.methods-from-auth-config]
The sign-in methods and the sign-up gate a deployment advertises are resolved from the one
`authConfig` that also enforces them, so the sign-in screen never offers a method or a sign-up the
server refuses; in production it never offers no method at all
(`identity.signin.production-needs-a-method`).

r[identity.capabilities.superset-only]
OSS never enables `verifiedSignUp` or `passwordReset`. Each is a superset's presentation signal for
an endpoint only a superset registers — setting a first password, and requesting a password reset.

r[identity.signup.gate]
The gate (`AUTH_ALLOW_SIGNUP`) sits beside the allowlist in the single
`databaseHooks.user.create.before` hook — the one create path every provider runs through — and is
checked *first*, so a closed deployment does not disclose which domains it allows. It gates
**creation only**: accounts created earlier still sign in, and the MCP connector's OAuth flow
authorises an *existing* Account rather than creating one (`identity.mcp.token-one-account`
unaffected).

r[identity.signup.gate-default]
Unset, it is **closed** when email+password is enabled in production and **open** otherwise.

## Amendment (post-v0.2) — the client address

> **Status:** DDD amendment (FDD slice **S42**). **The requirements above are unchanged by S42**:
> nothing here changes who may read, unlock or sign in — only the *key* the rate limits count
> against.

**Problem.** The app decided "who is the client" in two places, and neither could be trusted. The
S32a unlock limit took the last `X-Forwarded-For` hop from **any** peer, so a client reaching the
app port directly forged its key. BetterAuth read the **first** `X-Forwarded-For` value, which a
client chooses even behind the proxy (the proxy appends its hop and keeps what the client sent), so
a client could reset BetterAuth's sign-in rate limit and choose the `ipAddress` stored on its
session row.

**The client address is resolved once, and only a trusted proxy may name it.**

### Invariants — client address

r[identity.client-ip.resolved-once]
Every consumer of a client address takes it from one resolver (`src/server/client-ip.ts`), resolved
once per request by a root middleware in `createApp`.

r[identity.client-ip.trusted-walk]
The resolver starts from the socket peer (an IPv4-mapped IPv6 address counts as its IPv4 form).
While the current address is a **trusted proxy**, it steps one hop left in `X-Forwarded-For`. The
first untrusted hop is the client. When every hop is trusted, the leftmost one is. An empty or
unparsable hop stops the walk at the nearest trusted address, so garbage never becomes a key. A
header from an untrusted peer is ignored.

r[identity.client-ip.trusted-set]
The trusted set is deployment configuration: `ARTEFACTOR_TRUSTED_PROXIES`, a comma-separated list
of CIDRs or bare addresses that **replaces** the default. The default is loopback plus the private
and link-local ranges — `127.0.0.0/8, ::1/128, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
169.254.0.0/16, fc00::/7, fe80::/10` — which is where a same-host or Docker-network proxy connects
from, so a peer from a public address never names its own client address. An invalid entry fails
the boot, naming the variable.

r[identity.client-ip.better-auth-header]
BetterAuth reads the address only from the `X-Artefactor-Client-IP` header, which the middleware
strips from every incoming request and sets to the resolved address; the raw `X-Forwarded-For`
never reaches BetterAuth's IP logic.

r[identity.client-ip.unlock-limit+2]
The S32a unlock limit (per holder and client address,
`hosting.link-gate.unlock-attempts-limited`) keys on the same address.

## Amendment (post-v0.2) — URL-credential redaction in the app log

> **Status:** DDD amendment (FDD slices **S50** and **S51**). **The requirements above are
> unchanged by S50 and S51**: nothing here changes who may sign in or how a request is
> authenticated — only what the app log prints about a request.

**Problem.** The request log printed every request's path with its full query string, and
credentials travel in query strings: the magic-link `token`, the OAuth callback's `code` and
`state`, the frame token `?t=` (S36), and a password-reset token. The incoming line is written
before the handler consumes the credential, so whoever reads the log could race its owner to it.
BetterAuth's own logger leaked one too: it passes whole error objects to its sink, and every
`StateError` a failed OAuth callback throws carries `details: { state }` (better-auth 1.6.20), so
`Failed to parse state` printed the callback's `state` — a live one when the verification row was
found but the security check failed.

**A credential carried in a URL never reaches the app log.** Two sinks write it, the request log
and BetterAuth's logger, and both fail closed (*Invariants — app log* below). Neither allow-lists
a field, so a new URL-borne credential (the EE password-reset link, another OAuth provider, a new
frame parameter, a field a later BetterAuth adds to an error) is covered without being listed
anywhere.

Paths are logged as received: an `/a/:slug` slug is the artefact's address, not a credential.
Request bodies and headers were never logged. BetterAuth's message strings are printed as they are:
they are static or interpolate configuration and callback URLs.

### Invariants — app log

r[identity.log.request-log-no-values]
**The request log** (S50) records each request's method, path, status and duration, and its query
parameter **names** — never their values.

r[identity.log.auth-log-no-values]
**BetterAuth's logger** (S51) prints what failed — its message, and an error's name, message,
`code` and stack — never a value it was handed: every other error field and every object argument
prints its key names only.

## Amendment (post-v0.2) — the account's own name

> **Status:** DDD amendment (FDD slice **S57**). **The requirements above are unchanged by S57**:
> the domain still stores no user data. The name belongs to BetterAuth's user, as the email does.

**Problem.** A signed-in user saw their name in the account menu (S53) but could not change it, so
an account created by a magic link or Google kept whatever name it arrived with.

**A user renames only themselves, through BetterAuth.** The rename takes a name and no user id, so
it cannot address another account. It calls BetterAuth's own `updateUser` for the caller's session
and never writes the `user` table itself. It is a cookie-authenticated state change, so the origin
guard covers it (`identity.origin.app-origin-only`). The route is S57's.

### Invariants — account name

r[identity.account.rename-self+2]
A user changes only their own name, through BetterAuth's `updateUser` for their own session; the
domain writes no user data. A name that is empty after trimming or longer than 100 characters is
refused, and nothing is written.

r[identity.account.email-read-only]
An Account's email never changes: no endpoint the app exposes changes it, BetterAuth's own
`update-user` and `change-email` included.

## Open questions

- MCP OAuth scopes: a single implicit "act as me" grant vs. finer scopes (read-only vs.
  write). Default: **one grant**, the token can do anything its Account can; revisit if needed.
- OAuth providers beyond Google (e.g. GitHub). Default: Google only at launch.
- MCP token ↔ active org: which org an MCP `create_artefact` is stamped with when the token's
  Account belongs to several (the token's default/active org vs. an explicit tool arg). Leaning the
  Account's active org; confirm with the Tenancy context. **TBD.**
