// ALI-414 — the Vite dev server's port and API proxy target. Plain `pnpm dev`
// sets neither variable and keeps 5273 → http://localhost:3000; `pnpm dev:local`
// (`src/dev/dev-local.ts`) passes the port portless assigned and Hono's.
export interface DevServerEnv {
  ARTEFACTOR_DEV_CLIENT_PORT?: string;
  ARTEFACTOR_DEV_API_TARGET?: string;
}

export function devServerConfig(env: DevServerEnv): { port: number; target: string } {
  return {
    port: env.ARTEFACTOR_DEV_CLIENT_PORT ? Number(env.ARTEFACTOR_DEV_CLIENT_PORT) : 5273,
    target: env.ARTEFACTOR_DEV_API_TARGET || "http://localhost:3000",
  };
}
