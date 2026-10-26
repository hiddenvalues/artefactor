import { createServer as createNetServer } from "node:net";
import type { ServerType } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromium, type Browser, type Frame, type Page } from "playwright-core";
import type { Hono } from "hono";
import type { ArtefactSummary } from "../shared/contracts";

// S36 (`hosting.frame.sandboxed`, `identity.origin.app-origin-only`) — the isolation, proven in a
// real Chromium against the real app and its real shell. CI installs `chromium-headless-shell` first (as
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

// The shell posts to, and the origin guard trusts, the app origin — so the app must think it
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

// S83 (`mcp.guide.write-at-once`) — an artefact that follows the guide's debounced snippet: a
// 400 ms timer, flushed on beforeunload (listened to only while a write waits) and on
// visibilitychange to hidden, setItem only in save().
const DEBOUNCED_FIXTURE = `<!doctype html><html><head><title>debounced</title></head><body>
<h1 id="seeded"></h1>
<script>
var value = localStorage.getItem("k");
document.getElementById("seeded").textContent = value || "empty";
function save(v) { try { localStorage.setItem("k", v); } catch (e) {} }
var t = null;
function saveSoon() {
  if (t) clearTimeout(t);
  t = setTimeout(flush, 400);
  window.addEventListener("beforeunload", flush);
}
function flush() {
  if (!t) return;
  clearTimeout(t); t = null;
  window.removeEventListener("beforeunload", flush);
  save(value);
}
document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "hidden") flush();
});
window.change = function (v) { value = v; saveSoon(); };
</script>
</body></html>`;

describe.skipIf(!runBrowserTests)("isolated artefact serving in Chromium (S36)", { timeout: 30_000 }, () => {
  let app: Hono;
  let server: ServerType;
  let browser: Browser;
  let cookie: string;
  let artefact: ArtefactSummary;
  let debounced: ArtefactSummary;
  // Cookie headers seen on /api/me requests: the canary for a leaked session.
  const meCookies: (string | null)[] = [];
  // Paths of the data saves the browser sends.
  const puts: string[] = [];

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
        if (req.method === "PUT") puts.push(new URL(req.url).pathname);
        return app.fetch(req);
      },
    });

    const signUp = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "browser-s36@example.com", password: "correct-horse-battery", name: "b" }),
    });
    cookie = signUp.headers.get("set-cookie")!.split(";")[0]!;
    const publish = async (html: string) => {
      const form = new FormData();
      form.set("title", "browser fixture");
      form.set("kind", "form");
      form.set("payload", new File([html], "fixture.html"));
      const created = (await (
        await app.request("/api/artefacts", { method: "POST", body: form, headers: { cookie } })
      ).json()) as ArtefactSummary;
      return (await (
        await app.request(`/api/artefacts/${created.id}/visibility`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", cookie },
          body: JSON.stringify({ visibility: "authenticated" }),
        })
      ).json()) as ArtefactSummary;
    };
    artefact = await publish(FIXTURE);
    debounced = await publish(DEBOUNCED_FIXTURE);

    browser = await chromium.launch();
  });

  afterAll(async () => {
    vi.useRealTimers();
    await browser?.close();
    await new Promise((resolve) => (server ? server.close(resolve) : resolve(null)));
  });

  // A signed-in browser page on the artefact's shell, and its artefact frame.
  async function openShell(target = artefact): Promise<{ page: Page; frame: () => Promise<Frame> }> {
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
    await page.goto(`${ORIGIN}/a/${target.publicSlug}`);
    const frame = async () => {
      const f = (await (await page.waitForSelector("#ae-frame")).contentFrame())!;
      await f.waitForSelector("#seeded");
      return f;
    };
    await frame();
    return { page, frame };
  }

  async function savedBlob(target = artefact): Promise<string | null> {
    const res = await app.request(`/api/artefacts/${target.id}/data/me`, { headers: { cookie } });
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

  // r[verify hosting.frame.sandboxed]
  // r[verify hosting.frame.no-cookies]
  // r[verify identity.origin.app-origin-only+2]
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

  // r[verify hosting.frame.shim-posts-to-shell+2]
  // r[verify hosting.frame.shell-saves-for-frame+2]
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

  // The artefact reloads its own frame (the top page stays): none of the
  // shell's own unload events fire. The change made in the same task still
  // reaches the shell and is saved. The reloaded document is requested before
  // that save lands (measured: the PUT reaches the server ~1 ms after the
  // frame's GET, on main as here, and a frame-sent "unloading" hint doesn't
  // change that), so it may come back seeded with the older data: a named
  // residual loss of data.shell.writes-pinned, not asserted either way.
  // r[verify data.shell.debounces-and-flushes]
  // r[verify data.shim.writes-through-shell+2]
  // r[verify data.shell.writes-pinned+3]
  it("a change made just before the artefact reloads its own frame is saved", async () => {
    const { page } = await openShell();
    // What the frame's current document shows, or null while it is still the
    // document that asked for the reload.
    const shown = async () => {
      try {
        const f = (await (await page.$("#ae-frame"))!.contentFrame())!;
        return (await f.evaluate(
          `window.__reloading ? null : (document.getElementById("seeded") || {}).textContent || null`,
        )) as string | null;
      } catch {
        return null;
      }
    };
    const reloadWith = async (script: string) => {
      const f = (await (await page.$("#ae-frame"))!.contentFrame())!;
      await f.evaluate(`window.__reloading = true; ${script}; location.reload();`).catch(() => {});
    };
    try {
      for (let i = 0; i < 5; i++) {
        const value = `in-frame-${i}`;
        await reloadWith(`localStorage.setItem("k", ${JSON.stringify(value)})`);
        expect(await until(savedBlob, (b) => b === JSON.stringify({ k: value }))).toBe(JSON.stringify({ k: value }));
        // The reloaded document is up (whichever data it was seeded with).
        expect(await until(shown, (v) => v !== null)).not.toBeNull();
        // A reloaded document seeded before the save landed would save under
        // a pin it wasn't built on (the residual loss): start each round from
        // a freshly seeded page.
        await page.reload();
        expect(await until(shown, (v) => v === value)).toBe(value);
      }
      // The reset pattern: clear, then reload.
      await reloadWith(`localStorage.clear()`);
      expect(await until(savedBlob, (b) => b === "{}")).toBe("{}");
      expect(await until(shown, (v) => v !== null)).not.toBeNull();
    } finally {
      await page.context().close();
    }
  });

  // r[verify data.shell.debounces-and-flushes]
  // r[verify data.shim.writes-through-shell+2]
  it("a change made just before the top page reloads is saved", async () => {
    const { page, frame } = await openShell();
    try {
      for (let i = 0; i < 5; i++) {
        const value = `late-${i}`;
        await (await frame()).evaluate(`localStorage.setItem("k", ${JSON.stringify(value)})`);
        await page.reload();
        expect(await (await frame()).textContent("#seeded")).toBe(value);
        expect(await savedBlob()).toBe(JSON.stringify({ k: value }));
      }
    } finally {
      await page.context().close();
    }
  });

  // r[verify mcp.guide.write-at-once]
  // r[verify data.shell.writes-pinned+3]
  it("a debounced change, flushed as the guide says, survives a reload of the top page", async () => {
    const { page, frame } = await openShell(debounced);
    try {
      for (let i = 0; i < 5; i++) {
        const value = `debounced-${i}`;
        await (await frame()).evaluate(`window.change(${JSON.stringify(value)})`);
        await page.reload();
        expect(await (await frame()).textContent("#seeded")).toBe(value);
        expect(await savedBlob(debounced)).toBe(JSON.stringify({ k: value }));
      }
    } finally {
      await page.context().close();
    }
  });

  // r[verify mcp.guide.write-at-once]
  // r[verify data.shell.writes-pinned+3]
  it("a debounced change, flushed as the guide says, survives closing the page", async () => {
    for (let i = 0; i < 5; i++) {
      const value = `closed-${i}`;
      const { page, frame } = await openShell(debounced);
      try {
        await (await frame()).evaluate(`window.change(${JSON.stringify(value)})`);
        await page.close({ runBeforeUnload: true });
        expect(await until(() => savedBlob(debounced), (b) => b === JSON.stringify({ k: value }))).toBe(
          JSON.stringify({ k: value }),
        );
      } finally {
        await page.context().close();
      }
    }
  });

  // r[verify mcp.guide.write-at-once]
  it("the guide's flush writes nothing when no change is waiting", async () => {
    const { page, frame } = await openShell(debounced);
    try {
      await frame();
      const before = puts.length;
      await page.close({ runBeforeUnload: true });
      await new Promise((r) => setTimeout(r, 1_500));
      expect(puts.slice(before).filter((p) => p.endsWith("/data/me"))).toEqual([]);
    } finally {
      await page.context().close();
    }
  });

  // r[verify mcp.guide.write-at-once]
  it("the guide's snippet listens for beforeunload only while a write is waiting", async () => {
    const { page, frame } = await openShell(debounced);
    try {
      const f = await frame();
      // The frame shares its page's CDP session: find its main world among the contexts that
      // Runtime.enable reports, and ask DevTools for the listeners on its window.
      const cdp = await page.context().newCDPSession(page);
      const { frameTree } = await cdp.send("Page.getFrameTree");
      const frameId = frameTree.childFrames!.find((c) => c.frame.url === f.url())!.frame.id;
      const contexts: { id: number; frameId?: string; isDefault?: boolean }[] = [];
      cdp.on("Runtime.executionContextCreated", ({ context }) =>
        contexts.push({ id: context.id, ...(context.auxData as { frameId?: string; isDefault?: boolean }) }),
      );
      await cdp.send("Runtime.enable");
      const executionContextId = contexts.find((c) => c.frameId === frameId && c.isDefault)!.id;
      const beforeUnloadListeners = async () => {
        const { result } = await cdp.send("Runtime.evaluate", { expression: "window", contextId: executionContextId });
        const { listeners } = await cdp.send("DOMDebugger.getEventListeners", { objectId: result.objectId! });
        return listeners.filter((l) => l.type === "beforeunload").length;
      };
      expect(await beforeUnloadListeners()).toBe(0);
      await f.evaluate(`window.change("waiting")`);
      expect(await beforeUnloadListeners()).toBe(1);
      expect(await until(beforeUnloadListeners, (n) => n === 0)).toBe(0);
    } finally {
      await page.context().close();
    }
  });
});
