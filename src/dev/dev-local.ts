import { createServer } from "node:net";
import concurrently from "concurrently";
import { devLocalEnv } from "./dev-local.env";

// ALI-414 — `pnpm dev:local` = `portless run tsx src/dev/dev-local.ts`. portless
// hands this process the public URL (`PORTLESS_URL`: https://artefactor.localhost,
// or https://<branch>.artefactor.localhost in a worktree) and the port it proxies
// to (`PORT`). Vite takes that port; Hono gets a free loopback port behind Vite's
// proxy. Plain `pnpm dev` is untouched.

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const s = createServer();
    s.once("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => done(port));
    });
  });
}

const url = process.env.PORTLESS_URL;
const vitePort = Number(process.env.PORT);
if (!url || !Number.isInteger(vitePort) || vitePort <= 0) {
  console.error("dev-local: run it through portless — `pnpm dev:local` — which sets PORTLESS_URL and PORT.");
  process.exit(1);
}

const env = devLocalEnv({ url, vitePort, honoPort: await freePort() });
console.log(`Artefactor on ${env.server.BETTER_AUTH_URL} (Vite :${vitePort}, Hono :${env.server.PORT})`);

const { result } = concurrently(
  [
    // portless proxies to 127.0.0.1, so Vite must listen there rather than on
    // whichever address `localhost` resolves to first.
    { command: "vite --host 127.0.0.1", name: "client", prefixColor: "cyan", env: env.client },
    { command: "tsx watch src/server/index.ts", name: "server", prefixColor: "magenta", env: env.server },
  ],
  { killOthersOn: ["failure", "success"] },
);
result.then(
  () => process.exit(0),
  () => process.exit(1),
);
