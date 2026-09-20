// Identity & Access (IA) — which sign-in methods a deployment enables, and
// whether account creation is open, as a pure decision. See
// docs/specs/ddd/identity-access.md (the S38 amendment, IA7 and the amended IA4).
//
// Kept framework-free and unit-tested like `email-domain.ts`; `src/server/env.ts`
// resolves it once at boot and exports the result, so the BetterAuth config
// (`src/server/auth.ts`, `ee/server/auth.pg.ts`) and the public config route all
// read one value rather than re-deriving the rules.

export interface AuthConfigInput {
  nodeEnv: "development" | "test" | "production";
  /** `AUTH_EMAIL_PASSWORD`; `undefined` = unset, take the default. */
  emailPassword: boolean | undefined;
  /** `AUTH_ALLOW_SIGNUP`; `undefined` = unset, take the default. */
  allowSignup: boolean | undefined;
  /** Both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are present. */
  googleConfigured: boolean;
}

export interface AuthConfig {
  emailPasswordEnabled: boolean;
  googleEnabled: boolean;
  signupAllowed: boolean;
}

/**
 * Resolve the enabled sign-in methods and the sign-up gate.
 *
 * Defaults reproduce S1 exactly: email+password is on outside production and off
 * in it, and Google is on exactly when configured. The gate's default tracks
 * **verification** rather than environment — it is closed only when production
 * has the unverified email+password path open, since Google has already proven
 * the address it asserts. An explicit flag always wins.
 *
 * IA7 ("production has at least one enabled sign-in method") is *checked* on this
 * result by the env schema, not decided here: this function reports the
 * configuration, the schema refuses to boot on an unusable one.
 */
export function resolveAuthConfig(input: AuthConfigInput): AuthConfig {
  const emailPasswordEnabled =
    input.emailPassword ?? input.nodeEnv !== "production";
  return {
    emailPasswordEnabled,
    googleEnabled: input.googleConfigured,
    signupAllowed:
      input.allowSignup ??
      !(emailPasswordEnabled && input.nodeEnv === "production"),
  };
}
