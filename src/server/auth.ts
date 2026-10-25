import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../infra/db/client";
import {
  account,
  jwks,
  oauthAccessToken,
  oauthClient,
  oauthClientAssertion,
  oauthClientResource,
  oauthConsent,
  oauthRefreshToken,
  oauthResource,
  session,
  user,
  verification,
} from "../infra/db/schema";
import { authConfig, env } from "./env";
import { CLIENT_IP_HEADER } from "./client-ip";
import { authLog } from "./auth-log";
import {
  DOMAIN_NOT_ALLOWED_MESSAGE,
  isEmailDomainAllowed,
} from "../domain/identity/email-domain";
import { mcpAuthPlugins } from "./mcp/auth-plugins";

// S1 — Identity & Access. BetterAuth owns users, sessions, and credential
// handling; it persists through the shared Drizzle/SQLite database. The domain
// only ever consumes the stable BetterAuth user id as `ownerId` (see
// docs/specs/ddd/identity-access.md).
//
// Two methods, both via BetterAuth, and which of them a deployment enables is
// configuration, not a rule of the environment (S38 — resolved once in
// env.ts as `authConfig`):
//   - Google OAuth (social sign-in) — enabled when both credentials are set, the
//     production default. Google verifies the email; the allowlist below then
//     gates it to the configured domains.
//   - Email + password — `AUTH_EMAIL_PASSWORD`, defaulting to on outside
//     production and off in it. It is an **unverified** path while OSS carries no
//     mail transport, which is what the sign-up gate below exists for.

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  // The base URL origin is trusted implicitly; add the dev client origin so the
  // Vite SPA on :5273 can drive the auth API during development.
  trustedOrigins: env.AUTH_TRUSTED_ORIGINS,
  // S42 — the client address (rate limiter, stored `session.ipAddress`)
  // comes only from the header `createApp` sets, never from `X-Forwarded-For`.
  // r[impl identity.client-ip.better-auth-header]
  advanced: { ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] } },
  // S51 — BetterAuth's log prints what failed, never a value it was handed
  // (a failed OAuth callback's error carries the `state`).
  // r[impl identity.log.auth-log-app]
  logger: { log: authLog },
  emailAndPassword: {
    // S38 — deployment configuration; see the module comment.
    enabled: authConfig.emailPasswordEnabled,
  },
  // S57 — the email is read-only: BetterAuth's `change-email` stays off (its
  // default, stated explicitly for this auth instance; a superset that builds
  // its own instance keeps the default), and `update-user` refuses an email of
  // its own accord.
  // r[impl identity.account.email-read-only]
  user: { changeEmail: { enabled: false } },
  socialProviders: authConfig.googleEnabled
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID!,
          clientSecret: env.GOOGLE_CLIENT_SECRET!,
          // No `hd`: it only restricts a single Workspace domain, but the
          // allowlist may permit more than one. The create hook below is the
          // boundary that gates every provider.
        },
      }
    : undefined,
  // The sign-up gate (S38) — an Account may be created only when
  // sign-up is open **and** the email's domain is allowed. Enforced on the create
  // path so it covers *every* provider (Google and email+password); a refused
  // create can never sign in afterwards. It gates creation only: accounts that
  // already exist still sign in, and the MCP connector's OAuth flow authorises an
  // existing Account rather than creating one.
  databaseHooks: {
    user: {
      create: {
        // r[impl identity.signup.gate]
        before: async (newUser) => {
          // The gate is checked first, so a closed deployment does not disclose
          // which domains it allows.
          if (!authConfig.signupAllowed) {
            throw new APIError("FORBIDDEN", {
              message: "Sign-up is closed on this deployment.",
            });
          }
          if (
            !isEmailDomainAllowed(
              newUser.email,
              env.AUTH_ALLOWED_EMAIL_DOMAINS,
            )
          ) {
            throw new APIError("FORBIDDEN", {
              message: DOMAIN_NOT_ALLOWED_MESSAGE,
            });
          }
        },
      },
    },
  },
  // S18/S63 — programmatic access via a remote MCP server: the OAuth provider
  // and the `jwt` plugin, defined once for every deployment (`mcpAuthPlugins`).
  // r[impl hosting.magic-link.no-oss-endpoint]
  plugins: [...mcpAuthPlugins(env.BETTER_AUTH_URL)],
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: {
      user,
      session,
      account,
      verification,
      oauthClient,
      oauthResource,
      oauthClientResource,
      oauthRefreshToken,
      oauthAccessToken,
      oauthConsent,
      oauthClientAssertion,
      jwks,
    },
  }),
});

export type Auth = typeof auth;
