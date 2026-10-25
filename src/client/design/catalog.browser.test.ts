import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COMPONENTS_DIR, exempt, previewGroup, previewId, SCREENS_DIR } from "./registry";

// The design catalog (docs/design/README.md) in a real Chromium: the exported
// bundle (`pnpm design:export`) serves one section per component on the catalog
// page and one standalone page per preview for `/design-sync`, all rendering
// without a page error or a console error. Skips locally when no browser is
// installed, like the S43 behaviour suite; CI installs one.
const chromiumAvailable = await chromium
  .launch()
  .then((b) => b.close())
  .then(
    () => true,
    () => false,
  );
const runBrowserTests = chromiumAvailable || Boolean(process.env.CI);

// One preview per component and (S70) per screen, named from it: a missing
// preview fails here too, not only in the coverage test.
const previewsOf = (dir: string) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".tsx") && !e.name.endsWith(".preview.tsx"))
    .map((e) => join(e.parentPath, e.name).split("\\").join("/"))
    .filter((f) => !exempt(f))
    .map((f) => f.replace(/\.tsx$/, ".preview.tsx"));
const screenPreviews = previewsOf(SCREENS_DIR);
const previews = [...previewsOf(COMPONENTS_DIR), ...screenPreviews];

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

describe.skipIf(!runBrowserTests)("the design catalog in Chromium", { timeout: 120_000 }, () => {
  const out = mkdtempSync(join(tmpdir(), "artefactor-design-"));
  let server: Server;
  let origin = "";
  let browser: Browser;

  beforeAll(async () => {
    const { build } = await import("vite");
    await build({ configFile: resolve("vite.design.config.ts"), logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
    server = createServer((req, res) => {
      const path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)).replace(/^([/\\])+/, "");
      try {
        const body = readFileSync(join(out, path || "index.html"));
        res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" }).end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    browser = await chromium.launch();
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await new Promise((done) => (server ? server.close(done) : done(null)));
  });

  /**
   * Opens `path`, waits for the catalog to mount, and returns the page, every
   * error it raised and every request that left it: off the catalog's own
   * origin, or under `/api/`, which the fixture API answers in the page.
   */
  async function open(path: string): Promise<{ page: Page; errors: string[]; escaped: string[] }> {
    const page = await browser.newPage();
    const errors: string[] = [];
    const escaped: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
    page.on("request", (r) => {
      const url = new URL(r.url());
      if (url.protocol === "data:") return;
      if (url.origin !== origin || url.pathname.startsWith("/api/")) escaped.push(`${r.method()} ${r.url()}`);
    });
    await page.goto(`${origin}/${path}`);
    await page.waitForSelector("[data-catalog-ready]");
    // Let effects, debounced fixture fetches and animations settle.
    await page.waitForTimeout(400);
    return { page, errors, escaped };
  }

  // r[verify platform.search.top-bar-previews]
  it("renders one section per component, with no errors", async () => {
    expect(previews.length).toBeGreaterThan(0);
    const { page, errors } = await open("index.html");
    const sections = await page.locator("section[data-preview]").evaluateAll((els) => els.map((e) => e.getAttribute("data-preview")));
    expect(sections.sort()).toEqual(previews.map(previewId).sort());
    expect(errors).toEqual([]);
    await page.close();
  });

  // r[verify platform.design.screen-previews]
  it("renders every screen preview in the Templates group, light and dark, with no request outside the fixture API", async () => {
    expect(screenPreviews.length).toBeGreaterThan(0);
    for (const file of screenPreviews) {
      const id = previewId(file);
      const html = readFileSync(join(out, "components", `${id}.html`), "utf8");
      expect(html.split("\n")[0], id).toBe('<!-- @dsCard group="Templates" -->');

      const { page, errors, escaped } = await open(`components/${id}.html`);
      expect(await page.locator(`section[data-preview="${id}"] [data-slot]`).count(), id).toBeGreaterThan(0);
      // Dark: the class the catalog's theme toggle sets, then let it repaint.
      await page.evaluate(() => document.documentElement.classList.add("dark"));
      await page.waitForTimeout(200);
      expect(errors, id).toEqual([]);
      expect(escaped, id).toEqual([]);
      await page.close();
    }
  });

  // r[verify platform.design.consent-preview-states]
  it("previews the consent screen's Ready, Loading and Request expired states, Ready with an enabled Allow", async () => {
    const id = "screen-oauth-consent-screen";
    expect(screenPreviews.map(previewId)).toContain(id);
    const { page, errors } = await open(`components/${id}.html`);
    const variants = page.locator(`section[data-preview="${id}"] > div > div`);
    expect(await variants.evaluateAll((els) => els.map((e) => e.firstElementChild?.textContent))).toEqual([
      "Ready",
      "Loading",
      "Request expired",
    ]);
    const allow = variants.nth(0).getByRole("button", { name: "Allow" });
    expect(await allow.count()).toBe(1);
    expect(await allow.isEnabled()).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("renders the Theme page's five sections, the dark column mirroring the light one", async () => {
    const { page, errors } = await open("components/theme-theme-specimen.html");
    const specimens = page.locator('[data-slot="theme-specimen"]');
    expect(await specimens.evaluateAll((els) => els.map((e) => e.getAttribute("data-section")))).toEqual([
      "colours",
      "product",
      "type",
      "radius",
      "in-use",
    ]);
    for (const name of ["Colours", "Product colours", "Type", "Radius", "In use"])
      expect(await page.getByText(name, { exact: true }).count(), name).toBe(1);

    const colours = page.locator('[data-section="colours"]');
    const light = await colours.locator('[data-column="light"] [data-swatch]').count();
    expect(light).toBeGreaterThan(0);
    expect(await colours.locator('.dark[data-column="dark"] [data-swatch]').count()).toBe(light);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("reads the theme from tokens only: a :root override restyles the primary swatch", async () => {
    const { page } = await open("components/theme-theme-specimen.html");
    const swatch = page.locator('[data-section="colours"] [data-column="light"] [data-swatch="primary"]');
    const background = () => swatch.evaluate((el) => getComputedStyle(el).backgroundColor);
    const before = await background();
    await page.evaluate(() => document.documentElement.style.setProperty("--primary", "rgb(255, 0, 128)"));
    expect(await background()).toBe("rgb(255, 0, 128)");
    expect(before).not.toBe("rgb(255, 0, 128)");
    await page.close();
  });

  it("closes a busy dialog preview on Escape and hands focus back to its launcher", async () => {
    const { page, errors } = await open("index.html");
    const launcher = page.getByRole("button", { name: "Open busy confirm" });
    await launcher.click();
    await page.getByRole("alertdialog").waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("alertdialog").waitFor({ state: "detached" });
    expect(await launcher.evaluate((el) => el === document.activeElement)).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("adds a collection created in the picker preview and selects it", async () => {
    const { page, errors } = await open("components/add-to-collection-dialog.html");
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /New collection/ }).click();
    await dialog.getByRole("textbox").fill("Launch");
    await dialog.getByRole("button", { name: "Create" }).click();
    await dialog.getByRole("button", { name: "Add to Launch" }).waitFor();
    expect(await dialog.getByRole("button", { name: /^Launch$/ }).count()).toBe(1);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("exports every preview as a standalone page carrying its design-sync card marker", async () => {
    for (const file of previews) {
      const id = previewId(file);
      const html = readFileSync(join(out, "components", `${id}.html`), "utf8");
      expect(html.split("\n")[0]).toBe(`<!-- @dsCard group="${previewGroup(file)}" -->`);

      const { page, errors } = await open(`components/${id}.html`);
      const sections = await page.locator("section[data-preview]").evaluateAll((els) => els.map((e) => e.getAttribute("data-preview")));
      expect(sections, id).toEqual([id]);
      expect(errors, id).toEqual([]);
      await page.close();
    }
  });
});
