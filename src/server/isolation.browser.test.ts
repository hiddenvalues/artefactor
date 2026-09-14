import { createServer as createNetServer } from "node:net";
import type { ServerType } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromium, type Browser, type Frame, type Page } from "playwright-core";
import type { Hono } from "hono";
import type { ArtefactSummary } from "../shared/contracts";

// S36 (AH28, AD10, IA6) — the isolation, proven in a real Chromium against the
// real app and its real shell. CI installs `chromium-headless-shell` first (as
// for the S35 renderer), so this always runs there; locally it skips only when
// no browser is installed.
const chromiumAvailable = await chromium
  .launch()
  .then((b) => b.close())
  .then(
    () => true,
    () => false,
  );
const runBrowserTests = chromiumAvailable || Boolean(process.env.CI);

// The shell posts to, and IA6 trusts, the app origin — so the app must think it
// lives where the browser reaches it. Pick the port before the app is imported.
const port = await new Promise<number>((resolve) => {
  const s = createNetServer().listen(0, () => {
    const p = (s.address() as { port: number }).port;
    s.close(() => resolve(p));
  });
});
const ORIGIN = `http://localhost:${port}`;
process.env.BETTER_AUTH_URL = ORIGIN;

const FIXTURE = `<!doctype html><html><head><title>fixture</title></head><body>
<h1 id="seeded"></h1>
<script>document.getElementById("seeded").textContent = localStorage.getItem("k") || "empty";</script>
<form id="archive" method="POST"></form>
</body></html>`;

describe.skipIf(!runBrowserTests)("isolated artefact serving in Chromium (S36)", { timeout: 30_000 }, () => {
  let app: Hono;
  let server: ServerType;
  let browser: Browser;
  let cookie: string;
  let artefact: ArtefactSummary;
  // Cookie headers seen on /api/me requests: the canary for a leaked session.
  const meCookies: (string | null)[] = [];

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db } = await import("../infra/db/client");
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    const { createApp } = await import("./app");
    const { serve } = await import("@hono/node-server");
    app = createApp();
    server = serve({
      port,
      fetch: (req: Request) => {
        if (new URL(req.url).pathname === "/api/me") meCookies.push(req.headers.get("cookie"));
        return app.fetch(req);
      },
    });

    const signUp = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "browser-s36@example.com", password: "correct-horse-battery", name: "b" }),
    });
    cookie = signUp.headers.get("set-cookie")!.split(";")[0]!;
    const form = new FormData();
    form.set("title", "browser fixture");
    form.set("kind", "form");
    form.set("payload", new File([FIXTURE], "fixture.html"));
    const created = (await (
      await app.request("/api/artefacts", { method: "POST", body: form, headers: { cookie } })
    ).json()) as ArtefactSummary;
    artefact = (await (
      await app.request(`/api/artefacts/${created.id}/visibility`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ visibility: "authenticated" }),
      })
    ).json()) as ArtefactSummary;

    browser = await chromium.launch();
  });

  afterAll(async () => {
    vi.useRealTimers();
    await browser?.close();
    await new Promise((resolve) => (server ? server.close(resolve) : resolve(null)));
  });

  // A signed-in browser page on the artefact's shell, and its artefact frame.
  async function openShell(): Promise<{ page: Page; frame: () => Promise<Frame> }> {
    const context = await browser.newContext();
    const eq = cookie.indexOf("=");
    await context.addCookies([
      {
        name: cookie.slice(0, eq),
        value: cookie.slice(eq + 1),
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/a/${artefact.publicSlug}`);
    const frame = async () => {
      const f = (await (await page.waitForSelector("#ae-frame")).contentFrame())!;
      await f.waitForSelector("#seeded");
      return f;
    };
    await frame();
    return { page, frame };
  }

  async function savedBlob(): Promise<string | null> {
    const res = await app.request(`/api/artefacts/${artefact.id}/data/me`, { headers: { cookie } });
    return ((await res.json()) as { blob: string | null }).blob;
  }

  async function until<T>(probe: () => Promise<T>, ok: (v: T) => boolean, ms = 10_000): Promise<T> {
    const deadline = Date.now() + ms;
    for (;;) {
      const v = await probe();
      if (ok(v) || Date.now() > deadline) return v;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  it("the artefact can't read the session cookie, read the API, or change state", async () => {
    const { page, frame } = await openShell();
    const f = await frame();

    // The frame's own globals, so evaluated as page source (the server tsconfig
    // has no DOM lib).
    expect(
      await f.evaluate(`(() => {
        try { return "read " + document.cookie; } catch (e) { return "threw " + e.name; }
      })()`),
    ).toBe("threw SecurityError");

    const before = meCookies.length;
    const read = await f.evaluate(`(async () => {
      try {
        const res = await fetch("/api/me", { credentials: "include" });
        return "read " + res.status + " " + (await res.text());
      } catch (e) {
        return "threw " + e.name;
      }
    })()`);
    expect(read).toBe("threw TypeError");
    const seen = meCookies.slice(before);
    expect(seen.length).toBeGreaterThan(0);
    for (const header of seen) expect(header ?? "").not.toContain("better-auth.session_token");

    await f.evaluate(`(() => {
      const form = document.getElementById("archive");
      form.action = ${JSON.stringify(`/api/artefacts/${artefact.id}/archive`)};
      form.submit();
    })()`);
    await page.waitForTimeout(1000);
    const summary = (await (
      await app.request(`/api/artefacts/${artefact.id}`, { headers: { cookie } })
    ).json()) as ArtefactSummary;
    expect(summary.status).toBe("active");
    await page.context().close();
  });

  it("localStorage persists through the shell, and an in-frame reload after the token expired comes back seeded", async () => {
    const first = await openShell();
    await (await first.frame()).evaluate(`localStorage.setItem("k", "persisted")`);
    expect(await until(savedBlob, (b) => b === '{"k":"persisted"}')).toBe('{"k":"persisted"}');

    await first.page.reload();
    const reloaded = await first.frame();
    expect(await reloaded.textContent("#seeded")).toBe("persisted");

    // Move the server's clock past the token's five minutes, then let the
    // artefact reload itself: the frame gets the expired page, the shell mints a
    // fresh URL, and the artefact comes back with its data.
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    try {
      const requests: string[] = [];
      first.page.on("request", (r) => requests.push(r.url()));
      await reloaded.evaluate(`location.reload()`);
      const text = await until(
        async () => {
          try {
            const f = (await (await first.page.$("#ae-frame"))!.contentFrame())!;
            return await f.textContent("#seeded", { timeout: 500 });
          } catch {
            return null;
          }
        },
        (v) => v === "persisted" && requests.some((u) => u.includes("/frame-token")),
      );
      expect(requests.some((u) => u.endsWith("/frame-token"))).toBe(true);
      expect(text).toBe("persisted");
    } finally {
      vi.useRealTimers();
      await first.page.context().close();
    }
  });
});
