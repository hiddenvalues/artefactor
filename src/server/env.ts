import { z } from "zod";
import { contentOriginProblem } from "./runtime/content-origin";
import { resolveAuthConfig, type AuthConfig } from "../domain/identity/auth-config";

// An optional string an operator may leave blank: `${VAR:-}` in a compose file
// hands the process an empty string, which means "not configured", not "a value
// of length zero". (`ARTEFACTOR_RENDERER_URL` in the schema below does the same inline.)
const blankAsUnset = <T extends z.ZodType>(inner: T) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    inner,
  );

// S38 — an optional operator boolean. `true|false|1|0` case-insensitively; an
// **empty string parses as unset**, so a `${AUTH_EMAIL_PASSWORD:-}` pass-through
// in compose means "take the default", not a boot failure.
const optionalBoolean = (name: string) =>
  z.preprocess((v) => {
    if (v === undefined || v === "") return undefined;
    if (typeof v !== "string") return v;
    const s = v.trim().toLowerCase();
    if (s === "") return undefined;
    if (s === "true" || s === "1") return true;
    if (s === "false" || s === "0") return false;
    return v;
  }, z.boolean({ error: `${name} must be true, false, 1 or 0` }).optional());

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_PATH: z.string().min(1).default("./data/artefactor.db"),
  ARTEFACTOR_PAYLOAD_DIR: z.string().min(1).default("./data/payloads"),
  // S37 (AH29) — the isolated thumbnail renderer (`ARTEFACTOR_ROLE=renderer`, a
  // separate hardened container from the same image; see
  // docs/renderer-isolation.md). Unset (or empty): no renderer — every card shows
  // the kind placeholder and nothing else changes (AH25). S35's
  // `ARTEFACTOR_THUMBNAILS` is gone; a leftover value is ignored.
  ARTEFACTOR_RENDERER_URL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.url({ protocol: /^https?$/, message: "ARTEFACTOR_RENDERER_URL must be an absolute http(s) URL" }).optional(),
  ),
  // S35 — thumbnails live beside the payloads, never inside that directory.
  ARTEFACTOR_THUMBNAIL_DIR: z.string().min(1).default("./data/thumbnails"),
  MIGRATIONS_DIR: z.string().min(1).default("./src/infra/db/migrations"),
  CLIENT_DIR: z.string().min(1).default("./dist/client"),
  // The authoring skill surfaced through the MCP connector (S18) — Claude design
  // can use the connector but cannot load Agent Skills, so `get_authoring_guide`
  // serves this file's body. Must point at a file present in the runtime image
  // (the Dockerfile copies `skills/` for exactly this).
  AUTHORING_GUIDE_PATH: z
    .string()
    .min(1)
    .default("./skills/artefactor/SKILL.md"),
  // Git commit the image was built from; stamped by the Docker build-arg in CI
  // (see .github/workflows/deploy.yml) and surfaced at GET /health.
  GIT_SHA: z.string().min(1).default("dev"),
  // BetterAuth (S1 — Identity). Secret signs sessions/tokens; in production it
  // MUST be supplied. A fixed dev/test default keeps local runs zero-config.
  BETTER_AUTH_SECRET: z.string().min(1).default("dev-insecure-secret-change-me"),
  // Public base URL BetterAuth issues callbacks/cookies against.
  BETTER_AUTH_URL: z.string().min(1).default("http://localhost:3000"),
  // Comma-separated extra origins allowed to call the auth API (e.g. the Vite
  // dev server on :5273). The BETTER_AUTH_URL origin is always trusted.
  AUTH_TRUSTED_ORIGINS: z
    .string()
    .default("http://localhost:5273")
    .transform((s) =>
      s
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  // S36 (AH28) — optional origin (`scheme://host[:port]`, no path) that artefact
  // frames are served on, on a **separate registrable domain** from the app
  // (e.g. https://humlycontent.com). That host answers only the frame routes and
  // /health. Unset: frames live on the app host, isolated by the sandbox alone.
  ARTEFACTOR_CONTENT_ORIGIN: z.string().min(1).optional(),
  // Google OAuth (BetterAuth social sign-in). Enabled exactly when both are set.
  // In production they are required *unless* AUTH_EMAIL_PASSWORD=true — a
  // production deployment needs at least one sign-in method (S38, IA7).
  // A **blank** value reads as unset rather than as a length violation: the
  // compose file passes `${GOOGLE_CLIENT_ID:-}`, so a deployment that configures
  // no Google client hands us an empty string, and half a credential pair would
  // otherwise enable a provider that cannot work.
  GOOGLE_CLIENT_ID: blankAsUnset(z.string().min(1).optional()),
  GOOGLE_CLIENT_SECRET: blankAsUnset(z.string().min(1).optional()),
  // S38 (IA7) — the credential provider. Unset: on outside production, off in it
  // (S1's behaviour). Set it to open email+password on a deployment that does not
  // want a Google dependency.
  AUTH_EMAIL_PASSWORD: optionalBoolean("AUTH_EMAIL_PASSWORD"),
  // S38 (IA4, amended) — the account-creation gate, checked beside the domain
  // allowlist in the one user-create hook, so it covers every provider. Unset, it
  // is closed only when production has the unverified email+password path open
  // (see domain/identity/auth-config.ts).
  AUTH_ALLOW_SIGNUP: optionalBoolean("AUTH_ALLOW_SIGNUP"),
  // Account creation is restricted to these email domains, for every provider
  // (IA invariant 4). Comma-separated; matched case-insensitively, exact domain.
  AUTH_ALLOWED_EMAIL_DOMAINS: z
    .string()
    // Generic dev/test default; set the real org domain(s) in production via env.
    .default("example.com")
    .transform((s) =>
      s
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean),
    ),
}).superRefine((cfg, ctx) => {
  // Never ship the placeholder secret to production.
  if (
    cfg.NODE_ENV === "production" &&
    cfg.BETTER_AUTH_SECRET === "dev-insecure-secret-change-me"
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["BETTER_AUTH_SECRET"],
      message: "BETTER_AUTH_SECRET must be set in production",
    });
  }
  // S38 / IA7 — a production deployment must have at least one enabled sign-in
  // method, or no human could ever sign in. Which methods are enabled is
  // configuration (the pure `resolveAuthConfig`); this is the boot-time check on
  // its result, and the message names both ways out.
  if (cfg.NODE_ENV === "production") {
    const authConfig = resolveAuthConfig({
      nodeEnv: cfg.NODE_ENV,
      emailPassword: cfg.AUTH_EMAIL_PASSWORD,
      allowSignup: cfg.AUTH_ALLOW_SIGNUP,
      googleConfigured: Boolean(cfg.GOOGLE_CLIENT_ID && cfg.GOOGLE_CLIENT_SECRET),
    });
    if (!authConfig.emailPasswordEnabled && !authConfig.googleEnabled) {
      ctx.addIssue({
        code: "custom",
        path: ["NODE_ENV"],
        message:
          "production needs a sign-in method: set GOOGLE_CLIENT_ID + " +
          "GOOGLE_CLIENT_SECRET, or AUTH_EMAIL_PASSWORD=true",
      });
    }
  }
  // S36 — a content origin sharing the app's host, a subdomain or a parent
  // domain would share its cookies and site, defeating the point.
  if (cfg.ARTEFACTOR_CONTENT_ORIGIN !== undefined) {
    const problem = contentOriginProblem(cfg.ARTEFACTOR_CONTENT_ORIGIN, cfg.BETTER_AUTH_URL);
    if (problem) {
      ctx.addIssue({
        code: "custom",
        path: ["ARTEFACTOR_CONTENT_ORIGIN"],
        message: `ARTEFACTOR_CONTENT_ORIGIN ${problem}`,
      });
    }
  }
  // An empty allowlist would lock everyone out — guard against a misconfigured
  // AUTH_ALLOWED_EMAIL_DOMAINS (e.g. set to "" or only commas).
  if (cfg.AUTH_ALLOWED_EMAIL_DOMAINS.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["AUTH_ALLOWED_EMAIL_DOMAINS"],
      message: "AUTH_ALLOWED_EMAIL_DOMAINS must list at least one domain",
    });
  }
});

export type Env = z.infer<typeof schema>;

// The schema itself, for validating a configuration without starting the app.
export const envSchema = schema;

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast on misconfiguration.
  console.error("Invalid environment configuration:");
  console.error(z.treeifyError(parsed.error));
  process.exit(1);
}

export const env: Env = parsed.data;

// S38 — the resolved sign-in configuration, decided once at boot so the
// BetterAuth instances (`auth.ts`, `ee/server/auth.pg.ts`) and the public config
// route all read one value rather than re-deriving the rules. IA7 has already
// been checked above, so in production at least one method is enabled here.
export const authConfig: AuthConfig = resolveAuthConfig({
  nodeEnv: env.NODE_ENV,
  emailPassword: env.AUTH_EMAIL_PASSWORD,
  allowSignup: env.AUTH_ALLOW_SIGNUP,
  googleConfigured: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
});
