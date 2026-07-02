import { beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer, type McpToolDeps } from "./server";
import { InMemoryArtefactRepository } from "../../domain/artefact/in-memory-artefact-repository";
import { InMemoryCollectionRepository } from "../../domain/collection/in-memory-collection-repository";
import { SINGLETON_SCOPE } from "../../domain/artefact/tenant-scope";
import { InMemoryDataRepository } from "../../domain/data/in-memory-data-repository";
import { upsertDataEntry } from "../../domain/data/data-entry";
import type { PayloadStore, StoredPayload } from "../../domain/artefact/ports";

// S18 — the MCP tool surface, exercised through a real in-memory MCP
// client↔server pair (so the protocol dispatch + zod validation run), against
// in-memory domain repos. Proves each tool wraps the right command AND that
// authority is the token's `userId` (the same commands the BFF uses).

class FakePayloadStore implements PayloadStore {
  readonly live = new Map<string, Uint8Array>();
  private seq = 0;
  async put(content: Uint8Array): Promise<StoredPayload> {
    const ref = `ref-${++this.seq}`;
    this.live.set(ref, content);
    return { ref, bytes: content.byteLength, hash: `hash-${ref}` };
  }
  async get(ref: string): Promise<Uint8Array> {
    const f = this.live.get(ref);
    if (!f) throw new Error("not found");
    return f;
  }
  async delete(ref: string): Promise<void> {
    this.live.delete(ref);
  }
}

interface ToolResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

describe("MCP artefact tools (S18)", () => {
  let deps: McpToolDeps;

  beforeEach(() => {
    deps = {
      repo: new InMemoryArtefactRepository(),
      collectionRepo: new InMemoryCollectionRepository(),
      payloadStore: new FakePayloadStore(),
      dataRepo: new InMemoryDataRepository(),
    };
  });

  // A connected MCP client acting as `userId` against the shared deps.
  async function clientFor(userId: string): Promise<Client> {
    const server = buildMcpServer(userId, deps, SINGLETON_SCOPE);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientT);
    return client;
  }

  async function call(
    client: Client,
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    return (await client.callTool({ name, arguments: args })) as ToolResult;
  }

  const json = (r: ToolResult) => JSON.parse(r.content[0]!.text);

  it("advertises the full tool set", async () => {
    const client = await clientFor("u1");
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "archive_artefact",
        "create_artefact",
        "get_artefact",
        "get_authoring_guide",
        "list_artefacts",
        "restore_artefact",
        "set_visibility",
        "update_artefact",
      ].sort(),
    );
  });

  it("advertises the persistence contract as server instructions", async () => {
    const client = await clientFor("u1");
    const instructions = client.getInstructions();
    expect(instructions).toBeTruthy();
    expect(instructions).toMatch(/localStorage/);
    expect(instructions).toMatch(/get_authoring_guide/);
  });

  it("get_authoring_guide returns the full skill body", async () => {
    const client = await clientFor("u1");
    const r = await call(client, "get_authoring_guide", {});
    expect(r.isError).toBeFalsy();
    const text = r.content[0]!.text;
    // The frontmatter is stripped; the body's heading and the persistence
    // section come through.
    expect(text.startsWith("---")).toBe(false);
    expect(text).toMatch(/# Building and publishing artefacts for Artefactor/);
    expect(text).toMatch(/Persisting data \(localStorage\)/);
  });

  it("create_artefact creates a private artefact owned by the caller", async () => {
    const client = await clientFor("u1");
    const r = json(
      await call(client, "create_artefact", {
        title: "My deck",
        kind: "slide-deck",
        html: "<!doctype html><h1>hi</h1>",
      }),
    );
    expect(r).toMatchObject({
      ownerId: "u1",
      title: "My deck",
      kind: "slide-deck",
      visibility: "private",
      status: "active",
      url: null,
    });
    expect(typeof r.id).toBe("string");
  });

  it("create_artefact can publish at a shareable tier (mints slug + url)", async () => {
    const client = await clientFor("u1");
    const r = json(
      await call(client, "create_artefact", {
        title: "Public form",
        kind: "form",
        html: "<h1>f</h1>",
        visibility: "public",
      }),
    );
    expect(r.visibility).toBe("public");
    expect(r.publicSlug).toBeTruthy();
    expect(r.url).toBe(`http://localhost:3000/a/${r.publicSlug}`);
  });

  it("update_artefact replaces fields on the caller's artefact", async () => {
    const client = await clientFor("u1");
    const created = json(
      await call(client, "create_artefact", {
        title: "Old",
        kind: "other",
        html: "<h1>1</h1>",
      }),
    );
    const updated = json(
      await call(client, "update_artefact", { id: created.id, title: "New" }),
    );
    expect(updated.title).toBe("New");
  });

  it("list_artefacts lists the caller's own, newest first, archived opt-in", async () => {
    const client = await clientFor("u1");
    const a = json(
      await call(client, "create_artefact", { title: "A", kind: "other", html: "<i>a</i>" }),
    );
    const b = json(
      await call(client, "create_artefact", { title: "B", kind: "other", html: "<i>b</i>" }),
    );
    await call(client, "archive_artefact", { id: a.id });

    const active = json(await call(client, "list_artefacts", {}));
    expect(active.artefacts.map((x: { id: string }) => x.id)).toEqual([b.id]);

    const all = json(await call(client, "list_artefacts", { include_archived: true }));
    expect(all.artefacts.map((x: { id: string }) => x.id).sort()).toEqual(
      [a.id, b.id].sort(),
    );
  });

  it("archive then restore round-trips", async () => {
    const client = await clientFor("u1");
    const a = json(
      await call(client, "create_artefact", { title: "A", kind: "other", html: "<i>a</i>" }),
    );
    expect(json(await call(client, "archive_artefact", { id: a.id })).status).toBe(
      "archived",
    );
    expect(json(await call(client, "restore_artefact", { id: a.id })).status).toBe(
      "active",
    );
  });

  it("reports dataAuthorCount so a breaking update can be flagged", async () => {
    const client = await clientFor("u1");
    const a = json(
      await call(client, "create_artefact", { title: "Form", kind: "form", html: "<i>f</i>" }),
    );
    // No saved data yet.
    expect(json(await call(client, "get_artefact", { id: a.id })).dataAuthorCount).toBe(0);

    // Two users save data (the opaque blobs the running artefact persists).
    await deps.dataRepo.save(
      upsertDataEntry({ id: "d1", artefactId: a.id, authorId: "u1", blob: "{}" }),
    );
    await deps.dataRepo.save(
      upsertDataEntry({ id: "d2", artefactId: a.id, authorId: "u2", blob: "{}" }),
    );

    expect(json(await call(client, "get_artefact", { id: a.id })).dataAuthorCount).toBe(2);
    // update_artefact carries the same signal in its result.
    const updated = json(
      await call(client, "update_artefact", { id: a.id, title: "Form v2" }),
    );
    expect(updated.dataAuthorCount).toBe(2);
  });

  it("attributes authority to the token's user — cannot touch another user's artefact", async () => {
    const u1 = await clientFor("u1");
    const a = json(
      await call(u1, "create_artefact", { title: "Mine", kind: "other", html: "<i>m</i>" }),
    );

    const u2 = await clientFor("u2");
    const got = await call(u2, "get_artefact", { id: a.id });
    expect(got.isError).toBe(true);

    const upd = await call(u2, "update_artefact", { id: a.id, title: "Hijacked" });
    expect(upd.isError).toBe(true);

    // u2 sees none of u1's artefacts.
    expect(json(await call(u2, "list_artefacts", {})).artefacts).toEqual([]);
  });

  it("returns an error result (not a crash) for an unknown artefact", async () => {
    const client = await clientFor("u1");
    const r = await call(client, "get_artefact", { id: "does-not-exist" });
    expect(r.isError).toBe(true);
  });
});
