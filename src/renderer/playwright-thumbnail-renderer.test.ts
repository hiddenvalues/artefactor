import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type LaunchOptions } from "playwright-core";
import { ThumbnailRendererUnavailable } from "../domain/artefact/errors";
import { createRendererApp } from "./app";
import { PlaywrightThumbnailRenderer, captureWebp } from "./playwright-thumbnail-renderer";

// S35 (AH26) / S37 (AH29) — the Playwright renderer against a real headless
// Chromium, **with its OS sandbox on**. CI installs `chromium-headless-shell`
// first (and lifts Ubuntu's unprivileged-userns restriction), so these always
// run there; locally they skip only when no browser is installed
// (`pnpm exec playwright-core install chromium-headless-shell`).
const chromiumAvailable = await chromium
  .launch({ chromiumSandbox: true })
  .then((b) => b.close())
  .then(
    () => true,
    () => false,
  );
const runBrowserTests = chromiumAvailable || Boolean(process.env.CI);

const enc = (s: string) => new TextEncoder().encode(s);

// The canvas size of a WebP (lossy VP8, lossless VP8L or extended VP8X), read
// from its header — or null when the bytes are not a WebP at all.
function webpSize(b: Uint8Array): { width: number; height: number } | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (ascii(0, 4) !== "RIFF" || ascii(8, 12) !== "WEBP") return null;
  const chunk = ascii(12, 16);
  if (chunk === "VP8X") {
    return {
      width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)),
      height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)),
    };
  }
  if (chunk === "VP8 ") {
    return { width: (b[26]! | (b[27]! << 8)) & 0x3fff, height: (b[28]! | (b[29]! << 8)) & 0x3fff };
  }
  if (chunk === "VP8L") {
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  return null;
}

describe.skipIf(!runBrowserTests)("PlaywrightThumbnailRenderer (S35)", () => {
  let renderer: PlaywrightThumbnailRenderer;
  let canary: Server;
  let canaryUrl: string;
  const canaryHits: string[] = [];

  beforeAll(async () => {
    renderer = new PlaywrightThumbnailRenderer();
    canary = createServer((req, res) => {
      canaryHits.push(`${req.method} ${req.url}`);
      res.end("ok");
    });
    canary.on("upgrade", (req, socket) => {
      canaryHits.push(`UPGRADE ${req.url}`);
      socket.destroy();
    });
    await new Promise<void>((r) => canary.listen(0, "127.0.0.1", r));
    canaryUrl = `127.0.0.1:${(canary.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => canary.close(r));
  });

  it("renders a page with CDN CSS, a web font and a canvas into a 512×320 WebP", async () => {
    const html = `<!doctype html>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@700&display=swap">
      <style>body{margin:0;font-family:Inter,sans-serif;background:#f4f1ea} h1{font-size:96px}</style>
      <h1>Quarterly deck</h1>
      <canvas id="c" width="600" height="200"></canvas>
      <script>
        const g = document.getElementById("c").getContext("2d");
        g.fillStyle = "#c0392b"; g.fillRect(0, 0, 600, 200);
      </script>`;

    const image = await renderer.render(enc(html));

    expect(webpSize(image)).toEqual({ width: 512, height: 320 });
  }, 30_000);

  it("lets no request reach loopback — fetch, <img>, sendBeacon or WebSocket", async () => {
    const html = `<!doctype html>
      <img src="http://${canaryUrl}/img">
      <img src="http://localhost:${canaryUrl.split(":")[1]}/img-localhost">
      <script>
        fetch("http://${canaryUrl}/fetch", { mode: "no-cors" }).catch(() => {});
        navigator.sendBeacon("http://${canaryUrl}/beacon", "x");
        try { new WebSocket("ws://${canaryUrl}/ws"); } catch {}
      </script>`;

    await renderer.render(enc(html));
    await new Promise((r) => setTimeout(r, 500));

    expect(canaryHits).toEqual([]);
  }, 30_000);

  it("blocks a WebSocket to a public host", async () => {
    const html = `<!doctype html><script>
      window.__ws = { messages: 0, state: "pending" };
      const ws = new WebSocket("wss://ws.postman-echo.com/raw");
      ws.onopen = () => ws.send("ping");
      ws.onmessage = () => window.__ws.messages++;
      ws.onclose = () => (window.__ws.state = "closed");
      ws.onerror = () => (window.__ws.state = "error");
    </script>`;

    const seen = await renderer.withPage(enc(html), (page) =>
      page.evaluate(() => (globalThis as unknown as { __ws: { messages: number; state: string } }).__ws),
    );

    expect(seen.messages).toBe(0);
    expect(seen.state).not.toBe("pending");
  }, 30_000);

  it("aborts a page that never finishes within the 15 s cap, and keeps rendering after", async () => {
    const started = Date.now();
    await expect(
      renderer.render(enc("<!doctype html><script>while(true){}</script>")),
    ).rejects.toThrow(/timed out/);
    expect(Date.now() - started).toBeLessThan(20_000);

    const image = await renderer.render(enc("<!doctype html><h1>after</h1>"));
    expect(webpSize(image)).toEqual({ width: 512, height: 320 });
  }, 45_000);

  it("launches a fresh sandboxed browser for every render and closes it after", async () => {
    const launched: { options: LaunchOptions; browser: Browser }[] = [];
    const fresh = new PlaywrightThumbnailRenderer({
      settleMs: 0,
      launch: async (options) => {
        const browser = await chromium.launch(options);
        launched.push({ options, browser });
        return browser;
      },
    });

    await fresh.render(enc("<h1>one</h1>"));
    await fresh.render(enc("<h1>two</h1>"));

    expect(launched.map((l) => l.options.chromiumSandbox)).toEqual([true, true]);
    expect(launched.map((l) => l.browser.isConnected())).toEqual([false, false]);
  }, 30_000);
});

describe.skipIf(!runBrowserTests)("renderer role over HTTP, sandbox on (S37)", () => {
  const post = (app: { request: (r: Request) => Response | Promise<Response> }, html: string) => {
    const body = enc(html);
    return app.request(
      new Request("http://renderer/render", {
        method: "POST",
        headers: { "content-length": String(body.byteLength) },
        body,
      }),
    );
  };

  function role() {
    const launches: LaunchOptions[] = [];
    const r = createRendererApp({
      engine: new PlaywrightThumbnailRenderer({
        launch: (options) => {
          launches.push(options);
          return chromium.launch(options);
        },
      }),
      exitAfterJob: false,
      minUptimeMs: 0,
      uptimeMs: () => 0,
      exit: () => {},
      log: () => {},
    });
    return { ...r, launches };
  }

  it("POST /render of a fixture returns a 512×320 WebP, each render in a new browser", async () => {
    const r = role();
    await r.ready;
    expect((await r.app.request("/health")).status).toBe(200);
    const afterProbe = r.launches.length;

    const first = await post(r.app, "<!doctype html><h1 style='font-size:96px'>Deck</h1>");
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("image/webp");
    expect(webpSize(new Uint8Array(await first.arrayBuffer()))).toEqual({ width: 512, height: 320 });

    expect((await post(r.app, "<h1>again</h1>")).status).toBe(200);
    expect(r.launches.length - afterProbe).toBe(2);
    expect(r.launches.every((l) => l.chromiumSandbox === true)).toBe(true);
  }, 45_000);

  it("a busy-looping fixture answers 422 within the cap", async () => {
    const r = role();
    await r.ready;
    const started = Date.now();

    const res = await post(r.app, "<!doctype html><script>while(true){}</script>");

    expect(res.status).toBe(422);
    expect(Date.now() - started).toBeLessThan(25_000);
  }, 45_000);
});

describe("PlaywrightThumbnailRenderer without a browser (S35, AH25)", () => {
  it("retries a capture Chromium rejects before its first frame exists", async () => {
    const calls: string[] = [];
    let attempts = 0;
    const bytes = await captureWebp(async (method) => {
      calls.push(method);
      attempts++;
      if (attempts === 1) throw new Error("Protocol error (Page.captureScreenshot): Unable to capture screenshot");
      return { data: Buffer.from("RIFFxxxxWEBP").toString("base64") };
    }, 0);
    expect(new TextDecoder().decode(bytes)).toBe("RIFFxxxxWEBP");
    expect(calls).toEqual(["Page.captureScreenshot", "Page.captureScreenshot"]);
  });

  it("gives up after the last capture attempt", async () => {
    let attempts = 0;
    await expect(
      captureWebp(async () => {
        attempts++;
        throw new Error("Unable to capture screenshot");
      }, 0),
    ).rejects.toThrow("Unable to capture screenshot");
    expect(attempts).toBe(3);
  });

  it("reports itself unavailable when Chromium cannot launch", async () => {
    const renderer = new PlaywrightThumbnailRenderer({
      launch: (): Promise<Browser> => Promise.reject(new Error("Executable doesn't exist")),
    });
    await expect(renderer.render(enc("<h1>x</h1>"))).rejects.toBeInstanceOf(
      ThumbnailRendererUnavailable,
    );
  });
});
