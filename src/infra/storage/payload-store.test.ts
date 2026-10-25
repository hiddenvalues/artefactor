import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { FilesystemPayloadStore } from "./payload-store";

// S2 — payloads on the filesystem, one file per artefact.
describe("FilesystemPayloadStore (S2)", () => {
  let store: FilesystemPayloadStore;
  const bytes = (s: string) => new TextEncoder().encode(s);

  beforeEach(() => {
    store = new FilesystemPayloadStore(mkdtempSync(join(tmpdir(), "artefactor-payloads-")));
  });

  // r[verify hosting.payload.ref-owned-by-one-artefact]
  it("stores identical bytes under two refs, so deleting one leaves the other", async () => {
    const first = await store.put(bytes("<p>same</p>"));
    const second = await store.put(bytes("<p>same</p>"));
    expect(second.ref).not.toBe(first.ref);
    expect(second.hash).toBe(first.hash);

    await store.delete(first.ref);
    expect(new TextDecoder().decode(await store.get(second.ref))).toBe("<p>same</p>");
  });
});
