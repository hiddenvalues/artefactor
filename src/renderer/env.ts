import { dirname } from "node:path";
import { z } from "zod";

// S37 (AH29) — the renderer role's own configuration. It deliberately shares
// nothing with `src/server/env.ts`: that schema demands the app's secrets in
// production, and a renderer must hold none.
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  // Exit after answering one render, so the container's restart policy brings
  // back a clean process and an empty tmpfs for the next job.
  ARTEFACTOR_RENDERER_EXIT_AFTER_JOB: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  // Never exit before this much uptime: Docker resets its restart backoff only
  // for a container that ran ≥ 10 s (the S37 spike measured it).
  ARTEFACTOR_RENDERER_MIN_UPTIME_MS: z.coerce.number().int().nonnegative().default(10_000),
});

export type RendererEnv = z.infer<typeof schema>;

export function parseRendererEnv(raw: Record<string, string | undefined>): RendererEnv {
  return schema.parse(raw);
}

// App secrets that must never reach a renderer.
const SECRETS = ["BETTER_AUTH_SECRET", "GOOGLE_CLIENT_SECRET", "DATABASE_URL"] as const;

export interface SelfCheckProbe {
  uid: number;
  exists: (path: string) => boolean;
}

// S37 (AH29) — in production, the reason this renderer must not start, or null.
// The image bakes the app's storage paths into its env, so what counts is
// whether their directories are actually present (a mounted volume), not the
// variables.
export function selfCheck(
  env: RendererEnv,
  raw: Record<string, string | undefined>,
  probe: SelfCheckProbe,
): string | null {
  if (env.NODE_ENV !== "production") return null;
  for (const name of SECRETS) {
    if (raw[name]) return `${name} is set — a renderer must hold no app secrets`;
  }
  const storage: [string, string | undefined][] = [
    ["DATABASE_PATH", raw.DATABASE_PATH ? dirname(raw.DATABASE_PATH) : undefined],
    ["ARTEFACTOR_PAYLOAD_DIR", raw.ARTEFACTOR_PAYLOAD_DIR],
    ["ARTEFACTOR_THUMBNAIL_DIR", raw.ARTEFACTOR_THUMBNAIL_DIR],
  ];
  for (const [name, dir] of storage) {
    if (dir && probe.exists(dir)) {
      return `the ${name} directory ${dir} exists — a renderer must have no app storage mounted`;
    }
  }
  if (probe.uid === 0) return "running as root (uid 0) — run the renderer as an unprivileged user";
  return null;
}
