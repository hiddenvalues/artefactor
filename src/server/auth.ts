import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { mcp } from "better-auth/plugins";
import { db } from "../infra/db/client";
import {
  account,
  oauthAccessToken,
  oauthApplication,
  oauthConsent,
  session,
  user,
  verification,
} from "../infra/db/schema";
import { authConfig, env } from "./env";
import { isEmailDomainAllowed } from "../domain/identity/email-domain";

// S1 — Identity & Access. BetterAuth owns users, sessions, and credential
// handling; it persists through the shared Drizzle/SQLite database. The domain
// only ever consumes the stable BetterAuth user id as `ownerId` (see
// docs/specs/ddd/identity-access.md).
//
// Two methods, both via BetterAuth, and which of them a deployment enables is
// configuration, not a rule of the environment (S38 / IA7 — resolved once in
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
  emailAndPassword: {
    // S38 — deployment configuration; see the module comment.
    enabled: authConfig.emailPasswordEnabled,
  },
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
  // IA invariant 4 (as amended by S38) — an Account may be created only when
  // sign-up is open **and** the email's domain is allowed. Enforced on the create
  // path so it covers *every* provider (Google and email+password); a refused
  // create can never sign in afterwards. It gates creation only: accounts that
  // already exist still sign in, and the MCP connector's OAuth flow authorises an
  // existing Account rather than creating one (IA2).
  databaseHooks: {
    user: {
      create: {
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
              message: `Sign-up is restricted to ${env.AUTH_ALLOWED_EMAIL_DOMAINS.join(
                " and ",
              )} accounts.`,
            });
          }
        },
      },
    },
  },
  // S18 — programmatic access via a remote MCP server. The `mcp` plugin embeds
  // an OIDC provider: it self-registers OAuth discovery (`.well-known/oauth-*`),
  // dynamic client registration (`/mcp/register`), authorize/consent/token, and
  // `getMcpSession` (bearer → Account) used to guard `POST /mcp`. `loginPage` is
  // where an unauthenticated authorize request is sent to sign in — the SPA root.
  // See docs/specs/ddd/identity-access.md "Programmatic access (MCP connector)".
  plugins: [mcp({ loginPage: "/" })],
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: {
      user,
      session,
      account,
      verification,
      oauthApplication,
      oauthAccessToken,
      oauthConsent,
    },
  }),
});

export type Auth = typeof auth;
