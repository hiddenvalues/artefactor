import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_PATH: z.string().min(1).default("./data/artefactor.db"),
  ARTEFACTOR_PAYLOAD_DIR: z.string().min(1).default("./data/payloads"),
  // S35 — artefact card thumbnails. `off` never starts a browser: every card
  // shows the kind placeholder and nothing else changes (AH25). Thumbnails live
  // beside the payloads, never inside that directory.
  ARTEFACTOR_THUMBNAILS: z.enum(["on", "off"]).default("on"),
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
  // Google OAuth (BetterAuth social sign-in). Required in production, which is
  // Google-only; optional in dev/test where email+password is the method.
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
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
  // Production is Google-only (email+password is disabled there), so the Google
  // credentials are mandatory — without them no human could sign in.
  if (cfg.NODE_ENV === "production") {
    if (!cfg.GOOGLE_CLIENT_ID) {
      ctx.addIssue({
        code: "custom",
        path: ["GOOGLE_CLIENT_ID"],
        message: "GOOGLE_CLIENT_ID must be set in production (Google-only auth)",
      });
    }
    if (!cfg.GOOGLE_CLIENT_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["GOOGLE_CLIENT_SECRET"],
        message:
          "GOOGLE_CLIENT_SECRET must be set in production (Google-only auth)",
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

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast on misconfiguration.
  console.error("Invalid environment configuration:");
  console.error(z.treeifyError(parsed.error));
  process.exit(1);
}

export const env: Env = parsed.data;
