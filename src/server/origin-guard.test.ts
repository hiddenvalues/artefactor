import { beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { ArtefactSummary } from "../shared/contracts";
import { createOriginGuard } from "./middleware/origin-guard";
import { framingFromEnv } from "./runtime/framing";

// S36 (IA6) — cookie-authenticated state changes come only from the app origin.
describe("origin guard (S36, IA6)", () => {
  describe("the middleware", () => {
    const TRUSTED = ["https://app.example", "http://localhost:5273"];
    const app = new Hono();
    app.use("/api/*", createOriginGuard(TRUSTED));
    app.all("/api/*", (c) => c.text("reached"));

    const send = (method: string, path: string, headers: Record<string, string> = {}) =>
      app.request(path, { method, headers });

    it("refuses a state change from an untrusted or opaque Origin", async () => {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        expect((await send(method, "/api/x", { Origin: "null" })).status).toBe(403);
        expect((await send(method, "/api/x", { Origin: "https://evil.example" })).status).toBe(403);
      }
    });

    it("refuses a state change whose Sec-Fetch-Site isn't same-origin", async () => {
      for (const site of ["cross-site", "same-site", "none"]) {
        expect((await send("PUT", "/api/x", { "Sec-Fetch-Site": site })).status).toBe(403);
      }
    });

    it("refuses a trusted Origin paired with a cross-site fetch", async () => {
      const res = await send("PUT", "/api/x", {
        Origin: "https://app.example",
        "Sec-Fetch-Site": "cross-site",
      });
      expect(res.status).toBe(403);
    });

    it("lets through a trusted origin, same-origin fetch metadata, or neither header", async () => {
      expect((await send("PUT", "/api/x", { Origin: "https://app.example" })).status).toBe(200);
      expect((await send("PUT", "/api/x", { Origin: "http://localhost:5273" })).status).toBe(200);
      expect((await send("PUT", "/api/x", { "Sec-Fetch-Site": "same-origin" })).status).toBe(200);
      expect((await send("PUT", "/api/x")).status).toBe(200);
    });

    it("never checks a read", async () => {
      for (const method of ["GET", "HEAD", "OPTIONS"]) {
        const res = await send(method, "/api/x", { Origin: "null", "Sec-Fetch-Site": "cross-site" });
        expect(res.status).not.toBe(403);
      }
    });

    it("leaves /api/auth/* to BetterAuth", async () => {
      const res = await send("POST", "/api/auth/sign-in/email", {
        Origin: "null",
        "Sec-Fetch-Site": "cross-site",
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("reached");
    });
  });

  describe("trusted origins", () => {
    const base = {
      BETTER_AUTH_SECRET: "s",
      BETTER_AUTH_URL: "https://app.example/some/path",
      AUTH_TRUSTED_ORIGINS: ["http://localhost:5273/", "not a url"],
    };

    it("are the BETTER_AUTH_URL origin plus AUTH_TRUSTED_ORIGINS", () => {
      expect(framingFromEnv(base).trustedAppOrigins).toEqual([
        "https://app.example",
        "http://localhost:5273",
      ]);
    });

    it("never include the content origin, even when listed", () => {
      const framing = framingFromEnv({
        ...base,
        AUTH_TRUSTED_ORIGINS: ["https://content.example"],
        ARTEFACTOR_CONTENT_ORIGIN: "https://content.example",
      });
      expect(framing.trustedAppOrigins).toEqual(["https://app.example"]);
    });
  });

  describe("on the real app", () => {
    let app: Hono;
    let cookie: string;

    beforeAll(async () => {
      const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
      const { db } = await import("../infra/db/client");
      migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
      const { createApp } = await import("./app");
      app = createApp();
      const res = await app.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "owner-ia6@example.com",
          password: "correct-horse-battery",
          name: "ia6",
        }),
      });
      cookie = res.headers.get("set-cookie")!.split(";")[0]!;
    });

    async function makeArtefact(): Promise<ArtefactSummary> {
      const form = new FormData();
      form.set("title", "ia6");
      form.set("kind", "form");
      form.set("payload", new File(["<h1>ia6</h1>"], "a.html"));
      const res = await app.request("/api/artefacts", {
        method: "POST",
        body: form,
        headers: { cookie },
      });
      return (await res.json()) as ArtefactSummary;
    }

    const share = (id: string, headers: Record<string, string>) =>
      app.request(`/api/artefacts/${id}/visibility`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie, ...headers },
        body: JSON.stringify({ visibility: "public" }),
      });

    const visibilityOf = async (id: string) =>
      ((await (await app.request(`/api/artefacts/${id}`, { headers: { cookie } })).json()) as ArtefactSummary)
        .visibility;

    it("403 and nothing changed for Origin: null, a foreign Origin, or a cross-site fetch", async () => {
      const a = await makeArtefact();
      const refused: Record<string, string>[] = [
        { Origin: "null" },
        { Origin: "https://evil.example" },
        { "Sec-Fetch-Site": "cross-site" },
      ];
      for (const headers of refused) {
        expect((await share(a.id, headers)).status).toBe(403);
      }
      expect(await visibilityOf(a.id)).toBe("private");
    });

    it("200 from the app origin, an AUTH_TRUSTED_ORIGINS entry, or a client sending neither header", async () => {
      const admitted: Record<string, string>[] = [
        { Origin: "http://localhost:3000", "Sec-Fetch-Site": "same-origin" },
        { Origin: "http://localhost:5273" },
        {},
      ];
      for (const headers of admitted) {
        const a = await makeArtefact();
        expect((await share(a.id, headers)).status).toBe(200);
      }
    });

    it("a read with Origin: null isn't blocked by it", async () => {
      const res = await app.request("/api/me", { headers: { cookie, Origin: "null" } });
      expect(res.status).toBe(200);
    });

    it("POST /mcp with Origin: null isn't blocked by it (bearer-only, not under /api)", async () => {
      const res = await app.request("/mcp", {
        method: "POST",
        headers: { Origin: "null", "Content-Type": "application/json", Accept: "application/json" },
        body: "{}",
      });
      // No bearer → the connector's own 401, not the guard's 403.
      expect(res.status).toBe(401);
    });
  });
});
