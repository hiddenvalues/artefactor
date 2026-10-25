// ALI-414 — the env `pnpm dev:local` hands each process. portless fronts Vite
// (the public-facing process, on the port portless assigned); Hono listens on a
// free loopback port behind Vite's proxy. Both learn the one public URL, so
// BetterAuth issues cookies for, and trusts, the origin the browser reaches.
export interface DevLocalEnv {
  server: { PORT: string; BETTER_AUTH_URL: string; AUTH_TRUSTED_ORIGINS: string };
  client: { ARTEFACTOR_DEV_CLIENT_PORT: string; ARTEFACTOR_DEV_API_TARGET: string };
}

export function devLocalEnv(input: { url: string; vitePort: number; honoPort: number }): DevLocalEnv {
  const origin = new URL(input.url).origin;
  return {
    server: {
      PORT: String(input.honoPort),
      BETTER_AUTH_URL: origin,
      AUTH_TRUSTED_ORIGINS: origin,
    },
    client: {
      ARTEFACTOR_DEV_CLIENT_PORT: String(input.vitePort),
      ARTEFACTOR_DEV_API_TARGET: `http://127.0.0.1:${input.honoPort}`,
    },
  };
}
