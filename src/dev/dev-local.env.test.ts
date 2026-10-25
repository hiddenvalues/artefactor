import { describe, expect, it } from "vitest";
import { devLocalEnv } from "./dev-local.env";
import { devServerConfig } from "./vite-dev-server";
import viteConfig from "../../vite.config";

// ALI-414 — `pnpm dev:local`: portless fronts Vite; Hono listens on its own
// loopback port behind Vite's proxy, and both learn the one public URL.
describe("devLocalEnv", () => {
  it("points Hono and Vite at each other under the portless URL", () => {
    const env = devLocalEnv({
      url: "https://ali-414.artefactor.localhost",
      vitePort: 4123,
      honoPort: 51234,
    });
    expect(env.server).toEqual({
      PORT: "51234",
      BETTER_AUTH_URL: "https://ali-414.artefactor.localhost",
      AUTH_TRUSTED_ORIGINS: "https://ali-414.artefactor.localhost",
    });
    expect(env.client).toEqual({
      ARTEFACTOR_DEV_CLIENT_PORT: "4123",
      ARTEFACTOR_DEV_API_TARGET: "http://127.0.0.1:51234",
    });
  });

  it("drops a trailing slash so the URL is a bare origin", () => {
    const env = devLocalEnv({ url: "https://artefactor.localhost/", vitePort: 4000, honoPort: 5000 });
    expect(env.server.BETTER_AUTH_URL).toBe("https://artefactor.localhost");
  });
});

describe("vite dev server config", () => {
  it("keeps plain `pnpm dev` on 5273 proxying to localhost:3000 when no env is set", () => {
    expect(devServerConfig({})).toEqual({
      port: 5273,
      target: "http://localhost:3000",
    });
    expect(viteConfig.server?.port).toBe(5273);
    expect(viteConfig.server?.strictPort).toBe(true);
    expect(viteConfig.server?.proxy).toEqual({
      "/api": "http://localhost:3000",
      "/health": "http://localhost:3000",
      "/a/": "http://localhost:3000",
    });
  });

  it("takes the port and proxy target the launcher passes", () => {
    expect(
      devServerConfig({ ARTEFACTOR_DEV_CLIENT_PORT: "4123", ARTEFACTOR_DEV_API_TARGET: "http://127.0.0.1:51234" }),
    ).toEqual({ port: 4123, target: "http://127.0.0.1:51234" });
  });
});
