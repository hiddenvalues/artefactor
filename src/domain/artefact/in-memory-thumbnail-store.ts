import type { ThumbnailStore } from "./ports";

// In-memory implementation of the ThumbnailStore port — the TDD double for the
// S35 thumbnail commands and service. `files` is keyed `<artefactId>/<hash>`.
export class InMemoryThumbnailStore implements ThumbnailStore {
  readonly files = new Map<string, Uint8Array>();

  async put(artefactId: string, payloadHash: string, bytes: Uint8Array): Promise<void> {
    this.files.set(`${artefactId}/${payloadHash}`, bytes);
  }

  async get(artefactId: string, payloadHash: string): Promise<Uint8Array | null> {
    return this.files.get(`${artefactId}/${payloadHash}`) ?? null;
  }

  async delete(artefactId: string, payloadHash: string): Promise<void> {
    this.files.delete(`${artefactId}/${payloadHash}`);
  }

  async deleteAllExcept(artefactId: string, keepHash: string): Promise<void> {
    for (const key of [...this.files.keys()]) {
      if (key.startsWith(`${artefactId}/`) && key !== `${artefactId}/${keepHash}`) {
        this.files.delete(key);
      }
    }
  }

  async deleteAll(artefactId: string): Promise<void> {
    for (const key of [...this.files.keys()]) {
      if (key.startsWith(`${artefactId}/`)) this.files.delete(key);
    }
  }

  // The stored hashes for one artefact, sorted — for assertions.
  hashesOf(artefactId: string): string[] {
    return [...this.files.keys()]
      .filter((k) => k.startsWith(`${artefactId}/`))
      .map((k) => k.slice(artefactId.length + 1))
      .sort();
  }
}
