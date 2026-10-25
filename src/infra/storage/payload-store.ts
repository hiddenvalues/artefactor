import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  PayloadStore,
  StoredPayload,
} from "../../domain/artefact/ports";

// Filesystem-backed payload store. Trusted HTML payloads (≤ 100 MB) are written
// as opaque files named by a generated ref; the artefact row keeps ref+bytes+hash.
// r[impl hosting.payload.on-filesystem]
export class FilesystemPayloadStore implements PayloadStore {
  constructor(private readonly root: string) {}

  // Every put mints a fresh ref, identical bytes included: no two artefacts share a file.
  // r[impl hosting.payload.ref-owned-by-one-artefact]
  async put(content: Uint8Array): Promise<StoredPayload> {
    await mkdir(this.root, { recursive: true });
    const ref = randomUUID();
    const hash = createHash("sha256").update(content).digest("hex");
    await writeFile(join(this.root, ref), content);
    return { ref, bytes: content.byteLength, hash };
  }

  async get(ref: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(join(this.root, ref)));
  }

  async delete(ref: string): Promise<void> {
    await rm(join(this.root, ref), { force: true });
  }
}
