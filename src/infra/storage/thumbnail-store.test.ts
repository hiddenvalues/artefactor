import { mkdtempSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { FilesystemThumbnailStore } from "./thumbnail-store";

// S35 (AH26) — thumbnails on the filesystem, one WebP per (artefact, payload hash).
describe("FilesystemThumbnailStore (S35)", () => {
  let root: string;
  let store: FilesystemThumbnailStore;
  const bytes = (s: string) => new TextEncoder().encode(s);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "artefactor-thumbs-"));
    store = new FilesystemThumbnailStore(root);
  });

  it("stores a render at <root>/<artefactId>/<payloadHash>.webp and reads it back", async () => {
    await store.put("art-1", "h1", bytes("webp-1"));
    expect(await readdir(join(root, "art-1"))).toEqual(["h1.webp"]);
    expect(new TextDecoder().decode((await store.get("art-1", "h1"))!)).toBe("webp-1");
  });

  it("returns null for a render that was never stored", async () => {
    expect(await store.get("art-1", "nope")).toBeNull();
    expect(await store.get("unknown", "nope")).toBeNull();
  });

  it("deletes one render", async () => {
    await store.put("art-1", "h1", bytes("1"));
    await store.put("art-1", "h2", bytes("2"));
    await store.delete("art-1", "h1");
    expect(await store.get("art-1", "h1")).toBeNull();
    expect(await store.get("art-1", "h2")).not.toBeNull();
  });

  it("deletes every render of an artefact except the kept hash, leaving others' alone", async () => {
    await store.put("art-1", "h1", bytes("1"));
    await store.put("art-1", "h2", bytes("2"));
    await store.put("art-1", "h3", bytes("3"));
    await store.put("art-2", "h1", bytes("other"));

    await store.deleteAllExcept("art-1", "h3");

    expect(await readdir(join(root, "art-1"))).toEqual(["h3.webp"]);
    expect(await store.get("art-2", "h1")).not.toBeNull();
  });

  it("deletes every render of an artefact, and tolerates one that has none", async () => {
    await store.put("art-1", "h1", bytes("1"));
    await store.deleteAll("art-1");
    await store.deleteAll("never-rendered");
    expect(await readdir(root)).toEqual([]);
  });

  it("refuses path segments that could escape the root", async () => {
    await expect(store.put("../evil", "h1", bytes("x"))).rejects.toThrow();
    await expect(store.get("art-1", "../../etc/passwd")).rejects.toThrow();
  });
});
