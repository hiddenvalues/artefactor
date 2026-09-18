import {
  chromium,
  type Browser,
  type BrowserContext,
  type LaunchOptions,
  type Page,
} from "playwright-core";
import { ThumbnailRendererUnavailable } from "../domain/artefact/errors";
import type { ThumbnailRenderer } from "../domain/artefact/ports";

// The synthetic origin the payload is served from. It is load-bearing: from a
// public-looking `https://` origin Chromium's Local Network Access refuses
// requests to loopback and private ranges, whereas a page set straight into
// `about:blank` reached them. `.invalid` never resolves, so nothing but the
// payload can come from it.
const ORIGIN = "https://artefact.invalid/";
const VIEWPORT = { width: 1280, height: 800 };
// 1280×800 × 0.4 = the 512×320 card image.
const SCALE = 0.4;

// S37 (AH29) — every launch runs Chromium with its OS sandbox on. There is no
// option to turn it off, and a failed launch is never retried without it.
const SANDBOXED: LaunchOptions = { chromiumSandbox: true };

export interface PlaywrightThumbnailRendererOptions {
  // Pause after `load` for fonts, late layout and first animation frames.
  settleMs?: number;
  // Hard cap on one whole render; past it the browser is closed.
  timeoutMs?: number;
  // Launches Chromium with the given options (tests spy on it).
  launch?: (options: LaunchOptions) => Promise<Browser>;
}

class RenderTimedOut extends Error {}

type CaptureSend = (
  method: "Page.captureScreenshot",
  params: {
    format: "webp";
    quality: number;
    clip: { x: number; y: number; width: number; height: number; scale: number };
  },
) => Promise<{ data: string }>;

// The CDP WebP capture (Playwright's own screenshot() has no WebP). Chromium
// rejects a capture made before its first compositor frame exists ("Unable to
// capture screenshot") — `load` doesn't guarantee one — so a rejected capture
// is retried after a short pause, a bounded number of times. Retrying from here
// needs nothing from the page, which a hostile artefact could stall.
export async function captureWebp(send: CaptureSend, retryDelayMs = 250): Promise<Uint8Array> {
  const attempts = 3;
  for (let attempt = 1; ; attempt++) {
    try {
      const { data } = await send("Page.captureScreenshot", {
        format: "webp",
        quality: 80,
        clip: { x: 0, y: 0, ...VIEWPORT, scale: SCALE },
      });
      return new Uint8Array(Buffer.from(data, "base64"));
    } catch (err) {
      if (attempt >= attempts) throw err;
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }
}

// S35 (AH26) — renders a pristine thumbnail of an artefact's stored HTML in
// headless Chromium: the payload alone, in a fresh context with no cookies,
// storage, credentials, service workers or WebSockets, at a synthetic origin.
// No S13 localStorage bootstrap and no S12 shell, so no one's data can appear.
// S37 (AH29) — runs only in the isolated renderer role, with Chromium's sandbox
// on, and in a new browser for every render that is closed straight after, so
// nothing one artefact leaves behind in Chromium reaches the next. Its profile
// and temp files go to the OS temp dir, a tmpfs in the renderer container.
export class PlaywrightThumbnailRenderer implements ThumbnailRenderer {
  private readonly settleMs: number;
  private readonly timeoutMs: number;
  private readonly launch: (options: LaunchOptions) => Promise<Browser>;

  constructor(options: PlaywrightThumbnailRendererOptions = {}) {
    this.settleMs = options.settleMs ?? 1000;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.launch = options.launch ?? ((opts) => chromium.launch(opts));
  }

  // Launch and close a sandboxed browser once: proves this host can run the
  // sandbox before the renderer reports itself ready.
  async probe(): Promise<void> {
    const browser = await this.acquire();
    await closeBrowser(browser);
  }

  async render(html: Uint8Array): Promise<Uint8Array> {
    return this.withPage(html, async (page) => {
      const cdp = await page.context().newCDPSession(page);
      return captureWebp((method, params) => cdp.send(method, params));
    });
  }

  // Load `html` into an isolated page in a fresh browser, let it settle, run
  // `use` on it and close the browser — all inside the hard cap. `render` is
  // `use` = capture.
  async withPage<T>(html: Uint8Array, use: (page: Page) => Promise<T>): Promise<T> {
    const browser = await this.acquire();
    let timer: NodeJS.Timeout | null = null;
    try {
      const work = (async () => {
        const context: BrowserContext = await browser.newContext({
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
      await closeBrowser(browser);
    }
  }

  private async acquire(): Promise<Browser> {
    try {
      return await this.launch(SANDBOXED);
    } catch (err) {
      throw new ThumbnailRendererUnavailable("sandboxed Chromium could not be launched", {
        cause: err,
      });
    }
  }
}

// Close a browser, giving up waiting after a short grace: a page wedged in a busy
// loop can stall a graceful close. In the disposable renderer the process exits
// after the job anyway.
async function closeBrowser(browser: Browser): Promise<void> {
  const closed = browser.close().then(
    () => true,
    () => true,
  );
  const grace = new Promise<false>((r) => setTimeout(() => r(false), 5_000).unref());
  await Promise.race([closed, grace]);
}
