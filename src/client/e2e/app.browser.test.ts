import { mkdtempSync, readdirSync, readFileSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ServerType } from "@hono/node-server";
import type { Hono } from "hono";
import { chromium, type Browser, type BrowserContext, type Locator, type Page, type Route } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FRAME_HOLD_MAX_MS } from "../../server/runtime/shell";
import { SHELL_TOKENS } from "../../server/runtime/shell-theme";
import type { ArtefactSummary, InviteResult, ShareInvitation } from "../../shared/contracts";
import { MCP_REDIRECT, pkce, registerClient } from "../../test/mcp-oauth";

// S43 — React client on stock shadcn/ui: the behaviour suite. It drives the
// *built* client in a real Chromium against the real app on a throwaway SQLite
// database (the S35/S36 pattern). It was written against the Svelte app and
// passes unchanged on the React app, so its selectors lean on what a user sees —
// text, labels, titles — never on either framework's markup. CI installs
// `chromium-headless-shell`, so it always runs there; locally it skips only when
// no browser is installed.
const chromiumAvailable = await chromium
  .launch()
  .then((b) => b.close())
  .then(
    () => true,
    () => false,
  );
const runBrowserTests = chromiumAvailable || Boolean(process.env.CI);

// BetterAuth trusts, and sets cookies for, the origin the browser reaches — so
// the app must know its port before it is imported.
const port = await new Promise<number>((done) => {
  const s = createNetServer().listen(0, () => {
    const p = (s.address() as { port: number }).port;
    s.close(() => done(p));
  });
});
const ORIGIN = `http://localhost:${port}`;
process.env.BETTER_AUTH_URL = ORIGIN;
const work = mkdtempSync(join(tmpdir(), "artefactor-client-e2e-"));
const CLIENT_DIR = join(work, "client");
process.env.CLIENT_DIR = CLIENT_DIR;

const PASSWORD = "correct-horse-battery";
const MAX_PAYLOAD_BYTES = 100 * 1024 * 1024;

function html(title: string, padBytes = 0): string {
  return `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1><!--${"x".repeat(padBytes)}--></body></html>`;
}

// Retries an assertion until it holds or the deadline passes (playwright-core
// has no auto-retrying `expect`).
async function eventually(check: () => Promise<void> | void, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      await check();
      return;
    } catch (e) {
      if (Date.now() > deadline) throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

const exact = (text: string) => new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);

// Anything a user clicks: a button, a link, a menu item, a radio, a tab.
const CLICKABLE = ':is(button, a, [role="menuitem"], [role="menuitemradio"], [role="radio"], [role="option"], [role="tab"])';
const control = (scope: Page | Locator, text: string | RegExp) =>
  scope.locator(CLICKABLE, { hasText: typeof text === "string" ? exact(text) : text });

// Each test signs up its own user and opens its own browser context, so the tests
// run concurrently. `concurrent` is an option here: `describe.concurrent.skipIf`
// drops it.
describe.skipIf(!runBrowserTests)("the client's flows in Chromium (S43)", { concurrent: true, timeout: 60_000 }, () => {
  let app: Hono;
  let server: ServerType;
  let browser: Browser;
  let seq = 0;

  beforeAll(async () => {
    const { build } = await import("vite");
    await build({
      configFile: resolve("vite.config.ts"),
      logLevel: "silent",
      build: { outDir: CLIENT_DIR, emptyOutDir: true },
    });
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db } = await import("../../infra/db/client");
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    const { createApp } = await import("../../server/app");
    const { serve } = await import("@hono/node-server");
    app = createApp();
    server = serve({ port, fetch: app.fetch });
    browser = await chromium.launch();
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    await new Promise((done) => (server ? server.close(done) : done(null)));
  });

  interface User {
    name: string;
    email: string;
    cookie: string;
  }

  async function newUser(name = "Ada Lovelace"): Promise<User> {
    seq += 1;
    const email = `s43-${seq}-${Date.now()}@example.com`;
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD, name }),
    });
    expect(res.status).toBe(200);
    return { name, email, cookie: res.headers.get("set-cookie")!.split(";")[0]! };
  }

  async function createArtefact(u: User, title: string, kind = "prototype", payload = html(title)): Promise<ArtefactSummary> {
    const form = new FormData();
    form.set("title", title);
    form.set("kind", kind);
    form.set("payload", new File([payload], "a.html"));
    const res = await app.request("/api/artefacts", { method: "POST", body: form, headers: { cookie: u.cookie } });
    expect(res.status).toBe(201);
    return (await res.json()) as ArtefactSummary;
  }

  async function setVisibility(u: User, id: string, visibility: string): Promise<void> {
    const res = await app.request(`/api/artefacts/${id}/visibility`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie: u.cookie },
      body: JSON.stringify({ visibility }),
    });
    expect(res.status).toBe(200);
  }

  async function archive(u: User, id: string): Promise<void> {
    const res = await app.request(`/api/artefacts/${id}/archive`, { method: "POST", headers: { cookie: u.cookie } });
    expect(res.ok).toBe(true);
  }

  async function createCollection(u: User, name: string): Promise<{ id: string }> {
    const res = await app.request("/api/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: u.cookie },
      body: JSON.stringify({ name }),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string };
  }

  async function context(
    u?: User,
    colorScheme: "light" | "dark" = "light",
    viewport = { width: 1400, height: 900 },
  ): Promise<BrowserContext> {
    const ctx = await browser.newContext({ viewport, colorScheme });
    await ctx.grantPermissions(["clipboard-write"], { origin: ORIGIN });
    // One Chromium holds one clipboard for every context, and the tests run
    // concurrently: each page keeps what it last copied, which `copied` reads.
    await ctx.addInitScript(() => {
      const clipboard = navigator.clipboard;
      // Only a secure context has one.
      if (!clipboard) return;
      const write = clipboard.writeText.bind(clipboard);
      clipboard.writeText = async (text) => {
        await write(text);
        (window as unknown as { copied: string }).copied = text;
      };
    });
    if (u) {
      const eq = u.cookie.indexOf("=");
      await ctx.addCookies([
        {
          name: u.cookie.slice(0, eq),
          value: u.cookie.slice(eq + 1),
          domain: "localhost",
          path: "/",
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
    }
    return ctx;
  }

  // A signed-in page on the dashboard.
  async function openApp(u: User): Promise<Page> {
    const page = await (await context(u)).newPage();
    await page.goto(ORIGIN);
    await page.getByRole("heading", { name: "Home" }).waitFor();
    return page;
  }

  // The text the page last wrote to the clipboard.
  const copied = (page: Page) => page.evaluate(() => (window as unknown as { copied?: string }).copied);

  const visible = (l: Locator) => l.first().waitFor({ state: "visible" });
  const gone = (l: Locator) => l.first().waitFor({ state: "hidden" });

  // The title an item opens by — every card and row carries exactly one
  // "Open <title>" control, in display order.
  async function shownTitles(page: Page): Promise<string[]> {
    const labels = await page
      .locator("main [aria-label^='Open ']:not([data-recent] *)")
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!.slice("Open ".length)));
    return [...new Set(labels)];
  }

  // Every card's own ⋯ menu; the item for `title` is the one inside its card.
  async function cardMenu(page: Page, title: string): Promise<void> {
    const titles = await shownTitles(page);
    const index = titles.indexOf(title);
    expect(index).toBeGreaterThanOrEqual(0);
    const onCollectionPage = await page.locator("main h1").count().then(async (n) =>
      n > 0 && !["Home"].includes((await page.locator("main h1").first().innerText()).trim()),
    );
    // A collection page's header carries its own ⋯ ahead of the cards'.
    await openMenu(page, page.locator("main [title^='More']:not([data-recent] *)").nth(index + (onCollectionPage ? 1 : 0)));
  }

  // Opens a menu once the last one has fully gone: a closing menu stays mounted
  // for its exit animation, and a press that lands then reads as a click
  // outside it — one no person is quick enough to make.
  async function openMenu(page: Page, trigger: Locator): Promise<void> {
    await page.locator("[role='menu']").first().waitFor({ state: "detached" });
    await trigger.click();
  }

  async function openSidebar(page: Page): Promise<Locator> {
    const aside = page.locator("aside");
    if ((await aside.count()) === 0) await page.getByRole("button", { name: "Toggle sidebar" }).click();
    await visible(aside);
    return aside;
  }

  const toast = (page: Page, text: string | RegExp) => page.getByText(text).first();

  // S55 — pick a level from the Manage access dialog's General settings.
  async function chooseAccessLevel(page: Page, label: string): Promise<void> {
    await page.getByRole("dialog").locator("[aria-haspopup='listbox']").click();
    await page.getByRole("option").filter({ hasText: new RegExp(`^\\s*${label}`) }).click();
    // The list animates out before the dialog takes keys again.
    await page.getByRole("listbox").waitFor({ state: "detached" });
  }

  // S47 — Home's listing, below Recent (own cards appear in both).
  const listing = (page: Page) => page.locator("main section[aria-label='All artefacts']");
  // The suite shares one database, so every other test's members-tier artefact
  // is shared with each new user: a test about its own artefacts narrows to them.
  async function mineOnly(page: Page): Promise<void> {
    await control(page.locator("main"), /^\s*My artefacts/).click();
  }

  async function fileIn(u: User, artefactId: string, collectionId: string): Promise<void> {
    const res = await app.request(`/api/artefacts/${artefactId}/collection`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie: u.cookie },
      body: JSON.stringify({ collectionId }),
    });
    expect(res.status).toBe(200);
  }
  async function setCollectionVisibility(u: User, id: string, visibility: string): Promise<void> {
    const res = await app.request(`/api/collections/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: u.cookie },
      body: JSON.stringify({ visibility }),
    });
    expect(res.ok).toBe(true);
  }
  async function slugOf(u: User, id: string): Promise<string> {
    const res = await app.request(`/api/artefacts/${id}`, { headers: { cookie: u.cookie } });
    return ((await res.json()) as ArtefactSummary).publicSlug!;
  }
  async function bookmark(u: User, id: string): Promise<void> {
    const put = await app.request(`/api/artefacts/${id}/bookmark`, { method: "PUT", headers: { cookie: u.cookie } });
    expect(put.ok).toBe(true);
  }
  async function createSubCollection(u: User, name: string, parentId: string): Promise<{ id: string }> {
    const res = await app.request("/api/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: u.cookie },
      body: JSON.stringify({ name, parentId }),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string };
  }
  // The grid card of `title` in Home's listing.
  const cardOf = (page: Page, title: string) =>
    listing(page).locator("[data-slot='card']", { has: page.locator(`[aria-label='Open ${title}']`) });

  describe("auth", () => {
    // S63 — the MCP connector's consent screen. The client is registered and
    // the authorize URL built as claude.ai does; its redirect_uri is answered
    // in-browser, so the test reads where the browser was sent.
    describe("MCP connector consent (S63)", () => {
      async function authorizeURL(clientName: string): Promise<string> {
        const client = (await (await registerClient(app, clientName)).json()) as { client_id: string };
        const { challenge } = pkce();
        return `${ORIGIN}/api/auth/oauth2/authorize?${new URLSearchParams({
          response_type: "code",
          client_id: client.client_id,
          redirect_uri: MCP_REDIRECT,
          scope: "openid offline_access",
          state: "xyz",
          code_challenge: challenge,
          code_challenge_method: "S256",
          resource: `${ORIGIN}/mcp`,
        }).toString()}`;
      }

      // The client's callback: answered in-browser, and the URL it was sent to
      // recorded. Wrapped, so awaiting the route doesn't await the landing. The
      // client's whole origin is answered here (its favicon included), so the
      // landing never waits on the real network.
      async function catchCallback(page: Page): Promise<{ reached: Promise<URL> }> {
        let landed: (u: URL) => void = () => {};
        const reached = new Promise<URL>((done) => (landed = done));
        const clientOrigin = new URL(MCP_REDIRECT).origin;
        await page.route(`${clientOrigin}/**`, (route) => {
          const url = new URL(route.request().url());
          if (!url.href.startsWith(MCP_REDIRECT)) return route.fulfill({ status: 404, body: "" });
          landed(url);
          return route.fulfill({ contentType: "text/html", body: "<p>back at the client</p>" });
        });
        return { reached };
      }

      it("signs a signed-out user in and resumes onto the consent screen, not Home", async () => {
        const u = await newUser("Grace Hopper");
        const page = await (await context()).newPage();
        await page.goto(await authorizeURL("Claude (resume)"));
        await page.getByPlaceholder("Email").fill(u.email);
        await page.getByPlaceholder("Password").fill(PASSWORD);
        await page.locator("form button[type='submit']").click();
        await visible(page.getByRole("heading", { name: /Claude \(resume\)/ }));
        expect(new URL(page.url()).pathname).toBe("/oauth/consent");
        await visible(page.getByText(u.email));
        expect(await page.getByRole("heading", { name: "Home" }).count()).toBe(0);
        await page.context().close();
      });

      it("says a refused signed request has expired on sign-in, with a plain sign-in", async () => {
        const u = await newUser();
        const page = await (await context()).newPage();
        await page.goto(await authorizeURL("Claude (refused)"));
        await visible(page.getByPlaceholder("Email"));
        // A signature the provider refuses, as an expired request is refused.
        const url = new URL(page.url());
        url.searchParams.set("sig", "AAAA" + url.searchParams.get("sig")!.slice(4));
        await page.goto(url.toString());
        await page.getByPlaceholder("Email").fill(u.email);
        await page.getByPlaceholder("Password").fill(PASSWORD);
        await page.locator("form button[type='submit']").click();
        await visible(page.getByText("This connection request has expired."));
        expect(await page.getByPlaceholder("Password").count()).toBe(0);
        // The plain sign-in drops the request, and signing in reaches the app.
        await control(page, "Sign in without connecting").click();
        await page.waitForURL(`${ORIGIN}/`);
        await page.getByPlaceholder("Email").fill(u.email);
        await page.getByPlaceholder("Password").fill(PASSWORD);
        await page.locator("form button[type='submit']").click();
        await visible(page.getByRole("heading", { name: "Home" }));
        await page.context().close();
      });

      it("shows a signed request past its expiry as expired before any sign-in", async () => {
        const page = await (await context()).newPage();
        await page.goto(await authorizeURL("Claude (late)"));
        await visible(page.getByPlaceholder("Email"));
        const url = new URL(page.url());
        url.searchParams.set("exp", String(Math.floor(Date.now() / 1000) - 60));
        await page.goto(url.toString());
        await visible(page.getByText("This connection request has expired."));
        expect(await page.getByPlaceholder("Email").count()).toBe(0);
        await page.context().close();
      });

      // r[verify identity.mcp.consent-required]
      it("Allow sends the browser back to the client with a code", async () => {
        const u = await newUser();
        const page = await (await context(u)).newPage();
        const { reached } = await catchCallback(page);
        await page.goto(await authorizeURL("Claude (allow)"));
        await visible(page.getByRole("heading", { name: /Claude \(allow\)/ }));
        // The screen names where the code goes, not only the name the client chose.
        const returnLine = page.getByText(/^It will send you back to/);
        await visible(returnLine);
        expect(await returnLine.textContent()).toBe(`It will send you back to ${new URL(MCP_REDIRECT).host}.`);
        await control(page, "Allow").click();
        const back = await reached;
        expect(back.searchParams.get("code")).toBeTruthy();
        expect(back.searchParams.get("error")).toBeNull();
        // Close without waiting on a route handler still in flight (the
        // landing page's own follow-up requests to the client's origin).
        await page.unrouteAll({ behavior: "ignoreErrors" });
        await page.context().close();
      });

      // r[verify identity.mcp.consent-required]
      it("Deny sends the browser back to the client with access_denied and no code", async () => {
        const u = await newUser();
        const page = await (await context(u)).newPage();
        const { reached } = await catchCallback(page);
        await page.goto(await authorizeURL("Claude (deny)"));
        await visible(page.getByRole("heading", { name: /Claude \(deny\)/ }));
        await control(page, "Deny").click();
        const back = await reached;
        expect(back.searchParams.get("error")).toBe("access_denied");
        expect(back.searchParams.get("code")).toBeNull();
        // Close without waiting on a route handler still in flight (the
        // landing page's own follow-up requests to the client's origin).
        await page.unrouteAll({ behavior: "ignoreErrors" });
        await page.context().close();
      });

      it("shows a tampered request as expired, with no Allow", async () => {
        const u = await newUser();
        const page = await (await context(u)).newPage();
        await page.goto(await authorizeURL("Claude (tampered)"));
        await visible(page.getByRole("heading", { name: /Claude \(tampered\)/ }));
        const url = new URL(page.url());
        url.searchParams.set("sig", "AAAA" + url.searchParams.get("sig")!.slice(4));
        await page.goto(url.toString());
        await visible(page.getByText("This connection request has expired."));
        expect(await control(page, "Allow").count()).toBe(0);
        await page.context().close();
      });
    });

    // r[verify platform.client.behaviour-suite+2]
    it("signs in with email + password onto Home, and signs out to the auth screen", async () => {
      const u = await newUser();
      const page = await (await context()).newPage();
      await page.goto(ORIGIN);
      await page.getByPlaceholder("Email").fill(u.email);
      await page.getByPlaceholder("Password").fill(PASSWORD);
      await page.locator("form button[type='submit']").click();
      await visible(page.getByRole("heading", { name: "Home" }));

      await page.locator("[title='Account']:visible").click();
      await control(page, "Log out").click();
      await visible(page.getByPlaceholder("Email"));
      await page.context().close();
    });

    it("shows no email form when the deployment has email + password off", async () => {
      const page = await (await context()).newPage();
      await page.route("**/api/config", (route) =>
        route.fulfill({
          json: {
            emailPasswordEnabled: false,
            googleEnabled: true,
            signupAllowed: true,
            capabilities: { magicLinkSignIn: false },
          },
        }),
      );
      await page.goto(ORIGIN);
      await visible(control(page, "Continue with Google"));
      expect(await page.getByPlaceholder("Email").count()).toBe(0);
      expect(await page.getByPlaceholder("Password").count()).toBe(0);
      await page.context().close();
    });

    // The screen never names the allowed email domains, even fed a config that
    // still carries them (a server from before the field was dropped).
    const NO_LINKS = { magicLinkSignIn: false, verifiedSignUp: false, passwordReset: false, shareInvitations: false };
    const ALL_LINKS = { magicLinkSignIn: true, verifiedSignUp: true, passwordReset: true, shareInvitations: false };
    it.each([
      ["Google on", true, NO_LINKS],
      ["Google off", false, NO_LINKS],
      ["Google on and the superset's link flows", true, ALL_LINKS],
    ])("names no email domain in sign-in or sign-up mode with %s", async (_, googleEnabled, capabilities) => {
      const page = await (await context()).newPage();
      await page.route("**/api/config", (route) =>
        route.fulfill({
          json: {
            allowedEmailDomains: ["example.com", "example.org"],
            emailPasswordEnabled: true,
            googleEnabled,
            signupAllowed: true,
            capabilities,
          },
        }),
      );
      await page.goto(ORIGIN);
      await visible(page.getByPlaceholder("Email"));
      const expectNoDomain = async () => {
        const text = await page.locator("body").innerText();
        expect(text).not.toContain("@");
        expect(text).not.toMatch(/example\.(com|org)/i);
      };
      await expectNoDomain();
      await page.getByRole("tab", { name: "Create account" }).click();
      await visible(page.getByRole("tab", { name: "Create account", selected: true }));
      await expectNoDomain();
      await page.context().close();
    });

    // S33a — the magic-link affordance, driven by `capabilities.magicLinkSignIn`.
    // OSS registers no magic-link endpoint, so the tests stub it.
    describe("magic-link sign-in (S33a)", () => {
      const MAGIC = "Email me a sign-in link";

      async function magicLinkPage(): Promise<Page> {
        const page = await (await context()).newPage();
        await page.route("**/api/config", (route) =>
          route.fulfill({
            json: {
              emailPasswordEnabled: true,
              googleEnabled: true,
              signupAllowed: true,
              capabilities: { magicLinkSignIn: true },
            },
          }),
        );
        return page;
      }

      // r[verify hosting.magic-link.sign-in-control]
      it("offers no magic-link control under the OSS default", async () => {
        const page = await (await context()).newPage();
        await page.goto(ORIGIN);
        await visible(page.getByPlaceholder("Password"));
        expect(await control(page, MAGIC).count()).toBe(0);
        expect(await page.getByLabel("Email for a sign-in link").count()).toBe(0);
        await page.context().close();
      });

      // r[verify hosting.magic-link.sign-in-control]
      it("sends a link to the typed email with the post-sign-in callback, then says to check the inbox", async () => {
        const page = await magicLinkPage();
        const sent: Record<string, unknown>[] = [];
        await page.route("**/api/auth/sign-in/magic-link", (route) => {
          sent.push(route.request().postDataJSON() as Record<string, unknown>);
          return route.fulfill({ json: { status: true } });
        });
        await page.goto(ORIGIN);
        // Offered in both modes.
        await control(page, "Create account").first().click();
        await visible(control(page, MAGIC));
        await control(page, "Sign in").first().click();

        await page.getByLabel("Email for a sign-in link").fill("a@b.co");
        await control(page, MAGIC).click();

        await visible(page.getByText("Check your inbox — we sent a sign-in link to a@b.co"));
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({ email: "a@b.co", callbackURL: "/", newUserCallbackURL: "/", errorCallbackURL: "/" });
        expect(await page.getByPlaceholder("Password").count()).toBe(0);

        await control(page, "Use a different email").click();
        await visible(page.getByLabel("Email for a sign-in link"));
        await page.context().close();
      });

      // r[verify hosting.magic-link.send-error]
      it("shows an inline error when the send is rejected, and keeps the form", async () => {
        const page = await magicLinkPage();
        await page.route("**/api/auth/sign-in/magic-link", (route) =>
          route.fulfill({ status: 429, json: { message: "Too many requests. Please try again later." } }),
        );
        await page.goto(ORIGIN);
        await page.getByLabel("Email for a sign-in link").fill("a@b.co");
        await control(page, MAGIC).click();

        await visible(page.getByText(/couldn't send a sign-in link|too many/i));
        await visible(page.getByLabel("Email for a sign-in link"));
        expect(await control(page, MAGIC).isEnabled()).toBe(true);
        await page.context().close();
      });

      // r[verify hosting.magic-link.landing-error]
      it("explains an expired or used link on landing back with ?error", async () => {
        for (const code of ["EXPIRED_TOKEN", "INVALID_TOKEN"]) {
          const page = await magicLinkPage();
          await page.goto(`${ORIGIN}/?error=${code}`);
          await visible(page.getByText("That sign-in link has expired or was already used — send a new one"));
          await page.context().close();
        }
        const page = await magicLinkPage();
        await page.goto(`${ORIGIN}/?error=failed_to_create_user`);
        await visible(page.getByText("We couldn't sign you in with that link"));
        await page.context().close();
      });

      // r[verify identity.auth-screen.signup-refused]
      // r[verify hosting.magic-link.landing-error]
      it("explains a refused sign-up on landing, in generic words", async () => {
        const page = await magicLinkPage();
        await page.goto(`${ORIGIN}/?error=signup_refused`);
        await visible(page.getByText("We couldn't create an account for that address — sign-up isn't open to it here"));
        expect(await page.getByText("We couldn't sign you in with that link").count()).toBe(0);
        await page.context().close();
      });
    });

    // S67 — the legal notice under the sign-in and sign-up actions, driven by
    // `legal` on /api/config, stubbed here for each combination.
    describe("legal notice (S67)", () => {
      const TERMS = "https://example.com/terms";
      const PRIVACY = "/privacy";
      const NOTICE = /^By continuing you /;

      async function legalPage(
        legal: { termsUrl: string | null; privacyUrl: string | null },
        capabilities: Record<string, boolean> = {},
        path = "/",
      ): Promise<Page> {
        const page = await (await context()).newPage();
        await page.route("**/api/config", (route) =>
          route.fulfill({
            json: {
              emailPasswordEnabled: true,
              googleEnabled: true,
              signupAllowed: true,
              capabilities: { magicLinkSignIn: false, verifiedSignUp: false, passwordReset: false, shareInvitations: false, ...capabilities },
              legal,
            },
          }),
        );
        await page.goto(`${ORIGIN}${path}`);
        if (path === "/") await visible(page.getByPlaceholder("Password"));
        return page;
      }

      // r[verify identity.auth-screen.legal-notice+2]
      it("links the Terms and the Privacy notice on the sign-in and sign-up views", async () => {
        const page = await legalPage({ termsUrl: TERMS, privacyUrl: PRIVACY });
        for (const tab of ["Sign in", "Create account"]) {
          await control(page, tab).first().click();
          const notice = page.getByText(NOTICE);
          await visible(notice);
          expect(await notice.textContent()).toBe(
            "By continuing you agree to the Terms and acknowledge the Privacy notice.",
          );
          expect(await notice.getByRole("link", { name: "Terms" }).getAttribute("href")).toBe(TERMS);
          expect(await notice.getByRole("link", { name: "Privacy notice" }).getAttribute("href")).toBe(PRIVACY);
          expect(
            await notice
              .getByRole("link")
              .evaluateAll((as) => as.map((a) => [a.getAttribute("target"), a.getAttribute("rel")])),
          ).toEqual([
            ["_blank", "noopener noreferrer"],
            ["_blank", "noopener noreferrer"],
          ]);
        }
        await page.context().close();
      });

      // r[verify identity.auth-screen.legal-notice+2]
      it("names only the one that is configured", async () => {
        const privacyOnly = await legalPage({ termsUrl: null, privacyUrl: PRIVACY });
        await visible(privacyOnly.getByText(NOTICE));
        expect(await privacyOnly.getByText(NOTICE).textContent()).toBe("By continuing you acknowledge the Privacy notice.");
        expect(await privacyOnly.getByText(NOTICE).getByRole("link").count()).toBe(1);
        await privacyOnly.context().close();

        const termsOnly = await legalPage({ termsUrl: TERMS, privacyUrl: null });
        await visible(termsOnly.getByText(NOTICE));
        expect(await termsOnly.getByText(NOTICE).textContent()).toBe("By continuing you agree to the Terms.");
        expect(await termsOnly.getByText(NOTICE).getByRole("link", { name: "Terms" }).getAttribute("href")).toBe(TERMS);
        await termsOnly.context().close();
      });

      // r[verify identity.auth-screen.legal-notice+2]
      it("renders no notice when neither is configured", async () => {
        const page = await legalPage({ termsUrl: null, privacyUrl: null });
        expect(await page.getByText(NOTICE).count()).toBe(0);
        await control(page, "Create account").first().click();
        await visible(page.getByPlaceholder("Name"));
        expect(await page.getByText(NOTICE).count()).toBe(0);
        await page.context().close();
      });

      // r[verify identity.auth-screen.legal-notice+2]
      it("shows no notice on the forgot-password view", async () => {
        const page = await legalPage({ termsUrl: TERMS, privacyUrl: PRIVACY }, { passwordReset: true });
        await visible(page.getByText(NOTICE));
        await control(page, "Forgot password?").click();
        await visible(control(page, "Send reset link"));
        expect(await page.getByText(NOTICE).count()).toBe(0);
        await page.context().close();
      });

      // r[verify identity.auth-screen.legal-notice+2]
      it("shows no notice on the reset and expired-reset landings", async () => {
        const both = { termsUrl: TERMS, privacyUrl: PRIVACY };
        const reset = await legalPage(both, { passwordReset: true }, "/?reset-password=1&token=t");
        await visible(reset.getByLabel("New password"));
        expect(await reset.getByText(NOTICE).count()).toBe(0);
        await reset.context().close();

        const expired = await legalPage(both, { passwordReset: true }, "/?reset-password=1&error=INVALID_TOKEN");
        await visible(control(expired, "Send a new link"));
        expect(await expired.getByText(NOTICE).count()).toBe(0);
        await expired.context().close();
      });
    });

    // S48 — Verified sign-up and password reset affordances, driven by
    // `capabilities.verifiedSignUp` and `capabilities.passwordReset`. OSS
    // registers neither flow's endpoints, so the tests stub them.
    describe("verified sign-up and password reset (S48)", () => {
      const SIGN_UP_LINK = "Email me a link to create my account";
      const OSS_CONFIG = {
        emailPasswordEnabled: true,
        googleEnabled: true,
        signupAllowed: true,
        capabilities: { magicLinkSignIn: false, verifiedSignUp: false, passwordReset: false, shareInvitations: false },
      };

      async function stubbedPage(capabilities: Record<string, boolean>, u?: User): Promise<Page> {
        const page = await (await context(u)).newPage();
        await page.route("**/api/config", (route) =>
          route.fulfill({ json: { ...OSS_CONFIG, capabilities: { ...OSS_CONFIG.capabilities, ...capabilities } } }),
        );
        return page;
      }

      // Records each request body to `path` and answers with `reply`.
      async function capture(
        page: Page,
        path: string,
        reply: { status?: number; json: unknown } = { json: { status: true } },
      ): Promise<Record<string, unknown>[]> {
        const sent: Record<string, unknown>[] = [];
        await page.route(`**/api/auth/${path}`, (route) => {
          sent.push(route.request().postDataJSON() as Record<string, unknown>);
          return route.fulfill(reply);
        });
        return sent;
      }

      describe("with every flag off (the OSS default)", () => {
        // r[verify identity.auth-screen.verified-sign-up]
        // r[verify identity.auth-screen.forgot-password]
        it("keeps a password on Create account, signs up by signUp.email, and offers no Forgot password?", async () => {
          const page = await (await context()).newPage();
          const sent = await capture(page, "sign-up/email", { status: 400, json: { message: "stubbed" } });
          await page.goto(ORIGIN);
          await visible(page.getByPlaceholder("Password"));
          expect(await control(page, "Forgot password?").count()).toBe(0);

          await control(page, "Create account").first().click();
          await page.getByPlaceholder("Name").fill("Ada");
          await page.getByPlaceholder("Email").fill("a@b.co");
          await page.getByPlaceholder("Password").fill(PASSWORD);
          await page.locator("form button[type='submit']").first().click();
          await eventually(() => expect(sent).toEqual([{ name: "Ada", email: "a@b.co", password: PASSWORD }]));
          expect(await control(page, SIGN_UP_LINK).count()).toBe(0);
          expect(await control(page, "Forgot password?").count()).toBe(0);
          await page.context().close();
        });

        // r[verify identity.auth-screen.welcome-landing]
        it("renders Home for a signed-in ?welcome=set-password", async () => {
          const page = await (await context(await newUser())).newPage();
          await page.goto(`${ORIGIN}/?welcome=set-password`);
          await visible(page.getByRole("heading", { name: "Home" }));
          expect(await page.getByText("Choose a password").count()).toBe(0);
          await page.context().close();
        });
      });

      describe("verified sign-up", () => {
        // r[verify identity.auth-screen.verified-sign-up]
        it("asks Create account for a name and email only, and emails a link that welcomes a new account", async () => {
          const page = await stubbedPage({ verifiedSignUp: true });
          const sent = await capture(page, "sign-in/magic-link");
          await page.goto(ORIGIN);
          await control(page, "Create account").first().click();
          await visible(page.getByPlaceholder("Name"));
          expect(await page.getByPlaceholder("Password").count()).toBe(0);

          await page.getByPlaceholder("Name").fill("Ada");
          await page.getByPlaceholder("Email").fill("a@b.co");
          await control(page, SIGN_UP_LINK).click();

          await visible(page.getByText(/Check your inbox.*a@b\.co/));
          expect(sent).toEqual([
            {
              email: "a@b.co",
              name: "Ada",
              callbackURL: "/",
              newUserCallbackURL: "/?welcome=set-password",
              errorCallbackURL: "/",
            },
          ]);
          await page.context().close();
        });

        // r[verify identity.auth-screen.verified-sign-up]
        it("carries a captured returnTo into the welcome URL", async () => {
          const page = await stubbedPage({ verifiedSignUp: true });
          const sent = await capture(page, "sign-in/magic-link");
          await page.goto(`${ORIGIN}/?returnTo=${encodeURIComponent("/a/x")}`);
          await control(page, "Create account").first().click();
          await page.getByPlaceholder("Name").fill("Ada");
          await page.getByPlaceholder("Email").fill("a@b.co");
          await control(page, SIGN_UP_LINK).click();

          await visible(page.getByText(/Check your inbox.*a@b\.co/));
          expect(sent[0]).toMatchObject({
            callbackURL: "/a/x",
            newUserCallbackURL: "/?welcome=set-password&returnTo=%2Fa%2Fx",
            errorCallbackURL: "/?returnTo=%2Fa%2Fx",
          });
          await page.context().close();
        });

        // r[verify identity.auth-screen.verified-sign-up]
        it("shows an inline error when the send is rejected, and keeps the form", async () => {
          const page = await stubbedPage({ verifiedSignUp: true });
          await capture(page, "sign-in/magic-link", { status: 429, json: { message: "Too many requests." } });
          await page.goto(ORIGIN);
          await control(page, "Create account").first().click();
          await page.getByPlaceholder("Name").fill("Ada");
          await page.getByPlaceholder("Email").fill("a@b.co");
          await control(page, SIGN_UP_LINK).click();

          await visible(page.getByText(/too many/i));
          await visible(page.getByPlaceholder("Name"));
          expect(await control(page, SIGN_UP_LINK).isEnabled()).toBe(true);
          await page.context().close();
        });

        // r[verify identity.auth-screen.verified-sign-up]
        it("sends S33a's sign-in link with the same welcome URL for a new account", async () => {
          const page = await stubbedPage({ verifiedSignUp: true, magicLinkSignIn: true });
          const sent = await capture(page, "sign-in/magic-link");
          await page.goto(ORIGIN);
          await page.getByLabel("Email for a sign-in link").fill("a@b.co");
          await control(page, "Email me a sign-in link").click();

          await visible(page.getByText("Check your inbox — we sent a sign-in link to a@b.co"));
          expect(sent[0]).toMatchObject({ callbackURL: "/", newUserCallbackURL: "/?welcome=set-password" });
          await page.context().close();
        });
      });

      describe("set password", () => {
        async function welcomePage(query = ""): Promise<Page> {
          const page = await stubbedPage({ verifiedSignUp: true }, await newUser());
          await page.goto(`${ORIGIN}/?welcome=set-password${query}`);
          await visible(page.getByText("Choose a password"));
          return page;
        }

        async function choose(page: Page, password: string, confirm = password): Promise<void> {
          await page.getByLabel("New password").fill(password);
          await page.getByLabel("Confirm password").fill(confirm);
          await control(page, "Set password").click();
        }

        // r[verify identity.auth-screen.set-password]
        it("catches a confirm mismatch without a request", async () => {
          const page = await welcomePage();
          const sent = await capture(page, "set-password");
          await choose(page, PASSWORD, "something-else-entirely");
          await visible(page.getByText("The passwords don't match"));
          expect(sent).toEqual([]);
          await page.context().close();
        });

        // r[verify identity.auth-screen.set-password]
        it("POSTs the new password, then lands on returnTo with welcome stripped", async () => {
          const page = await welcomePage(`&returnTo=${encodeURIComponent("/a/x")}`);
          const sent = await capture(page, "set-password");
          await choose(page, PASSWORD);
          await page.waitForURL(`${ORIGIN}/a/x`);
          expect(sent).toEqual([{ newPassword: PASSWORD }]);
          await page.context().close();
        });

        // r[verify identity.auth-screen.set-password]
        it("lands on Home without a returnTo", async () => {
          const page = await welcomePage();
          await capture(page, "set-password");
          await choose(page, PASSWORD);
          await visible(page.getByRole("heading", { name: "Home" }));
          expect(new URL(page.url()).search).toBe("");
          await page.context().close();
        });

        // r[verify identity.auth-screen.set-password]
        it("explains a stale session and an account that already has a password", async () => {
          for (const [status, code, text] of [
            [403, "SESSION_NOT_FRESH", "For your security, sign in again with a link to set a password"],
            [400, "PASSWORD_ALREADY_SET", "This account already has a password"],
          ] as const) {
            const page = await welcomePage();
            await capture(page, "set-password", { status, json: { code, message: "stubbed" } });
            await choose(page, PASSWORD);
            await visible(page.getByText(text));
            await visible(page.getByLabel("New password"));
            await page.context().close();
          }
        });

        // r[verify identity.auth-screen.set-password]
        it("skips to Home without a request", async () => {
          const page = await welcomePage();
          const sent = await capture(page, "set-password");
          await control(page, "Skip — I'll sign in with email links").click();
          await visible(page.getByRole("heading", { name: "Home" }));
          expect(new URL(page.url()).search).toBe("");
          expect(sent).toEqual([]);
          await page.context().close();
        });
      });

      describe("forgot password", () => {
        // r[verify identity.auth-screen.forgot-password]
        it("offers Forgot password? in sign-in mode only, and sends a reset link", async () => {
          const page = await stubbedPage({ passwordReset: true });
          const sent = await capture(page, "request-password-reset");
          await page.goto(ORIGIN);
          await visible(control(page, "Forgot password?"));
          await control(page, "Create account").first().click();
          await visible(page.getByPlaceholder("Name"));
          expect(await control(page, "Forgot password?").count()).toBe(0);
          await control(page, "Sign in").first().click();

          await control(page, "Forgot password?").click();
          await page.getByPlaceholder("Email").fill("a@b.co");
          await control(page, "Send reset link").click();

          await visible(page.getByText("If an account exists for a@b.co, we sent a reset link"));
          expect(sent).toEqual([{ email: "a@b.co", redirectTo: "/?reset-password=1" }]);
          await control(page, "Back to sign in").click();
          await visible(page.getByPlaceholder("Password"));
          await page.context().close();
        });

        // r[verify identity.auth-screen.forgot-password]
        it("shows an inline error when the send is rejected, and Back to sign in returns to the form", async () => {
          const page = await stubbedPage({ passwordReset: true });
          await capture(page, "request-password-reset", { status: 429, json: { message: "Too many requests." } });
          await page.goto(ORIGIN);
          await control(page, "Forgot password?").click();
          await page.getByPlaceholder("Email").fill("a@b.co");
          await control(page, "Send reset link").click();

          await visible(page.getByText(/too many/i));
          expect(await control(page, "Send reset link").isEnabled()).toBe(true);
          await control(page, "Back to sign in").click();
          await visible(page.getByPlaceholder("Password"));
          await page.context().close();
        });
      });

      describe("reset landing", () => {
        const EXPIRED = "That reset link has expired or was already used";

        // r[verify identity.auth-screen.reset-landing]
        it("resets with the landing token, then shows the sign-in form with a notice", async () => {
          const page = await stubbedPage({ passwordReset: true });
          const sent = await capture(page, "reset-password");
          await page.goto(`${ORIGIN}/?reset-password=1&token=t`);
          await page.getByLabel("New password").fill(PASSWORD);
          await page.getByLabel("Confirm password").fill(PASSWORD);
          await control(page, "Reset password").click();

          await visible(page.getByText("Password updated — sign in with your new password"));
          await visible(page.getByPlaceholder("Password"));
          expect(sent).toEqual([{ newPassword: PASSWORD, token: "t" }]);
          await page.context().close();
        });

        async function resetFromLanding(page: Page): Promise<void> {
          await page.goto(`${ORIGIN}/?reset-password=1&token=t`);
          await page.getByLabel("New password").fill(PASSWORD);
          await page.getByLabel("Confirm password").fill(PASSWORD);
          await control(page, "Reset password").click();
          await visible(page.getByText("Password updated — sign in with your new password"));
        }

        async function signInAs(page: Page, u: User): Promise<void> {
          await page.getByPlaceholder("Email").fill(u.email);
          await page.getByPlaceholder("Password").fill(PASSWORD);
          await page.locator("form button[type='submit']").first().click();
        }

        // r[verify identity.auth-screen.reset-landing]
        it("hands off to the app when the visitor signs in after a reset", async () => {
          const u = await newUser();
          const page = await stubbedPage({ passwordReset: true });
          await capture(page, "reset-password");
          await resetFromLanding(page);
          await signInAs(page, u);
          await visible(page.getByRole("heading", { name: "Home" }));
          await page.context().close();
        });

        // r[verify identity.auth-screen.reset-landing]
        it("refetches a signed-in visitor's session after a reset, reading a revoked one as signed out", async () => {
          const page = await stubbedPage({ passwordReset: true }, await newUser());
          let revoked = false;
          await page.route("**/api/auth/reset-password", (route) => {
            revoked = true;
            return route.fulfill({ json: { status: true } });
          });
          await page.route("**/api/auth/get-session", (route) => (revoked ? route.fulfill({ json: null }) : route.continue()));
          await resetFromLanding(page);
          await visible(page.getByPlaceholder("Password"));
          await new Promise((r) => setTimeout(r, 500));
          expect(await page.getByRole("heading", { name: "Home" }).count()).toBe(0);
          await visible(page.getByText("Password updated — sign in with your new password"));
          await page.context().close();
        });

        // r[verify identity.auth-screen.reset-landing]
        it("hands off to the app after Back to sign in from the reset and expired views", async () => {
          for (const landing of ["token=t", "error=INVALID_TOKEN"]) {
            const u = await newUser();
            const page = await stubbedPage({ passwordReset: true });
            await page.goto(`${ORIGIN}/?reset-password=1&${landing}`);
            if (landing === "token=t") await visible(page.getByLabel("New password"));
            else await visible(page.getByText(EXPIRED));
            await control(page, "Back to sign in").click();
            await signInAs(page, u);
            await visible(page.getByRole("heading", { name: "Home" }));
            await page.context().close();
          }
        });

        // r[verify identity.auth-screen.reset-landing]
        it("shows the reset view to a signed-in visitor too", async () => {
          const page = await stubbedPage({ passwordReset: true }, await newUser());
          await page.goto(`${ORIGIN}/?reset-password=1&token=t`);
          await visible(page.getByLabel("New password"));
          expect(await page.getByRole("heading", { name: "Home" }).count()).toBe(0);
          await page.context().close();
        });

        // r[verify identity.auth-screen.reset-landing]
        it("explains a spent link on landing — never as a sign-in link — and offers a new one", async () => {
          const page = await stubbedPage({ passwordReset: true, magicLinkSignIn: true });
          await page.goto(`${ORIGIN}/?reset-password=1&error=INVALID_TOKEN`);
          await visible(page.getByText(EXPIRED));
          expect(await page.getByText(/sign-in link has expired/).count()).toBe(0);

          await control(page, "Send a new link").click();
          await visible(control(page, "Send reset link"));
          await page.context().close();
        });

        // r[verify identity.auth-screen.reset-landing]
        it("explains a link the server refuses on submit", async () => {
          const page = await stubbedPage({ passwordReset: true });
          await capture(page, "reset-password", { status: 400, json: { code: "INVALID_TOKEN", message: "Invalid token" } });
          await page.goto(`${ORIGIN}/?reset-password=1&token=t`);
          await page.getByLabel("New password").fill(PASSWORD);
          await page.getByLabel("Confirm password").fill(PASSWORD);
          await control(page, "Reset password").click();

          await visible(page.getByText(EXPIRED));
          await visible(control(page, "Send a new link"));
          await page.context().close();
        });
      });
    });
  });

  describe("upload and edit", () => {
    // r[verify platform.client.behaviour-suite+2]
    it("uploads an .html file with a title and kind as a card named by that kind's icon", async () => {
      const page = await openApp(await newUser());
      await control(page, "New artefact").click();
      await page.getByLabel("Title").fill("Quarterly form");
      await control(page, "Form").click();
      await page.setInputFiles("input[type='file']", {
        name: "q.html",
        mimeType: "text/html",
        buffer: Buffer.from(html("Quarterly form")),
      });
      await control(page, "Upload artefact").click();

      const open = page.locator("main [aria-label='Open Quarterly form']:not([data-recent] *)").first();
      await visible(open);
      await visible(cardOf(page, "Quarterly form").getByRole("img", { name: "Form", exact: true }));
      await page.context().close();
    });

    // r[verify platform.client.behaviour-suite+2]
    it("shows the cap error for a file over 100 MB", async () => {
      const big = join(work, "big.html");
      writeFileSync(big, "");
      truncateSync(big, MAX_PAYLOAD_BYTES + 1);
      const page = await openApp(await newUser());
      await control(page, "New artefact").click();
      await page.getByLabel("Title").fill("Too big");
      await page.setInputFiles("input[type='file']", big);
      await control(page, "Upload artefact").click();
      await visible(page.getByText("payload exceeds the 100 MB cap"));
      await page.context().close();
    });

    // r[verify platform.client.behaviour-suite+2]
    it("edits an artefact's title and replaces its file, updating the card", async () => {
      const u = await newUser();
      const a = await createArtefact(u, "Draft deck", "slide-deck");
      const page = await openApp(u);
      await cardMenu(page, "Draft deck");
      await control(page, "Edit").click();
      await page.getByLabel("Title").fill("Final deck");
      await page.setInputFiles("input[type='file']", {
        name: "final.html",
        mimeType: "text/html",
        buffer: Buffer.from(html("Final deck", 300 * 1024)),
      });
      await control(page, "Save changes").click();

      await visible(page.locator("main [aria-label='Open Final deck']:not([data-recent] *)"));
      expect(await page.locator("main [aria-label='Open Draft deck']:not([data-recent] *)").count()).toBe(0);
      // S62/S65 — neither the card nor the list row shows a size, so the stored payload is the evidence.
      const saved = (await (await app.request(`/api/artefacts/${a.id}`, { headers: { cookie: u.cookie } })).json()) as ArtefactSummary;
      expect(Math.round(saved.payloadBytes / 1024)).toBe(300);
      await page.context().close();
    });
  });

  // r[verify platform.client.behaviour-suite+2]
  // r[verify hosting.card.share-link-unless-private+6]
  it("switches private → org members → public from the card's Share button; neither the card nor the row shows a share link", async () => {
    const u = await newUser();
    const a = await createArtefact(u, "Tiered");
    const page = await openApp(u);
    // S47 — the card below Recent (its twin in Recent carries the same controls);
    // only this user's own, since other tests' members artefacts carry links.
    await mineOnly(page);
    const main = listing(page);
    expect(await main.getByText(/\/a\//).count()).toBe(0);

    // S54 — an owner's card: an access badge and a Share button, with no access
    // dropdown and no "Manage access" button.
    const badge = (label: string) => main.locator(`[title='Access: ${label}']`);
    await visible(badge("Private"));
    expect(await control(main, "Private").count()).toBe(0);
    expect(await control(main, "Manage access").count()).toBe(0);

    // S55 — Share opens the Manage access dialog; Done saves the draft.
    await control(main, "Share").click();
    await chooseAccessLevel(page, "Org members");
    await control(page.getByRole("dialog"), "Done").click();
    await visible(toast(page, "“Tiered” is now shared with org members"));
    await visible(badge("Org members"));
    const shared = (await (await app.request(`/api/artefacts/${a.id}`, { headers: { cookie: u.cookie } })).json()) as ArtefactSummary;
    // S62/S65 — neither the owner's card nor the list row carries a share link of its own.
    expect(await main.getByText(/\/a\//).count()).toBe(0);
    expect(await main.locator("[aria-label^='Copy link /a/']").count()).toBe(0);
    await page.locator("main [title='List']").click();
    await visible(main.locator("[title='Access: Org members']"));
    expect(await main.getByText(`/a/${shared.publicSlug}`).count()).toBe(0);
    expect(await main.locator("[aria-label^='Copy link /a/']").count()).toBe(0);

    await control(main, "Share").click();
    await chooseAccessLevel(page, "Public");
    await control(page.getByRole("dialog"), "Done").click();
    await visible(toast(page, "“Tiered” is now public"));
    await visible(badge("Public"));

    await control(main, "Share").click();
    await chooseAccessLevel(page, "Private");
    await control(page.getByRole("dialog"), "Done").click();
    await visible(toast(page, "“Tiered” is now private"));
    await visible(badge("Private"));
    await page.context().close();
  });

  describe("archive", () => {
    // r[verify platform.client.behaviour-suite+2]
    it("archives with an Undo toast, lists it under Archive, and restores it", async () => {
      const u = await newUser();
      await createArtefact(u, "Old notes", "interactive-doc");
      const page = await openApp(u);
      const card = page.locator("main [aria-label='Open Old notes']:not([data-recent] *)");

      await cardMenu(page, "Old notes");
      await control(page, "Archive").click();
      await gone(card);
      await control(page, "Undo").click();
      await visible(card);

      await cardMenu(page, "Old notes");
      await control(page, "Archive").click();
      await gone(card);
      const aside = await openSidebar(page);
      await control(aside, /^\s*Archive/).click();
      await visible(page.getByRole("heading", { name: "Archive" }));
      await visible(page.locator("main").getByText("Old notes"));
      await control(page.locator("main"), "Restore").click();
      await gone(page.locator("main").getByText("Old notes"));

      await control(aside, "Home").click();
      await visible(card);
      await page.context().close();
    });

    // r[verify platform.client.behaviour-suite+2]
    it("permanently deletes an archived artefact after confirmation", async () => {
      const u = await newUser();
      const a = await createArtefact(u, "Doomed");
      await archive(u, a.id);
      const page = await openApp(u);
      const aside = await openSidebar(page);
      await control(aside, /^\s*Archive/).click();
      await visible(page.locator("main").getByText("Doomed"));

      await page.locator("main [aria-label='Delete permanently']").click();
      await visible(page.getByText("Delete “Doomed” permanently?"));
      await control(page, "Delete artefact").click();
      await visible(toast(page, "“Doomed” deleted"));
      await gone(page.locator("main").getByText("Doomed", { exact: true }));
      const res = await app.request(`/api/artefacts/${a.id}`, { headers: { cookie: u.cookie } });
      expect(res.status).toBe(404);
      await page.context().close();
    });
  });

  // r[verify platform.client.behaviour-suite+2]
  it("creates a collection, files an artefact in it, nests, expands/collapses and archives it", async () => {
    const u = await newUser();
    await createArtefact(u, "Filed away");
    const page = await openApp(u);
    const aside = await openSidebar(page);

    await aside.locator("[aria-label='New collection']").click();
    await page.getByLabel("Name").fill("Lab notes");
    await control(page, "Create collection").click();
    await visible(control(aside, /Lab notes/));

    await cardMenu(page, "Filed away");
    await control(page, "Add to collection…").click();
    await control(page, /Lab notes/).last().click();
    await control(page, "Add to Lab notes").click();
    await visible(toast(page, /added to Lab notes/));

    await control(aside, /Lab notes/).click();
    await visible(page.getByRole("heading", { level: 1, name: "Lab notes" }));
    await visible(control(page.locator("main"), "Collections"));
    await visible(page.locator("main [aria-label='Open Filed away']:not([data-recent] *)"));

    await openMenu(page, page.locator("main [title='More']:not([data-recent] *)").first());
    await control(page, "New sub-collection").click();
    await page.getByLabel("Name").fill("Transcripts");
    await control(page, "Create collection").click();
    const child = control(aside, /Transcripts/);
    await visible(child);
    await aside.locator("[aria-label='Collapse']").click();
    await gone(child);
    await aside.locator("[aria-label='Expand']").click();
    await visible(child);

    await openMenu(page, page.locator("main [title='More']:not([data-recent] *)").first());
    await control(page, "Archive collection").click();
    await visible(page.getByRole("heading", { name: "Home" }));
    await gone(control(aside, /Lab notes/));
    await control(aside, /^\s*Archive/).click();
    await visible(page.locator("main").getByText("Lab notes"));
    await page.context().close();
  });

  // S59 — every screen has a path: the URL follows navigation, survives a
  // reload, walks Back and Forward, and falls back to Home.
  describe("navigation (S59)", () => {
    const path = (page: Page) => new URL(page.url()).pathname;
    const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name, exact: true });
    const search = (page: Page) => page.getByRole("combobox", { name: "Search artefacts and collections" });

    async function openAccountFromMenu(page: Page): Promise<void> {
      await openMenu(page, page.locator("header [title^='Account']:visible"));
      await page.getByRole("menuitem", { name: "Account", exact: true }).click();
      await visible(heading(page, "Account"));
    }

    // r[verify platform.navigation.history]
    it("puts Account in the URL, and a reload stays on Account", async () => {
      const u = await newUser();
      const page = await openApp(u);
      expect(path(page)).toBe("/");
      await openAccountFromMenu(page);
      expect(path(page)).toBe("/account");
      await page.reload();
      await visible(heading(page, "Account"));
      expect(path(page)).toBe("/account");
      await page.context().close();
    });

    // r[verify platform.navigation.history]
    it("puts a collection page in the URL, and a reload shows it with its ancestors expanded", async () => {
      const u = await newUser();
      const parent = await createCollection(u, "Programme");
      const child = await createSubCollection(u, "Workstream", parent.id);
      const page = await openApp(u);
      const aside = await openSidebar(page);
      await control(aside, /Programme/).click();
      await visible(heading(page, "Programme"));
      expect(path(page)).toBe(`/c/${parent.id}`);

      await page.goto(`${ORIGIN}/c/${child.id}`);
      await visible(heading(page, "Workstream"));
      expect(path(page)).toBe(`/c/${child.id}`);
      // The sidebar is remembered open; its row for the parent is expanded to the child.
      await visible(control(page.locator("aside"), /Workstream/));
      await page.context().close();
    });

    // r[verify platform.navigation.history]
    it("walks Back and Forward between screens, resetting the search as an open does", async () => {
      const u = await newUser();
      const research = await createCollection(u, "Field notes");
      const page = await openApp(u);
      const aside = await openSidebar(page);
      await control(aside, /Field notes/).click();
      await visible(heading(page, "Field notes"));
      await openAccountFromMenu(page);

      await search(page).fill("zzz");
      await page.goBack();
      await visible(heading(page, "Field notes"));
      expect(path(page)).toBe(`/c/${research.id}`);
      expect(await search(page).inputValue()).toBe("");

      await page.goBack();
      await visible(heading(page, "Home"));
      expect(path(page)).toBe("/");

      await page.goForward();
      await visible(heading(page, "Field notes"));
      expect(path(page)).toBe(`/c/${research.id}`);
      await page.context().close();
    });

    // r[verify platform.navigation.history]
    it("pushes nothing when the open screen is opened again", async () => {
      const u = await newUser();
      const page = await openApp(u);
      await openAccountFromMenu(page);
      const length = await page.evaluate(() => history.length);
      await openAccountFromMenu(page);
      expect(await page.evaluate(() => history.length)).toBe(length);
      await page.context().close();
    });

    // r[verify platform.navigation.history]
    it("replaces a collection archived from inside it, so Back doesn't return to it", async () => {
      const u = await newUser();
      const doomed = await createCollection(u, "Short-lived");
      const page = await openApp(u);
      await page.goto(`${ORIGIN}/c/${doomed.id}`);
      await visible(heading(page, "Short-lived"));
      await openMenu(page, page.locator("main [title='More']:not([data-recent] *)").first());
      await control(page, "Archive collection").click();
      await visible(heading(page, "Home"));
      expect(path(page)).toBe("/");
      await page.goBack();
      await visible(heading(page, "Home"));
      expect(path(page)).toBe("/");
      await page.context().close();
    });

    // r[verify platform.navigation.fallback-home+2]
    it("shows Home at / for a collection path the caller can't open, and Back doesn't return to it", async () => {
      const owner = await newUser();
      const hidden = await createCollection(owner, "Not yours");
      const u = await newUser();
      const page = await openApp(u);
      for (const target of [`/c/${hidden.id}`, "/c/no-such-collection", "/nowhere"]) {
        await page.goto(`${ORIGIN}${target}`);
        await visible(heading(page, "Home"));
        await eventually(() => expect(path(page), target).toBe("/"));
        expect(await page.getByText("Not yours").count()).toBe(0);
      }
      await page.goBack();
      expect(path(page)).not.toBe("/nowhere");
      await page.context().close();
    });

    // r[verify platform.navigation.fallback-home+2]
    it("shows Home at / for /organization without an org context", async () => {
      const u = await newUser();
      const page = await (await context(u)).newPage();
      await page.goto(`${ORIGIN}/organization`);
      await visible(heading(page, "Home"));
      await eventually(() => expect(path(page)).toBe("/"));
      await page.context().close();
    });

    // r[verify platform.navigation.paths]
    it("shows the Archive at /archive", async () => {
      const u = await newUser();
      const page = await (await context(u)).newPage();
      await page.goto(`${ORIGIN}/archive`);
      await visible(heading(page, "Archive"));
      expect(path(page)).toBe("/archive");
      await page.context().close();
    });

    // r[verify platform.navigation.sign-in-keeps-path]
    it("sends a signed-out visitor at /account back there after Google sign-in", async () => {
      const page = await (await context()).newPage();
      await page.route("**/api/config", (route) =>
        route.fulfill({
          json: {
            emailPasswordEnabled: true,
            googleEnabled: true,
            signupAllowed: true,
            capabilities: { magicLinkSignIn: false },
          },
        }),
      );
      const sent: Record<string, unknown>[] = [];
      await page.route("**/api/auth/sign-in/social", (route) => {
        sent.push(route.request().postDataJSON() as Record<string, unknown>);
        return route.fulfill({ status: 400, json: { message: "stubbed" } });
      });
      await page.goto(`${ORIGIN}/account`);
      await control(page, "Continue with Google").click();
      await eventually(() => expect(sent).toHaveLength(1));
      expect(sent[0]).toMatchObject({
        callbackURL: "/account",
        errorCallbackURL: "/?auth_error=1&returnTo=%2Faccount",
      });
      await page.context().close();
    });

    // r[verify platform.navigation.sign-in-keeps-path]
    it("lands a visitor who signs in with a password at /account on Account", async () => {
      const u = await newUser();
      const page = await (await context()).newPage();
      await page.goto(`${ORIGIN}/account`);
      await page.getByPlaceholder("Email").fill(u.email);
      await page.getByPlaceholder("Password").fill(PASSWORD);
      await page.locator("form button[type='submit']").click();
      await visible(heading(page, "Account"));
      expect(path(page)).toBe("/account");
      await page.context().close();
    });

    // S73 — `/signin` and `/signup` pick the auth screen's opening tab, so an
    // external site can link straight to either.
    describe("sign-in and sign-up paths (S73)", () => {
      const tab = (page: Page, name: string, selected?: boolean) => page.getByRole("tab", { name, selected });

      async function signedOutAt(at: string, signupAllowed = true): Promise<Page> {
        const page = await (await context()).newPage();
        await page.route("**/api/config", (route) =>
          route.fulfill({
            json: { emailPasswordEnabled: true, googleEnabled: false, signupAllowed, capabilities: {} },
          }),
        );
        await page.goto(`${ORIGIN}${at}`);
        await visible(page.getByPlaceholder("Email"));
        return page;
      }

      // r[verify identity.auth-screen.signin-signup-paths]
      it("opens /signup on Create account while sign-up is open", async () => {
        const page = await signedOutAt("/signup");
        await visible(tab(page, "Create account", true));
        await visible(page.getByPlaceholder("Name"));
        expect(path(page)).toBe("/signup");
        await page.context().close();
      });

      // r[verify identity.auth-screen.signin-signup-paths]
      it("opens /signup on Sign in, with no Create account tab, while sign-up is closed", async () => {
        const page = await signedOutAt("/signup", false);
        expect(await tab(page, "Create account").count()).toBe(0);
        expect(await page.getByPlaceholder("Name").count()).toBe(0);
        await visible(control(page, "Sign in"));
        await page.context().close();
      });

      // r[verify identity.auth-screen.signin-signup-paths]
      it("keeps the magic-link block on /signup when there is no email+password form", async () => {
        const page = await (await context()).newPage();
        await page.route("**/api/config", (route) =>
          route.fulfill({
            json: {
              emailPasswordEnabled: false,
              googleEnabled: true,
              signupAllowed: true,
              capabilities: { magicLinkSignIn: true, verifiedSignUp: true, passwordReset: false, shareInvitations: false },
            },
          }),
        );
        await page.goto(`${ORIGIN}/signup`);
        await visible(page.getByLabel("Email for a sign-in link"));
        await visible(control(page, "Email me a sign-in link"));
        await page.context().close();
      });

      // r[verify identity.auth-screen.signin-signup-paths]
      it("opens /signin on Sign in, and any other path on Sign in with the path kept", async () => {
        for (const at of ["/signin", "/library-or-any-path"]) {
          const page = await signedOutAt(at);
          await visible(tab(page, "Sign in", true));
          expect(path(page), at).toBe(at);
          await page.context().close();
        }
      });

      // r[verify identity.auth-screen.signin-signup-paths]
      it("lands a sign-up from /signup on Home at /", async () => {
        seq += 1;
        const page = await signedOutAt("/signup");
        await page.getByPlaceholder("Name").fill("Grace Hopper");
        await page.getByPlaceholder("Email").fill(`s73-${seq}-${Date.now()}@example.com`);
        await page.getByPlaceholder("Password").fill(PASSWORD);
        // `/signup` is no screen to return to: no full reload back to it.
        await page.evaluate(() => Object.assign(window, { s73Marker: true }));
        await page.locator("form button[type='submit']").click();
        await visible(heading(page, "Home"));
        expect(path(page)).toBe("/");
        expect(await page.evaluate(() => (window as { s73Marker?: boolean }).s73Marker)).toBe(true);
        await page.context().close();
      });

      // r[verify identity.auth-screen.signin-signup-paths]
      it("still honours an explicit ?returnTo= from /signup", async () => {
        seq += 1;
        const page = await signedOutAt("/signup?returnTo=/account");
        await page.getByPlaceholder("Name").fill("Grace Hopper");
        await page.getByPlaceholder("Email").fill(`s73-rt-${seq}-${Date.now()}@example.com`);
        await page.getByPlaceholder("Password").fill(PASSWORD);
        await page.locator("form button[type='submit']").click();
        await eventually(() => expect(path(page)).toBe("/account"));
        await page.context().close();
      });

      // r[verify identity.auth-screen.signin-signup-paths]
      it("sends a signed-in visitor at /signin or /signup to Home at /", async () => {
        const u = await newUser();
        for (const at of ["/signin", "/signup"]) {
          const page = await (await context(u)).newPage();
          await page.goto(`${ORIGIN}${at}`);
          await visible(heading(page, "Home"));
          expect(path(page), at).toBe("/");
          await page.context().close();
        }
      });

      // r[verify identity.auth-screen.signin-signup-paths]
      it("follows the tabs in the address on /signin and /signup only", async () => {
        const page = await signedOutAt("/signin");
        await tab(page, "Create account").click();
        await eventually(() => expect(path(page)).toBe("/signup"));
        await tab(page, "Sign in").click();
        await eventually(() => expect(path(page)).toBe("/signin"));
        await page.context().close();

        const elsewhere = await signedOutAt("/account");
        await tab(elsewhere, "Create account").click();
        await visible(tab(elsewhere, "Create account", true));
        expect(path(elsewhere)).toBe("/account");
        await elsewhere.context().close();
      });
    });

    // S61 — Back and Forward wait for the data a screen needs, as the first load does.
    describe("waiting for data (S61)", () => {
      const loading = (page: Page) => page.locator("main").getByText("Loading…", { exact: true });

      // Holds every request matching `url` until the returned release is called;
      // `answer` (default: pass it through) then answers each one.
      async function hold(page: Page, url: string | RegExp, answer = (route: Route) => route.continue()): Promise<() => void> {
        let release!: () => void;
        const released = new Promise<void>((done) => (release = done));
        await page.route(url, async (route) => {
          await released;
          await answer(route);
        });
        return release;
      }

      // Signed in at `/` with `/api/collections` held: Home needs nothing, so it shows.
      async function openHoldingCollections(u: User): Promise<{ page: Page; release: () => void }> {
        const page = await (await context(u)).newPage();
        const release = await hold(page, "**/api/collections*");
        await page.goto(ORIGIN);
        await visible(heading(page, "Home"));
        return { page, release };
      }

      // Leaves `target` behind `/` in history, then goes Back onto it.
      const backOnto = (page: Page, target: string) =>
        page.evaluate((p) => {
          history.pushState(null, "", p);
          history.pushState(null, "", "/");
          history.back();
        }, target);

      // r[verify platform.navigation.waits-for-data]
      it("holds Back onto a collection until the library answers, then shows it at its path", async () => {
        const u = await newUser();
        const notes = await createCollection(u, "Held notes");
        const { page, release } = await openHoldingCollections(u);
        await backOnto(page, `/c/${notes.id}`);
        await visible(loading(page));
        expect(path(page)).toBe(`/c/${notes.id}`);
        release();
        await visible(heading(page, "Held notes"));
        expect(path(page)).toBe(`/c/${notes.id}`);
        await page.context().close();
      });

      // r[verify platform.navigation.waits-for-data]
      it("holds Forward onto a collection until the library answers, then shows it at its path", async () => {
        const u = await newUser();
        const notes = await createCollection(u, "Forward notes");
        const { page, release } = await openHoldingCollections(u);
        await page.evaluate(async (p) => {
          history.pushState(null, "", p);
          const popped = new Promise((done) => window.addEventListener("popstate", done, { once: true }));
          history.back();
          await popped;
          history.forward();
        }, `/c/${notes.id}`);
        await visible(loading(page));
        expect(path(page)).toBe(`/c/${notes.id}`);
        release();
        await visible(heading(page, "Forward notes"));
        expect(path(page)).toBe(`/c/${notes.id}`);
        await page.context().close();
      });

      // r[verify platform.navigation.fallback-home+2]
      it("shows Home at / for a held pop onto a collection the caller can't open, once the library answers", async () => {
        const owner = await newUser();
        const hidden = await createCollection(owner, "Someone else's");
        const u = await newUser();
        const { page, release } = await openHoldingCollections(u);
        await backOnto(page, `/c/${hidden.id}`);
        await visible(loading(page));
        release();
        await gone(loading(page));
        await visible(heading(page, "Home"));
        await eventually(() => expect(path(page)).toBe("/"));
        expect(await page.getByText("Someone else's").count()).toBe(0);
        await page.context().close();
      });

      // r[verify platform.navigation.waits-for-data]
      it("holds Back onto /organization until /api/me answers, then shows Organization settings", async () => {
        const u = await newUser();
        const page = await (await context(u)).newPage();
        const organizations = { activeId: "org-hv", memberships: [{ id: "org-hv", name: "Hidden Value", role: "owner" }] };
        const release = await hold(page, /\/api\/me$/, async (route) => {
          const real = (await (await route.fetch()).json()) as Record<string, unknown>;
          await route.fulfill({ json: { ...real, organizations } });
        });
        await page.goto(ORIGIN);
        await visible(heading(page, "Home"));
        await backOnto(page, "/organization");
        await visible(loading(page));
        expect(path(page)).toBe("/organization");
        release();
        await visible(heading(page, "Organization settings"));
        expect(path(page)).toBe("/organization");
        await page.context().close();
      });

      // r[verify platform.navigation.waits-for-data]
      it("keeps a screen opened while a pop is held, once the library answers", async () => {
        const u = await newUser();
        const notes = await createCollection(u, "Overtaken notes");
        const { page, release } = await openHoldingCollections(u);
        await backOnto(page, `/c/${notes.id}`);
        await visible(loading(page));
        await openAccountFromMenu(page);
        release();
        // The library has answered once a collection shows in the sidebar.
        await visible(control(await openSidebar(page), /Overtaken notes/));
        await visible(heading(page, "Account"));
        expect(path(page)).toBe("/account");
        await page.context().close();
      });

      // r[verify platform.navigation.waits-for-data]
      it("holds a reload on a collection until the library answers, never showing Home", async () => {
        const u = await newUser();
        const notes = await createCollection(u, "Reloaded notes");
        const page = await (await context(u)).newPage();
        const release = await hold(page, "**/api/collections*");
        await page.goto(`${ORIGIN}/c/${notes.id}`);
        await visible(loading(page));
        expect(await heading(page, "Home").count()).toBe(0);
        expect(path(page)).toBe(`/c/${notes.id}`);
        release();
        await visible(heading(page, "Reloaded notes"));
        expect(path(page)).toBe(`/c/${notes.id}`);
        await page.context().close();
      });
    });
  });

  it("makes a collection public behind a generated password from its header (S32b)", async () => {
    const u = await newUser();
    const c = await createCollection(u, "Gated tree");
    const page = await openApp(u);
    const aside = await openSidebar(page);
    await control(aside, /Gated tree/).click();
    await visible(page.getByRole("heading", { level: 1, name: "Gated tree" }));

    const header = page.locator("main header, main").first();
    await control(header, "Private").first().click();
    await page.getByText("Anyone with the link").click();
    await page.getByText("Require a password").click();
    const field = page.getByLabel("Link password");
    await visible(field);
    const generated = await field.inputValue();
    expect(generated).toHaveLength(16);
    await control(page, "Make public").click();
    await visible(toast(page, /Collection access set to Public/));
    await visible(page.locator("main [aria-label='Password protected']").first());

    const res = await app.request("/api/collections", { headers: { cookie: u.cookie } });
    const { collections } = (await res.json()) as { collections: { id: string; visibility: string; linkGate?: unknown }[] };
    const saved = collections.find((x) => x.id === c.id)!;
    expect(saved.visibility).toBe("public");
    expect(saved.linkGate).toEqual({ passwordProtected: true, expiresAt: null });
    await page.context().close();
  });

  it("manages access: searching adds a person to the list, removing drops them", async () => {
    const owner = await newUser();
    const guest = await newUser("Grace Hopper");
    await createArtefact(owner, "Board memo");
    const page = await openApp(owner);

    await control(listing(page), "Share").click();
    await visible(page.getByText("Manage access", { exact: true }));
    await chooseAccessLevel(page, "Specific people");
    await page.getByLabel("Search people").fill(guest.email);
    await control(page, new RegExp(guest.email.replace(/[.]/g, "\\."))).click();
    await visible(page.getByText("People with access · 1"));

    await page.locator(`[aria-label='Remove ${guest.name}']`).click();
    await visible(page.getByText(/No one yet/));
    await page.context().close();
  });

  describe("Manage access dialog (S55)", () => {
    async function summaryOf(u: User, id: string): Promise<ArtefactSummary> {
      return (await (await app.request(`/api/artefacts/${id}`, { headers: { cookie: u.cookie } })).json()) as ArtefactSummary;
    }
    async function accessOf(u: User, id: string): Promise<string[]> {
      const res = await app.request(`/api/artefacts/${id}/access`, { headers: { cookie: u.cookie } });
      return ((await res.json()) as { members: { email: string }[] }).members.map((m) => m.email);
    }
    // Every access write the page sends, as "METHOD /path".
    function writes(page: Page): string[] {
      const seen: string[] = [];
      page.on("request", (r) => {
        const path = new URL(r.url()).pathname;
        if (r.method() !== "GET" && /^\/api\/artefacts\/[^/]+\/(sharing|visibility|link-gate|data-visibility|access)/.test(path))
          seen.push(`${r.method()} ${path}`);
      });
      return seen;
    }
    const dialogOf = (page: Page) => page.getByRole("dialog");
    const section = (page: Page, label: string) => dialogOf(page).getByText(label, { exact: true });

    // r[verify hosting.access-dialog.sections-by-level]
    // r[verify hosting.access-dialog.draft-until-done]
    // r[verify hosting.access-dialog.undo-unless-password]
    it("shows only General settings for Private, sends nothing until Done, and Undo restores Private", async () => {
      const u = await newUser();
      const a = await createArtefact(u, "Drafted");
      const page = await openApp(u);
      await mineOnly(page);
      const sent = writes(page);

      await control(listing(page), "Share").click();
      await visible(section(page, "General settings"));
      for (const label of ["Link", "Viewers", "Link protection", "Saved data"]) expect(await section(page, label).count(), label).toBe(0);

      await chooseAccessLevel(page, "Org members");
      await visible(section(page, "Link"));
      await visible(dialogOf(page).getByText("The link is created when you click Done."));
      expect(sent).toEqual([]);

      await control(dialogOf(page), "Done").click();
      await visible(toast(page, "“Drafted” is now shared with org members"));
      expect(sent).toEqual([`PUT /api/artefacts/${a.id}/sharing`]);
      expect((await summaryOf(u, a.id)).visibility).toBe("authenticated");

      await control(page, "Undo").click();
      await eventually(async () => expect((await summaryOf(u, a.id)).visibility).toBe("private"));
      await visible(listing(page).locator("[title='Access: Private']"));
      await page.context().close();
    });

    // r[verify hosting.access-dialog.level-change-start]
    it("brings the remembered viewers back after a detour through Private", async () => {
      const owner = await newUser();
      const guest = await newUser("Grace Hopper");
      const a = await createArtefact(owner, "Remembered");
      const guestId = ((await (await app.request("/api/me", { headers: { cookie: guest.cookie } })).json()) as { id: string }).id;
      const res = await app.request(`/api/artefacts/${a.id}/sharing`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie: owner.cookie },
        body: JSON.stringify({ visibility: "selected", members: [guestId] }),
      });
      expect(res.status).toBe(200);
      const page = await openApp(owner);
      await mineOnly(page);

      await control(listing(page), "Share").click();
      await chooseAccessLevel(page, "Private");
      await control(dialogOf(page), "Done").click();
      await visible(toast(page, "“Remembered” is now private"));
      await gone(dialogOf(page));

      await control(listing(page), "Share").click();
      await chooseAccessLevel(page, "Specific people");
      await visible(dialogOf(page).getByText(guest.email));
      await control(dialogOf(page), "Done").click();
      await visible(toast(page, "“Remembered” is now shared with specific people"));
      expect(await accessOf(owner, a.id)).toEqual([guest.email]);
      await page.context().close();
    });

    it("starts a never-shared artefact's viewers empty, and Done saves the one person added", async () => {
      const owner = await newUser();
      const guest = await newUser("Katherine Johnson");
      const a = await createArtefact(owner, "Fresh list");
      const page = await openApp(owner);
      await mineOnly(page);

      await control(listing(page), "Share").click();
      await chooseAccessLevel(page, "Specific people");
      await visible(dialogOf(page).getByText(/No one yet — search above to add people/));
      await page.getByLabel("Search people").fill(guest.email);
      await control(page, new RegExp(guest.email.replace(/[.]/g, "\\."))).click();
      await visible(dialogOf(page).getByText("People with access · 1"));
      await control(dialogOf(page), "Done").click();
      await visible(toast(page, "“Fresh list” is now shared with specific people"));
      expect(await accessOf(owner, a.id)).toEqual([guest.email]);
      await page.context().close();
    });

    describe("viewer search popover", () => {
      const searchField = (page: Page) => dialogOf(page).getByRole("combobox", { name: "Search people" });
      const results = (page: Page) => page.getByRole("listbox");
      const optionFor = (page: Page, u: User) =>
        page.getByRole("option", { name: new RegExp(u.email.replace(/[.]/g, "\\.")) });
      async function openSpecificPeople(owner: User, title: string): Promise<Page> {
        await createArtefact(owner, title);
        const page = await openApp(owner);
        await mineOnly(page);
        await control(listing(page), "Share").click();
        await chooseAccessLevel(page, "Specific people");
        await visible(searchField(page));
        return page;
      }
      const heightOf = async (page: Page) => (await dialogOf(page).boundingBox())!.height;

      // r[verify hosting.access-dialog.search-popover]
      it("opens the results over the sections below, so the dialog keeps its height", async () => {
        const owner = await newUser();
        const guest = await newUser("Grace Hopper");
        const page = await openSpecificPeople(owner, "Steady height");
        const before = await heightOf(page);

        await searchField(page).fill(guest.email);
        await visible(optionFor(page, guest));
        expect(Math.abs((await heightOf(page)) - before)).toBeLessThanOrEqual(1);
        expect(await dialogOf(page).getByRole("listbox").count()).toBe(0);

        await searchField(page).fill("zzz");
        await visible(page.getByRole("status").filter({ hasText: "No people found." }));
        expect(Math.abs((await heightOf(page)) - before)).toBeLessThanOrEqual(1);

        await searchField(page).fill("");
        await results(page).waitFor({ state: "detached" });
        await page.context().close();
      });

      // r[verify hosting.access-dialog.search-popover]
      it("closes on Esc before the dialog does, keeping the draft", async () => {
        const owner = await newUser();
        const guest = await newUser("Grace Hopper");
        const page = await openSpecificPeople(owner, "Esc layers");

        await searchField(page).fill(guest.email);
        await visible(optionFor(page, guest));
        await page.keyboard.press("Escape");
        await results(page).waitFor({ state: "detached" });
        await visible(dialogOf(page));
        await visible(dialogOf(page).getByText("Specific people", { exact: true }));

        await page.keyboard.press("Escape");
        await gone(dialogOf(page));
        await page.context().close();
      });

      // r[verify hosting.access-dialog.search-popover]
      it("closes on a click outside it, leaving the dialog open", async () => {
        const owner = await newUser();
        const guest = await newUser("Grace Hopper");
        const page = await openSpecificPeople(owner, "Click outside");

        await searchField(page).fill(guest.email);
        await visible(optionFor(page, guest));
        await searchField(page).click();
        await visible(optionFor(page, guest));
        await dialogOf(page).getByText("Manage access", { exact: true }).click();
        await results(page).waitFor({ state: "detached" });
        await visible(dialogOf(page));
        await page.context().close();
      });

      // r[verify hosting.access-dialog.search-keyboard+2]
      it("adds the highlighted person on Enter, clears the field and keeps focus in it", async () => {
        const owner = await newUser();
        const guest = await newUser("Grace Hopper");
        const page = await openSpecificPeople(owner, "Keyboard add");

        await searchField(page).fill(guest.email);
        await visible(optionFor(page, guest));
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Enter");
        await visible(dialogOf(page).getByText("People with access · 1"));
        await visible(dialogOf(page).getByText(guest.email));
        expect(await searchField(page).inputValue()).toBe("");
        await results(page).waitFor({ state: "detached" });
        expect(await searchField(page).evaluate((el) => el === document.activeElement)).toBe(true);
        await page.context().close();
      });

      // r[verify hosting.access-dialog.search-keyboard+2]
      it("adds a clicked person the same way, and leaves them out of later results", async () => {
        const owner = await newUser();
        const guest = await newUser("Grace Hopper");
        const page = await openSpecificPeople(owner, "Click add");

        await searchField(page).fill(guest.email);
        await optionFor(page, guest).click();
        await visible(dialogOf(page).getByText("People with access · 1"));
        expect(await searchField(page).inputValue()).toBe("");
        await results(page).waitFor({ state: "detached" });
        expect(await searchField(page).evaluate((el) => el === document.activeElement)).toBe(true);

        await searchField(page).fill(guest.email);
        await visible(page.getByRole("status").filter({ hasText: "No people found." }));
        expect(await optionFor(page, guest).count()).toBe(0);
        await page.context().close();
      });

      // r[verify hosting.access-dialog.search-keyboard+2]
      it("is a combobox controlling the results listbox, naming the highlighted option", async () => {
        const owner = await newUser();
        const guest = await newUser("Grace Hopper");
        const page = await openSpecificPeople(owner, "Combobox");
        const field = searchField(page);
        expect(await field.getAttribute("aria-expanded")).toBe("false");

        await field.fill(guest.email);
        await visible(optionFor(page, guest));
        await page.keyboard.press("ArrowDown");
        expect(await field.getAttribute("aria-expanded")).toBe("true");
        expect(await field.getAttribute("aria-controls")).toBe(await results(page).getAttribute("id"));
        await eventually(async () =>
          expect(await field.getAttribute("aria-activedescendant")).toBe(
            await page.locator("[role='option'][aria-selected='true']").getAttribute("id"),
          ),
        );
        expect(await field.getAttribute("aria-activedescendant")).toBe(await optionFor(page, guest).getAttribute("id"));
        await page.context().close();
      });

      // r[verify hosting.access-dialog.search-keyboard+2]
      it("moves the highlight with ↓ and ↑, and Enter adds the highlighted person", async () => {
        const owner = await newUser();
        const name = `Hopper ${Date.now()}`;
        await newUser(`${name} One`);
        await newUser(`${name} Two`);
        const page = await openSpecificPeople(owner, "Arrow keys");

        await searchField(page).fill(name);
        const options = page.getByRole("option");
        await eventually(async () => expect(await options.count()).toBe(2));
        const selected = page.locator("[role='option'][aria-selected='true']");
        expect(await selected.getAttribute("id")).toBe(await options.nth(0).getAttribute("id"));
        await page.keyboard.press("ArrowDown");
        await eventually(async () =>
          expect(await selected.getAttribute("id")).toBe(await options.nth(1).getAttribute("id")),
        );
        await page.keyboard.press("ArrowUp");
        await eventually(async () =>
          expect(await selected.getAttribute("id")).toBe(await options.nth(0).getAttribute("id")),
        );
        await page.keyboard.press("ArrowDown");
        const second = (await options.nth(1).textContent())!.includes(`${name} Two`) ? "Two" : "One";
        await page.keyboard.press("Enter");
        await visible(dialogOf(page).getByText("People with access · 1"));
        await visible(dialogOf(page).getByText(`${name} ${second}`));
        await page.context().close();
      });

      // r[verify hosting.access-dialog.search-popover]
      it("closes on a click outside the dialog before the dialog does", async () => {
        const owner = await newUser();
        const guest = await newUser("Grace Hopper");
        const page = await openSpecificPeople(owner, "Overlay click");

        await searchField(page).fill(guest.email);
        await visible(optionFor(page, guest));
        await page.mouse.click(5, 5);
        await results(page).waitFor({ state: "detached" });
        await visible(dialogOf(page));

        await page.mouse.click(5, 5);
        await gone(dialogOf(page));
        await page.context().close();
      });

      it("scrolls a long result list under the wheel", async () => {
        const owner = await newUser();
        const name = `Wheel ${Date.now()}`;
        for (let i = 0; i < 9; i++) await newUser(`${name} ${i}`);
        const page = await openSpecificPeople(owner, "Wheel scroll");

        await searchField(page).fill(name);
        await eventually(async () => expect(await page.getByRole("option").count()).toBe(9));
        const box = (await results(page).boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, 200);
        await eventually(async () => expect(await results(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(0));
        await page.context().close();
      });

      // r[verify hosting.access-dialog.search-keyboard+2]
      it("reopens the results on ↓, ↑ or a click in the field while it holds a query", async () => {
        const owner = await newUser();
        const guest = await newUser("Grace Hopper");
        const page = await openSpecificPeople(owner, "Reopen");

        await searchField(page).fill(guest.email);
        await visible(optionFor(page, guest));
        await page.keyboard.press("Escape");
        await results(page).waitFor({ state: "detached" });
        expect(await searchField(page).getAttribute("aria-expanded")).toBe("false");
        await page.keyboard.press("ArrowDown");
        await visible(optionFor(page, guest));
        expect(await searchField(page).getAttribute("aria-expanded")).toBe("true");

        await page.keyboard.press("Escape");
        await results(page).waitFor({ state: "detached" });
        await page.keyboard.press("ArrowUp");
        await visible(optionFor(page, guest));

        await dialogOf(page).getByText("Manage access", { exact: true }).click();
        await results(page).waitFor({ state: "detached" });
        await searchField(page).click();
        await visible(optionFor(page, guest));
        await page.keyboard.press("Enter");
        await visible(dialogOf(page).getByText("People with access · 1"));
        await page.context().close();
      });

      it("stays closed on ↓ in an empty field", async () => {
        const owner = await newUser();
        const page = await openSpecificPeople(owner, "Blank field");

        await searchField(page).click();
        await page.keyboard.press("ArrowDown");
        await new Promise((done) => setTimeout(done, 300));
        expect(await results(page).count()).toBe(0);
        expect(await searchField(page).getAttribute("aria-expanded")).toBe("false");
        await page.context().close();
      });

      it("keeps focus in the field when the results are pressed", async () => {
        const owner = await newUser();
        const page = await openSpecificPeople(owner, "Press results");

        await searchField(page).fill("zzz");
        const status = page.getByRole("status").filter({ hasText: "No people found." });
        await visible(status);
        await status.click();
        await page.keyboard.type("q");
        expect(await searchField(page).inputValue()).toBe("zzzq");
        await page.context().close();
      });

      // r[verify hosting.access-dialog.search-keyboard+2]
      it("leaves Home and End to the caret", async () => {
        const owner = await newUser();
        const guest = await newUser("Grace Hopper");
        const page = await openSpecificPeople(owner, "Caret keys");

        await searchField(page).fill(guest.email);
        await visible(optionFor(page, guest));
        await page.keyboard.press("Home");
        expect(await searchField(page).evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(0);
        await page.keyboard.press("End");
        expect(await searchField(page).evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(guest.email.length);
        await page.context().close();
      });

      // r[verify hosting.access-dialog.search-keyboard+2]
      it("drops a late response for a query the owner has since changed", async () => {
        const owner = await newUser();
        const guest = await newUser("Grace Hopper");
        const page = await openSpecificPeople(owner, "Late response");
        let release!: () => void;
        const held = new Promise<void>((done) => (release = done));
        await page.route("**/api/users/search?*", async (route) => {
          if (route.request().url().includes(encodeURIComponent(guest.email))) await held;
          await route.continue();
        });

        const sent = page.waitForRequest((r) => r.url().includes(encodeURIComponent(guest.email)));
        await searchField(page).fill(guest.email);
        await sent;
        await searchField(page).fill("zzz");
        await visible(page.getByRole("status").filter({ hasText: "No people found." }));
        const late = page.waitForResponse((r) => r.url().includes(encodeURIComponent(guest.email)));
        release();
        await late;
        await new Promise((done) => setTimeout(done, 300));
        expect(await optionFor(page, guest).count()).toBe(0);
        await visible(page.getByRole("status").filter({ hasText: "No people found." }));
        await page.context().close();
      });
    });

    it("says Specific people is only for the org members you invite", async () => {
      const u = await newUser();
      await createArtefact(u, "Help text");
      const page = await openApp(u);
      await mineOnly(page);

      await control(listing(page), "Share").click();
      await dialogOf(page).locator("[aria-haspopup='listbox']").click();
      const option = page.getByRole("option").filter({ hasText: /^\s*Specific people/ });
      await visible(option.getByText("Only org members you invite", { exact: true }));
      await page.context().close();
    });

    // r[verify hosting.access-dialog.draft-until-done]
    it("discards the draft on Cancel and on Esc; Esc with the level list open closes only the list", async () => {
      const u = await newUser();
      const a = await createArtefact(u, "Discarded");
      const page = await openApp(u);
      await mineOnly(page);
      const before = await summaryOf(u, a.id);
      const sent = writes(page);

      await control(listing(page), "Share").click();
      await chooseAccessLevel(page, "Public");
      await control(dialogOf(page), "Cancel").click();
      await gone(dialogOf(page));

      await control(listing(page), "Share").click();
      await chooseAccessLevel(page, "Org members");
      await dialogOf(page).locator("[aria-haspopup='listbox']").click();
      await visible(page.getByRole("listbox"));
      await page.keyboard.press("Escape");
      await page.getByRole("listbox").waitFor({ state: "detached" });
      await visible(section(page, "General settings"));
      await page.keyboard.press("Escape");
      await gone(dialogOf(page));

      expect(sent).toEqual([]);
      expect(await summaryOf(u, a.id)).toEqual(before);
      await page.context().close();
    });

    // r[verify hosting.sharing.members-replace]
    it("keeps Done disabled when the access list fails to load, so a save can't replace it with a partial one", async () => {
      const owner = await newUser();
      const guest = await newUser("Ada Byron");
      const a = await createArtefact(owner, "Unloaded list");
      const guestId = ((await (await app.request("/api/me", { headers: { cookie: guest.cookie } })).json()) as { id: string }).id;
      const res = await app.request(`/api/artefacts/${a.id}/sharing`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie: owner.cookie },
        body: JSON.stringify({ visibility: "selected", members: [guestId] }),
      });
      expect(res.status).toBe(200);
      const page = await openApp(owner);
      await mineOnly(page);
      await page.route(`**/api/artefacts/${a.id}/access`, (route) =>
        route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) }),
      );

      await control(listing(page), "Share").click();
      await visible(dialogOf(page).getByText("Couldn't load who has access."));
      expect(await control(dialogOf(page), "Done").isDisabled()).toBe(true);
      expect(await dialogOf(page).getByText(/No one yet/).count()).toBe(0);
      await page.context().close();
    });

    describe("an edit while the access list loads", () => {
      const STORING = `<html><body><script>localStorage.getItem("k")</script>Stores</body></html>`;
      async function idOf(u: User): Promise<string> {
        return ((await (await app.request("/api/me", { headers: { cookie: u.cookie } })).json()) as { id: string }).id;
      }
      async function share(owner: User, id: string, body: object): Promise<void> {
        const res = await app.request(`/api/artefacts/${id}/sharing`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", cookie: owner.cookie },
          body: JSON.stringify(body),
        });
        expect(res.status).toBe(200);
      }
      // Opens the owner's dialog with `GET …/access` held; `release` lets it through.
      async function openHeld(owner: User, id: string): Promise<{ page: Page; release: () => Promise<void> }> {
        const page = await openApp(owner);
        await mineOnly(page);
        let open!: () => void;
        const held = new Promise<void>((done) => (open = done));
        const isList = (url: string) => new URL(url).pathname === `/api/artefacts/${id}/access`;
        await page.route(`**/api/artefacts/${id}/access`, async (route) => {
          if (route.request().method() === "GET") await held;
          await route.continue();
        });
        const sent = page.waitForRequest((r) => r.method() === "GET" && isList(r.url()));
        await control(listing(page), "Share").click();
        await sent;
        return {
          page,
          release: async () => {
            const loaded = page.waitForResponse((r) => r.request().method() === "GET" && isList(r.url()));
            open();
            await loaded;
          },
        };
      }

      // r[verify hosting.access-dialog.load-keeps-list]
      it("keeps the viewers when Saved data changes before the list arrives", async () => {
        const owner = await newUser();
        const guest = await newUser("Grace Hopper");
        const a = await createArtefact(owner, "Data first", "prototype", STORING);
        await share(owner, a.id, { visibility: "selected", members: [await idOf(guest)] });
        const { page, release } = await openHeld(owner, a.id);

        await visible(dialogOf(page).getByText("Loading…"));
        await dialogOf(page).getByRole("radio", { name: /Shared with viewers/ }).click();
        expect(await control(dialogOf(page), "Done").isDisabled()).toBe(true);
        await release();
        await visible(dialogOf(page).getByText(guest.email));
        await control(dialogOf(page), "Done").click();
        await visible(toast(page, "Saved data is now shared with viewers"));
        expect(await accessOf(owner, a.id)).toEqual([guest.email]);
        expect((await summaryOf(owner, a.id)).dataVisibility).toBe("shared");
        await page.context().close();
      });

      // r[verify hosting.access-dialog.load-keeps-list]
      it("starts Specific people from the retained list when picked before it arrives", async () => {
        const owner = await newUser();
        const guest = await newUser("Grace Hopper");
        const a = await createArtefact(owner, "Picked early");
        await share(owner, a.id, { visibility: "selected", members: [await idOf(guest)] });
        await share(owner, a.id, { visibility: "authenticated" });
        const { page, release } = await openHeld(owner, a.id);

        await chooseAccessLevel(page, "Specific people");
        await visible(dialogOf(page).getByText("Loading…"));
        await release();
        await visible(dialogOf(page).getByText("People with access · 1"));
        await visible(dialogOf(page).getByText(guest.email));
        await control(dialogOf(page), "Done").click();
        await visible(toast(page, "“Picked early” is now shared with specific people"));
        expect(await accessOf(owner, a.id)).toEqual([guest.email]);
        await page.context().close();
      });

      // r[verify hosting.access-dialog.load-keeps-list]
      it("keeps the loaded viewers beside a person added before the list arrives", async () => {
        const owner = await newUser();
        const first = await newUser("Grace Hopper");
        const added = await newUser("Katherine Johnson");
        const a = await createArtefact(owner, "Added early");
        await share(owner, a.id, { visibility: "selected", members: [await idOf(first)] });
        const { page, release } = await openHeld(owner, a.id);

        await visible(dialogOf(page).getByText("Loading…"));
        await dialogOf(page).getByRole("combobox", { name: "Search people" }).fill(added.email);
        await page.getByRole("option", { name: new RegExp(added.email.replace(/[.]/g, "\\.")) }).click();
        // The count waits for the list: one added person isn't everyone with access.
        expect(await dialogOf(page).getByText(/People with access ·/).count()).toBe(0);
        await release();
        await visible(dialogOf(page).getByText("People with access · 2"));
        await control(dialogOf(page), "Done").click();
        await visible(toast(page, "2 people can now open “Added early”"));
        expect((await accessOf(owner, a.id)).sort()).toEqual([first.email, added.email].sort());
        await page.context().close();
      });

      it("shows no people count when the list fails to load after a person was added", async () => {
        const owner = await newUser();
        const added = await newUser("Katherine Johnson");
        const a = await createArtefact(owner, "Failed early");
        await share(owner, a.id, { visibility: "selected" });
        const page = await openApp(owner);
        await mineOnly(page);
        let fail!: () => void;
        const held = new Promise<void>((done) => (fail = done));
        await page.route(`**/api/artefacts/${a.id}/access`, async (route) => {
          if (route.request().method() !== "GET") return route.continue();
          await held;
          await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) });
        });

        await control(listing(page), "Share").click();
        await visible(dialogOf(page).getByText("Loading…"));
        await dialogOf(page).getByRole("combobox", { name: "Search people" }).fill(added.email);
        await page.getByRole("option", { name: new RegExp(added.email.replace(/[.]/g, "\\.")) }).click();
        fail();
        await visible(dialogOf(page).getByText("Couldn't load who has access."));
        expect(await dialogOf(page).getByText(/People with access ·/).count()).toBe(0);
        expect(await control(dialogOf(page), "Done").isDisabled()).toBe(true);
        await page.context().close();
      });
    });

    it("disables Done on a too-short password, with the error linked to the field", async () => {
      const u = await newUser();
      await createArtefact(u, "Guarded");
      const page = await openApp(u);
      await mineOnly(page);

      await control(listing(page), "Share").click();
      await chooseAccessLevel(page, "Public");
      await dialogOf(page).getByText("Require a password").click();
      const field = page.getByLabel("Link password");
      await field.fill("abcde");
      const error = dialogOf(page).getByText("The password needs at least 8 characters.");
      await visible(error);
      expect(await field.getAttribute("aria-describedby")).toBe(await error.getAttribute("id"));
      expect(await control(dialogOf(page), "Done").isDisabled()).toBe(true);

      await field.fill("long-enough-pw");
      await gone(error);
      expect(await control(dialogOf(page), "Done").isDisabled()).toBe(false);
      await page.context().close();
    });

    // r[verify hosting.sharing.atomic-save]
    it("shows the error toast on a failed Done, and the card keeps its badge", async () => {
      const u = await newUser();
      const a = await createArtefact(u, "Refused");
      const page = await openApp(u);
      await mineOnly(page);
      await page.route("**/api/artefacts/*/sharing", (route) =>
        route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) }),
      );

      await control(listing(page), "Share").click();
      await chooseAccessLevel(page, "Public");
      await control(dialogOf(page), "Done").click();
      await visible(toast(page, "Couldn't make “Refused” public. Try again."));
      expect((await summaryOf(u, a.id)).visibility).toBe("private");
      await page.keyboard.press("Escape");
      await gone(dialogOf(page));
      await visible(listing(page).locator("[title='Access: Private']"));
      await page.context().close();
    });

    it("keeps the Access inherited popover for an artefact in a collection, and the collection's people-only dialog", async () => {
      const u = await newUser();
      const c = await createCollection(u, "Inheriting tree");
      const a = await createArtefact(u, "Contained");
      const moved = await app.request(`/api/artefacts/${a.id}/collection`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie: u.cookie },
        body: JSON.stringify({ collectionId: c.id }),
      });
      expect(moved.status).toBe(200);
      const res = await app.request(`/api/collections/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", cookie: u.cookie },
        body: JSON.stringify({ visibility: "selected" }),
      });
      expect(res.ok).toBe(true);
      const page = await openApp(u);
      await mineOnly(page);

      await control(listing(page), "Share").click();
      await visible(page.getByText("Access inherited"));
      expect(await page.getByRole("dialog", { name: "Manage access" }).count()).toBe(0);
      await page.keyboard.press("Escape");

      const aside = await openSidebar(page);
      await control(aside, /Inheriting tree/).click();
      await visible(page.getByRole("heading", { level: 1, name: "Inheriting tree" }));
      await control(page.locator("main"), "Manage").first().click();
      await visible(dialogOf(page).getByText(/everything inside inherits this list/));
      expect(await dialogOf(page).locator("[aria-haspopup='listbox']").count()).toBe(0);
      await page.context().close();
    });

    // r[verify collections.access-dialog.no-stale-results]
    it("drops a late search response in a collection's people-only dialog once the query has changed", async () => {
      const u = await newUser();
      const guest = await newUser("Grace Hopper");
      const c = await createCollection(u, "Searched tree");
      const res = await app.request(`/api/collections/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", cookie: u.cookie },
        body: JSON.stringify({ visibility: "selected" }),
      });
      expect(res.ok).toBe(true);
      const page = await openApp(u);
      let release!: () => void;
      const held = new Promise<void>((done) => (release = done));
      await page.route("**/api/users/search?*", async (route) => {
        if (route.request().url().includes(encodeURIComponent(guest.email))) await held;
        await route.continue();
      });

      const aside = await openSidebar(page);
      await control(aside, /Searched tree/).click();
      await visible(page.getByRole("heading", { level: 1, name: "Searched tree" }));
      await control(page.locator("main"), "Manage").first().click();
      const field = dialogOf(page).getByPlaceholder("Search people by name or email…");
      const sent = page.waitForRequest((r) => r.url().includes(encodeURIComponent(guest.email)));
      await field.fill(guest.email);
      await sent;
      await field.fill("zzz");
      await visible(dialogOf(page).getByText("No people found."));
      const late = page.waitForResponse((r) => r.url().includes(encodeURIComponent(guest.email)));
      release();
      await late;
      await new Promise((done) => setTimeout(done, 300));
      expect(await dialogOf(page).getByText(guest.email).count()).toBe(0);
      await visible(dialogOf(page).getByText("No people found."));
      await page.context().close();
    });

    // S33b — the share-invitation seam, against stub invitation endpoints: the
    // OSS server mounts none, so a superset's are played by `page.route`.
    describe("share invitations (S33b)", () => {
      const searchField = (page: Page) => dialogOf(page).getByRole("combobox", { name: "Search people" });
      const PENDING: ShareInvitation = {
        id: "inv-1",
        email: "pending@b.co",
        createdAt: "2026-10-01T00:00:00.000Z",
        expiresAt: "2030-10-15T00:00:00.000Z",
      };

      // Every sharing and invitation request the page sends, as "METHOD path[ body]".
      function recorded(page: Page): string[] {
        const seen: string[] = [];
        page.on("request", (r) => {
          const path = new URL(r.url()).pathname;
          if (!/^\/api\/artefacts\/[^/]+\/(sharing|invitations|access)/.test(path)) return;
          if (r.method() === "GET" && !path.endsWith("/access")) return;
          seen.push(`${r.method()} ${path}${r.postData() ? ` ${r.postData()}` : ""}`);
        });
        return seen;
      }

      // The owner's dialog on `title` at Specific people, with the capability
      // on: the stub lists `saved`, answers an invite with `answer(email)` (a
      // number is a failed status) and a revoke with 204.
      async function openInviting(
        owner: User,
        title: string,
        { saved = [], answer = () => ({ status: "pending" }), visibility = "selected" }: {
          // A number: the list fails with that status.
          saved?: ShareInvitation[] | number;
          answer?: (email: string) => InviteResult | number;
          visibility?: string;
        } = {},
      ): Promise<{ page: Page; sent: string[]; id: string }> {
        const { id } = await createArtefact(owner, title);
        if (visibility !== "private") await setVisibility(owner, id, visibility);
        const page = await (await context(owner)).newPage();
        await page.route("**/api/config", async (route) => {
          const res = await route.fetch();
          const config = await res.json();
          await route.fulfill({ json: { ...config, capabilities: { ...config.capabilities, shareInvitations: true } } });
        });
        await page.route(/\/api\/artefacts\/[^/]+\/invitations/, async (route) => {
          const req = route.request();
          if (req.method() === "GET") {
            return typeof saved === "number"
              ? route.fulfill({ status: saved, json: { error: "failed" } })
              : route.fulfill({ json: saved });
          }
          if (req.method() === "DELETE") return route.fulfill({ status: 204 });
          const result = answer((req.postDataJSON() as { email: string }).email);
          return typeof result === "number"
            ? route.fulfill({ status: result, json: { error: "failed" } })
            : route.fulfill({ json: result });
        });
        const sent = recorded(page);
        await page.goto(ORIGIN);
        await page.getByRole("heading", { name: "Home" }).waitFor();
        await mineOnly(page);
        await control(listing(page), "Share").click();
        if (visibility === "private") await chooseAccessLevel(page, "Specific people");
        await visible(searchField(page));
        return { page, sent, id };
      }

      // r[verify hosting.invitations.oss-default-off+3]
      // r[verify hosting.invitations.invite-affordance+3]
      it("offers no invite and asks for no invitations with the capability off", async () => {
        const owner = await newUser();
        const { id } = await createArtefact(owner, "No invites");
        await setVisibility(owner, id, "selected");
        const page = await openApp(owner);
        const asked: string[] = [];
        page.on("request", (r) => {
          if (r.url().includes("/invitations")) asked.push(r.url());
        });
        await mineOnly(page);
        await control(listing(page), "Share").click();
        await searchField(page).fill("a@b.co");
        await visible(page.getByRole("status").filter({ hasText: "No people found." }));
        expect(await page.getByRole("option", { name: /Invite/ }).count()).toBe(0);
        expect(asked).toEqual([]);
        await page.context().close();
      });

      // r[verify hosting.invitations.invite-affordance+3]
      // r[verify hosting.invitations.sent-on-done+3]
      it("invites an unknown email: a Will be invited row, then Done saves sharing before the invite", async () => {
        const owner = await newUser();
        const { page, sent, id } = await openInviting(owner, "Invite one", { visibility: "private" });
        await searchField(page).fill("a@b.co");
        const invite = page.getByRole("option", { name: "Invite a@b.co" });
        await visible(invite);
        expect(await page.getByRole("status").filter({ hasText: "No people found." }).count()).toBe(0);
        await invite.click();
        await visible(dialogOf(page).getByText("Will be invited"));
        expect(await searchField(page).inputValue()).toBe("");
        await visible(dialogOf(page).getByText("People with access · 1"));
        const writes = () => sent.filter((s) => !s.startsWith("GET"));
        expect(writes()).toEqual([]);

        await control(dialogOf(page), "Done").click();
        // One toast: the level change with its Undo, then the invitation sent.
        await visible(toast(page, "“Invite one” is now shared with specific people · Invitation sent to a@b.co"));
        await visible(control(page, "Undo"));
        expect(writes()).toEqual([
          `PUT /api/artefacts/${id}/sharing {"visibility":"selected"}`,
          `POST /api/artefacts/${id}/invitations {"email":"a@b.co"}`,
        ]);
        await page.context().close();
      });

      // r[verify hosting.invitations.sent-on-done+3]
      it("refreshes the library after a granted invite", async () => {
        const owner = await newUser();
        const { page, sent, id } = await openInviting(owner, "Invite granted", { answer: () => ({ status: "granted" }) });
        await searchField(page).fill("a@b.co");
        await page.getByRole("option", { name: "Invite a@b.co" }).click();
        const refreshed = page.waitForRequest(
          (r) => r.method() === "GET" && new URL(r.url()).pathname === "/api/artefacts",
        );
        await control(dialogOf(page), "Done").click();
        await gone(dialogOf(page));
        await refreshed;
        // The invite, and no reload of the closing dialog's members after it.
        const post = `POST /api/artefacts/${id}/invitations {"email":"a@b.co"}`;
        expect(sent.slice(sent.indexOf(post))).toEqual([post]);
        await page.context().close();
      });

      // r[verify hosting.invitations.invite-affordance+3]
      // r[verify hosting.invitations.sent-on-done+3]
      it("shows a saved invitation, revokes it on Done, and sends nothing on Cancel", async () => {
        const owner = await newUser();
        const { page, sent, id } = await openInviting(owner, "Invite pending", { saved: [PENDING] });
        await visible(dialogOf(page).getByText(/Invited · expires/));
        await visible(dialogOf(page).getByText("People with access · 1"));
        await dialogOf(page).getByRole("button", { name: "Remove invitation for pending@b.co" }).click();
        expect(await dialogOf(page).getByText("pending@b.co").count()).toBe(0);
        await control(dialogOf(page), "Cancel").click();
        await gone(dialogOf(page));
        expect(sent.filter((s) => !s.startsWith("GET"))).toEqual([]);

        await control(listing(page), "Share").click();
        await dialogOf(page).getByRole("button", { name: "Remove invitation for pending@b.co" }).click();
        await control(dialogOf(page), "Done").click();
        await gone(dialogOf(page));
        await visible(toast(page, "Invitation removed"));
        await eventually(() =>
          expect(sent.filter((s) => !s.startsWith("GET"))).toEqual([`DELETE /api/artefacts/${id}/invitations/inv-1`]),
        );
        await page.context().close();
      });

      // r[verify hosting.invitations.sent-on-done+3]
      it("shows a private artefact's pending invitation and revokes it from another level", async () => {
        const owner = await newUser();
        const { page, sent, id } = await openInviting(owner, "Invite kept", { saved: [PENDING], visibility: "private" });
        await visible(dialogOf(page).getByText(/Invited · expires/));
        await dialogOf(page).getByRole("button", { name: "Remove invitation for pending@b.co" }).click();
        await chooseAccessLevel(page, "Private");
        await control(dialogOf(page), "Done").click();
        await gone(dialogOf(page));
        await eventually(() =>
          expect(sent.filter((s) => !s.startsWith("GET"))).toEqual([`DELETE /api/artefacts/${id}/invitations/inv-1`]),
        );
        await page.context().close();
      });

      // r[verify hosting.invitations.invite-affordance+3]
      // r[verify hosting.invitations.sent-on-done+3]
      it("hides invitations whose list failed to load, and Done still saves the sharing", async () => {
        const owner = await newUser();
        const { page, sent, id } = await openInviting(owner, "Invites down", { saved: 500 });
        await searchField(page).fill("a@b.co");
        await visible(page.getByRole("status").filter({ hasText: "No people found." }));
        expect(await page.getByRole("option", { name: /Invite/ }).count()).toBe(0);
        expect(await dialogOf(page).getByText("Couldn't load who has access.").count()).toBe(0);
        await chooseAccessLevel(page, "Private");
        await control(dialogOf(page), "Done").click();
        await gone(dialogOf(page));
        await eventually(() =>
          expect(sent.filter((s) => !s.startsWith("GET"))).toEqual([
            `PUT /api/artefacts/${id}/sharing {"visibility":"private"}`,
          ]),
        );
        await page.context().close();
      });

      // r[verify hosting.invitations.sent-on-done+3]
      it("names a failed invite in an error toast and still sends the others", async () => {
        const owner = await newUser();
        const { page, sent, id } = await openInviting(owner, "Invite two", {
          answer: (email) => (email === "bad@b.co" ? 500 : { status: "pending" }),
        });
        for (const email of ["bad@b.co", "good@b.co"]) {
          await searchField(page).fill(email);
          await page.getByRole("option", { name: `Invite ${email}` }).click();
        }
        await control(dialogOf(page), "Done").click();
        await visible(toast(page, /Couldn't send the invitation to bad@b\.co/));
        expect(sent.filter((s) => s.startsWith("POST"))).toEqual([
          `POST /api/artefacts/${id}/invitations {"email":"bad@b.co"}`,
          `POST /api/artefacts/${id}/invitations {"email":"good@b.co"}`,
        ]);
        await page.context().close();
      });
    });
  });

  // r[verify platform.client.behaviour-suite+2]
  it("bookmarks an artefact into the sidebar and removes it again", async () => {
    const u = await newUser();
    await createArtefact(u, "Pinned piece");
    const page = await openApp(u);
    const aside = await openSidebar(page);

    await cardMenu(page, "Pinned piece");
    await control(page, "Bookmark").click();
    await visible(aside.getByText("Bookmarks"));
    await visible(aside.getByText("Pinned piece"));

    await cardMenu(page, "Pinned piece");
    await control(page, "Remove bookmark").click();
    await gone(aside.getByText("Pinned piece"));
    await page.context().close();
  });

  // r[verify platform.client.behaviour-suite+2]
  it("lifts a grid card on hover exactly as the Svelte client did — eased, not snapped — and leaves list rows still", async () => {
    const u = await newUser();
    await createArtefact(u, "Hovered");
    const page = await openApp(u);
    const open = page.locator("main [aria-label='Open Hovered']:not([data-recent] *)");
    // The card is the thumbnail button's nearest ancestor with a border radius.
    const card = () =>
      open.evaluate((el) => {
        let n: HTMLElement | null = el.parentElement;
        while (n && getComputedStyle(n).borderTopLeftRadius === "0px") n = n.parentElement;
        const s = getComputedStyle(n!);
        // Every property a lift can move: `transform`, or Tailwind v4's
        // individual `translate` / `scale`.
        const moved = ["transform", "translate", "scale"].filter((p) => {
          const v = s.getPropertyValue(p);
          return v !== "" && v !== "none";
        });
        const durations = s.transitionDuration.split(",").map((d) => parseFloat(d));
        const transitioned = s.transitionProperty.split(",").map((p, i) => ({
          p: p.trim(),
          ms: (durations[i % durations.length] ?? 0) * 1000,
        }));
        return {
          moved,
          transform: s.transform,
          // The visible layers only: Tailwind pads a shadow with transparent,
          // zero-size ring/inset layers that draw nothing.
          shadow: s.boxShadow
            .split(/,(?![^(]*\))/)
            .map((l) => l.trim())
            .filter((l) => l !== "rgba(0, 0, 0, 0) 0px 0px 0px 0px")
            .join(", "),
          // A moved property eases only when it (or `all`) has a transition.
          eased: moved.every((p) => transitioned.some((t) => (t.p === p || t.p === "all") && t.ms >= 100)),
        };
      });

    expect((await card()).moved).toEqual([]);
    await open.hover();
    await eventually(async () =>
      expect(await card()).toEqual({
        moved: ["transform"],
        // translateY(-6px) scale(1.015), and the original lift shadow.
        transform: "matrix(1.015, 0, 0, 1.015, 0, -6)",
        shadow: "rgba(16, 17, 18, 0.32) 0px 18px 38px -12px",
        eased: true,
      }),
    );

    await page.locator("main [title='List']").click();
    await eventually(async () => expect((await open.boundingBox())!.width).toBeLessThan(80));
    await open.hover();
    await new Promise((r) => setTimeout(r, 300));
    expect((await card()).moved).toEqual([]);
    await page.context().close();
  });

  // r[verify platform.client.card-lift-under-top-bar]
  it("keeps a hovered grid card scrolled under the top bar beneath the bar", async () => {
    const u = await newUser();
    for (let i = 1; i <= 8; i++) await createArtefact(u, `Underneath ${i}`);
    const page = await (await context(u, "light", { width: 1400, height: 600 })).newPage();
    await page.goto(ORIGIN);
    await page.getByRole("heading", { name: "Home" }).waitFor();
    // The first grid card, so the page can scroll far enough to tuck it under the bar.
    const open = page.locator("main [aria-label^='Open Underneath']:not([data-recent] *)").first();
    await visible(open);

    // Scroll so the card's top edge sits 24 px under the bar's bottom edge,
    // whichever element scrolls the page.
    const probe = await open.evaluate((el) => {
      let card: HTMLElement | null = el.parentElement;
      while (card && getComputedStyle(card).borderTopLeftRadius === "0px") card = card.parentElement;
      let scroller: Element | null = card!.parentElement;
      while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY)))
        scroller = scroller.parentElement;
      const target = scroller ?? document.scrollingElement!;
      const barBottom = document.querySelector("header")!.getBoundingClientRect().bottom;
      target.scrollTop += card!.getBoundingClientRect().top - (barBottom - 24);
      const r = card!.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: barBottom - 8, under: r.top < barBottom - 8 };
    });
    expect(probe.under).toBe(true);

    await open.hover();
    // Let the lift's 150 ms transition settle.
    await new Promise((r) => setTimeout(r, 300));
    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return { inHeader: !!el?.closest("header"), inMain: !!el?.closest("main") };
    }, probe);
    expect(hit).toEqual({ inHeader: true, inMain: false });
    await page.context().close();
  });

  // r[verify platform.client.behaviour-suite+2]
  // r[verify hosting.home.shared-cards+2]
  it("shows another user's members artefact under Home's Shared with me, as an ArtefactCard, in grid and list", async () => {
    const author = await newUser("Maya Chen");
    const a = await createArtefact(author, "Team handbook", "interactive-doc");
    await setVisibility(author, a.id, "authenticated");
    const page = await openApp(await newUser());
    const main = page.locator("main");

    // S47 — the switch carries the library totals. (Other tests' members-tier
    // artefacts are shared with this user too, so Shared is at least 1.)
    const countOf = async (label: string) =>
      Number((await control(main, new RegExp(`^\\s*${label}\\s*\\d+\\s*$`)).innerText()).replace(label, "").trim());
    await visible(control(main, /^\s*All\s*\d+\s*$/));
    const [all, mine, theirs] = [await countOf("All"), await countOf("My artefacts"), await countOf("Shared with me")];
    expect(mine).toBe(0);
    expect(theirs).toBeGreaterThanOrEqual(1);
    expect(all).toBe(mine + theirs);
    await control(main, /^\s*Shared with me/).click();
    const open = page.locator("main [aria-label='Open Team handbook']:not([data-recent] *)");
    await visible(open);
    await visible(main.getByText("Shared by Maya Chen"));
    expect((await open.boundingBox())!.width).toBeGreaterThan(150);
    // S54 — the viewer's card: the read-only "Org members" badge.
    await visible(main.locator("[title='Access: Org members']"));

    // A viewer's menu: Open, Bookmark and Download HTML; nothing owner-only and
    // no Copy share link (the link is on the card).
    await cardMenu(page, "Team handbook");
    const menu = page.locator("[role='menu']");
    await visible(control(menu, "Open"));
    await visible(control(menu, "Bookmark"));
    await visible(control(menu, "Download HTML"));
    for (const absent of ["Copy share link", "Remove from collection", "Archive", "Edit", "Add to collection…"])
      expect(await control(menu, absent).count(), absent).toBe(0);
    await page.keyboard.press("Escape");

    await page.locator("main [title='List']").click();
    await eventually(async () => expect((await open.boundingBox())!.width).toBeLessThan(80));
    await visible(main.getByText(/Shared by Maya Chen/));
    await page.context().close();
  });

  describe("artefact card (S54)", () => {
    // r[verify hosting.card.share-link-unless-private+6]
    // r[verify hosting.card.viewer-menu-downloads+2]
    it("gives a viewer a Share button that copies the full URL without opening a dialog, and Download HTML in the menu", async () => {
      const author = await newUser("Maya Chen");
      const a = await createArtefact(author, "Field guide", "interactive-doc");
      await setVisibility(author, a.id, "authenticated");
      const publicSlug = await slugOf(author, a.id);
      const page = await openApp(await newUser());
      await control(page.locator("main"), /^\s*Shared with me/).click();
      const card = cardOf(page, "Field guide");
      await visible(card);

      expect(await card.getByText(/\/a\//).count()).toBe(0);
      const share = card.getByRole("button", { name: "Copy link", exact: true });
      await visible(share);
      expect(await share.innerText()).toMatch(/Share/);
      await share.click();
      await visible(toast(page, /Link copied/));
      expect(await copied(page)).toBe(`${ORIGIN}/a/${publicSlug}`);
      expect(await page.getByRole("dialog").count()).toBe(0);

      await cardMenu(page, "Field guide");
      const download = page.locator("[role='menu'] a", { hasText: exact("Download HTML") });
      await visible(download);
      expect(await download.getAttribute("href")).toBe(`/api/artefacts/${a.id}/download`);
      await page.context().close();
    });

    // r[verify hosting.card.copy-failure-says-so]
    for (const [how, stub] of [
      ["the clipboard write rejects", () => (navigator.clipboard.writeText = () => Promise.reject(new Error("denied")))],
      ["there is no clipboard", () => Object.defineProperty(navigator, "clipboard", { value: undefined })],
    ] as const)
      it(`toasts "Couldn't copy the link", never "Link copied", when ${how}`, async () => {
        const author = await newUser("Maya Chen");
        const a = await createArtefact(author, `Uncopyable ${how}`, "interactive-doc");
        await setVisibility(author, a.id, "authenticated");
        const page = await (await context(await newUser())).newPage();
        await page.addInitScript(stub);
        await page.goto(ORIGIN);
        await control(page.locator("main"), /^\s*Shared with me/).click();
        const card = cardOf(page, `Uncopyable ${how}`);
        await card.getByRole("button", { name: "Copy link", exact: true }).click();
        await visible(toast(page, "Couldn't copy the link"));
        expect(await page.getByText(/Link copied/).count()).toBe(0);
        await page.context().close();
      });

    // r[verify hosting.row.meta-line]
    it("shows no payload size on a card, nor (S65) on the row", async () => {
      const u = await newUser();
      await createArtefact(u, "Sized card", "prototype", html("Sized card", 300 * 1024));
      const page = await openApp(u);
      await mineOnly(page);
      const card = cardOf(page, "Sized card");
      await visible(card);
      expect(await card.getByText(/\d+(\.\d)? (KB|MB)/).count()).toBe(0);

      await page.locator("main [title='List']").click();
      await visible(listing(page).locator("[aria-label='Open Sized card']"));
      await visible(listing(page).getByText(/^Updated /));
      expect(await listing(page).getByText(/\d+(\.\d)? (KB|MB)/).count()).toBe(0);
      await page.context().close();
    });

    it("names the kind with an icon before the title, and the thumbnail carries no kind text", async () => {
      const u = await newUser();
      await createArtefact(u, "Kind by the title", "prototype");
      const page = await openApp(u);
      await mineOnly(page);
      const card = cardOf(page, "Kind by the title");
      const icon = card.getByRole("img", { name: "Prototype", exact: true });
      await visible(icon);
      // Hovering names it too: the thumbnail no longer does.
      expect(await icon.getAttribute("title")).toBe("Prototype");
      const title = card.locator("button[title='Kind by the title']");
      const follows = await icon.evaluate(
        (el, t) => !!(el.compareDocumentPosition(t!) & Node.DOCUMENT_POSITION_FOLLOWING),
        await title.elementHandle(),
      );
      expect(follows).toBe(true);
      expect(await card.locator("[aria-label='Open Kind by the title']").getByText("Prototype").count()).toBe(0);
      await page.context().close();
    });

    // Squeezes `card`'s grid to its minimum column (15.5rem).
    const narrowest = (card: Locator) =>
      card.evaluate((el) => ((el.parentElement as HTMLElement).style.gridTemplateColumns = "repeat(3, 248px)"));
    const box = async (l: Locator) => (await l.boundingBox())!;

    it("keeps an owner's Share whole on the access row of the narrowest card, truncating the access label instead", async () => {
      const u = await newUser();
      const c = await createCollection(u, "Narrow tree");
      await setCollectionVisibility(u, c.id, "selected");
      const a = await createArtefact(u, "Narrow contained");
      await fileIn(u, a.id, c.id);
      const page = await openApp(u);
      await mineOnly(page);
      const card = cardOf(page, "Narrow contained");
      await visible(card);
      await narrowest(card);
      const [cb, s, badge] = await Promise.all([box(card), box(control(card, "Share")), box(card.locator("[title^='Access: ']"))]);
      expect(s.x + s.width).toBeLessThanOrEqual(cb.x + cb.width - 14 + 0.5);
      expect(Math.abs(s.y + s.height / 2 - (badge.y + badge.height / 2))).toBeLessThan(4);
      await page.context().close();
    });

    it("wraps a viewer's access row so “Shared by …” is never cut, with Share whole inside the card", async () => {
      const author = await newUser("Maya Chen");
      const a = await createArtefact(author, "Wrapped shared", "interactive-doc");
      await setVisibility(author, a.id, "authenticated");
      const page = await openApp(await newUser());
      await control(page.locator("main"), /^\s*Shared with me/).click();
      const card = cardOf(page, "Wrapped shared");
      await visible(card);
      await narrowest(card);
      const sharedBy = card.getByText("Shared by Maya Chen", { exact: true });
      await visible(sharedBy);
      expect(await sharedBy.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      const [cb, n, s] = await Promise.all([
        box(card),
        box(sharedBy),
        box(card.getByRole("button", { name: "Copy link", exact: true })),
      ]);
      for (const r of [n, s]) {
        expect(r.x).toBeGreaterThanOrEqual(cb.x + 14 - 0.5);
        expect(r.x + r.width).toBeLessThanOrEqual(cb.x + cb.width - 14 + 0.5);
        expect(r.y + r.height).toBeLessThanOrEqual(cb.y + cb.height);
      }
      await page.context().close();
    });

    it("marks an owner's card inside a collection with an inherited icon, not an INHERITED badge, beside Share", async () => {
      const u = await newUser();
      const c = await createCollection(u, "Card tree");
      const a = await createArtefact(u, "Card contained");
      await fileIn(u, a.id, c.id);
      const page = await openApp(u);
      await mineOnly(page);
      const card = cardOf(page, "Card contained");
      const icon = card.getByRole("img", { name: "Access inherited from “Card tree”", exact: true });
      await visible(icon);
      expect(await icon.getAttribute("title")).toBe("Access inherited from “Card tree”");
      expect(await card.getByText(/inherited/i).count()).toBe(0);
      const share = control(card, "Share");
      const [i, sh] = [(await icon.boundingBox())!, (await share.boundingBox())!];
      expect(Math.abs(i.y + i.height / 2 - (sh.y + sh.height / 2))).toBeLessThan(4);
      await page.context().close();
    });

    it("gives cards in one grid row the same height, with their access rows along the bottom", async () => {
      const u = await newUser();
      const c = await createCollection(u, "Even tree");
      const a = await createArtefact(u, "Even with collection");
      await fileIn(u, a.id, c.id);
      await createArtefact(u, "Even without");
      const page = await openApp(u);
      await mineOnly(page);
      const cards = [cardOf(page, "Even with collection"), cardOf(page, "Even without")];
      await visible(cards[0]!.getByText("In Even tree"));
      const boxes = await Promise.all(cards.map(async (c) => (await c.boundingBox())!));
      expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThan(1);
      expect(Math.abs(boxes[0]!.height - boxes[1]!.height)).toBeLessThan(1);
      const access = await Promise.all(cards.map(async (c) => (await c.locator("[title^='Access: ']").boundingBox())!));
      // The access row sits on the bottom edge, below the collection row.
      const collection = (await cards[0]!.getByText("In Even tree").boundingBox())!;
      expect(access[0]!.y).toBeGreaterThan(collection.y + collection.height);
      expect(Math.abs(access[0]!.y + access[0]!.height - (access[1]!.y + access[1]!.height))).toBeLessThan(1);
      await page.context().close();
    });

    const LONG_TITLE = "Vinga Ambassadors: Walkthrough of the onboarding flow for new ambassadors and their mentors";
    // The title's rendered lines, and whether it clips its text (its
    // `line-clamp` "…" is painted, never in the DOM, so a clip is the check).
    const titleLines = (title: Locator) =>
      title.locator("span").evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          lines: Math.round(el.clientHeight / parseFloat(s.lineHeight)),
          clipped: el.scrollHeight > el.clientHeight + 1,
          clamp: s.webkitLineClamp,
        };
      });

    // r[verify hosting.card.long-title]
    it("wraps a long title to two lines, then truncates it, with the full title as its tooltip", async () => {
      const u = await newUser();
      await createArtefact(u, LONG_TITLE);
      const page = await openApp(u);
      await mineOnly(page);
      const card = cardOf(page, LONG_TITLE);
      await visible(card);
      await narrowest(card);
      const title = card.locator("button", { hasText: LONG_TITLE });
      expect(await titleLines(title)).toEqual({ lines: 2, clipped: true, clamp: "2" });
      expect(await title.getAttribute("title")).toBe(LONG_TITLE);
      // The kind icon and "More actions" are centred on the first line, not the middle.
      const [t, icon, menu, lineHeight] = await Promise.all([
        box(title),
        box(card.getByRole("img", { name: "Prototype", exact: true })),
        box(card.locator("[title^='More']")),
        title.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight)),
      ]);
      const firstLine = t.y + lineHeight / 2;
      expect(Math.abs(icon.y + icon.height / 2 - firstLine)).toBeLessThan(2);
      expect(Math.abs(menu.y + menu.height / 2 - firstLine)).toBeLessThan(2);
      await page.context().close();
    });

    // r[verify hosting.card.long-title]
    it("keeps a short title on one line, its access row level with a long-titled card's in the same row", async () => {
      const u = await newUser();
      await createArtefact(u, LONG_TITLE);
      await createArtefact(u, "Short");
      const page = await openApp(u);
      await mineOnly(page);
      const cards = [cardOf(page, LONG_TITLE), cardOf(page, "Short")];
      await visible(cards[1]!);
      await narrowest(cards[0]!);
      const short = cards[1]!.locator("button", { hasText: "Short" });
      expect(await titleLines(short)).toEqual({ lines: 1, clipped: false, clamp: "2" });
      const boxes = await Promise.all(cards.map(box));
      expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThan(1);
      const access = await Promise.all(cards.map((c) => box(c.locator("[title^='Access: ']"))));
      expect(Math.abs(access[0]!.y + access[0]!.height - (access[1]!.y + access[1]!.height))).toBeLessThan(1);
      await page.context().close();
    });

    it("names a long artefact or collection in full as the tooltip in the sidebar, and a long collection on its tile and its page", async () => {
      const u = await newUser();
      const name = "Vinga Ambassadors programme: every workstream, review and onboarding artefact";
      const c = await createCollection(u, name);
      const a = await createArtefact(u, LONG_TITLE);
      await bookmark(u, a.id);
      const put = await app.request(`/api/collections/${c.id}/bookmark`, { method: "PUT", headers: { cookie: u.cookie } });
      expect(put.ok).toBe(true);
      const page = await openApp(u);
      const aside = await openSidebar(page);
      // The bookmarked artefact, the bookmarked collection and the collection's tree row.
      await visible(aside.locator(`[title='${LONG_TITLE}']`));
      await eventually(async () => expect(await aside.locator(`[title='${name}']`).count()).toBe(2));
      // Its page's heading; then a long-named sub-collection's tile on its parent's page.
      await page.goto(`${ORIGIN}/c/${c.id}`);
      const h1 = page.getByRole("heading", { level: 1, name, exact: true });
      await visible(h1);
      expect(await h1.getAttribute("title")).toBe(name);
      const parent = await createCollection(u, "Parent tree");
      await createSubCollection(u, `${name} (nested)`, parent.id);
      await page.goto(`${ORIGIN}/c/${parent.id}`);
      await visible(page.locator(`main button[title='${name} (nested)']`));
      await page.context().close();
    });

    it("names a long artefact in full as the tooltip in the Add to collection dialog, and a long artefact and collection on the Archive", async () => {
      const u = await newUser();
      const name = "Vinga Ambassadors archive: every retired workstream, review and onboarding artefact";
      await createCollection(u, "Dialog target");
      await createArtefact(u, LONG_TITLE);
      const page = await openApp(u);
      await mineOnly(page);
      await cardMenu(page, LONG_TITLE);
      await control(page, "Add to collection…").click();
      await visible(page.getByRole("dialog").locator(`[title='${LONG_TITLE}']`));
      await page.keyboard.press("Escape");
      const archived = await createArtefact(u, `${LONG_TITLE} (archived)`);
      await archive(u, archived.id);
      const c = await createCollection(u, name);
      const res = await app.request(`/api/collections/${c.id}/archive`, { method: "POST", headers: { cookie: u.cookie } });
      expect(res.ok).toBe(true);
      await page.goto(`${ORIGIN}/archive`);
      await visible(page.locator(`main [title='${LONG_TITLE} (archived)']`));
      await visible(page.locator(`main [title='${name}']`));
      await page.context().close();
    });

    it("tabs from the thumbnail through bookmark, title, More actions, collection and Share", async () => {
      const u = await newUser();
      const c = await createCollection(u, "Card tab tree");
      const a = await createArtefact(u, "Card tabbed");
      await fileIn(u, a.id, c.id);
      await bookmark(u, a.id);
      const page = await openApp(u);
      await mineOnly(page);
      const card = cardOf(page, "Card tabbed");
      await visible(card.locator("[aria-label='Remove bookmark']"));

      await card.locator("[aria-label='Open Card tabbed']").focus();
      const order: string[] = [];
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press("Tab");
        order.push(
          await page.evaluate(() => {
            const el = document.activeElement!;
            return el.getAttribute("aria-label") ?? el.textContent!.trim();
          }),
        );
      }
      expect(order).toEqual(["Remove bookmark", "Card tabbed", "More actions", "In Card tab tree", "Share"]);
      await page.context().close();
    });

    // r[verify hosting.card.public-hides-activity+2]
    it("shows an owner's public, password-protected card with the lock inside its badge, not on the thumbnail, and no activity", async () => {
      const u = await newUser();
      const a = await createArtefact(u, "Locked launch");
      const res = await app.request(`/api/artefacts/${a.id}/visibility`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie: u.cookie },
        body: JSON.stringify({ visibility: "public", linkGate: { password: "correct-horse-9" } }),
      });
      expect(res.status).toBe(200);
      const page = await openApp(u);
      await mineOnly(page);
      const main = listing(page);

      const badge = main.locator("[title='Access: Public']");
      await visible(badge);
      await visible(badge.locator("[aria-label='Password protected']"));
      const thumbnail = main.locator("[aria-label='Open Locked launch']").locator("xpath=..");
      expect(await thumbnail.locator("[aria-label='Password protected']").count()).toBe(0);
      expect(await main.getByText(/^Updated /).count()).toBe(0);
      await page.context().close();
    });

    it("removes a bookmark from the thumbnail's own button without opening the artefact, and Undo restores it", async () => {
      const u = await newUser();
      const a = await createArtefact(u, "Saved for later");
      const put = await app.request(`/api/artefacts/${a.id}/bookmark`, { method: "PUT", headers: { cookie: u.cookie } });
      expect(put.ok).toBe(true);
      const bookmarked = async () =>
        (
          (await (await app.request("/api/bookmarks", { headers: { cookie: u.cookie } })).json()) as { artefacts: { id: string }[] }
        ).artefacts.some((x) => x.id === a.id);
      const page = await openApp(u);
      await mineOnly(page);
      const main = listing(page);
      const open = main.locator("[aria-label='Open Saved for later']");
      const remove = main.locator("[aria-label='Remove bookmark']");
      await visible(remove);

      // The bookmark button is the thumbnail's sibling, never inside its open button.
      expect(await open.locator("[aria-label='Remove bookmark']").count()).toBe(0);
      expect(await remove.evaluate((el) => el.closest("[aria-label^='Open ']") === null)).toBe(true);

      let opened = 0;
      page.context().on("page", () => (opened += 1));
      const url = page.url();
      await remove.click();
      await visible(toast(page, "Bookmark removed"));
      await gone(remove);
      await eventually(async () => expect(await bookmarked()).toBe(false));
      expect(opened).toBe(0);
      expect(page.url()).toBe(url);

      await control(page, "Undo").click();
      await visible(remove);
      await eventually(async () => expect(await bookmarked()).toBe(true));
      await page.context().close();
    });
  });

  describe("artefact row (S56, S65)", () => {
    // Home's listing in list density: the user's own artefacts, or those shared with them.
    async function listPage(u: User, first: string, scope: "mine" | "shared" = "mine"): Promise<Page> {
      const page = await openApp(u);
      if (scope === "mine") await mineOnly(page);
      else await control(page.locator("main"), /^\s*Shared with me/).click();
      await page.locator("main [title='List']").click();
      const tile = listing(page).locator(`[aria-label='Open ${first}']`);
      await eventually(async () => expect((await tile.boundingBox())!.width).toBeLessThan(80));
      return page;
    }
    // The row of `title`: the card holding its "Open <title>" kind tile.
    const rowOf = (page: Page, title: string) =>
      listing(page).locator("[data-slot='card']", { has: page.locator(`[aria-label='Open ${title}']`) });

    it("gives an owner's top-level row the access badge and a Share button that opens the Manage access dialog — no pill, no people-only dialog", async () => {
      const u = await newUser();
      await createArtefact(u, "Row owned");
      const page = await listPage(u, "Row owned");
      const row = rowOf(page, "Row owned");

      await visible(row.locator("[title='Access: Private']"));
      const share = control(row, "Share");
      expect(await share.getAttribute("aria-haspopup")).toBe("dialog");
      expect(await share.getAttribute("title")).toBe("Manage access");
      // The retired pill was a button reading the tier; its popover's Manage opened the people-only dialog.
      expect(await control(row, "Private").count()).toBe(0);
      expect(await control(row, "Manage").count()).toBe(0);

      await share.click();
      await visible(page.getByRole("dialog").getByText("General settings", { exact: true }));
      await visible(page.getByRole("dialog").locator("[aria-haspopup='listbox']"));
      await page.context().close();
    });

    it("marks an owner's row inside a collection with the inherited icon after the access badge, whose Share opens Access inherited — and the collection header keeps its people-only dialog", async () => {
      const u = await newUser();
      const c = await createCollection(u, "Row tree");
      const a = await createArtefact(u, "Row contained");
      await fileIn(u, a.id, c.id);
      await setCollectionVisibility(u, c.id, "selected");
      const page = await listPage(u, "Row contained");
      const row = rowOf(page, "Row contained");

      // S65 — the card's inherited icon replaces the INHERITED text badge, right after the access badge.
      const badge = row.locator("[title='Access: Specific people']");
      await visible(badge);
      expect(await row.getByText(/^\s*Inherited\s*$/i).count()).toBe(0);
      const inherited = row.getByRole("img", { name: "Access inherited from “Row tree”", exact: true });
      await visible(inherited);
      expect(await badge.evaluate((el, icon) => el.nextElementSibling === icon, await inherited.elementHandle())).toBe(true);
      const share = control(row, "Share");
      expect(await share.getAttribute("aria-haspopup")).toBe("dialog");
      // What it opens, not the Manage access dialog it doesn't.
      expect(await share.getAttribute("title")).toBe("Access inherited");
      await share.click();
      await visible(page.getByText("Access inherited"));
      expect(await page.getByRole("dialog", { name: "Manage access" }).count()).toBe(0);
      await control(page, "Open “Row tree”").click();
      await visible(page.getByRole("heading", { level: 1, name: "Row tree" }));

      await control(page.locator("main"), "Manage").first().click();
      await visible(page.getByRole("dialog").getByText(/everything inside inherits this list/));
      expect(await page.getByRole("dialog").locator("[aria-haspopup='listbox']").count()).toBe(0);
      await page.context().close();
    });

    // r[verify hosting.card.share-link-unless-private+6]
    // r[verify hosting.card.collection-only-if-visible+3]
    // r[verify hosting.card.viewer-menu-downloads+2]
    // r[verify hosting.row.meta-line]
    it("gives a viewer's row Shared by and its collection — no kind, size or link in the meta line — and a Share that copies the full URL", async () => {
      const author = await newUser("Maya Chen");
      const c = await createCollection(author, "Row shared tree");
      const a = await createArtefact(author, "Row field notes", "interactive-doc");
      await setVisibility(author, a.id, "authenticated");
      await fileIn(author, a.id, c.id);
      await setCollectionVisibility(author, c.id, "authenticated");
      const slug = await slugOf(author, a.id);
      const page = await listPage(await newUser(), "Row field notes", "shared");
      const row = rowOf(page, "Row field notes");

      await visible(row.getByText("Shared by Maya Chen"));
      await visible(control(row, "In Row shared tree"));
      await visible(row.locator("[title='Access: Org members']"));
      // S65 — the kind tile alone shows the kind; no size, and no link of the row's own.
      expect(await row.getByText("Interactive doc", { exact: true }).count()).toBe(0);
      expect(await row.getByText(/\d+(\.\d)? [KM]B/).count()).toBe(0);
      expect(await row.locator("[aria-label^='Copy link /a/']").count()).toBe(0);
      expect(await row.getByText(/\/a\//).count()).toBe(0);

      const share = row.getByRole("button", { name: "Copy link", exact: true });
      expect(await share.getAttribute("title")).toBe("Copy link");
      await share.click();
      await visible(toast(page, `Link copied · ${new URL(ORIGIN).host}/a/${slug}`));
      expect(await copied(page)).toBe(`${ORIGIN}/a/${slug}`);

      await openMenu(page, row.locator("[aria-label='More actions']"));
      const menu = page.locator("[role='menu']");
      for (const item of ["Open", "Bookmark", "Download HTML"]) await visible(control(menu, item));
      for (const absent of ["Copy share link", "Archive", "Edit"]) expect(await control(menu, absent).count(), absent).toBe(0);
      await page.context().close();
    });

    // r[verify hosting.card.public-hides-activity+2]
    it("puts a public protected link's lock and clock inside the row's access badge, not the meta line, and hides activity", async () => {
      const u = await newUser();
      const a = await createArtefact(u, "Row locked");
      const expiresAt = new Date(Date.now() + 48 * 3600_000).toISOString();
      const res = await app.request(`/api/artefacts/${a.id}/visibility`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie: u.cookie },
        body: JSON.stringify({ visibility: "public", linkGate: { password: "correct-horse-9", expiresAt } }),
      });
      expect(res.status).toBe(200);
      const page = await listPage(u, "Row locked");
      const row = rowOf(page, "Row locked");
      const badge = row.locator("[title='Access: Public']");

      await visible(badge.locator("[role='img'][aria-label='Password protected']"));
      await visible(badge.locator("[role='img'][aria-label^='Link expires ']"));
      expect(await row.locator("[aria-label='Password protected']").count()).toBe(1);
      expect(await row.locator("[aria-label^='Link expires ']").count()).toBe(1);
      expect(await row.getByText(/^Updated /).count()).toBe(0);
      await page.context().close();
    });

    it("removes a bookmark from the button after the title, and Undo re-adds it", async () => {
      const u = await newUser();
      const a = await createArtefact(u, "Row saved");
      const put = await app.request(`/api/artefacts/${a.id}/bookmark`, { method: "PUT", headers: { cookie: u.cookie } });
      expect(put.ok).toBe(true);
      const bookmarked = async () =>
        (
          (await (await app.request("/api/bookmarks", { headers: { cookie: u.cookie } })).json()) as { artefacts: { id: string }[] }
        ).artefacts.some((x) => x.id === a.id);
      const page = await listPage(u, "Row saved");
      const row = rowOf(page, "Row saved");
      const remove = row.locator("[aria-label='Remove bookmark']");
      await visible(remove);
      // A sibling of the title, never inside an open target.
      expect(await remove.evaluate((el) => el.parentElement!.closest("button") === null)).toBe(true);

      await remove.click();
      await visible(toast(page, "Bookmark removed"));
      await gone(remove);
      await eventually(async () => expect(await bookmarked()).toBe(false));

      await control(page, "Undo").click();
      await visible(remove);
      await eventually(async () => expect(await bookmarked()).toBe(true));
      await page.context().close();
    });

    it("tabs from the kind tile through title, bookmark, collection, Share and More actions", async () => {
      const u = await newUser();
      const c = await createCollection(u, "Row tab tree");
      const a = await createArtefact(u, "Row tabbed");
      await setVisibility(u, a.id, "authenticated");
      await fileIn(u, a.id, c.id);
      await setCollectionVisibility(u, c.id, "authenticated");
      const put = await app.request(`/api/artefacts/${a.id}/bookmark`, { method: "PUT", headers: { cookie: u.cookie } });
      expect(put.ok).toBe(true);
      const page = await listPage(u, "Row tabbed");
      const row = rowOf(page, "Row tabbed");
      await visible(row.locator("[aria-label='Remove bookmark']"));

      await row.locator("[aria-label='Open Row tabbed']").focus();
      const order: string[] = [];
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press("Tab");
        order.push(
          await page.evaluate(() => {
            const el = document.activeElement!;
            return el.getAttribute("aria-label") ?? el.textContent!.trim();
          }),
        );
      }
      expect(order).toEqual(["Row tabbed", "Remove bookmark", "In Row tab tree", "Share", "More actions"]);
      await page.context().close();
    });

    // r[verify hosting.row.meta-line]
    it("leaves out the meta line of a public row you own with no collection and no saved data, centring the title on the kind tile", async () => {
      const u = await newUser();
      const a = await createArtefact(u, "Row bare");
      await setVisibility(u, a.id, "public");
      const page = await listPage(u, "Row bare");
      const row = rowOf(page, "Row bare");
      await visible(row.locator("[title='Access: Public']"));
      const tile = (await row.locator("[aria-label='Open Row bare']").boundingBox())!;
      const title = (await row.locator("[title='Row bare']").boundingBox())!;
      expect(Math.abs(title.y + title.height / 2 - (tile.y + tile.height / 2))).toBeLessThanOrEqual(1);
      expect(await row.getByText(/^Updated /).count()).toBe(0);
      await page.context().close();
    });

    it("drops the access badge, inherited icon, Share and More actions below the title block on a narrow row, right-aligned as one group", async () => {
      const u = await newUser();
      const c = await createCollection(u, "Row narrow tree");
      const a = await createArtefact(u, "Row narrow");
      await fileIn(u, a.id, c.id);
      const page = await listPage(u, "Row narrow");
      const row = rowOf(page, "Row narrow");
      await row.evaluate((el) => ((el as HTMLElement).style.width = "360px"));
      const box = async (l: Locator) => (await l.boundingBox())!;
      await eventually(async () => {
        const [r, tile, title, badge, icon, share, more] = await Promise.all([
          box(row),
          box(row.locator("[aria-label='Open Row narrow']")),
          box(row.locator("[title='Row narrow']")),
          box(row.locator("[title^='Access: ']")),
          box(row.getByRole("img", { name: /^Access inherited from / })),
          box(control(row, "Share")),
          box(row.locator("[aria-label='More actions']")),
        ]);
        const group = [badge, icon, share, more];
        for (const g of group) expect(g.y).toBeGreaterThan(title.y + title.height);
        const mid = (g: { y: number; height: number }) => g.y + g.height / 2;
        for (const g of group) expect(Math.abs(mid(g) - mid(share))).toBeLessThan(4);
        expect(badge.x).toBeLessThan(icon.x);
        expect(icon.x).toBeLessThan(share.x);
        expect(share.x).toBeLessThan(more.x);
        // Right-aligned: "More actions" ends at the row's inner edge, inset as far as the kind tile starts.
        const inset = tile.x - r.x;
        expect(Math.abs(more.x + more.width - (r.x + r.width - inset))).toBeLessThanOrEqual(2);
      });
      await page.context().close();
    });

    it("opens More actions as a menu above the next row, and Esc closes it", async () => {
      const u = await newUser();
      await createArtefact(u, "Row menu lower");
      await createArtefact(u, "Row menu upper");
      const page = await listPage(u, "Row menu upper");
      const next = (await rowOf(page, "Row menu lower").boundingBox())!;

      await openMenu(page, rowOf(page, "Row menu upper").locator("[aria-label='More actions']"));
      const menu = page.locator("[role='menu']");
      await visible(menu);
      const box = (await menu.boundingBox())!;
      expect(box.y + box.height).toBeGreaterThan(next.y + 10);
      const x = box.x + box.width / 2;
      const y = Math.max(box.y, next.y) + 5;
      expect(await page.evaluate(([px, py]) => !!document.elementFromPoint(px!, py!)?.closest("[role='menu']"), [x, y])).toBe(true);

      await page.keyboard.press("Escape");
      await menu.first().waitFor({ state: "detached" });
      await page.context().close();
    });
  });

  describe("one card on collection pages (S62)", () => {
    const idOf = async (u: User) =>
      ((await (await app.request("/api/me", { headers: { cookie: u.cookie } })).json()) as { id: string }).id;
    async function grantCollection(owner: User, collectionId: string, to: User): Promise<void> {
      const res = await app.request(`/api/collections/${collectionId}/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: owner.cookie },
        body: JSON.stringify({ userId: await idOf(to) }),
      });
      expect(res.status).toBe(204);
    }
    // An owner's collection holding a contributor's artefact (S29): `selected`, with the contributor listed.
    async function contributed(title: string): Promise<{ owner: User; collection: { id: string } }> {
      const owner = await newUser("Olu Owner");
      const contributor = await newUser("Maya Chen");
      const collection = await createCollection(owner, `${title} tree`);
      await setCollectionVisibility(owner, collection.id, "selected");
      await grantCollection(owner, collection.id, contributor);
      const a = await createArtefact(contributor, title, "interactive-doc");
      await fileIn(contributor, a.id, collection.id);
      return { owner, collection };
    }
    async function collectionPage(u: User, id: string): Promise<Page> {
      const page = await (await context(u)).newPage();
      await page.goto(`${ORIGIN}/c/${id}`);
      await page.locator("main h1").first().waitFor();
      return page;
    }
    // S82 — Home and collection pages share one Sort menu and one remembered choice.
    const SORT_OPTIONS = ["Last updated", "Last viewed", "Title A–Z"];
    async function sortOptions(page: Page): Promise<string[]> {
      await openMenu(page, page.locator("main [aria-label^='Sort:']"));
      const options = page.getByRole("menuitemradio");
      await visible(options.first());
      const texts = (await options.allInnerTexts()).map((t) => t.trim());
      await page.keyboard.press("Escape");
      return texts;
    }

    // r[verify hosting.browse.one-sort]
    // r[verify hosting.browse.one-sort-pref]
    it("offers the same Sort menu on Home and on a collection page, Last updated by default", async () => {
      const u = await newUser();
      const c = await createCollection(u, "Sorted tree");
      const a = await createArtefact(u, "Sorted inside");
      await fileIn(u, a.id, c.id);

      const home = await openApp(u);
      await visible(home.locator("main [aria-label='Sort: Last updated']"));
      expect(await sortOptions(home)).toEqual(SORT_OPTIONS);
      await home.context().close();

      // S65's retired size sort falls back to the default.
      const page = await (await context(u)).newPage();
      await page.addInitScript(() => localStorage.setItem("artefactor:sort", "size"));
      await page.goto(`${ORIGIN}/c/${c.id}`);
      await visible(page.locator("main [aria-label='Sort: Last updated']"));
      expect(await sortOptions(page)).toEqual(SORT_OPTIONS);
      await page.context().close();
    });

    // r[verify hosting.browse.one-sort-pref]
    it("carries a Sort picked on a collection page over to Home", async () => {
      const u = await newUser();
      const c = await createCollection(u, "Carried sort");
      const a = await createArtefact(u, "Bravo carried");
      await fileIn(u, a.id, c.id);
      await createArtefact(u, "Charlie carried");
      await createArtefact(u, "Alpha carried");
      const page = await collectionPage(u, c.id);
      await openMenu(page, page.locator("main [aria-label^='Sort:']"));
      await control(page, "Title A–Z").click();
      await visible(page.locator("main [aria-label='Sort: Title A–Z']"));

      await page.goto(ORIGIN);
      await page.getByRole("heading", { name: "Home" }).waitFor();
      await mineOnly(page);
      await visible(page.locator("main [aria-label='Sort: Title A–Z']"));
      await eventually(async () => expect(await shownTitles(page)).toEqual(["Alpha carried", "Bravo carried", "Charlie carried"]));
      expect(
        await page.evaluate(() => [localStorage.getItem("artefactor:sort"), localStorage.getItem("artefactor:home-sort")]),
      ).toEqual(["title", null]);
      await page.context().close();
    });

    // r[verify hosting.browse.one-sort]
    it("puts the artefact just opened from a collection page first under Last viewed", async () => {
      const u = await newUser();
      const c = await createCollection(u, "Viewed tree");
      const older = await createArtefact(u, "Older viewed");
      const newer = await createArtefact(u, "Newer viewed");
      await fileIn(u, older.id, c.id);
      await fileIn(u, newer.id, c.id);
      const page = await collectionPage(u, c.id);
      await openMenu(page, page.locator("main [aria-label^='Sort:']"));
      await control(page, "Last viewed").click();
      await eventually(async () => expect(await shownTitles(page)).toEqual(["Newer viewed", "Older viewed"]));

      const popup = page.context().waitForEvent("page");
      await page.locator("main [aria-label='Open Older viewed']").first().click();
      await (await popup).close();
      await eventually(async () => expect(await shownTitles(page)).toEqual(["Older viewed", "Newer viewed"]));
      await page.context().close();
    });

    // The card or row holding `title`'s open target.
    const itemOf = (page: Page, title: string) =>
      page.locator("main [data-slot='card']", { has: page.locator(`[aria-label='Open ${title}']`) });

    // r[verify hosting.card.viewer-menu-downloads+2]
    // r[verify hosting.card.share-link-unless-private+6]
    // r[verify hosting.home.shared-cards+2]
    it("renders another user's artefact as the viewer's card and row, as on Home: Shared by, the access badge and Download HTML", async () => {
      const { owner, collection } = await contributed("Contributed notes");
      const member = await newUser();
      await grantCollection(owner, collection.id, member);
      const page = await collectionPage(member, collection.id);

      for (const density of ["grid", "list"] as const) {
        if (density === "list") await page.locator("main [title='List']").click();
        const item = itemOf(page, "Contributed notes");
        await visible(item);
        await visible(item.getByText(/Shared by Maya Chen/));
        await visible(item.locator("[title='Access: Specific people']"));
        expect(await item.locator("[data-slot='avatar']").count(), density).toBe(0);
        expect(await control(item, "Open").count(), density).toBe(0);
        // The page is the collection: no "In <it>" link.
        expect(await control(item, /^\s*In Contributed notes tree/).count(), density).toBe(0);
        await visible(item.getByRole("button", { name: "Copy link", exact: true }));

        await openMenu(page, item.locator("[aria-label='More actions']"));
        const menu = page.locator("[role='menu']");
        await visible(control(menu, "Download HTML"));
        expect(await control(menu, "Remove from collection").count(), density).toBe(0);
        await page.keyboard.press("Escape");
      }
      await page.context().close();
    });

    // r[verify hosting.home.shared-cards+2]
    it("lets the collection's owner remove a foreign artefact from its ⋯ menu, which ejects it from the page", async () => {
      const { owner, collection } = await contributed("Ejectable notes");
      const page = await collectionPage(owner, collection.id);
      const item = itemOf(page, "Ejectable notes");
      await visible(item);

      await openMenu(page, item.locator("[aria-label='More actions']"));
      await control(page.locator("[role='menu']"), "Remove from collection").click();
      await visible(toast(page, "“Ejectable notes” removed from the collection"));
      await gone(item);
      await page.context().close();
    });

    // r[verify hosting.card.share-link-unless-private+6]
    it("gives a viewer's card and (S65) row no Share when the artefact's effective tier is private", async () => {
      const { owner, collection } = await contributed("Private contribution");
      await setCollectionVisibility(owner, collection.id, "private");
      const page = await collectionPage(owner, collection.id);
      for (const density of ["grid", "list"] as const) {
        const item = itemOf(page, "Private contribution");
        if (density === "list") {
          await page.locator("main [title='List']").click();
          // The row's kind tile is 40px; the card's open target is its whole thumbnail.
          const tile = item.locator("[aria-label='Open Private contribution']");
          await eventually(async () => expect((await tile.boundingBox())!.width).toBeLessThan(80));
        }
        await visible(item.locator("[title='Access: Private']"));
        expect(await item.locator("[aria-label='More actions']").count(), density).toBe(1);
        expect(await item.getByRole("button", { name: "Copy link", exact: true }).count(), density).toBe(0);
        expect(await control(item, "Share").count(), density).toBe(0);
      }
      await page.context().close();
    });
  });

  // S64 — the "Access inherited" popover behind an owner's Share inside a
  // collection, and behind a nested collection header's access pill.
  describe("Access inherited popover (S64)", () => {
    const popoverOf = (page: Page) => page.getByRole("dialog", { name: "Access inherited" });
    const copyLinkIn = (scope: Locator) => scope.getByRole("button", { name: /^Copy link \/a\// });

    async function contained(u: User, title: string, visibility: string, payload?: string) {
      const c = await createCollection(u, `${title} tree`);
      const a = await createArtefact(u, title, "prototype", payload);
      await fileIn(u, a.id, c.id);
      await setCollectionVisibility(u, c.id, visibility);
      return { c, a };
    }
    async function ownCardShare(u: User, title: string): Promise<{ page: Page; share: Locator }> {
      const page = await openApp(u);
      await mineOnly(page);
      const card = cardOf(page, title);
      await visible(card);
      return { page, share: control(card, "Share") };
    }

    // r[verify hosting.card.share-link-unless-private+6]
    it("puts the share link at the top of the popover behind an owner's card Share, and copying it leaves the popover open", async () => {
      const u = await newUser();
      const { a } = await contained(u, "Linked inside", "authenticated");
      const slug = await slugOf(u, a.id);
      const { page, share } = await ownCardShare(u, "Linked inside");
      expect(await share.getAttribute("title")).toBe("Access inherited");
      await share.click();
      const popover = popoverOf(page);
      // Measured once its zoom-in has settled.
      await eventually(async () => expect((await popover.boundingBox())!.width).toBe(288));

      expect((await popover.innerText()).trim()).toMatch(/^LINK\s/i);
      const link = popover.getByRole("button", { name: `Copy link /a/${slug}`, exact: true });
      await visible(link);
      expect(await link.getAttribute("title")).toBe(`Copy ${ORIGIN}/a/${slug}`);
      await link.click();
      await visible(toast(page, /Link copied/));
      expect(await copied(page)).toBe(`${ORIGIN}/a/${slug}`);
      await visible(popover);
      await page.context().close();
    });

    // r[verify hosting.card.share-link-unless-private+6]
    it("puts the same link at the top of the popover behind an owner's row Share", async () => {
      const u = await newUser();
      const { a } = await contained(u, "Row linked inside", "authenticated");
      const slug = await slugOf(u, a.id);
      const page = await openApp(u);
      await mineOnly(page);
      await page.locator("main [title='List']").click();
      const tile = listing(page).locator("[aria-label='Open Row linked inside']");
      await eventually(async () => expect((await tile.boundingBox())!.width).toBeLessThan(80));
      const row = listing(page).locator("[data-slot='card']", { has: page.locator("[aria-label='Open Row linked inside']") });
      await control(row, "Share").click();
      const popover = popoverOf(page);
      const link = popover.getByRole("button", { name: `Copy link /a/${slug}`, exact: true });
      await link.click();
      await visible(toast(page, /Link copied/));
      expect(await copied(page)).toBe(`${ORIGIN}/a/${slug}`);
      await visible(popover);
      await page.context().close();
    });

    // r[verify hosting.card.share-link-unless-private+6]
    it("shows no Link section while the collection is private: the popover starts at Access inherited", async () => {
      const u = await newUser();
      await contained(u, "Private inside", "private");
      const { page, share } = await ownCardShare(u, "Private inside");
      await share.click();
      const popover = popoverOf(page);
      await visible(popover);
      expect(await copyLinkIn(popover).count()).toBe(0);
      expect(await popover.getByText("Link", { exact: true }).count()).toBe(0);
      expect((await popover.innerText()).trim()).toMatch(/^Access inherited/);
      await page.context().close();
    });

    // r[verify hosting.card.share-link-unless-private+6]
    it("still shows the link under an expired inherited gate, beside the red expired text", async () => {
      const u = await newUser();
      const { c, a } = await contained(u, "Expired inside", "private");
      const res = await app.request(`/api/collections/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", cookie: u.cookie },
        // An expiry can't be set in the past: set it an hour ahead, then run
        // the page's clock two hours on, so the client reads it as expired.
        body: JSON.stringify({ visibility: "public", linkGate: { expiresAt: new Date(Date.now() + 3600_000).toISOString() } }),
      });
      expect(res.ok).toBe(true);
      const slug = await slugOf(u, a.id);
      const page = await (await context(u)).newPage();
      await page.clock.setFixedTime(Date.now() + 2 * 3600_000);
      await page.goto(ORIGIN);
      await mineOnly(page);
      await control(cardOf(page, "Expired inside"), "Share").click();
      const popover = popoverOf(page);
      await visible(popover.getByRole("button", { name: `Copy link /a/${slug}`, exact: true }));
      await visible(popover.getByText("Link protection inherited from “Expired inside tree”"));
      await visible(popover.locator(".text-destructive", { hasText: /expired/i }));
      await page.context().close();
    });

    // r[verify hosting.card.copy-failure-says-so+1]
    it("toasts \"Couldn't copy the link\" when the clipboard write rejects, and the popover stays open", async () => {
      const u = await newUser();
      await contained(u, "Uncopyable inside", "authenticated");
      const page = await (await context(u)).newPage();
      await page.addInitScript(() => (navigator.clipboard.writeText = () => Promise.reject(new Error("denied"))));
      await page.goto(ORIGIN);
      await mineOnly(page);
      await control(cardOf(page, "Uncopyable inside"), "Share").click();
      const popover = popoverOf(page);
      await copyLinkIn(popover).click();
      await visible(toast(page, "Couldn't copy the link"));
      await visible(popover);
      await page.context().close();
    });

    // r[verify hosting.card.share-link-unless-private+6]
    it("names and opens the tree root behind Share for an artefact in a nested collection, where access can be changed", async () => {
      const u = await newUser();
      const root = await createCollection(u, "Research root");
      const res = await app.request("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: u.cookie },
        body: JSON.stringify({ name: "Interviews child", parentId: root.id }),
      });
      expect(res.status).toBe(201);
      const child = (await res.json()) as { id: string };
      const a = await createArtefact(u, "Nested inside");
      await fileIn(u, a.id, child.id);
      await setCollectionVisibility(u, root.id, "authenticated");
      const { page, share } = await ownCardShare(u, "Nested inside");
      await share.click();
      const popover = popoverOf(page);
      await visible(popover.getByText("This artefact is in “Research root” and follows its access.", { exact: false }));
      expect(await popover.getByText("Interviews child").count()).toBe(0);
      await control(popover, "Open “Research root”").click();
      await visible(page.getByRole("heading", { level: 1, name: "Research root" }));
      expect(new URL(page.url()).pathname).toBe(`/c/${root.id}`);
      await page.context().close();
    });

    // r[verify hosting.access.effective-from-tree-root]
    it("names the tree root, not the nested collection, in the inherited icon on the card and (S65) the row", async () => {
      const u = await newUser();
      const root = await createCollection(u, "Icon root");
      const res = await app.request("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: u.cookie },
        body: JSON.stringify({ name: "Icon child", parentId: root.id }),
      });
      expect(res.status).toBe(201);
      const child = (await res.json()) as { id: string };
      const a = await createArtefact(u, "Icon nested");
      await fileIn(u, a.id, child.id);
      await setCollectionVisibility(u, root.id, "authenticated");
      const page = await openApp(u);
      await mineOnly(page);
      for (const density of ["grid", "list"] as const) {
        const item = cardOf(page, "Icon nested");
        if (density === "list") {
          await page.locator("main [title='List']").click();
          const tile = item.locator("[aria-label='Open Icon nested']");
          await eventually(async () => expect((await tile.boundingBox())!.width).toBeLessThan(80));
        }
        await visible(item.getByRole("img", { name: "Access inherited from “Icon root”", exact: true }));
        expect(await item.getByRole("img", { name: /Icon child/ }).count(), density).toBe(0);
      }
      await page.context().close();
    });

    it("opens from a nested collection header's pill 256px wide, with no Link section", async () => {
      const u = await newUser();
      const root = await createCollection(u, "Pill root");
      const res = await app.request("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: u.cookie },
        body: JSON.stringify({ name: "Pill child", parentId: root.id }),
      });
      expect(res.status).toBe(201);
      const child = (await res.json()) as { id: string };
      await setCollectionVisibility(u, root.id, "authenticated");
      const page = await (await context(u)).newPage();
      await page.goto(`${ORIGIN}/c/${child.id}`);
      await visible(page.getByRole("heading", { level: 1, name: "Pill child" }));
      await control(page.locator("main"), /Inherited/).first().click();
      const popover = popoverOf(page);
      await eventually(async () => expect((await popover.boundingBox())!.width).toBe(256));
      expect(await copyLinkIn(popover).count()).toBe(0);
      expect((await popover.innerText()).trim()).toMatch(/^Access inherited/);
      await page.context().close();
    });

    it("tabs Copy link → Open the collection → the Saved data radios, a radiogroup named Saved data; Esc returns focus to Share", async () => {
      const u = await newUser();
      await contained(
        u,
        "Tabbed inside",
        "authenticated",
        `<html><body><script>localStorage.getItem("k")</script>Tabbed inside</body></html>`,
      );
      const { page, share } = await ownCardShare(u, "Tabbed inside");
      await share.click();
      const popover = popoverOf(page);
      await visible(popover);
      await visible(popover.getByRole("radiogroup", { name: "Saved data" }));

      const focused = () =>
        page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim() ?? "");
      await eventually(async () => expect(await focused()).toMatch(/^Copy link \/a\//));
      await page.keyboard.press("Tab");
      expect(await focused()).toBe("Open “Tabbed inside tree”");
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.getAttribute("role"))).toBe("radio");
      expect(
        await page.evaluate(() => !!document.activeElement?.closest("[role='radiogroup'][aria-label='Saved data']")),
      ).toBe(true);

      await page.keyboard.press("Escape");
      await gone(popover);
      expect(await share.evaluate((el) => el === document.activeElement)).toBe(true);
      await page.context().close();
    });
  });

  // r[verify platform.client.behaviour-suite+2]
  // r[verify hosting.home.screen]
  it("filters by type and access, sorts, switches density — and all of it survives a reload", async () => {
    const u = await newUser();
    await createArtefact(u, "Gamma prototype", "prototype");
    const deck = await createArtefact(u, "Beta deck", "slide-deck");
    await createArtefact(u, "Alpha form", "form");
    await createArtefact(u, "Delta deck", "slide-deck");
    await setVisibility(u, deck.id, "authenticated");
    const page = await openApp(u);
    await mineOnly(page);
    const main = page.locator("main");
    const typeFilter = main.locator("[aria-label^='Type:']");
    const accessFilter = main.locator("[aria-label^='Access:']");
    const sortControl = main.locator("[aria-label^='Sort:']");

    await openMenu(page, typeFilter);
    await control(page, /^\s*Form\s*\d/).click();
    await eventually(async () => expect(await shownTitles(page)).toEqual(["Alpha form"]));
    await openMenu(page, typeFilter);
    await control(page, /^\s*All types\s*\d/).click();

    await openMenu(page, accessFilter);
    await control(page, /^\s*Org members\s*\d/).click();
    await eventually(async () => expect(await shownTitles(page)).toEqual(["Beta deck"]));
    await openMenu(page, accessFilter);
    await control(page, /^\s*All access\s*\d/).click();

    // Last updated is the owner's list order, most recent first.
    const byUpdated = (
      (await (await app.request("/api/artefacts", { headers: { cookie: u.cookie } })).json()) as { artefacts: ArtefactSummary[] }
    ).artefacts.map((a) => a.title);
    await eventually(async () => expect(await shownTitles(page)).toEqual(byUpdated));
    await openMenu(page, sortControl);
    await control(page, "Last viewed").click();
    await visible(control(main, "Last viewed"));

    await openMenu(page, typeFilter);
    await control(page, /^\s*Slide deck\s*\d/).click();
    await eventually(async () => expect((await shownTitles(page)).sort()).toEqual(["Beta deck", "Delta deck"]));
    await openMenu(page, accessFilter);
    await control(page, /^\s*Private\s*\d/).click();
    await eventually(async () => expect(await shownTitles(page)).toEqual(["Delta deck"]));
    await main.locator("[title='List']").click();
    const open = main.locator("[aria-label='Open Delta deck']:not([data-recent] *)");
    await eventually(async () => expect((await open.boundingBox())!.width).toBeLessThan(80));

    await page.reload();
    await visible(page.getByRole("heading", { name: "Home" }));
    await eventually(async () => expect(await shownTitles(page)).toEqual(["Delta deck"]));
    await visible(control(main, "Last viewed"));
    expect((await open.boundingBox())!.width).toBeLessThan(80);
    expect(
      await page.evaluate(() =>
        ["density", "kind", "access", "sort", "scope", "sidebar"].map((k) => localStorage.getItem(`artefactor:${k}`)),
      ),
    ).toEqual(["list", "slide-deck", "private", "viewed", "mine", "closed"]);
    await page.context().close();
  });

  // S47 — Home: one landing screen for own and shared artefacts.
  describe("Home", () => {
    const recentCards = (page: Page) => page.locator("main [data-recent] > *");
    const listed = (page: Page) => page.locator("main section[aria-label='All artefacts'] [data-slot='card']");
    const recentTitles = (page: Page) =>
      page
        .locator("main [data-recent] [aria-label^='Open ']")
        .evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("aria-label")!.slice("Open ".length)))]);

    async function openAt(u: User, width: number): Promise<Page> {
      const page = await (await context(u, "light", { width, height: 900 })).newPage();
      await page.goto(ORIGIN);
      await page.getByRole("heading", { name: "Home" }).waitFor();
      return page;
    }

    // r[verify hosting.home.screen]
    it("shows Recent as one row: more cards at 1280 px than at 700 px, never wrapping", async () => {
      const u = await newUser();
      for (let i = 0; i < 12; i++) await createArtefact(u, `Recent ${i}`);
      const page = await openAt(u, 1280);
      const oneRow = async () => {
        const tops = await recentCards(page).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
        expect(new Set(tops).size).toBe(1);
        return tops.length;
      };
      await visible(recentCards(page));
      const wide = await oneRow();
      await page.setViewportSize({ width: 700, height: 900 });
      await eventually(async () => expect(await oneRow()).toBeLessThan(wide));
      expect(await oneRow()).toBeGreaterThan(0);
      await page.context().close();
    });

    // r[verify hosting.home.screen]
    it("pages 30 artefacts in two, back to page 1 when the type changes; no pager for 10", async () => {
      const u = await newUser();
      for (let i = 0; i < 25; i++) await createArtefact(u, `Proto ${i}`, "prototype");
      for (let i = 0; i < 5; i++) await createArtefact(u, `Form ${i}`, "form");
      const page = await openApp(u);
      await mineOnly(page);
      const pager = page.locator("main nav[aria-label='pagination']");
      await visible(pager);
      await eventually(async () => expect(await listed(page).count()).toBe(24));
      await pager.locator("[aria-label='Page 2']").click();
      await eventually(async () => expect(await listed(page).count()).toBe(6));
      await openMenu(page, page.locator("main [aria-label^='Type:']"));
      await control(page, /^\s*Prototype\s*\d/).click();
      await eventually(async () => expect(await pager.locator("[aria-current='page']").innerText()).toBe("1"));
      expect(await listed(page).count()).toBe(24);
      await page.context().close();

      const small = await newUser();
      for (let i = 0; i < 10; i++) await createArtefact(small, `Small ${i}`);
      const other = await openApp(small);
      await mineOnly(other);
      await eventually(async () => expect(await listed(other).count()).toBe(10));
      expect(await other.locator("main nav[aria-label='pagination']").count()).toBe(0);
      await other.context().close();
    });

    // r[verify hosting.home.screen]
    it("shows the empty states: Upload for a new user, an empty Shared with me, and Clear filters", async () => {
      const page = await (await context(await newUser())).newPage();
      await page.route("**/api/shared", (route) => route.fulfill({ json: { artefacts: [] } }));
      await page.goto(ORIGIN);
      await page.getByRole("heading", { name: "Home" }).waitFor();
      await visible(control(page.locator("main"), "Upload your first artefact"));
      expect(await recentCards(page).count()).toBe(0);
      await control(page.locator("main"), /^\s*Shared with me/).click();
      await visible(page.locator("main").getByText("Nothing has been shared with you yet."));
      await page.context().close();

      const author = await newUser("Maya Chen");
      const form = await createArtefact(author, "Shared survey", "form");
      await setVisibility(author, form.id, "authenticated");
      const u = await newUser();
      // A kind no other test shares, so Shared with me holds none of it.
      await createArtefact(u, "My odd one", "other");
      const filtered = await openApp(u);
      const main = filtered.locator("main");
      await openMenu(filtered, main.locator("[aria-label^='Type:']"));
      await control(filtered, /^\s*Other\s*\d/).click();
      await control(main, /^\s*Shared with me/).click();
      await visible(control(main, "Clear filters"));
      await control(main, "Clear filters").click();
      await eventually(async () => expect(await shownTitles(filtered)).toContain("Shared survey"));
      await visible(control(main, /^\s*Shared with me/));
      await filtered.context().close();
    });

    // r[verify hosting.home.sidebar-shared]
    it("drops the Sidebar's Shared with you item and lists a shared tree under Collections → Shared with me", async () => {
      const author = await newUser("Maya Chen");
      const col = await createCollection(author, "Research wiki");
      const res = await app.request(`/api/collections/${col.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", cookie: author.cookie },
        body: JSON.stringify({ visibility: "authenticated" }),
      });
      expect(res.ok).toBe(true);
      const page = await openApp(await newUser());
      const aside = await openSidebar(page);
      expect(await control(aside, "Shared with you").count()).toBe(0);
      const group = aside.getByRole("group", { name: "Shared with me" });
      await visible(group.getByText("Research wiki"));
      await visible(group.getByText("Maya Chen"));
      await group.getByText("Research wiki").click();
      await visible(page.getByRole("heading", { name: "Research wiki" }));
      await page.context().close();
    });

    // r[verify hosting.home.shared-cards+2]
    it("moves an own artefact opened from the grid to the front of Recent without a reload", async () => {
      const u = await newUser();
      await createArtefact(u, "Older one");
      await createArtefact(u, "Newer one");
      const page = await openApp(u);
      await eventually(async () => expect((await recentTitles(page))[0]).toBe("Newer one"));
      const popup = page.context().waitForEvent("page");
      await page.locator("main [aria-label='Open Older one']:not([data-recent] *)").first().click();
      await (await popup).close();
      await eventually(async () => expect((await recentTitles(page))[0]).toBe("Older one"));
      await page.context().close();
    });

    // r[verify hosting.home.screen]
    it("lays the filter bar out by width: one line, then the switch alone, then two lines of controls", async () => {
      const u = await newUser();
      await createArtefact(u, "Laid out", "form");
      const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!;
      const parts = async (page: Page) => ({
        tabs: await box(page, "main [aria-label='Whose artefacts']"),
        type: await box(page, "main [aria-label^='Type:']"),
        access: await box(page, "main [aria-label^='Access:']"),
        sort: await box(page, "main [aria-label^='Sort:']"),
        toggle: await box(page, "main [title='List']"),
      });
      const sameLine = (a: { y: number; height: number }, b: { y: number; height: number }) =>
        Math.abs(a.y + a.height / 2 - (b.y + b.height / 2)) < 8;

      const wide = await openAt(u, 1280);
      let p = await parts(wide);
      expect(sameLine(p.tabs, p.type) && sameLine(p.type, p.sort) && sameLine(p.sort, p.toggle)).toBe(true);
      await wide.context().close();

      const mid = await openAt(u, 900);
      p = await parts(mid);
      expect(p.tabs.y + p.tabs.height).toBeLessThanOrEqual(p.type.y);
      expect(sameLine(p.type, p.sort) && sameLine(p.access, p.toggle)).toBe(true);
      await mid.context().close();

      const narrow = await openAt(u, 480);
      p = await parts(narrow);
      expect(sameLine(p.type, p.access)).toBe(true);
      expect(sameLine(p.sort, p.toggle)).toBe(true);
      expect(p.sort.y).toBeGreaterThan(p.type.y + p.type.height - 1);
      expect(await narrow.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await narrow.context().close();
    });
  });

  // S46 — Top bar: global search, tabs move out.
  describe("global search", () => {
    const search = (page: Page) => page.getByRole("combobox", { name: "Search artefacts and collections" });
    const expanded = (page: Page) => search(page).getAttribute("aria-expanded");

    // r[verify platform.search.top-bar-dropdown+2]
    it("finds another user's shared artefact from the Dashboard, in a dropdown that leaves the grid alone", async () => {
      const author = await newUser("Maya Chen");
      const a = await createArtefact(author, "Quarterly zebra review", "slide-deck");
      await setVisibility(author, a.id, "authenticated");
      const viewer = await newUser();
      await createArtefact(viewer, "My own notes");
      const page = await openApp(viewer);
      await mineOnly(page);
      await eventually(async () => expect(await shownTitles(page)).toEqual(["My own notes"]));

      await search(page).fill("zebra");
      await eventually(async () => expect(await expanded(page)).toBe("true"));
      const listbox = page.getByRole("listbox");
      const hit = listbox.getByRole("option", { name: /Quarterly zebra review/ });
      await visible(hit);
      expect(await listbox.getByRole("group", { name: "Artefacts" }).getByRole("option").count()).toBe(1);
      expect((await hit.locator("strong").innerText()).trim()).toBe("zebra");
      await visible(hit.getByText("Shared by Maya Chen"));
      expect(await listbox.locator("[role='option'][aria-selected='true']").count()).toBe(1);
      expect(await shownTitles(page)).toEqual(["My own notes"]);
      await page.context().close();
    });

    // r[verify platform.search.top-bar-dropdown+2]
    it("finds an own artefact outside the collection page it is typed on", async () => {
      const u = await newUser();
      await createCollection(u, "Inbox");
      await createArtefact(u, "Outside lighthouse");
      const page = await openApp(u);
      const aside = await openSidebar(page);
      await control(aside, /Inbox/).click();
      await visible(page.getByRole("heading", { level: 1, name: "Inbox" }));

      await search(page).fill("lighthouse");
      await visible(page.getByRole("listbox").getByRole("option", { name: /Outside lighthouse/ }));
      await page.context().close();
    });

    // r[verify platform.search.top-bar-dropdown+2]
    it("opens a collection hit with ↓ then Enter, and closes the dropdown", async () => {
      const u = await newUser();
      await createCollection(u, "Orbit one");
      await createCollection(u, "Orbit two");
      const page = await openApp(u);

      await search(page).fill("orbit");
      const options = page.getByRole("listbox").getByRole("option");
      const selected = page.locator("[role='option'][aria-selected='true']");
      await eventually(async () => expect(await options.count()).toBe(2));
      const second = (await options.nth(1).innerText()).split("\n")[0]!.trim();
      await eventually(async () => expect(await selected.innerText()).toBe(await options.first().innerText()));
      await page.keyboard.press("ArrowDown");
      await eventually(async () => expect(await selected.innerText()).toContain(second));
      await page.keyboard.press("Enter");
      await visible(page.getByRole("heading", { level: 1, name: second }));
      expect(await expanded(page)).toBe("false");
      await page.context().close();
    });

    // r[verify platform.search.top-bar-dropdown+2]
    it("closes on Esc keeping the text, and × empties the field and closes it", async () => {
      const u = await newUser();
      await createArtefact(u, "Escapable");
      const page = await openApp(u);

      await search(page).fill("escap");
      await eventually(async () => expect(await expanded(page)).toBe("true"));
      await page.keyboard.press("Escape");
      await eventually(async () => expect(await expanded(page)).toBe("false"));
      expect(await search(page).inputValue()).toBe("escap");

      await search(page).fill("escapa");
      await eventually(async () => expect(await expanded(page)).toBe("true"));
      await page.getByRole("button", { name: "Clear search" }).click();
      expect(await search(page).inputValue()).toBe("");
      await eventually(async () => expect(await expanded(page)).toBe("false"));
      await page.context().close();
    });

    // r[verify platform.search.top-bar-dropdown+2]
    it("says so in a status when nothing matches", async () => {
      const page = await openApp(await newUser());
      await search(page).fill("qqxxzz");
      await visible(page.getByRole("status").filter({ hasText: "No matches for “qqxxzz”" }));
      await visible(page.getByText("Try another word, or check the spelling."));
      await page.context().close();
    });

    // r[verify platform.top-bar.narrow-fit+2]
    it("fits the header at 390 and 480 px, and at 640 and 660 px beside the open sidebar, with and without an org, keeping toggle, logo tile, New artefact and Account", async () => {
      const u = await newUser();
      const cases = [
        { width: 390, sidebar: false },
        { width: 480, sidebar: false },
        { width: 640, sidebar: true },
        { width: 660, sidebar: true },
      ];
      for (const { width, sidebar } of cases)
        for (const orgs of [null, { activeId: "org-hv", memberships: [{ id: "org-hv", name: "Hidden Value", role: "owner" }] }]) {
          const page = await (await context(u, "light", { width, height: 800 })).newPage();
          if (orgs)
            await page.route(/\/api\/me$/, async (route) => {
              const real = (await (await route.fetch()).json()) as Record<string, unknown>;
              await route.fulfill({ json: { ...real, organizations: orgs } });
            });
          await page.goto(ORIGIN);
          await page.getByRole("heading", { name: "Home" }).waitFor();
          if (sidebar) await openSidebar(page);
          const at = `${width}px ${orgs ? "with" : "without"} an org${sidebar ? ", sidebar open" : ""}`;
          const row = await page.locator("header > div").evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
          expect(row.scroll, at).toBeLessThanOrEqual(row.client);
          const header = page.locator("header");
          for (const control of [
            header.getByRole("button", { name: "Toggle sidebar" }),
            header.getByRole("link", { name: "Artefactor, go to Home" }),
            header.getByRole("button", { name: "New artefact" }),
            header.locator("[title^='Account']:visible"),
          ]) {
            const box = (await control.boundingBox())!;
            expect(box, at).not.toBeNull();
            expect(box.x + box.width, at).toBeLessThanOrEqual(width);
            expect(await control.isVisible(), at).toBe(true);
          }
          expect(await header.getByText("Artefactor", { exact: true }).isVisible(), at).toBe(false);
          await page.context().close();
        }
    });

    // r[verify platform.top-bar.logo-home]
    it("links the logo to Home: a plain click shows Home in place, a ⌘-click keeps the browser default", async () => {
      const u = await newUser();
      const notes = await createCollection(u, "Logo notes");
      const page = await (await context(u)).newPage();
      await page.goto(`${ORIGIN}/c/${notes.id}`);
      await visible(page.getByRole("heading", { level: 1, name: "Logo notes", exact: true }));
      const logo = page.locator("header").getByRole("link", { name: "Artefactor, go to Home", exact: true });
      expect(await page.locator("header a").count()).toBe(1);
      expect(await logo.getAttribute("href")).toBe("/");
      // A ⌘-click is left to the browser: a window listener, which runs after
      // React's, sees its default unprevented (then prevents it, so no tab opens).
      await page.evaluate(() => {
        window.addEventListener(
          "click",
          (e) => {
            (window as unknown as { cmdPrevented?: boolean }).cmdPrevented = e.defaultPrevented;
            e.preventDefault();
          },
          { once: true },
        );
      });
      await logo.click({ modifiers: ["Meta"] });
      expect(await page.evaluate(() => (window as unknown as { cmdPrevented?: boolean }).cmdPrevented)).toBe(false);
      expect(new URL(page.url()).pathname).toBe(`/c/${notes.id}`);
      // A plain click shows Home with no full page load.
      await page.evaluate(() => ((window as unknown as { stay?: number }).stay = 1));
      await logo.click();
      await eventually(() => expect(new URL(page.url()).pathname).toBe("/"));
      await visible(page.getByRole("heading", { name: "Home" }));
      expect(await page.evaluate(() => (window as unknown as { stay?: number }).stay)).toBe(1);
      await page.context().close();
    });
  });

  describe("keyboard", () => {
    // r[verify platform.client.behaviour-suite+2]
    it("Esc closes an open menu and an open dialog", async () => {
      const u = await newUser();
      await createArtefact(u, "Keyed");
      const page = await openApp(u);

      await cardMenu(page, "Keyed");
      await visible(control(page, "Edit"));
      await page.keyboard.press("Escape");
      await gone(control(page, "Edit"));

      await control(page, "New artefact").click();
      await visible(page.getByText("Upload a self-contained HTML deliverable."));
      await page.keyboard.press("Escape");
      await gone(page.getByText("Upload a self-contained HTML deliverable."));
      await page.context().close();
    });

    // r[verify platform.client.behaviour-suite+2]
    // r[verify platform.search.top-bar-dropdown+2]
    // r[verify platform.top-bar.narrow-fit+2]
    it("Tab reaches every top-bar and card control, each with a visible focus indicator", async () => {
      const u = await newUser();
      await createArtefact(u, "Focusable");
      const page = await openApp(u);
      await page.locator("body").click({ position: { x: 1, y: 1 } });

      const seen: { name: string; visibleFocus: boolean }[] = [];
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press("Tab");
        seen.push(
          await page.evaluate(() => {
            const el = document.activeElement as HTMLElement;
            if (el === document.body) return { name: "(body)", visibleFocus: true };
            const s = getComputedStyle(el);
            const outline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
            const ring = s.boxShadow !== "none" && s.boxShadow !== "";
            return {
              name:
                el.getAttribute("aria-label") ||
                el.getAttribute("title") ||
                el.getAttribute("placeholder") ||
                (el.textContent ?? "").trim(),
              visibleFocus: outline || ring,
            };
          }),
        );
      }
      const names = seen.map((s) => s.name);
      for (const want of ["Toggle sidebar", "New artefact", "Account", "More"])
        expect(names.some((n) => n.startsWith(want)), `Tab reaches ${want} (saw ${names.join(" | ")})`).toBe(true);
      expect(names.some((n) => n.startsWith("Search")), "Tab reaches the search box").toBe(true);
      // S80 — the top bar runs sidebar toggle → logo → search → New artefact →
      // Account, with no view tabs between them.
      expect(names.slice(0, 5)).toEqual([
        "Toggle sidebar",
        "Artefactor, go to Home",
        "Search artefacts and collections",
        "New artefact",
        "Account",
      ]);
      expect(names.some((n) => n === "Your artefacts" || n === "Shared with you")).toBe(false);
      expect(seen.filter((s) => !s.visibleFocus).map((s) => s.name)).toEqual([]);
      await page.context().close();
    });
  });

  // S45 — App dark mode with a UI toggle.
  const DARK_BG = SHELL_TOKENS.dark.background; // = app.css `.dark` --background (tokens.test.ts)
  const LIGHT_BG = SHELL_TOKENS.light.background;

  // A colour as Chromium computes it, so it compares with a computed style.
  const computed = (page: Page, colour: string) =>
    page.evaluate((c) => {
      const probe = document.createElement("div");
      probe.style.backgroundColor = c;
      document.body.appendChild(probe);
      const out = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return out;
    }, colour);
  const isDark = (page: Page) => page.evaluate(() => document.documentElement.classList.contains("dark"));
  const bgOf = (page: Page, selector: string) =>
    page.evaluate((s) => getComputedStyle(document.querySelector(s)!).backgroundColor, selector);
  const storeTheme = (ctx: BrowserContext, theme: string) =>
    ctx.addInitScript((t) => localStorage.setItem("artefactor:theme", t), theme);

  async function publicSlug(u: User, title: string, payload?: string): Promise<string> {
    const a = await createArtefact(u, title, "prototype", payload);
    await setVisibility(u, a.id, "public");
    const got = (await (await app.request(`/api/artefacts/${a.id}`, { headers: { cookie: u.cookie } })).json()) as ArtefactSummary;
    return got.publicSlug!;
  }

  describe("theme", () => {
    // S53 — the theme radios sit in the account menu's Colour theme submenu.
    const chooseTheme = async (page: Page, label: string) => {
      await openMenu(page, page.locator("[title='Account']:visible"));
      await control(page, "Colour theme").click();
      await control(page, label).click();
    };

    // r[verify platform.theme.no-flash]
    it("paints an OS-dark visitor dark before the React bundle runs", async () => {
      const page = await (await context(undefined, "dark")).newPage();
      await page.route(/\/assets\/.*\.js$/, (route) => route.abort());
      await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
      expect(await page.locator("#app").innerHTML()).toBe("");
      expect(await isDark(page)).toBe(true);
      expect(await bgOf(page, "body")).toBe(await computed(page, DARK_BG));
      await page.context().close();
    });

    // r[verify platform.theme.menu-applies]
    // r[verify platform.top-bar.account-menu+2]
    it("switches to Dark under an OS in light, stores it, and keeps it across a reload", async () => {
      const page = await openApp(await newUser());
      expect(await isDark(page)).toBe(false);
      await chooseTheme(page, "Dark");
      await eventually(async () => expect(await isDark(page)).toBe(true));
      expect(await page.evaluate(() => localStorage.getItem("artefactor:theme"))).toBe("dark");
      await page.reload({ waitUntil: "domcontentloaded" });
      expect(await isDark(page)).toBe(true);
      await page.getByRole("heading", { name: "Home" }).waitFor();
      expect(await isDark(page)).toBe(true);
      await page.context().close();
    });

    // r[verify platform.theme.menu-applies]
    it("switches to Light under an OS in dark", async () => {
      const u = await newUser();
      const page = await (await context(u, "dark")).newPage();
      await page.goto(ORIGIN);
      await page.getByRole("heading", { name: "Home" }).waitFor();
      expect(await isDark(page)).toBe(true);
      await chooseTheme(page, "Light");
      await eventually(async () => expect(await isDark(page)).toBe(false));
      await page.context().close();
    });

    // r[verify platform.theme.menu-applies]
    it("follows the OS live under System, without a reload", async () => {
      const page = await openApp(await newUser());
      await chooseTheme(page, "Dark");
      await eventually(async () => expect(await isDark(page)).toBe(true));
      await chooseTheme(page, "System");
      await eventually(async () => expect(await isDark(page)).toBe(false));
      await page.emulateMedia({ colorScheme: "dark" });
      await eventually(async () => expect(await isDark(page)).toBe(true));
      await page.emulateMedia({ colorScheme: "light" });
      await eventually(async () => expect(await isDark(page)).toBe(false));
      expect(await page.evaluate(() => localStorage.getItem("artefactor:theme"))).toBe("system");
      await page.context().close();
    });

    // r[verify platform.theme.menu-applies]
    it("renders a toast fired in dark mode dark", async () => {
      const u = await newUser();
      await createArtefact(u, "Toasty");
      const ctx = await context(u);
      await storeTheme(ctx, "dark");
      const page = await ctx.newPage();
      await page.goto(ORIGIN);
      await page.getByRole("heading", { name: "Home" }).waitFor();
      await cardMenu(page, "Toasty");
      await control(page, "Archive").click();
      await visible(control(page, "Undo"));
      expect(await page.locator("[data-sonner-toaster]").first().getAttribute("data-sonner-theme")).toBe("dark");
      await page.context().close();
    });

    // r[verify platform.theme.shell-follows]
    it("themes the /a/:slug shell from the stored choice", async () => {
      const u = await newUser();
      const slug = await publicSlug(u, "Shell dark");
      const ctx = await context(u);
      await storeTheme(ctx, "dark");
      const page = await ctx.newPage();
      await page.goto(`${ORIGIN}/a/${slug}`);
      expect(await isDark(page)).toBe(true);
      expect(await bgOf(page, ".ae-bar")).toBe(await computed(page, DARK_BG));
      await page.context().close();
    });

    // r[verify platform.theme.frame-unthemed]
    it("serves the frame the same payload whatever the viewer's theme", async () => {
      const slug = await publicSlug(await newUser(), "Frame bytes");
      const frameBody = async (theme: string) => {
        const ctx = await context(undefined, theme === "dark" ? "dark" : "light");
        await storeTheme(ctx, theme);
        const page = await ctx.newPage();
        const res = page.waitForResponse((r) => new URL(r.url()).pathname === `/a/${slug}/frame`);
        await page.goto(`${ORIGIN}/a/${slug}`);
        const body = await (await res).body();
        expect(await isDark(page)).toBe(theme === "dark");
        await page.context().close();
        return body;
      };
      const light = await frameBody("light");
      const dark = await frameBody("dark");
      expect(dark.length).toBeGreaterThan(0);
      expect(dark.equals(light)).toBe(true);
    });

    // The iframe element's used color-scheme is the embedded document's
    // preferred one (CSS Color Adjust), so the shell's own `color-scheme` must
    // not reach the frame: a theme-responsive artefact follows the OS alone.
    it("keeps a theme-responsive artefact on the OS scheme whatever the viewer's theme", async () => {
      const responsive = `<!doctype html><html><head><style>body{background:white}@media (prefers-color-scheme: dark){body{background:black}}</style></head><body><h1>Responsive</h1></body></html>`;
      const slug = await publicSlug(await newUser(), "Responsive", responsive);
      const inFrame = async (theme: string) => {
        const ctx = await context(undefined, "light");
        await storeTheme(ctx, theme);
        const page = await ctx.newPage();
        await page.goto(`${ORIGIN}/a/${slug}`);
        expect(await isDark(page)).toBe(theme === "dark");
        let frame = page.frames().find((f) => new URL(f.url()).pathname === `/a/${slug}/frame`);
        await eventually(() => {
          frame = page.frames().find((f) => new URL(f.url()).pathname === `/a/${slug}/frame`);
          expect(frame).toBeDefined();
        });
        await frame!.waitForSelector("h1");
        const seen = await frame!.evaluate(() => ({
          prefersDark: matchMedia("(prefers-color-scheme: dark)").matches,
          body: getComputedStyle(document.body).backgroundColor,
        }));
        await page.context().close();
        return seen;
      };
      const light = await inFrame("light");
      const dark = await inFrame("dark");
      expect(light.prefersDark).toBe(false);
      expect(dark).toEqual(light);
    });

    // An artefact that opts into both schemes and paints no background shows
    // its canvas — opaque or see-through depending on whether the iframe's used
    // color-scheme matches its own. The frame must look the same either way.
    it("renders an artefact that opts into color-scheme identically under either viewer theme", async () => {
      const optIn = `<!doctype html><html><head><style>:root{color-scheme: light dark}</style></head><body><h1>Opt in</h1></body></html>`;
      const slug = await publicSlug(await newUser(), "Opt in", optIn);
      const shot = async (theme: string) => {
        const ctx = await context(undefined, "dark");
        await storeTheme(ctx, theme);
        const page = await ctx.newPage();
        await page.goto(`${ORIGIN}/a/${slug}`);
        await eventually(async () => {
          const f = page.frames().find((fr) => new URL(fr.url()).pathname === `/a/${slug}/frame`);
          expect(f).toBeDefined();
          await f!.waitForSelector("h1", { timeout: 1000 });
        });
        const scheme = await page.evaluate(() => getComputedStyle(document.getElementById("ae-frame")!).colorScheme);
        const png = await page.locator("#ae-frame").screenshot();
        await page.context().close();
        return { scheme, png };
      };
      const light = await shot("light");
      const dark = await shot("dark");
      expect(dark.scheme).toBe(light.scheme);
      expect(dark.png.equals(light.png)).toBe(true);
    });

    // r[verify platform.theme.shell-follows]
    it("gives an anonymous OS-dark viewer of a public link a dark shell", async () => {
      const slug = await publicSlug(await newUser(), "Anon dark");
      const page = await (await context(undefined, "dark")).newPage();
      await page.goto(`${ORIGIN}/a/${slug}`);
      expect(await isDark(page)).toBe(true);
      expect(await bgOf(page, ".ae-bar")).toBe(await computed(page, DARK_BG));
      await page.emulateMedia({ colorScheme: "light" });
      await eventually(async () => expect(await bgOf(page, ".ae-bar")).toBe(await computed(page, LIGHT_BG)));
      await page.context().close();
    });

    // S72 — Host shell chrome loads nothing from another origin.
    describe("no third-party chrome (S72)", () => {
      // The app's origin, plus the content origin when the deployment sets one.
      const allowed = [ORIGIN, process.env.ARTEFACTOR_CONTENT_ORIGIN].filter(Boolean).map((o) => new URL(o!).origin);

      // r[verify hosting.shell.no-third-party-chrome]
      it.each([
        ["anonymous", false],
        ["signed in", true],
      ])("requests nothing from another origin until the hold releases (%s)", async (_, signedIn) => {
        const owner = await newUser();
        const slug = await publicSlug(owner, "Self-contained");
        const ctx = await context(signedIn ? owner : undefined);
        try {
          const page = await ctx.newPage();
          const urls: URL[] = [];
          page.on("request", (r) => urls.push(new URL(r.url())));
          await page.goto(`${ORIGIN}/a/${slug}`, { waitUntil: "domcontentloaded" });
          await page.waitForFunction(() => !document.documentElement.classList.contains("ae-hold"));
          // The frame itself is among the requests checked.
          expect(urls.some((u) => u.pathname === `/a/${slug}/frame`)).toBe(true);
          expect(urls.map((u) => u.origin).filter((o) => !allowed.includes(o))).toEqual([]);
        } finally {
          await ctx.close();
        }
      });
    });
  });

  // S53 — Account menu shows the active organization and your role. OSS has no
  // org context, so these drive the top bar with `/api/me` (and the switch)
  // answered by the page, as a superset's provider would answer them.
  describe("account menu", () => {
    const HV = { id: "org-hv", name: "Hidden Value", role: "owner" as const };
    const ACME = { id: "org-acme", name: "Acme", role: "member" as const };
    type Orgs = { activeId: string; memberships: { id: string; name: string; role: string }[] };

    // Serves `/api/me` as the real one plus `orgs`; `onSwitch` answers the switch.
    async function withOrgs(
      page: Page,
      orgs: Orgs,
      onSwitch?: (organizationId: string) => { status: number; orgs?: Orgs },
    ): Promise<string[]> {
      let current = orgs;
      const switched: string[] = [];
      await page.route(/\/api\/me$/, async (route) => {
        const real = (await (await route.fetch()).json()) as Record<string, unknown>;
        await route.fulfill({ json: { ...real, organizations: current } });
      });
      await page.route(/\/api\/me\/active-organization$/, async (route) => {
        const { organizationId } = route.request().postDataJSON() as { organizationId: string };
        switched.push(organizationId);
        const answer = onSwitch?.(organizationId) ?? { status: 404 };
        if (answer.status !== 200 || !answer.orgs) return route.fulfill({ status: answer.status, json: { error: "not found" } });
        current = answer.orgs;
        const real = (await (await page.request.get(`${ORIGIN}/api/me`)).json()) as Record<string, unknown>;
        await route.fulfill({ json: { ...real, organizations: current } });
      });
      return switched;
    }

    async function openWith(u: User, orgs: Orgs | null, onSwitch?: Parameters<typeof withOrgs>[2], viewport?: { width: number; height: number }) {
      const page = await (await context(u, "light", viewport)).newPage();
      const switched = orgs ? await withOrgs(page, orgs, onSwitch) : [];
      await page.goto(ORIGIN);
      await page.getByRole("heading", { name: "Home" }).waitFor();
      return { page, switched };
    }

    const accountButton = (page: Page) => page.locator("header [title^='Account']:visible");
    const menu = (page: Page) => page.getByRole("menu").first();
    const itemNames = (page: Page) =>
      menu(page)
        .locator(":scope > [role^='menuitem']")
        .evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()));
    const switcher = (page: Page) => page.getByRole("menuitem", { name: "Switch organization" });
    const orgItems = (page: Page) => page.getByRole("menuitemcheckbox");

    // r[verify platform.top-bar.org-and-role+2]
    // r[verify platform.top-bar.account-menu+2]
    it("is the plain Account button without an org context, its menu Account, Colour theme then Log out", async () => {
      const u = await newUser("Ada Lovelace");
      const { page } = await openWith(u, null);
      await visible(page.getByRole("button", { name: "Account", exact: true }));
      await openMenu(page, accountButton(page));
      await visible(menu(page));
      expect(await itemNames(page)).toEqual(["Account", "Colour theme", "Log out"]);
      expect(await menu(page).getByText(u.email).count()).toBe(1);
      expect(await menu(page).locator(":scope > [data-slot='dropdown-menu-label']").count()).toBe(1);
      expect(await switcher(page).count()).toBe(0);
      expect(await page.getByRole("menuitem", { name: /Usage/ }).count()).toBe(0);
      await page.context().close();
    });

    // r[verify platform.top-bar.org-and-role+2]
    // r[verify platform.top-bar.switch-organization+3]
    it("shows the one org and its role on the button, with no switcher", async () => {
      const u = await newUser();
      const { page } = await openWith(u, { activeId: HV.id, memberships: [HV] });
      const button = page.getByRole("button", { name: "Account: Hidden Value, Owner", exact: true });
      await visible(button);
      expect(await button.getAttribute("title")).toBe("Account: Hidden Value, Owner");
      expect((await button.innerText()).replace(/\s+/g, " ").trim()).toBe("AL Hidden Value Owner");
      expect(await button.locator("svg.lucide-chevron-down").isVisible()).toBe(true);
      await openMenu(page, button);
      await visible(menu(page));
      expect(await switcher(page).count()).toBe(0);
      expect(await itemNames(page)).toEqual(["Account", "Organization settings", "Colour theme", "Log out"]);
      await page.context().close();
    });

    // r[verify platform.top-bar.org-and-role+2]
    it("is a round avatar-only button below sm, under the same name, with one account button displayed", async () => {
      const u = await newUser();
      const { page } = await openWith(u, { activeId: HV.id, memberships: [HV] }, undefined, { width: 480, height: 900 });
      const button = page.getByRole("button", { name: "Account: Hidden Value, Owner", exact: true });
      await visible(button);
      expect(await button.getAttribute("title")).toBe("Account: Hidden Value, Owner");
      expect((await button.innerText()).trim()).toBe("AL");
      const box = (await button.boundingBox())!;
      expect(box.width).toBe(box.height);
      expect(await button.evaluate((el) => el.classList.contains("rounded-full"))).toBe(true);
      expect(await page.locator("header [title^='Account']:visible").count()).toBe(1);
      await page.context().close();
    });

    // r[verify platform.top-bar.org-and-role+2]
    it("cuts a 40-character org name off on the button, keeping it whole in the name and title", async () => {
      const long = "The Very Long Organization Name Co. Ltd.";
      const u = await newUser();
      const { page } = await openWith(u, { activeId: "org-long", memberships: [{ id: "org-long", name: long, role: "admin" }] });
      const button = page.getByRole("button", { name: `Account: ${long}, Admin`, exact: true });
      await visible(button);
      expect(await button.getAttribute("title")).toBe(`Account: ${long}, Admin`);
      const name = button.getByText(long, { exact: true });
      expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      expect(await name.evaluate((el) => getComputedStyle(el).textOverflow)).toBe("ellipsis");
      expect(await name.evaluate((el) => el.getBoundingClientRect().width)).toBeLessThanOrEqual(160);
      await page.context().close();
    });

    // r[verify platform.top-bar.org-and-role+2]
    // r[verify platform.top-bar.switch-organization+3]
    it("lists every membership with its role under Switch organization, the active one checked", async () => {
      const u = await newUser();
      const { page } = await openWith(u, { activeId: ACME.id, memberships: [HV, ACME] });
      const button = page.getByRole("button", { name: "Account: Acme, Member", exact: true });
      await visible(button);
      await openMenu(page, button);
      await switcher(page).click();
      await visible(orgItems(page));
      const rows = await orgItems(page).evaluateAll((els) =>
        els.map((e) => [(e.textContent ?? "").replace(/\s+/g, " ").trim(), e.getAttribute("aria-checked")]),
      );
      expect(rows).toEqual([
        ["Hidden Value Owner", "false"],
        ["Acme Member", "true"],
      ]);
      await page.context().close();
    });

    // r[verify platform.top-bar.switch-organization+3]
    it("sends nothing when the active org is picked", async () => {
      const u = await newUser();
      const { page, switched } = await openWith(u, { activeId: ACME.id, memberships: [HV, ACME] });
      await openMenu(page, accountButton(page));
      await switcher(page).click();
      await page.getByRole("menuitemcheckbox", { name: /Acme/ }).click();
      await gone(page.getByRole("menu"));
      await page.waitForTimeout(300);
      expect(switched).toEqual([]);
      await visible(page.getByRole("button", { name: "Account: Acme, Member", exact: true }));
      await page.context().close();
    });

    // r[verify platform.top-bar.switch-organization+3]
    it("switches and lands on Home: the button follows, a toast confirms, the lists re-fetch, focus on the heading", async () => {
      const u = await newUser();
      const notes = await createCollection(u, "Old org notes");
      const { page, switched } = await openWith(u, { activeId: ACME.id, memberships: [HV, ACME] }, (id) => ({
        status: 200,
        orgs: { activeId: id, memberships: [HV, ACME] },
      }));
      await page.goto(`${ORIGIN}/c/${notes.id}`);
      await visible(page.getByRole("heading", { level: 1, name: "Old org notes", exact: true }));
      const listed: string[] = [];
      page.on("request", (r) => {
        const path = new URL(r.url()).pathname;
        if (r.method() === "GET" && (path === "/api/artefacts" || path === "/api/shared")) listed.push(path);
      });
      await openMenu(page, accountButton(page));
      await switcher(page).click();
      await page.getByRole("menuitemcheckbox", { name: /Hidden Value/ }).click();
      await visible(page.getByRole("button", { name: "Account: Hidden Value, Owner", exact: true }));
      await visible(toast(page, "Switched to Hidden Value"));
      expect(switched).toEqual([HV.id]);
      await eventually(() => expect(new Set(listed)).toEqual(new Set(["/api/artefacts", "/api/shared"])));
      expect(new URL(page.url()).pathname).toBe("/");
      await eventually(async () =>
        expect(await page.evaluate(() => document.activeElement?.outerHTML)).toMatch(/^<h1[^>]*>Home<\/h1>$/),
      );
      // A history entry: Back returns to the collection page.
      await page.goBack();
      await eventually(() => expect(new URL(page.url()).pathname).toBe(`/c/${notes.id}`));
      await page.context().close();
    });

    // r[verify platform.top-bar.switch-organization+3]
    it("moves focus straight to Home's heading when the switch answers after the menu has closed", async () => {
      const u = await newUser();
      const { page } = await openWith(u, { activeId: ACME.id, memberships: [HV, ACME] }, (id) => ({
        status: 200,
        orgs: { activeId: id, memberships: [HV, ACME] },
      }));
      let release!: () => void;
      const held = new Promise<void>((done) => (release = done));
      await page.route(/\/api\/me\/active-organization$/, async (route) => {
        await held;
        await route.fallback();
      });
      await openMenu(page, accountButton(page));
      await switcher(page).click();
      // Every element focused from the pick on.
      await page.evaluate(() => {
        const seen: string[] = [];
        (window as unknown as { focusedSince: string[] }).focusedSince = seen;
        document.addEventListener("focusin", (e) => seen.push((e.target as Element).outerHTML.slice(0, 80)));
      });
      await page.getByRole("menuitemcheckbox", { name: /Hidden Value/ }).click();
      await gone(page.getByRole("menu"));
      await page.waitForTimeout(300);
      release();
      await visible(page.getByRole("button", { name: "Account: Hidden Value, Owner", exact: true }));
      await eventually(async () =>
        expect(await page.evaluate(() => document.activeElement?.outerHTML)).toMatch(/^<h1[^>]*>Home<\/h1>$/),
      );
      const seen = await page.evaluate(() => (window as unknown as { focusedSince: string[] }).focusedSince);
      expect(seen.filter((s) => s.includes("Account:")), seen.join(" | ")).toEqual([]);
      await page.context().close();
    });

    // r[verify platform.top-bar.switch-organization+3]
    it("keeps the active org and the page, and toasts the error, when the switch fails", async () => {
      const u = await newUser();
      const notes = await createCollection(u, "Still here");
      const { page, switched } = await openWith(u, { activeId: ACME.id, memberships: [HV, ACME] }, () => ({ status: 404 }));
      await page.goto(`${ORIGIN}/c/${notes.id}`);
      await visible(page.getByRole("heading", { level: 1, name: "Still here", exact: true }));
      await openMenu(page, accountButton(page));
      await switcher(page).click();
      await page.getByRole("menuitemcheckbox", { name: /Hidden Value/ }).click();
      await visible(toast(page, "Couldn’t switch organization"));
      expect(switched).toEqual([HV.id]);
      const button = page.getByRole("button", { name: "Account: Acme, Member", exact: true });
      await visible(button);
      expect(new URL(page.url()).pathname).toBe(`/c/${notes.id}`);
      await visible(page.getByRole("heading", { level: 1, name: "Still here", exact: true }));
      // Focus goes back to the button, as when the menu closes without a switch.
      const onButton = () => button.evaluate((el) => el === document.activeElement);
      await eventually(async () => expect(await onButton()).toBe(true));
      // So it does when the failure answers after the menu has closed.
      let release!: () => void;
      const held = new Promise<void>((done) => (release = done));
      await page.route(/\/api\/me\/active-organization$/, async (route) => {
        await held;
        await route.fallback();
      });
      await openMenu(page, button);
      await switcher(page).click();
      await page.getByRole("menuitemcheckbox", { name: /Hidden Value/ }).click();
      await gone(page.getByRole("menu"));
      await page.waitForTimeout(300);
      const answered = page.waitForResponse(/\/api\/me\/active-organization$/);
      release();
      expect((await answered).status()).toBe(404);
      expect(switched).toEqual([HV.id, HV.id]);
      // The shell's catch runs once the answer is in; give it a render.
      await page.waitForTimeout(300);
      expect(await onButton()).toBe(true);
      expect(new URL(page.url()).pathname).toBe(`/c/${notes.id}`);
      await page.context().close();
    });

    // r[verify platform.top-bar.switch-organization+3]
    it("runs one switch at a time: a second pick while one is pending sends nothing", async () => {
      const u = await newUser();
      let release!: () => void;
      const held = new Promise<void>((done) => (release = done));
      const { page, switched } = await openWith(u, { activeId: ACME.id, memberships: [HV, ACME] }, (id) => ({
        status: 200,
        orgs: { activeId: id, memberships: [HV, ACME] },
      }));
      // Hold the switch's answer until both picks are in.
      await page.route(/\/api\/me\/active-organization$/, async (route) => {
        await held;
        await route.fallback();
      });
      for (let i = 0; i < 2; i++) {
        await openMenu(page, accountButton(page));
        await switcher(page).click();
        await page.getByRole("menuitemcheckbox", { name: /Hidden Value/ }).click();
        await gone(page.getByRole("menu"));
      }
      release();
      await visible(page.getByRole("button", { name: "Account: Hidden Value, Owner", exact: true }));
      await page.waitForTimeout(300);
      expect(switched).toEqual([HV.id]);
      await page.context().close();
    });

    // r[verify platform.top-bar.switch-organization+3]
    it("never lets a list answered for the old org overwrite the switched one", async () => {
      const u = await newUser();
      await createArtefact(u, "Current org artefact");
      const page = await (await context(u)).newPage();
      await withOrgs(page, { activeId: ACME.id, memberships: [HV, ACME] }, (id) => ({
        status: 200,
        orgs: { activeId: id, memberships: [HV, ACME] },
      }));
      // The first own-artefacts request answers last, with the old org's list.
      let release!: () => void;
      const held = new Promise<void>((done) => (release = done));
      let first = true;
      await page.route(/\/api\/artefacts$/, async (route) => {
        if (!first) return route.fallback();
        first = false;
        const real = (await (await route.fetch()).json()) as { artefacts: { title: string }[] };
        await held;
        await route.fulfill({ json: { artefacts: real.artefacts.map((a) => ({ ...a, title: "Old org artefact" })) } });
      });
      await page.goto(ORIGIN);
      await page.getByRole("heading", { name: "Home" }).waitFor();
      await openMenu(page, accountButton(page));
      await switcher(page).click();
      // The first load is still held, so the first list to answer is the refresh.
      const refreshed = page.waitForResponse(/\/api\/artefacts$/);
      await page.getByRole("menuitemcheckbox", { name: /Hidden Value/ }).click();
      await visible(page.getByRole("button", { name: "Account: Hidden Value, Owner", exact: true }));
      await refreshed;
      release();
      await visible(page.locator("main [aria-label='Open Current org artefact']"));
      await page.waitForTimeout(500);
      expect(await page.locator("main [aria-label='Open Old org artefact']").count()).toBe(0);
      expect(await page.locator("main [aria-label='Open Current org artefact']").count()).toBeGreaterThan(0);
      await page.context().close();
    });

    // r[verify platform.top-bar.account-menu+2]
    it("skips the header rows on ArrowDown, landing on the first item", async () => {
      const u = await newUser();
      const { page } = await openWith(u, { activeId: ACME.id, memberships: [HV, ACME] });
      // A pointer open focuses the menu itself (a keyboard open focuses its first item).
      await openMenu(page, accountButton(page));
      await visible(menu(page));
      await page.keyboard.press("ArrowDown");
      await eventually(async () =>
        expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe("Switch organization"),
      );
      await page.context().close();
    });

    // r[verify platform.top-bar.account-menu+2]
    it("lists the rows in order: user, org, the items with two separators, and no Usage", async () => {
      const u = await newUser("Ada Lovelace");
      const { page } = await openWith(u, { activeId: HV.id, memberships: [HV, ACME] });
      await openMenu(page, accountButton(page));
      await visible(menu(page));
      const rows = await menu(page)
        .locator(":scope > *")
        .evaluateAll((els) =>
          els.map((e) => {
            const slot = e.getAttribute("data-slot") ?? "";
            if (slot.endsWith("separator")) return "—";
            const text = (e.textContent ?? "").replace(/\s+/g, " ").trim();
            return slot.endsWith("label") ? `label: ${text}` : text;
          }),
        );
      expect(rows).toEqual([
        `label: ALAda Lovelace${u.email}`,
        "label: Hidden Value Owner",
        "Switch organization",
        "Account",
        "Organization settings",
        "—",
        "Colour theme",
        "—",
        "Log out",
      ]);
      expect(await page.getByRole("menuitem", { name: /Usage/ }).count()).toBe(0);
      await page.context().close();
    });

    // r[verify platform.top-bar.account-menu+2]
    it("runs on keys: Enter opens on the first item, → and ← work submenus, Esc returns focus to the button", async () => {
      const u = await newUser();
      const { page } = await openWith(u, { activeId: ACME.id, memberships: [HV, ACME] });
      const button = page.getByRole("button", { name: "Account: Acme, Member", exact: true });
      const focused = () => page.evaluate(() => (document.activeElement?.textContent ?? "").replace(/\s+/g, " ").trim());
      const onButton = () => button.evaluate((el) => el === document.activeElement);
      await page.locator("body").click({ position: { x: 1, y: 1 } });
      for (let i = 0; i < 12 && !(await onButton()); i++) await page.keyboard.press("Tab");
      expect(await onButton()).toBe(true);
      await page.keyboard.press("Enter");
      await visible(menu(page));
      await eventually(async () => expect(await focused()).toBe("Switch organization"));
      await page.keyboard.press("ArrowRight");
      await visible(orgItems(page));
      await eventually(async () => expect(await focused()).toBe("Hidden Value Owner"));
      await page.keyboard.press("ArrowLeft");
      await gone(orgItems(page));
      await eventually(async () => expect(await focused()).toBe("Switch organization"));
      await page.keyboard.press("Escape");
      await gone(page.getByRole("menu"));
      await eventually(async () => expect(await onButton()).toBe(true));
      await page.context().close();
    });

    // r[verify platform.top-bar.account-menu+2]
    it("holds the theme as a Colour theme submenu of three radios", async () => {
      const page = await openApp(await newUser());
      await openMenu(page, accountButton(page));
      await page.getByRole("menuitem", { name: "Colour theme" }).click();
      const radios = page.getByRole("menuitemradio");
      await visible(radios);
      expect(await radios.evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()))).toEqual(["Light", "Dark", "System"]);
      await page.context().close();
    });

    // r[verify platform.top-bar.account-menu+2]
    it("ends with Log out, which signs you out", async () => {
      const u = await newUser();
      const { page } = await openWith(u, { activeId: HV.id, memberships: [HV] });
      await openMenu(page, accountButton(page));
      const names = await itemNames(page);
      expect(names.at(-1)).toBe("Log out");
      await control(page, "Log out").click();
      await visible(page.getByPlaceholder("Email"));
      await page.context().close();
    });

    // S57 — Account screen: change your name.
    describe("Account screen (S57)", () => {
      // Answers `PATCH /api/me` with `status`; a 200 echoes the real /api/me
      // carrying the sent name (and `orgs`, when given). Records each sent body.
      async function onRename(page: Page, status: number, orgs?: Orgs): Promise<unknown[]> {
        const sent: unknown[] = [];
        await page.route(/\/api\/me$/, async (route) => {
          if (route.request().method() !== "PATCH") return route.fallback();
          const body = route.request().postDataJSON() as { name: string };
          sent.push(body);
          if (status !== 200) return route.fulfill({ status, json: { error: "boom" } });
          const real = (await (await page.request.get(`${ORIGIN}/api/me`)).json()) as Record<string, unknown>;
          await route.fulfill({ json: { ...real, name: body.name.trim(), ...(orgs ? { organizations: orgs } : {}) } });
        });
        return sent;
      }

      async function openAccount(page: Page): Promise<void> {
        await openMenu(page, accountButton(page));
        await page.getByRole("menuitem", { name: "Account", exact: true }).click();
        await visible(page.getByRole("heading", { name: "Account", exact: true }));
      }

      const nameField = (page: Page) => page.getByLabel("Name", { exact: true });
      const save = (page: Page) => page.getByRole("button", { name: "Save", exact: true });

      it("opens from the account menu without an org context: title, the name in the field, the email read-only", async () => {
        const u = await newUser("Ada Lovelace");
        const { page } = await openWith(u, null);
        await openAccount(page);
        await visible(page.getByText("Your profile."));
        expect(await nameField(page).inputValue()).toBe("Ada Lovelace");
        const main = page.locator("main");
        expect(await main.getByText(u.email).count()).toBeGreaterThan(0);
        // The email is shown, never editable.
        expect(await main.locator(`input[value="${u.email}"]:not([readonly]):not([disabled])`).count()).toBe(0);
        expect(await main.getByRole("textbox").count()).toBe(1);
        await page.context().close();
      });

      it("opens from the account menu with an org context too", async () => {
        const u = await newUser("Ada Lovelace");
        const { page } = await openWith(u, { activeId: HV.id, memberships: [HV] });
        await openAccount(page);
        expect(await nameField(page).inputValue()).toBe("Ada Lovelace");
        await page.context().close();
      });

      // r[verify platform.account.save-name+2]
      it("enables Save only for a changed, non-empty name", async () => {
        const u = await newUser("Ada Lovelace");
        const { page } = await openWith(u, null);
        await openAccount(page);
        expect(await save(page).isDisabled()).toBe(true);
        await nameField(page).fill("   ");
        expect(await save(page).isDisabled()).toBe(true);
        await nameField(page).fill(" Ada Lovelace ");
        expect(await save(page).isDisabled()).toBe(true);
        await nameField(page).fill("Ada King");
        expect(await save(page).isEnabled()).toBe(true);
        await page.context().close();
      });

      // r[verify platform.account.save-name+2]
      it("saves: toasts Name saved, the top bar follows, Save disables again", async () => {
        const u = await newUser("Ada Lovelace");
        const { page } = await openWith(u, null);
        const sent = await onRename(page, 200);
        await openAccount(page);
        await nameField(page).fill("  Grace Hopper ");
        await save(page).click();
        await visible(toast(page, "Name saved"));
        expect(sent).toEqual([{ name: "Grace Hopper" }]);
        await eventually(async () => expect(await save(page).isDisabled()).toBe(true));
        expect(await nameField(page).inputValue()).toBe("Grace Hopper");
        expect((await accountButton(page).innerText()).trim()).toContain("GH");
        await openMenu(page, accountButton(page));
        await visible(menu(page).getByText("Grace Hopper"));
        await page.context().close();
      });

      // r[verify platform.account.save-name+2]
      it("keeps the org context on the button after a save", async () => {
        const u = await newUser("Ada Lovelace");
        const orgs = { activeId: HV.id, memberships: [HV] };
        const { page } = await openWith(u, orgs);
        await onRename(page, 200, orgs);
        await openAccount(page);
        await nameField(page).fill("Grace Hopper");
        await save(page).click();
        await visible(toast(page, "Name saved"));
        await visible(page.getByRole("button", { name: "Account: Hidden Value, Owner", exact: true }));
        await page.context().close();
      });

      // r[verify platform.account.save-name+2]
      it("keeps the typed name and changes nothing else when the save fails", async () => {
        const u = await newUser("Ada Lovelace");
        const { page } = await openWith(u, null);
        const sent = await onRename(page, 500);
        await openAccount(page);
        await nameField(page).fill("Grace Hopper");
        await save(page).click();
        await visible(toast(page, "Couldn’t save your name"));
        expect(sent).toHaveLength(1);
        expect(await nameField(page).inputValue()).toBe("Grace Hopper");
        expect(await save(page).isEnabled()).toBe(true);
        expect((await accountButton(page).innerText()).trim()).toContain("AL");
        await openMenu(page, accountButton(page));
        await visible(menu(page).getByText("Ada Lovelace"));
        await page.context().close();
      });

      it("disables Save while the request is pending, and keeps an edit made meanwhile", async () => {
        const u = await newUser("Ada Lovelace");
        const { page } = await openWith(u, null);
        let release!: () => void;
        const held = new Promise<void>((done) => (release = done));
        await onRename(page, 200);
        await page.route(/\/api\/me$/, async (route) => {
          if (route.request().method() !== "PATCH") return route.fallback();
          await held;
          await route.fallback();
        });
        await openAccount(page);
        await nameField(page).fill("Grace Hopper");
        await save(page).click();
        await eventually(async () => expect(await save(page).isDisabled()).toBe(true));
        // An edit made while the save is pending survives its answer.
        await nameField(page).fill("Grace Hopper Jr");
        release();
        await visible(toast(page, "Name saved"));
        expect(await nameField(page).inputValue()).toBe("Grace Hopper Jr");
        await eventually(async () => expect(await save(page).isEnabled()).toBe(true));
        await page.context().close();
      });

      it("wraps the Name field and Save onto two lines below sm", async () => {
        const u = await newUser("Ada Lovelace");
        const { page } = await openWith(u, null, undefined, { width: 480, height: 900 });
        await openAccount(page);
        const field = (await nameField(page).boundingBox())!;
        const button = (await save(page).boundingBox())!;
        expect(button.y).toBeGreaterThanOrEqual(field.y + field.height);
        await page.context().close();
      });
    });

    // S58 — Organization settings screen and its administration seam. OSS has
    // no organization, so the page answers `/api/me` (via `withOrgs`) and the
    // organization routes, as a superset's provider would.
    describe("Organization settings (S58)", () => {
      type Role = "owner" | "admin" | "member";
      interface Settings {
        id: string;
        name: string;
        owner: { name: string; email: string };
        role: Role;
        members: { id: string; name: string; email: string; role: Role }[];
        invitations?: { id: string; email: string; sentAt: string }[];
        inviteDomains?: string[];
      }

      const idOf = async (u: User) =>
        ((await (await app.request("/api/me", { headers: { cookie: u.cookie } })).json()) as { id: string }).id;

      // The settings the mocked routes answer for an org: `me` is the caller
      // (with `role`), plus an owner (when the caller isn't one) and a member.
      function settingsFor(org: { id: string; name: string }, me: { id: string; name: string; email: string }, role: Role, extra: Partial<Settings> = {}): Settings {
        const owner = role === "owner" ? { name: me.name, email: me.email } : { name: "Olle Owner", email: "olle@acme.se" };
        const members: Settings["members"] = [
          ...(role === "owner" ? [] : [{ id: "u-owner", ...owner, role: "owner" as Role }]),
          { id: me.id, name: me.name, email: me.email, role },
          { id: "u-mia", name: "Mia Member", email: "mia@acme.se", role: "member" as Role },
        ].sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner"));
        const admin = role !== "member";
        return {
          id: org.id,
          name: org.name,
          owner,
          role,
          members,
          ...(admin
            ? { invitations: [{ id: "inv-1", email: "pending@acme.se", sentAt: new Date(Date.now() - 86_400_000).toISOString() }], inviteDomains: ["acme.se"] }
            : {}),
          ...extra,
        };
      }

      // Serves the organization routes from `byOrg`, keyed by the org active in
      // `state`; `hold` delays a GET for that org until released. Records the
      // state-changing requests.
      async function withOrganization(
        page: Page,
        state: { active: string },
        byOrg: Record<string, Settings>,
        opts: { invite?: (email: string) => { status: number; error?: string }; hold?: { org: string; until: Promise<void> } } = {},
      ) {
        const sent: { method: string; path: string; body?: unknown }[] = [];
        await page.route(/\/api\/organization(\/.*)?$/, async (route) => {
          const req = route.request();
          const path = new URL(req.url()).pathname;
          const org = state.active;
          if (req.method() === "GET") {
            if (opts.hold?.org === org) await opts.hold.until;
            return route.fulfill({ json: byOrg[org] });
          }
          const body = req.postData() ? req.postDataJSON() : undefined;
          sent.push({ method: req.method(), path, body });
          const s = byOrg[org]!;
          if (req.method() === "PATCH") {
            s.name = (body as { name: string }).name.trim();
            return route.fulfill({ json: s });
          }
          if (req.method() === "POST") {
            const email = (body as { email: string }).email;
            const answer = opts.invite?.(email) ?? { status: 201 };
            if (answer.status !== 201) return route.fulfill({ status: answer.status, json: { error: answer.error } });
            s.invitations = [...(s.invitations ?? []), { id: `inv-${email}`, email, sentAt: new Date().toISOString() }];
            return route.fulfill({ status: 201, json: s });
          }
          const id = decodeURIComponent(path.split("/").pop()!);
          s.invitations = (s.invitations ?? []).filter((i) => i.id !== id);
          return route.fulfill({ json: s });
        });
        return sent;
      }

      const ORG_A = { id: "org-a", name: "Acme AB", role: "owner" as const };
      const ORG_B = { id: "org-b", name: "Beta Co", role: "member" as const };

      // Opens the app as `u` in `orgs`, the organization routes answered from
      // `byOrg`, the switch moving `state.active` too.
      async function openOrg(u: User, active: string, byOrg: Record<string, Settings>, opts: Parameters<typeof withOrganization>[3] = {}, viewport?: { width: number; height: number }) {
        const state = { active };
        const memberships = [ORG_A, ORG_B].filter((o) => byOrg[o.id]);
        const page = await (await context(u, "light", viewport)).newPage();
        await withOrgs(page, { activeId: active, memberships }, (id) => {
          state.active = id;
          return { status: 200, orgs: { activeId: id, memberships } };
        });
        const sent = await withOrganization(page, state, byOrg, opts);
        await page.goto(ORIGIN);
        await page.getByRole("heading", { name: "Home" }).waitFor();
        return { page, sent, state };
      }

      async function openSettings(page: Page): Promise<void> {
        await openMenu(page, accountButton(page));
        await page.getByRole("menuitem", { name: "Organization settings", exact: true }).click();
        await visible(page.getByRole("heading", { name: "Organization settings", exact: true }));
      }

      const main = (page: Page) => page.locator("main");
      const nameField = (page: Page) => page.getByLabel("Organization name", { exact: true });
      const save = (page: Page) => main(page).getByRole("button", { name: "Save", exact: true });
      const inviteButton = (page: Page) => page.getByRole("button", { name: "Invite people", exact: true });
      const revokeButtons = (page: Page) => page.getByRole("button", { name: /^Revoke invitation to / });
      const dialog = (page: Page) => page.getByRole("dialog");
      const send = (page: Page) => dialog(page).getByRole("button", { name: "Send invite", exact: true });

      async function asOwner(extra: Partial<Settings> = {}) {
        const u = await newUser("Ada Lovelace");
        const me = { id: await idOf(u), name: u.name, email: u.email };
        return { u, me, byOrg: { [ORG_A.id]: settingsFor(ORG_A, me, "owner", extra), [ORG_B.id]: settingsFor(ORG_B, me, "member") } };
      }

      // r[verify platform.org-settings.role-controls+2]
      it("is not in the account menu without an org context", async () => {
        const u = await newUser();
        const { page } = await openWith(u, null);
        await openMenu(page, accountButton(page));
        await visible(menu(page));
        expect(await page.getByRole("menuitem", { name: "Organization settings" }).count()).toBe(0);
        await page.context().close();
      });

      // S80 — Account and Organization settings open for every role.
      // r[verify platform.top-bar.account-menu+2]
      it("opens Account and Organization settings from the menu for an owner, an admin and a member", async () => {
        for (const role of ["owner", "admin", "member"] as const) {
          const u = await newUser("Ada Lovelace");
          const me = { id: await idOf(u), name: u.name, email: u.email };
          const { page } = await openOrg(u, ORG_A.id, { [ORG_A.id]: settingsFor(ORG_A, me, role) });
          await openSettings(page);
          await openMenu(page, accountButton(page));
          await page.getByRole("menuitem", { name: "Account", exact: true }).click();
          await visible(page.getByRole("heading", { name: "Account", exact: true }));
          await page.context().close();
        }
      });

      // S59 — Organization settings has a path, which a reload keeps.
      // r[verify platform.navigation.fallback-home+2]
      // r[verify platform.navigation.history]
      it("is at /organization, which a reload or a fresh load opens with an org context", async () => {
        const { u, byOrg } = await asOwner();
        const { page } = await openOrg(u, ORG_A.id, byOrg);
        await openSettings(page);
        expect(new URL(page.url()).pathname).toBe("/organization");
        await page.reload();
        await visible(page.getByRole("heading", { name: "Organization settings", exact: true }));
        expect(new URL(page.url()).pathname).toBe("/organization");
        await page.context().close();
      });

      // r[verify platform.org-settings.role-controls+2]
      it("shows an owner the editable name, Invite people, pending rows with revoke, the owner first and (you)", async () => {
        const { u, byOrg } = await asOwner();
        const { page } = await openOrg(u, ORG_A.id, byOrg);
        await openSettings(page);
        await visible(main(page).getByText("Acme AB").first());
        expect(await nameField(page).inputValue()).toBe("Acme AB");
        await visible(save(page));
        await visible(inviteButton(page));
        await visible(main(page).getByText("Members · 2"));
        await visible(main(page).getByText("pending@acme.se"));
        await visible(main(page).getByText("Pending", { exact: true }));
        expect(await revokeButtons(page).count()).toBe(1);
        const rows = await main(page).locator("li").evaluateAll((els) => els.map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim()));
        expect(rows[0]).toContain("Ada Lovelace (you)");
        expect(rows[0]).toContain("Owner");
        expect(rows[1]).toContain("Mia Member");
        await page.context().close();
      });

      // r[verify platform.org-settings.role-controls+2]
      it("shows a member everything read-only, with the note naming the owner", async () => {
        const { u, byOrg } = await asOwner();
        const { page } = await openOrg(u, ORG_B.id, byOrg);
        await openSettings(page);
        await visible(main(page).getByText("Only owners can rename the organization or invite and remove members. Ask Olle Owner if something needs changing."));
        expect(await nameField(page).count()).toBe(0);
        expect(await main(page).getByRole("textbox").count()).toBe(0);
        expect(await inviteButton(page).count()).toBe(0);
        expect(await revokeButtons(page).count()).toBe(0);
        expect(await main(page).getByText("Pending", { exact: true }).count()).toBe(0);
        await visible(main(page).getByText("Ada Lovelace (you)"));
        await page.context().close();
      });

      // r[verify platform.org-settings.role-controls+2]
      it("offers an owner no Invite people when the org has no invite domains", async () => {
        const { u, byOrg } = await asOwner({ inviteDomains: [] });
        const { page } = await openOrg(u, ORG_A.id, byOrg);
        await openSettings(page);
        await visible(nameField(page));
        expect(await inviteButton(page).count()).toBe(0);
        expect(await revokeButtons(page).count()).toBe(1);
        await page.context().close();
      });

      it("renames: toasts Organization renamed and the top bar follows", async () => {
        const { u, byOrg } = await asOwner();
        const { page, sent } = await openOrg(u, ORG_A.id, byOrg);
        // The renamed org is what `/api/me` reports from then on.
        await page.route(/\/api\/me$/, async (route) => {
          const real = (await (await route.fetch()).json()) as Record<string, unknown>;
          const memberships = [{ ...ORG_A, name: byOrg[ORG_A.id]!.name }, ORG_B];
          await route.fulfill({ json: { ...real, organizations: { activeId: ORG_A.id, memberships } } });
        });
        await openSettings(page);
        await nameField(page).fill("  Acme Group ");
        await save(page).click();
        await visible(toast(page, "Organization renamed"));
        expect(sent).toEqual([{ method: "PATCH", path: "/api/organization", body: { name: "Acme Group" } }]);
        await visible(page.getByRole("button", { name: "Account: Acme Group, Owner", exact: true }));
        await page.context().close();
      });

      it("invites: Send invite only for an address at an invite domain, then a Pending row and a toast", async () => {
        const { u, byOrg } = await asOwner();
        const { page, sent } = await openOrg(u, ORG_A.id, byOrg);
        await openSettings(page);
        await inviteButton(page).click();
        await visible(dialog(page).getByText("Invite people", { exact: true }));
        await visible(dialog(page).getByText(/Addresses at acme\.se/));
        const email = dialog(page).getByLabel("Email", { exact: true });
        await email.fill("x@gmail.com");
        expect(await send(page).isDisabled()).toBe(true);
        await visible(dialog(page).getByText("Only addresses at acme.se can be invited"));
        await email.fill("x@acme.se");
        expect(await send(page).isEnabled()).toBe(true);
        await send(page).click();
        await visible(toast(page, "Invitation sent to x@acme.se"));
        await eventually(async () => expect(await dialog(page).count()).toBe(0));
        await visible(main(page).getByText("x@acme.se"));
        expect(await revokeButtons(page).count()).toBe(2);
        expect(sent).toEqual([{ method: "POST", path: "/api/organization/invitations", body: { email: "x@acme.se" } }]);
        await page.context().close();
      });

      it("keeps the dialog open with the reason when the server refuses the invite", async () => {
        const { u, byOrg } = await asOwner();
        const { page } = await openOrg(u, ORG_A.id, byOrg, { invite: () => ({ status: 409, error: "already-invited" }) });
        await openSettings(page);
        await inviteButton(page).click();
        await dialog(page).getByLabel("Email", { exact: true }).fill("pending@acme.se");
        await send(page).click();
        await visible(dialog(page).getByText("pending@acme.se already has a pending invitation"));
        expect(await dialog(page).count()).toBe(1);
        await page.context().close();
      });

      it("revokes: the row goes and a toast confirms", async () => {
        const { u, byOrg } = await asOwner();
        const { page, sent } = await openOrg(u, ORG_A.id, byOrg);
        await openSettings(page);
        await page.getByRole("button", { name: "Revoke invitation to pending@acme.se", exact: true }).click();
        await visible(toast(page, "Invitation to pending@acme.se revoked"));
        await eventually(async () => expect(await main(page).getByText("pending@acme.se").count()).toBe(0));
        expect(sent).toEqual([{ method: "DELETE", path: "/api/organization/invitations/inv-1", body: undefined }]);
        await page.context().close();
      });

      // r[verify platform.org-settings.follows-active-org+2]
      it("shows the switched org's role when opened after a switch, dropping a late answer for the old org", async () => {
        const { u, byOrg } = await asOwner();
        let release!: () => void;
        const until = new Promise<void>((done) => (release = done));
        // Held: org A's loads, once `holding` is set.
        let holding = false;
        let heldLoads = 0;
        const { page, state } = await openOrg(u, ORG_A.id, byOrg);
        await page.route(/\/api\/organization$/, async (route) => {
          if (route.request().method() === "GET" && state.active === ORG_A.id && holding) {
            heldLoads += 1;
            await until;
            // Org A's answer, though B is active by now.
            return route.fulfill({ json: byOrg[ORG_A.id] });
          }
          await route.fallback();
        });
        // A's settings load is held while the switch to B lands on Home.
        holding = true;
        await openMenu(page, accountButton(page));
        await page.getByRole("menuitem", { name: "Organization settings", exact: true }).click();
        await eventually(() => expect(heldLoads).toBeGreaterThan(0));
        await openMenu(page, accountButton(page));
        await switcher(page).click();
        await page.getByRole("menuitemcheckbox", { name: /Beta Co/ }).click();
        await visible(page.getByRole("button", { name: "Account: Beta Co, Member", exact: true }));
        await eventually(() => expect(new URL(page.url()).pathname).toBe("/"));
        // Opened again under B: the member's read-only view, which A's late answer must not replace.
        await openSettings(page);
        await visible(main(page).getByText(/Ask Olle Owner/));
        expect(await nameField(page).count()).toBe(0);
        release();
        await page.waitForTimeout(300);
        expect(await nameField(page).count()).toBe(0);
        await visible(main(page).getByText(/Ask Olle Owner/));
        await page.context().close();
      });

      it("shows an error state with Try again when the load fails", async () => {
        const { u, byOrg } = await asOwner();
        const { page } = await openOrg(u, ORG_A.id, byOrg);
        let fail = true;
        await page.route(/\/api\/organization$/, async (route) => {
          if (route.request().method() === "GET" && fail) return route.fulfill({ status: 500, json: { error: "boom" } });
          await route.fallback();
        });
        await openSettings(page);
        await visible(main(page).getByText("Couldn’t load the organization."));
        fail = false;
        await main(page).getByRole("button", { name: "Try again" }).click();
        await visible(nameField(page));
        await page.context().close();
      });

      it("toasts and changes nothing when a revoke fails", async () => {
        const { u, byOrg } = await asOwner();
        const { page } = await openOrg(u, ORG_A.id, byOrg);
        await page.route(/\/api\/organization\/invitations\/.*$/, (route) => route.fulfill({ status: 500, json: { error: "boom" } }));
        await openSettings(page);
        await page.getByRole("button", { name: "Revoke invitation to pending@acme.se", exact: true }).click();
        await visible(toast(page, "Couldn’t revoke the invitation"));
        await visible(main(page).getByText("pending@acme.se"));
        await page.context().close();
      });

      it("wraps the name field and Save, and keeps the rows inside a narrow screen", async () => {
        const { u, byOrg } = await asOwner();
        const { page } = await openOrg(u, ORG_A.id, byOrg, {}, { width: 360, height: 900 });
        await openSettings(page);
        const field = (await nameField(page).boundingBox())!;
        const button = (await save(page).boundingBox())!;
        expect(button.y).toBeGreaterThanOrEqual(field.y + field.height);
        const badge = (await main(page).getByText("Pending", { exact: true }).boundingBox())!;
        expect(badge.x + badge.width).toBeLessThanOrEqual(360);
        await page.context().close();
      });
    });
  });

  // r[verify platform.client.no-svelte-runtime]
  it("builds a client bundle with no Svelte runtime in it", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(js|html)$/.test(f)) files.push(p);
      }
    };
    walk(CLIENT_DIR);
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((f) => /svelte/i.test(readFileSync(f, "utf8")))).toEqual([]);
  });

  // S66 — Artefact opens without flicker: the shell holds until the frame has loaded.
  // Sequential, and at the top level so no other test in this file runs beside it:
  // each test races the shell's FRAME_HOLD_MAX_MS cap on the page's own clock, which
  // contention can stretch. Last, so the concurrent run before it drains only once.
  describe("hold until the frame has loaded (S66)", { concurrent: false }, () => {
    const held = (page: Page) =>
      page.evaluate(() => ({
        hold: document.documentElement.classList.contains("ae-hold"),
        bar: getComputedStyle(document.querySelector(".ae-bar")!).visibility,
        busy: document.getElementById("ae-frame")!.getAttribute("aria-busy"),
        // Every element under body that would paint: none while held.
        shown: [...document.body.querySelectorAll("*")]
          .filter((el) => getComputedStyle(el).visibility !== "hidden")
          .map((el) => el.id || el.getAttribute("class") || el.tagName),
      }));
    const released = (page: Page, timeout?: number) =>
      page.waitForFunction(() => !document.documentElement.classList.contains("ae-hold"), undefined, { timeout });

    // Opens `slug` (as `viewer`, or anonymous) under the stored dark theme with the
    // frame response held back; `answer` lets it through, `close` lets it through
    // and closes the context, so a failed expectation never leaves it pending.
    async function openHeld(slug: string, viewer?: User) {
      const ctx = await context(viewer, "light");
      await storeTheme(ctx, "dark");
      const page = await ctx.newPage();
      let answer = () => {};
      const answered = new Promise<void>((r) => (answer = r));
      await page.route(new RegExp(`/a/${slug}/frame`), async (route) => {
        await answered;
        await route.continue();
      });
      const close = async () => {
        answer();
        await ctx.close();
      };
      try {
        // The page's own load waits for the frame, so stop at the DOM.
        await page.goto(`${ORIGIN}/a/${slug}`, { waitUntil: "domcontentloaded" });
      } catch (e) {
        await close();
        throw e;
      }
      return { page, answer, close };
    }

    // r[verify hosting.shell.hold-until-frame]
    it("shows only the shell background until the frame loads, then everything at once", async () => {
      const { page, answer, close } = await openHeld(await publicSlug(await newUser(), "Held frame"));
      try {
        expect(await held(page)).toEqual({ hold: true, bar: "hidden", busy: "true", shown: [] });
        expect(await isDark(page)).toBe(true);
        expect(await bgOf(page, "body")).toBe(await computed(page, DARK_BG));
        answer();
        await released(page);
        // Released by the frame's load, well before the cap could have fired.
        expect(await page.evaluate(() => performance.now())).toBeLessThan(FRAME_HOLD_MAX_MS);
        const after = await held(page);
        expect(after).toMatchObject({ hold: false, bar: "visible", busy: null });
        expect(after.shown).toEqual(expect.arrayContaining(["ae-frame"]));
      } finally {
        await close();
      }
    });

    // r[verify hosting.shell.hold-until-frame]
    it("releases the hold at the cap when the frame never answers", async () => {
      const { page, close } = await openHeld(await publicSlug(await newUser(), "Silent frame"));
      try {
        expect((await held(page)).hold).toBe(true);
        await released(page, FRAME_HOLD_MAX_MS + 5_000);
        // The cap was set after navigation start, so it can't have fired before it.
        expect(await page.evaluate(() => performance.now())).toBeGreaterThanOrEqual(FRAME_HOLD_MAX_MS);
        expect(await held(page)).toMatchObject({ hold: false, bar: "visible", busy: null });
      } finally {
        await close();
      }
    });

    // r[verify hosting.shell.hold-until-frame]
    // r[verify hosting.shell.viewers-count-reserved]
    it("keeps a filled Viewers count hidden until the hold is released", async () => {
      const owner = await newUser();
      const other = await newUser("Grace Hopper");
      const slug = await publicSlug(owner, "Counted frame");
      // A signed-in open records the other user's view (S21).
      expect((await app.request(`/a/${slug}`, { headers: { cookie: other.cookie } })).status).toBe(200);
      const { page, answer, close } = await openHeld(slug, owner);
      try {
        const count = () =>
          page.evaluate(() => {
            const el = document.getElementById("ae-viewers-count")!;
            return { text: el.textContent, visibility: getComputedStyle(el).visibility };
          });
        await page.waitForFunction(() => document.getElementById("ae-viewers-count")!.textContent === "1");
        expect(await count()).toEqual({ text: "1", visibility: "hidden" });
        expect((await held(page)).shown).toEqual([]);
        answer();
        await released(page);
        expect(await count()).toEqual({ text: "1", visibility: "visible" });
      } finally {
        await close();
      }
    });
  });
});
