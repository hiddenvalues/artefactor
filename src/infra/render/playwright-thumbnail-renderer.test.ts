import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright-core";
import { ThumbnailRendererUnavailable } from "../../domain/artefact/errors";
import { PlaywrightThumbnailRenderer } from "./playwright-thumbnail-renderer";

// S35 (AH26) — the Playwright renderer against a real headless Chromium. CI
// installs `chromium-headless-shell` first, so these always run there; locally
// they skip only when no browser is installed
// (`pnpm exec playwright-core install chromium-headless-shell`).
const chromiumAvailable = await chromium
  .launch()
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
    await renderer.close();
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

  it("launches the browser lazily and closes it after being idle", async () => {
    let launches = 0;
    const idle = new PlaywrightThumbnailRenderer({
      idleCloseMs: 200,
      settleMs: 0,
      launch: () => {
        launches++;
        return chromium.launch();
      },
    });
    expect(launches).toBe(0);

    await idle.render(enc("<h1>one</h1>"));
    await idle.render(enc("<h1>two</h1>"));
    expect(launches).toBe(1);

    await new Promise((r) => setTimeout(r, 600));
    await idle.render(enc("<h1>three</h1>"));
    expect(launches).toBe(2);
    await idle.close();
  }, 30_000);
});

describe("PlaywrightThumbnailRenderer without a browser (S35, AH25)", () => {
  it("reports itself unavailable when Chromium cannot launch", async () => {
    const renderer = new PlaywrightThumbnailRenderer({
      launch: (): Promise<Browser> => Promise.reject(new Error("Executable doesn't exist")),
    });
    await expect(renderer.render(enc("<h1>x</h1>"))).rejects.toBeInstanceOf(
      ThumbnailRendererUnavailable,
    );
  });
});
