import type { Artefact } from "../../domain/artefact/artefact";
import type {
  ArtefactRepository,
  ThumbnailJob,
} from "../../domain/artefact/artefact-repository";
import { ThumbnailRendererUnavailable } from "../../domain/artefact/errors";
import type {
  PayloadStore,
  ThumbnailRenderer,
  ThumbnailStore,
} from "../../domain/artefact/ports";

// S35 — what the create / edit commands hand a render to. Synchronous and never
// throwing, so a thumbnail can never block or fail the command (AH25). A durable
// queue (e.g. pg-boss) would keep this interface.
export interface ThumbnailQueue {
  enqueue(job: ThumbnailJob): void;
}

export function thumbnailJobOf(a: Artefact): ThumbnailJob {
  return {
    id: a.id,
    payloadRef: a.payloadRef,
    payloadHash: a.payloadHash,
    thumbnailHash: a.thumbnailHash,
  };
}

// Called by the commands after a successful save. Swallows anything a queue
// implementation might throw despite its contract (AH25).
export function enqueueThumbnail(queue: ThumbnailQueue | undefined, a: Artefact): void {
  try {
    queue?.enqueue(thumbnailJobOf(a));
  } catch {
    // A thumbnail is derived chrome; the command's result stands.
  }
}

export interface ThumbnailServiceDeps {
  repo: Pick<ArtefactRepository, "recordThumbnail" | "listNeedingThumbnail">;
  payloadStore: PayloadStore;
  thumbnailStore: ThumbnailStore;
  // null = thumbnails disabled (`ARTEFACTOR_THUMBNAILS=off`): placeholders only.
  renderer: ThumbnailRenderer | null;
  log?: (message: string, err?: unknown) => void;
  // Rows per sweep read (the startup backfill pages through them).
  sweepPageSize?: number;
}

const defaultLog = (message: string, err?: unknown) =>
  err === undefined
    ? console.log(`[thumbnails] ${message}`)
    : console.warn(`[thumbnails] ${message}`, err);

// S35 (AH25/AH26) — the in-process thumbnail queue and its single worker
// (concurrency 1). There is no job table: `start()` sweeps for artefacts whose
// thumbnail is missing or stale, which both backfills and recovers whatever a
// crash or restart dropped.
export class ThumbnailService implements ThumbnailQueue {
  // Queued jobs by artefact id; re-enqueueing replaces the job (latest wins).
  private readonly pending = new Map<string, ThumbnailJob>();
  // Payload hashes whose render failed in this process — never retried here.
  private readonly failed = new Set<string>();
  private running: Promise<void> | null = null;
  private disabled: boolean;
  private readonly log: (message: string, err?: unknown) => void;
  private readonly sweepPageSize: number;

  constructor(private readonly deps: ThumbnailServiceDeps) {
    this.disabled = deps.renderer === null;
    this.log = deps.log ?? defaultLog;
    this.sweepPageSize = deps.sweepPageSize ?? 100;
  }

  enqueue(job: ThumbnailJob): void {
    try {
      if (this.disabled) return;
      this.pending.delete(job.id);
      this.pending.set(job.id, job);
      this.kick();
    } catch (err) {
      this.log("could not enqueue a thumbnail job", err);
    }
  }

  // Resolves once the queue is empty and the worker has stopped.
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  // The startup sweep: enqueue every active artefact whose thumbnail is missing
  // or stale, page by page, until a read offers nothing not already attempted.
  async start(): Promise<void> {
    if (this.disabled) {
      this.log("thumbnail renderer disabled — cards show the kind placeholder");
      return;
    }
    const attempted = new Set<string>();
    try {
      while (!this.disabled) {
        // Rows that stay stale (a failed or discarded render) keep reappearing
        // at the head of the read, so read past everything already attempted.
        const rows = await this.deps.repo.listNeedingThumbnail(
          this.sweepPageSize + attempted.size,
        );
        const fresh = rows.filter((r) => !attempted.has(`${r.id}:${r.payloadHash}`));
        if (fresh.length === 0) break;
        for (const job of fresh) {
          attempted.add(`${job.id}:${job.payloadHash}`);
          this.enqueue(job);
        }
        await this.idle();
      }
    } catch (err) {
      this.log("thumbnail sweep failed", err);
    }
  }

  private kick(): void {
    if (this.running || this.pending.size === 0) return;
    this.running = this.work().finally(() => {
      this.running = null;
      // A job enqueued while the loop was finishing must not be stranded.
      this.kick();
    });
  }

  private async work(): Promise<void> {
    for (;;) {
      const next = this.pending.values().next();
      if (next.done) return;
      this.pending.delete(next.value.id);
      await this.process(next.value);
    }
  }

  private async process(job: ThumbnailJob): Promise<void> {
    const { renderer, payloadStore, thumbnailStore, repo } = this.deps;
    if (this.disabled || !renderer) return;
    if (job.thumbnailHash === job.payloadHash) return;
    if (this.failed.has(job.payloadHash)) return;

    let html: Uint8Array;
    try {
      html = await payloadStore.get(job.payloadRef);
    } catch {
      return; // the payload was replaced or the artefact deleted: superseded
    }

    let image: Uint8Array;
    try {
      image = await renderer.render(html);
    } catch (err) {
      if (err instanceof ThumbnailRendererUnavailable) {
        this.disabled = true;
        this.pending.clear();
        this.log("thumbnail renderer unavailable — cards show the kind placeholder", err);
        return;
      }
      this.failed.add(job.payloadHash);
      this.log(`thumbnail render failed for artefact ${job.id}`, err);
      return;
    }

    try {
      await thumbnailStore.put(job.id, job.payloadHash, image);
      // AH26 — recorded only while the payload is still the one rendered.
      if (!(await repo.recordThumbnail(job.id, job.payloadHash))) {
        await thumbnailStore.delete(job.id, job.payloadHash);
        return;
      }
      await thumbnailStore.deleteAllExcept(job.id, job.payloadHash);
    } catch (err) {
      this.log(`could not store the thumbnail for artefact ${job.id}`, err);
    }
  }
}
