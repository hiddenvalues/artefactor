import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ThumbnailRendererUnavailable } from "../../domain/artefact/errors";
import { HttpThumbnailRenderer, ThumbnailRenderFailed } from "./http-thumbnail-renderer";

// S37 (AH25/AH29) — the app's side of the isolated renderer: POST the stored
// payload bytes to `${url}/render`, map the renderer's answers onto the port's
// two failure kinds (a failed render vs no renderer at all).

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

type Handler = (req: IncomingMessage, body: Buffer, res: ServerResponse) => void;

let servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.map((s) => new Promise((r) => (s.closeAllConnections(), s.close(r)))),
  );
  servers = [];
});

async function stub(handler: Handler): Promise<string> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => handler(req, Buffer.concat(chunks), res));
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

// A port nothing listens on: bind, note it, close.
async function refusedUrl(): Promise<string> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  await new Promise((r) => server.close(r));
  return `http://127.0.0.1:${port}`;
}

// A fake clock: `sleep` advances `now` instantly and records each delay.
function fakeClock() {
  let t = 0;
  const slept: number[] = [];
  return {
    slept,
    now: () => t,
    sleep: async (ms: number) => {
      slept.push(ms);
      t += ms;
    },
  };
}

describe("HttpThumbnailRenderer (S37)", () => {
  it("POSTs the HTML bytes to /render and returns the image on 200", async () => {
    const seen: { method?: string; url?: string; type?: string; length?: string; body?: string } = {};
    const url = await stub((req, body, res) => {
      Object.assign(seen, {
        method: req.method,
        url: req.url,
        type: req.headers["content-type"],
        length: req.headers["content-length"],
        body: body.toString(),
      });
      res.writeHead(200, { "content-type": "image/webp" }).end("RIFF-webp");
    });

    const image = await new HttpThumbnailRenderer(url).render(enc("<h1>hi</h1>"));

    expect(dec(image)).toBe("RIFF-webp");
    expect(seen).toEqual({
      method: "POST",
      url: "/render",
      type: "text/html; charset=utf-8",
      length: "11",
      body: "<h1>hi</h1>",
    });
  });

  it("tolerates a trailing slash on the configured URL", async () => {
    const paths: string[] = [];
    const url = await stub((req, _b, res) => {
      paths.push(req.url!);
      res.writeHead(200).end("x");
    });
    await new HttpThumbnailRenderer(`${url}/`).render(enc("<p>"));
    expect(paths).toEqual(["/render"]);
  });

  it.each([422, 413])("maps %i to a render failure, not an unavailable renderer", async (status) => {
    const url = await stub((_r, _b, res) => res.writeHead(status).end());
    const err = await new HttpThumbnailRenderer(url).render(enc("<p>")).catch((e) => e);
    expect(err).toBeInstanceOf(ThumbnailRenderFailed);
    expect(err).not.toBeInstanceOf(ThumbnailRendererUnavailable);
  });

  it("retries a 503, honouring Retry-After, until the renderer answers", async () => {
    let calls = 0;
    const url = await stub((_r, _b, res) => {
      calls++;
      if (calls <= 2) res.writeHead(503, { "retry-after": "3" }).end();
      else res.writeHead(200).end("image");
    });
    const clock = fakeClock();

    const image = await new HttpThumbnailRenderer(url, clock).render(enc("<p>"));

    expect(dec(image)).toBe("image");
    expect(calls).toBe(3);
    expect(clock.slept).toEqual([3000, 3000]);
  });

  it("retries a connection reset", async () => {
    let calls = 0;
    const url = await stub((req, _b, res) => {
      calls++;
      if (calls === 1) req.socket.destroy();
      else res.writeHead(200).end("image");
    });

    const image = await new HttpThumbnailRenderer(url, fakeClock()).render(enc("<p>"));

    expect(dec(image)).toBe("image");
    expect(calls).toBe(2);
  });

  it("gives up as unavailable once connections are refused past the 60 s budget", async () => {
    const clock = fakeClock();

    const err = await new HttpThumbnailRenderer(await refusedUrl(), clock)
      .render(enc("<p>"))
      .catch((e) => e);

    expect(err).toBeInstanceOf(ThumbnailRendererUnavailable);
    const total = clock.slept.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(60_000);
    expect(total).toBeLessThan(61_000);
  });

  it("gives up as unavailable when the renderer keeps answering 503 past the budget", async () => {
    const url = await stub((_r, _b, res) => res.writeHead(503, { "retry-after": "10" }).end());
    const clock = fakeClock();

    const err = await new HttpThumbnailRenderer(url, clock).render(enc("<p>")).catch((e) => e);

    expect(err).toBeInstanceOf(ThumbnailRendererUnavailable);
    expect(clock.now()).toBeLessThanOrEqual(60_000);
  });

  it("maps no response within the request timeout to a render failure", async () => {
    const url = await stub(() => {
      /* never answers */
    });

    const err = await new HttpThumbnailRenderer(url, { timeoutMs: 100 })
      .render(enc("<p>"))
      .catch((e) => e);

    expect(err).toBeInstanceOf(ThumbnailRenderFailed);
    expect(String(err.message)).toMatch(/timed out/);
  });

  it("defaults to a 30 s request timeout and a 60 s retry budget", () => {
    const r = new HttpThumbnailRenderer("http://renderer:3001");
    expect(r.timeoutMs).toBe(30_000);
    expect(r.retryBudgetMs).toBe(60_000);
  });
});
