import { ThumbnailRendererUnavailable } from "../../domain/artefact/errors";
import type { ThumbnailRenderer } from "../../domain/artefact/ports";

// S37 — a render the renderer tried and could not produce (it answered 413 or
// 422, or never answered in time). The service remembers the hash as failed.
export class ThumbnailRenderFailed extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ThumbnailRenderFailed";
  }
}

export interface HttpThumbnailRendererOptions {
  // One request's cap, from sending the payload to the last image byte.
  timeoutMs?: number;
  // How long refused/reset connections and 503s are retried before the renderer
  // counts as unavailable.
  retryBudgetMs?: number;
  // The pause between retries when the renderer names none (`Retry-After`).
  retryDelayMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

// Thrown inside `attempt` for an answer worth retrying.
class Retry {
  constructor(
    readonly reason: string,
    readonly afterMs: number | null,
  ) {}
}

// S37 (AH29) — the app's side of the isolated renderer: the stored payload bytes
// go out, WebP bytes come back, and nothing else crosses — no bootstrap, shell,
// data or identity (AH26). The renderer is disposable (one job per container),
// so a refused or reset connection or a 503 is the normal gap between two of its
// lives and is retried; only a renderer that stays away past the budget is
// unavailable (AH25's missing path).
export class HttpThumbnailRenderer implements ThumbnailRenderer {
  readonly url: string;
  readonly timeoutMs: number;
  readonly retryBudgetMs: number;
  private readonly retryDelayMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(url: string, options: HttpThumbnailRendererOptions = {}) {
    this.url = url;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retryBudgetMs = options.retryBudgetMs ?? 60_000;
    this.retryDelayMs = options.retryDelayMs ?? 500;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async render(html: Uint8Array): Promise<Uint8Array> {
    const deadline = this.now() + this.retryBudgetMs;
    for (;;) {
      const outcome = await this.attempt(html);
      if (!(outcome instanceof Retry)) return outcome;
      const remaining = deadline - this.now();
      if (remaining <= 0) {
        throw new ThumbnailRendererUnavailable(
          `thumbnail renderer at ${this.url} unavailable for ${this.retryBudgetMs} ms (${outcome.reason})`,
        );
      }
      await this.sleep(Math.min(outcome.afterMs ?? this.retryDelayMs, remaining));
    }
  }

  private async attempt(html: Uint8Array): Promise<Uint8Array | Retry> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    try {
      const res = await fetch(new URL("render", this.url.endsWith("/") ? this.url : `${this.url}/`), {
        method: "POST",
        headers: { "content-type": "text/html; charset=utf-8" },
        // The bytes as they are stored; `fetch`'s BodyInit wants a view over a
        // plain ArrayBuffer, which the payload store always gives us.
        body: html as Uint8Array<ArrayBuffer>,
        signal: abort.signal,
      });
      if (res.status === 200) return new Uint8Array(await res.arrayBuffer());
      await res.body?.cancel();
      if (res.status === 503) return new Retry("503", retryAfterMs(res.headers.get("retry-after")));
      throw new ThumbnailRenderFailed(`thumbnail renderer answered ${res.status}`);
    } catch (err) {
      if (err instanceof ThumbnailRenderFailed) throw err;
      if (abort.signal.aborted) {
        throw new ThumbnailRenderFailed(`thumbnail render timed out after ${this.timeoutMs} ms`, {
          cause: err,
        });
      }
      // fetch rejects with a TypeError for a refused, reset or dropped connection.
      if (err instanceof TypeError) return new Retry(connectionCode(err), null);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

function retryAfterMs(header: string | null): number | null {
  const seconds = header === null ? NaN : Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

function connectionCode(err: TypeError): string {
  const cause = err.cause as { code?: string } | undefined;
  return cause?.code ?? err.message;
}
