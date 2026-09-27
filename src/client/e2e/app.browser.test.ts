import { mkdtempSync, readdirSync, readFileSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ServerType } from "@hono/node-server";
import type { Hono } from "hono";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SHELL_TOKENS } from "../../server/runtime/shell-theme";
import type { ArtefactSummary } from "../../shared/contracts";

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

describe.skipIf(!runBrowserTests)("the client's flows in Chromium (S43)", { timeout: 60_000 }, () => {
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
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGIN });
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
    await page.getByRole("heading", { name: "Your artefacts" }).waitFor();
    return page;
  }

  const visible = (l: Locator) => l.first().waitFor({ state: "visible" });
  const gone = (l: Locator) => l.first().waitFor({ state: "hidden" });

  // The title an item opens by — every card and row carries exactly one
  // "Open <title>" control, in display order.
  async function shownTitles(page: Page): Promise<string[]> {
    const labels = await page
      .locator("main [aria-label^='Open ']")
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!.slice("Open ".length)));
    return [...new Set(labels)];
  }

  // Every card's own ⋯ menu; the item for `title` is the one inside its card.
  async function cardMenu(page: Page, title: string): Promise<void> {
    const titles = await shownTitles(page);
    const index = titles.indexOf(title);
    expect(index).toBeGreaterThanOrEqual(0);
    const onCollectionPage = await page.locator("main h1").count().then(async (n) =>
      n > 0 && !["Your artefacts", "Shared with you"].includes((await page.locator("main h1").first().innerText()).trim()),
    );
    // A collection page's header carries its own ⋯ ahead of the cards'.
    await openMenu(page, page.locator("main [title='More']").nth(index + (onCollectionPage ? 1 : 0)));
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

  describe("auth", () => {
    it("signs in with email + password onto “Your artefacts”, and signs out to the auth screen", async () => {
      const u = await newUser();
      const page = await (await context()).newPage();
      await page.goto(ORIGIN);
      await page.getByPlaceholder("Email").fill(u.email);
      await page.getByPlaceholder("Password").fill(PASSWORD);
      await page.locator("form button[type='submit']").click();
      await visible(page.getByRole("heading", { name: "Your artefacts" }));

      await page.locator("[title='Account']").click();
      await control(page, "Sign out").click();
      await visible(page.getByPlaceholder("Email"));
      await page.close();
    });

    it("shows no email form when the deployment has email + password off", async () => {
      const page = await (await context()).newPage();
      await page.route("**/api/config", (route) =>
        route.fulfill({
          json: {
            allowedEmailDomains: [],
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
      await page.close();
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
              allowedEmailDomains: [],
              emailPasswordEnabled: true,
              googleEnabled: true,
              signupAllowed: true,
              capabilities: { magicLinkSignIn: true },
            },
          }),
        );
        return page;
      }

      it("offers no magic-link control under the OSS default", async () => {
        const page = await (await context()).newPage();
        await page.goto(ORIGIN);
        await visible(page.getByPlaceholder("Password"));
        expect(await control(page, MAGIC).count()).toBe(0);
        expect(await page.getByLabel("Email for a sign-in link").count()).toBe(0);
        await page.close();
      });

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
        await page.close();
      });

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
        await page.close();
      });

      it("explains an expired or used link on landing back with ?error", async () => {
        for (const code of ["EXPIRED_TOKEN", "INVALID_TOKEN"]) {
          const page = await magicLinkPage();
          await page.goto(`${ORIGIN}/?error=${code}`);
          await visible(page.getByText("That sign-in link has expired or was already used — send a new one"));
          await page.close();
        }
        const page = await magicLinkPage();
        await page.goto(`${ORIGIN}/?error=failed_to_create_user`);
        await visible(page.getByText("We couldn't sign you in with that link"));
        await page.close();
      });
    });
  });

  describe("upload and edit", () => {
    it("uploads an .html file with a title and kind as a card with that kind badge", async () => {
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

      const open = page.locator("main [aria-label='Open Quarterly form']").first();
      await visible(open);
      await eventually(async () => expect(await open.innerText()).toContain("Form"));
      await page.close();
    });

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
      await page.close();
    });

    it("edits an artefact's title and replaces its file, updating the card", async () => {
      const u = await newUser();
      await createArtefact(u, "Draft deck", "slide-deck");
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

      await visible(page.locator("main [aria-label='Open Final deck']"));
      expect(await page.locator("main [aria-label='Open Draft deck']").count()).toBe(0);
      await visible(page.locator("main").getByText("300 KB"));
      await page.close();
    });
  });

  it("switches private → members → public, reveals and copies the share link, and hides it again", async () => {
    const u = await newUser();
    const a = await createArtefact(u, "Tiered");
    const page = await openApp(u);
    const main = page.locator("main");
    expect(await main.getByText(/\/a\//).count()).toBe(0);

    await control(main, "Private").click();
    await page.getByText("Any signed-in user").click();
    await visible(toast(page, "Visibility set to Members"));
    await visible(control(main, "Members"));
    const shared = (await (await app.request(`/api/artefacts/${a.id}`, { headers: { cookie: u.cookie } })).json()) as ArtefactSummary;
    const link = main.getByText(`/a/${shared.publicSlug}`);
    await visible(link);

    await link.click();
    await visible(toast(page, /Link copied/));

    await control(main, "Members").click();
    await page.getByText("Anyone with the link").click();
    await control(page, "Make public").click();
    await visible(toast(page, "Visibility set to Public"));
    await visible(control(main, "Public"));

    await control(main, "Public").click();
    await page.getByText("Only you", { exact: true }).click();
    await visible(toast(page, "Visibility set to Private"));
    await visible(control(main, "Private"));
    await gone(main.getByText(`/a/${shared.publicSlug}`));
    await page.close();
  });

  describe("archive", () => {
    it("archives with an Undo toast, lists it under Archive, and restores it", async () => {
      const u = await newUser();
      await createArtefact(u, "Old notes", "interactive-doc");
      const page = await openApp(u);
      const card = page.locator("main [aria-label='Open Old notes']");

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
      await page.close();
    });

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
      await page.close();
    });
  });

  it("creates a collection, files an artefact in it, nests, expands/collapses and archives it", async () => {
    const u = await newUser();
    await createArtefact(u, "Filed away");
    const page = await openApp(u);
    const aside = await openSidebar(page);

    await aside.locator("[aria-label='New collection']").click();
    await page.getByLabel("Name").fill("Research");
    await control(page, "Create collection").click();
    await visible(control(aside, /Research/));

    await cardMenu(page, "Filed away");
    await control(page, "Add to collection…").click();
    await control(page, /Research/).last().click();
    await control(page, "Add to Research").click();
    await visible(toast(page, /added to Research/));

    await control(aside, /Research/).click();
    await visible(page.getByRole("heading", { level: 1, name: "Research" }));
    await visible(control(page.locator("main"), "Collections"));
    await visible(page.locator("main [aria-label='Open Filed away']"));

    await openMenu(page, page.locator("main [title='More']").first());
    await control(page, "New sub-collection").click();
    await page.getByLabel("Name").fill("Interviews");
    await control(page, "Create collection").click();
    const child = control(aside, /Interviews/);
    await visible(child);
    await aside.locator("[aria-label='Collapse']").click();
    await gone(child);
    await aside.locator("[aria-label='Expand']").click();
    await visible(child);

    await openMenu(page, page.locator("main [title='More']").first());
    await control(page, "Archive collection").click();
    await visible(page.getByRole("heading", { name: "Your artefacts" }));
    await gone(control(aside, /Research/));
    await control(aside, /^\s*Archive/).click();
    await visible(page.locator("main").getByText("Research"));
    await page.close();
  });

  it("manages access: searching adds a person to the list, removing drops them", async () => {
    const owner = await newUser();
    const guest = await newUser("Grace Hopper");
    await createArtefact(owner, "Board memo");
    const page = await openApp(owner);

    await control(page.locator("main"), "Private").click();
    await page.getByText("Only people you choose").click();
    await visible(page.getByText("Manage access", { exact: true }));
    await page.getByPlaceholder("Search people by name or email…").fill(guest.email);
    await control(page, new RegExp(guest.email.replace(/[.]/g, "\\."))).click();
    await visible(page.getByText("People with access · 1"));

    await page.locator(`[aria-label='Remove ${guest.name}']`).click();
    await visible(page.getByText(/No one yet/));
    await page.close();
  });

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
    await page.close();
  });

  it("lifts a grid card on hover exactly as the Svelte client did — eased, not snapped — and leaves list rows still", async () => {
    const u = await newUser();
    await createArtefact(u, "Hovered");
    const page = await openApp(u);
    const open = page.locator("main [aria-label='Open Hovered']");
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
    await page.close();
  });

  it("shows another user's members artefact under “Shared with you”, in grid and list", async () => {
    const author = await newUser("Maya Chen");
    const a = await createArtefact(author, "Team handbook", "interactive-doc");
    await setVisibility(author, a.id, "authenticated");
    const page = await openApp(await newUser());

    // S46 — the top bar's tabs are gone; the Sidebar carries the way in.
    const aside = await openSidebar(page);
    await control(aside, "Shared with you").click();
    await visible(page.getByRole("heading", { name: "Shared with you" }));
    const open = page.locator("main [aria-label='Open Team handbook']");
    await visible(open);
    await visible(page.locator("main").getByText("Maya Chen"));
    expect((await open.boundingBox())!.width).toBeGreaterThan(150);

    await page.locator("main [title='List']").click();
    await eventually(async () => expect((await open.boundingBox())!.width).toBeLessThan(80));
    await visible(page.locator("main").getByText("Team handbook"));
    await page.close();
  });

  it("filters by kind and access, sorts, switches density — and all four survive a reload", async () => {
    const u = await newUser();
    await createArtefact(u, "Gamma prototype", "prototype");
    const deck = await createArtefact(u, "Beta deck", "slide-deck");
    await createArtefact(u, "Alpha form", "form");
    await createArtefact(u, "Delta deck", "slide-deck");
    await setVisibility(u, deck.id, "authenticated");
    const page = await openApp(u);
    const main = page.locator("main");

    await control(main, /^\s*Form\s*\d/).click();
    await eventually(async () => expect(await shownTitles(page)).toEqual(["Alpha form"]));
    await control(main, /^\s*All types/).click();

    await openMenu(page, control(main, "All access"));
    await control(page, /^\s*Members\s*\d/).click();
    await eventually(async () => expect(await shownTitles(page)).toEqual(["Beta deck"]));
    // The filter's trigger comes before any card's own tier control.
    await openMenu(page, control(main, "Members").first());
    await control(page, /^\s*All access\s*\d/).click();

    await openMenu(page, control(main, "Recently updated"));
    await control(page, "Title A–Z").click();
    await eventually(async () =>
      expect(await shownTitles(page)).toEqual(["Alpha form", "Beta deck", "Delta deck", "Gamma prototype"]),
    );

    await control(main, /^\s*Slide deck\s*\d/).click();
    await eventually(async () => expect(await shownTitles(page)).toEqual(["Beta deck", "Delta deck"]));
    await openMenu(page, control(main, "All access"));
    await control(page, /^\s*Private\s*\d/).click();
    await eventually(async () => expect(await shownTitles(page)).toEqual(["Delta deck"]));
    await main.locator("[title='List']").click();
    const open = main.locator("[aria-label='Open Delta deck']");
    await eventually(async () => expect((await open.boundingBox())!.width).toBeLessThan(80));

    await page.reload();
    await visible(page.getByRole("heading", { name: "Your artefacts" }));
    await eventually(async () => expect(await shownTitles(page)).toEqual(["Delta deck"]));
    await visible(control(main, "Title A–Z"));
    expect((await open.boundingBox())!.width).toBeLessThan(80);
    expect(
      await page.evaluate(() =>
        ["view", "density", "kind", "access", "sort", "sidebar"].map((k) => localStorage.getItem(`artefactor:${k}`)),
      ),
    ).toEqual(["dashboard", "list", "slide-deck", "private", "title", "closed"]);
    await page.close();
  });

  // S46 — Top bar: global search, tabs move out.
  describe("global search", () => {
    const search = (page: Page) => page.getByRole("combobox", { name: "Search artefacts and collections" });
    const expanded = (page: Page) => search(page).getAttribute("aria-expanded");

    it("finds another user's shared artefact from the Dashboard, in a dropdown that leaves the grid alone", async () => {
      const author = await newUser("Maya Chen");
      const a = await createArtefact(author, "Quarterly zebra review", "slide-deck");
      await setVisibility(author, a.id, "authenticated");
      const viewer = await newUser();
      await createArtefact(viewer, "My own notes");
      const page = await openApp(viewer);
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
      await page.close();
    });

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
      await page.close();
    });

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
      await page.close();
    });

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
      await page.close();
    });

    it("says so in a status when nothing matches", async () => {
      const page = await openApp(await newUser());
      await search(page).fill("qqxxzz");
      await visible(page.getByRole("status").filter({ hasText: "No matches for “qqxxzz”" }));
      await visible(page.getByText("Try another word, or check the spelling."));
      await page.close();
    });

    it("keeps the header from overflowing at 480 px, with New artefact and Account at full width", async () => {
      const u = await newUser();
      const widths = async (viewport: { width: number; height: number }) => {
        const page = await (await context(u, "light", viewport)).newPage();
        await page.goto(ORIGIN);
        await page.getByRole("heading", { name: "Your artefacts" }).waitFor();
        const header = await page.locator("header > div").evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
        const upload = (await page.getByRole("button", { name: "New artefact" }).boundingBox())!.width;
        const account = (await page.getByRole("button", { name: "Account" }).boundingBox())!.width;
        await page.close();
        return { header, upload, account };
      };
      const wide = await widths({ width: 1280, height: 800 });
      const narrow = await widths({ width: 480, height: 800 });
      expect(narrow.header.scroll).toBeLessThanOrEqual(narrow.header.client);
      expect(narrow.upload).toBe(wide.upload);
      expect(narrow.account).toBe(wide.account);
    });
  });

  describe("keyboard", () => {
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
      await page.close();
    });

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
      // S46 — the top bar runs sidebar toggle → search → New artefact → Account,
      // with no view tabs between them.
      expect(names.slice(0, 4)).toEqual(["Toggle sidebar", "Search artefacts and collections", "New artefact", "Account"]);
      expect(names.some((n) => n === "Your artefacts" || n === "Shared with you")).toBe(false);
      expect(seen.filter((s) => !s.visibleFocus).map((s) => s.name)).toEqual([]);
      await page.close();
    });
  });

  // S45 — App dark mode with a UI toggle.
  describe("theme", () => {
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
    const chooseTheme = async (page: Page, label: string) => {
      await openMenu(page, page.locator("[title='Account']"));
      await control(page, label).click();
    };

    async function publicSlug(u: User, title: string, payload?: string): Promise<string> {
      const a = await createArtefact(u, title, "prototype", payload);
      await setVisibility(u, a.id, "public");
      const got = (await (await app.request(`/api/artefacts/${a.id}`, { headers: { cookie: u.cookie } })).json()) as ArtefactSummary;
      return got.publicSlug!;
    }

    it("paints an OS-dark visitor dark before the React bundle runs", async () => {
      const page = await (await context(undefined, "dark")).newPage();
      await page.route(/\/assets\/.*\.js$/, (route) => route.abort());
      await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
      expect(await page.locator("#app").innerHTML()).toBe("");
      expect(await isDark(page)).toBe(true);
      expect(await bgOf(page, "body")).toBe(await computed(page, DARK_BG));
      await page.close();
    });

    it("switches to Dark under an OS in light, stores it, and keeps it across a reload", async () => {
      const page = await openApp(await newUser());
      expect(await isDark(page)).toBe(false);
      await chooseTheme(page, "Dark");
      await eventually(async () => expect(await isDark(page)).toBe(true));
      expect(await page.evaluate(() => localStorage.getItem("artefactor:theme"))).toBe("dark");
      await page.reload({ waitUntil: "domcontentloaded" });
      expect(await isDark(page)).toBe(true);
      await page.getByRole("heading", { name: "Your artefacts" }).waitFor();
      expect(await isDark(page)).toBe(true);
      await page.close();
    });

    it("switches to Light under an OS in dark", async () => {
      const u = await newUser();
      const page = await (await context(u, "dark")).newPage();
      await page.goto(ORIGIN);
      await page.getByRole("heading", { name: "Your artefacts" }).waitFor();
      expect(await isDark(page)).toBe(true);
      await chooseTheme(page, "Light");
      await eventually(async () => expect(await isDark(page)).toBe(false));
      await page.close();
    });

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
      await page.close();
    });

    it("renders a toast fired in dark mode dark", async () => {
      const u = await newUser();
      await createArtefact(u, "Toasty");
      const ctx = await context(u);
      await storeTheme(ctx, "dark");
      const page = await ctx.newPage();
      await page.goto(ORIGIN);
      await page.getByRole("heading", { name: "Your artefacts" }).waitFor();
      await cardMenu(page, "Toasty");
      await control(page, "Archive").click();
      await visible(control(page, "Undo"));
      expect(await page.locator("[data-sonner-toaster]").first().getAttribute("data-sonner-theme")).toBe("dark");
      await page.close();
    });

    it("themes the /a/:slug shell from the stored choice", async () => {
      const u = await newUser();
      const slug = await publicSlug(u, "Shell dark");
      const ctx = await context(u);
      await storeTheme(ctx, "dark");
      const page = await ctx.newPage();
      await page.goto(`${ORIGIN}/a/${slug}`);
      expect(await isDark(page)).toBe(true);
      expect(await bgOf(page, ".ae-bar")).toBe(await computed(page, DARK_BG));
      await page.close();
    });

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
        await page.close();
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
        await page.close();
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
        await page.close();
        return { scheme, png };
      };
      const light = await shot("light");
      const dark = await shot("dark");
      expect(dark.scheme).toBe(light.scheme);
      expect(dark.png.equals(light.png)).toBe(true);
    });

    it("gives an anonymous OS-dark viewer of a public link a dark shell", async () => {
      const slug = await publicSlug(await newUser(), "Anon dark");
      const page = await (await context(undefined, "dark")).newPage();
      await page.goto(`${ORIGIN}/a/${slug}`);
      expect(await isDark(page)).toBe(true);
      expect(await bgOf(page, ".ae-bar")).toBe(await computed(page, DARK_BG));
      await page.emulateMedia({ colorScheme: "light" });
      await eventually(async () => expect(await bgOf(page, ".ae-bar")).toBe(await computed(page, LIGHT_BG)));
      await page.close();
    });
  });

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
});
