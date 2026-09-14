import { mkdir, readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ThumbnailStore } from "../../domain/artefact/ports";

// Ids and hashes are uuids / hex digests; anything else is refused so a segment
// can never climb out of the root.
const SEGMENT = /^[A-Za-z0-9_-]+$/;

function segment(value: string): string {
  if (!SEGMENT.test(value)) throw new Error(`invalid thumbnail path segment: ${value}`);
  return value;
}

// S35 (AH26) — filesystem thumbnails at `<root>/<artefactId>/<payloadHash>.webp`.
// The root is a sibling of the payload root, never inside it, so a payload
// retention policy (S19b) never has to tell the two apart.
export class FilesystemThumbnailStore implements ThumbnailStore {
  constructor(private readonly root: string) {}

  async put(artefactId: string, payloadHash: string, bytes: Uint8Array): Promise<void> {
    const dir = join(this.root, segment(artefactId));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${segment(payloadHash)}.webp`), bytes);
  }

  async get(artefactId: string, payloadHash: string): Promise<Uint8Array | null> {
    const file = join(this.root, segment(artefactId), `${segment(payloadHash)}.webp`);
    try {
      return new Uint8Array(await readFile(file));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(artefactId: string, payloadHash: string): Promise<void> {
    await rm(join(this.root, segment(artefactId), `${segment(payloadHash)}.webp`), {
      force: true,
    });
    await this.removeDirIfEmpty(artefactId);
  }

  async deleteAllExcept(artefactId: string, keepHash: string): Promise<void> {
    const dir = join(this.root, segment(artefactId));
    const keep = `${segment(keepHash)}.webp`;
    for (const name of await this.list(dir)) {
      if (name !== keep) await rm(join(dir, name), { force: true });
    }
  }

  async deleteAll(artefactId: string): Promise<void> {
    await rm(join(this.root, segment(artefactId)), { recursive: true, force: true });
  }

  private async list(dir: string): Promise<string[]> {
    try {
      return await readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  // A render whose record lost may have been the directory's only file — e.g.
  // the artefact was deleted mid-render — so don't leave an empty folder behind.
  // `rmdir` only removes an empty directory, so a render landing meanwhile is kept.
  private async removeDirIfEmpty(artefactId: string): Promise<void> {
    await rmdir(join(this.root, segment(artefactId))).catch(() => {});
  }
}
