import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { ThumbnailRendererUnavailable } from "../../domain/artefact/errors";
import type { ThumbnailRenderer } from "../../domain/artefact/ports";

// The synthetic origin the payload is served from. It is load-bearing: from a
// public-looking `https://` origin Chromium's Local Network Access refuses
// requests to loopback and private ranges, whereas a page set straight into
// `about:blank` reached them. `.invalid` never resolves, so nothing but the
// payload can come from it.
const ORIGIN = "https://artefact.invalid/";
const VIEWPORT = { width: 1280, height: 800 };
// 1280×800 × 0.4 = the 512×320 card image.
const SCALE = 0.4;

export interface PlaywrightThumbnailRendererOptions {
  // Pause after `load` for fonts, late layout and first animation frames.
  settleMs?: number;
  // Close the browser after this long without a render.
  idleCloseMs?: number;
  // Hard cap on one whole render; past it the page's context is closed.
  timeoutMs?: number;
  launch?: () => Promise<Browser>;
}

class RenderTimedOut extends Error {}

// S35 (AH26) — renders a pristine thumbnail of an artefact's stored HTML in
// headless Chromium: the payload alone, in a fresh context with no cookies,
// storage, credentials, service workers or WebSockets, at a synthetic origin.
// No S13 localStorage bootstrap and no S12 shell, so no one's data can appear.
export class PlaywrightThumbnailRenderer implements ThumbnailRenderer {
  private readonly settleMs: number;
  private readonly idleCloseMs: number;
  private readonly timeoutMs: number;
  private readonly launch: () => Promise<Browser>;
  private browser: Promise<Browser> | null = null;
  private active = 0;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(options: PlaywrightThumbnailRendererOptions = {}) {
    this.settleMs = options.settleMs ?? 1000;
    this.idleCloseMs = options.idleCloseMs ?? 60_000;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.launch = options.launch ?? (() => chromium.launch());
  }

  async render(html: Uint8Array): Promise<Uint8Array> {
    return this.withPage(html, async (page) => {
      const cdp = await page.context().newCDPSession(page);
      // Playwright's own screenshot() has no WebP; the CDP capture does.
      const { data } = await cdp.send("Page.captureScreenshot", {
        format: "webp",
        quality: 80,
        clip: { x: 0, y: 0, ...VIEWPORT, scale: SCALE },
      });
      return new Uint8Array(Buffer.from(data, "base64"));
    });
  }

  // Load `html` into an isolated page, let it settle, run `use` on it and tear
  // the context down — all inside the hard cap. `render` is `use` = capture.
  async withPage<T>(html: Uint8Array, use: (page: Page) => Promise<T>): Promise<T> {
    const browser = await this.acquire();
    let context: BrowserContext | null = null;
    let timer: NodeJS.Timeout | null = null;
    try {
      const work = (async () => {
        context = await browser.newContext({
          viewport: VIEWPORT,
          deviceScaleFactor: 1,
          serviceWorkers: "block",
          acceptDownloads: false,
        });
        const page = await context.newPage();
        const body = Buffer.from(html);
        await page.route(`${ORIGIN}**`, (route) =>
          route.request().url() === ORIGIN
            ? route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body })
            : route.abort(),
        );
        await page.routeWebSocket(/.*/, (ws) => ws.close());
        // Never `networkidle`: one open connection would keep a page from idling.
        await page.goto(ORIGIN, { waitUntil: "load", timeout: this.timeoutMs });
        if (this.settleMs > 0) await page.waitForTimeout(this.settleMs);
        return use(page);
      })();
      const cap = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new RenderTimedOut(`thumbnail render timed out after ${this.timeoutMs} ms`)),
          this.timeoutMs,
        );
      });
      // A late rejection from the abandoned work must not surface as unhandled.
      work.catch(() => {});
      return await Promise.race([work, cap]);
    } finally {
      if (timer) clearTimeout(timer);
      await this.dispose(context);
      this.release();
    }
  }

  // Close the browser now (shutdown, tests).
  async close(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const browser = this.browser;
    this.browser = null;
    if (browser) await (await browser.catch(() => null))?.close().catch(() => {});
  }

  private async acquire(): Promise<Browser> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.active++;
    if (!this.browser) {
      const launching = this.launch();
      this.browser = launching;
      launching.then(
        (b) =>
          b.on("disconnected", () => {
            if (this.browser === launching) this.browser = null;
          }),
        () => {
          if (this.browser === launching) this.browser = null;
        },
      );
    }
    try {
      return await this.browser;
    } catch (err) {
      this.release();
      throw new ThumbnailRendererUnavailable("Chromium could not be launched", { cause: err });
    }
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    if (this.active > 0 || !this.browser) return;
    this.idleTimer = setTimeout(() => void this.close(), this.idleCloseMs);
    this.idleTimer.unref();
  }

  // Close the render's context. A page wedged in a busy loop can stall that, so
  // past a short grace the whole browser goes; the next render relaunches it.
  private async dispose(context: BrowserContext | null): Promise<void> {
    if (!context) return;
    const closed = (context as BrowserContext).close().then(
      () => true,
      () => true,
    );
    const grace = new Promise<false>((r) => setTimeout(() => r(false), 5_000).unref());
    if (!(await Promise.race([closed, grace]))) await this.close();
  }
}
