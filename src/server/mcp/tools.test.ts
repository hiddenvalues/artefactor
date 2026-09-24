import { beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer, type McpToolDeps } from "./server";
import { MAX_MCP_BLOB_BYTES, MAX_MCP_HTML_BYTES } from "./tools";
import { InMemoryArtefactRepository } from "../../domain/artefact/in-memory-artefact-repository";
import { InMemoryCollectionRepository } from "../../domain/collection/in-memory-collection-repository";
import { SINGLETON_SCOPE, type TenantScope } from "../../domain/artefact/tenant-scope";
import { InMemoryDataRepository } from "../../domain/data/in-memory-data-repository";
import { MAX_BLOB_BYTES, upsertDataEntry } from "../../domain/data/data-entry";
import { renderServedArtefact } from "../runtime/render";
import { putOwnDataEntry } from "../data/own-data.command";
import type { PayloadStore, StoredPayload } from "../../domain/artefact/ports";
import type { UserDirectory, UserIdentity } from "../data/user-directory";

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

// A fixed directory of display identities; ids missing from it resolve to
// nothing, as an unknown BetterAuth user does.
class FakeUserDirectory implements UserDirectory {
  constructor(readonly users: Record<string, UserIdentity> = {}) {}
  async lookup(ids: string[]): Promise<Map<string, UserIdentity>> {
    return new Map(
      ids.flatMap((id) => (this.users[id] ? [[id, this.users[id]!] as const] : [])),
    );
  }
  async search() {
    return [];
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
      userDirectory: new FakeUserDirectory({
        u1: { name: "Owner One", email: "owner@example.com" },
        u2: { name: "Ada Two", email: "Ada@Example.com" },
        // Registered, but never holds an entry in these tests.
        u4: { name: "No Data", email: "nodata@example.com" },
      }),
    };
  });

  // A connected MCP client acting as `userId` against the shared deps.
  async function clientFor(
    userId: string,
    scope: TenantScope = SINGLETON_SCOPE,
  ): Promise<Client> {
    const server = buildMcpServer(userId, deps, scope);
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
        "get_artefact_data",
        "get_artefact_html",
        "get_authoring_guide",
        "list_artefact_data_authors",
        "list_artefacts",
        "restore_artefact",
        "set_artefact_data",
        "set_data_visibility",
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
    // S31 — the write doctrine is ambient too, not only in the full guide.
    expect(instructions).toMatch(/set_artefact_data/);
    expect(instructions).toMatch(/if_unmodified_since/);
    // S40 — and so is the owner's read of everyone's data.
    expect(instructions).toMatch(/list_artefact_data_authors/);
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
    // S40 — the owner's read of other users' data is part of the manual.
    expect(text).toMatch(/Reading other users' data \(owner only\)/);
  });

  // S36 — the sandboxed frame makes the other browser stores throw, so the
  // guide and the ambient instructions both say so, in the same words.
  it("warns, in both the instructions and the guide, that other browser storage throws in the sandbox", async () => {
    const STORAGE =
      "sessionStorage, IndexedDB and cookies are never saved, and in Artefactor's sandboxed frame they throw. Don't use them, even for temporary state; keep temporary state in memory.";
    const client = await clientFor("u1");
    const guide = (await call(client, "get_authoring_guide", {})).content[0]!.text;
    for (const text of [client.getInstructions()!, guide]) {
      expect(text.replace(/\s+/g, " ")).toContain(STORAGE);
      for (const lib of ["Dexie", "localForage", "idb-keyval", "y-indexeddb"]) {
        expect(text).toContain(lib);
      }
      expect(text).toMatch(/target="_blank"/);
    }
  });

  describe("thumbnails (S35)", () => {
    function withQueue() {
      const jobs: { id: string; payloadHash: string }[] = [];
      deps = { ...deps, thumbnails: { enqueue: (job) => jobs.push(job) } };
      return jobs;
    }

    it("create_artefact enqueues one render with the stored hash and reports no thumbnail yet", async () => {
      const jobs = withQueue();
      const client = await clientFor("u1");
      const r = json(
        await call(client, "create_artefact", { title: "T", kind: "prototype", html: "<h1>hi</h1>" }),
      );
      const stored = await deps.repo.findById(r.id, SINGLETON_SCOPE);
      expect(jobs).toEqual([expect.objectContaining({ id: r.id, payloadHash: stored!.payloadHash })]);
      expect(r.thumbnailUrl).toBeNull();
    });

    it("update_artefact enqueues on an HTML replace, and not for a title-only change", async () => {
      const jobs = withQueue();
      const client = await clientFor("u1");
      const { id } = json(
        await call(client, "create_artefact", { title: "T", kind: "prototype", html: "<h1>v1</h1>" }),
      );
      jobs.length = 0;

      await call(client, "update_artefact", { id, title: "Renamed" });
      expect(jobs).toEqual([]);

      await call(client, "update_artefact", { id, html: "<h1>v2</h1>" });
      const stored = await deps.repo.findById(id, SINGLETON_SCOPE);
      expect(jobs).toEqual([expect.objectContaining({ id, payloadHash: stored!.payloadHash })]);
    });
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

  describe("set_data_visibility (S41)", () => {
    const create = async (client: Client) =>
      json(await call(client, "create_artefact", { title: "S", kind: "form", html: "<i>s</i>" }));

    it("get_artefact and list_artefacts report a new artefact's own-only default", async () => {
      const client = await clientFor("u1");
      const a = await create(client);
      expect(a.dataVisibility).toBe("own");
      expect(json(await call(client, "get_artefact", { id: a.id })).dataVisibility).toBe("own");
      const listed = json(await call(client, "list_artefacts", {}));
      expect(listed.artefacts[0].dataVisibility).toBe("own");
    });

    it("lets the owner flip it", async () => {
      const client = await clientFor("u1");
      const a = await create(client);
      const r = json(
        await call(client, "set_data_visibility", { id: a.id, dataVisibility: "shared" }),
      );
      expect(r.dataVisibility).toBe("shared");
      expect(json(await call(client, "get_artefact", { id: a.id })).dataVisibility).toBe(
        "shared",
      );
    });

    it("is not found for another user's, an unknown, an out-of-scope or an archived artefact", async () => {
      const u1 = await clientFor("u1");
      const a = await create(u1);
      await call(u1, "set_visibility", { id: a.id, visibility: "authenticated" });
      const u2 = await clientFor("u2");
      const u1Elsewhere = await clientFor("u1", { tenantId: "another-tenant" });
      for (const [client, id] of [
        [u2, a.id],
        [u1, "nope"],
        [u1Elsewhere, a.id],
      ] as const) {
        const r = await call(client, "set_data_visibility", { id, dataVisibility: "shared" });
        expect(r.isError).toBe(true);
        expect(r.content[0]!.text).toBe(id);
      }

      await call(u1, "archive_artefact", { id: a.id });
      const archived = await call(u1, "set_data_visibility", {
        id: a.id,
        dataVisibility: "shared",
      });
      expect(archived.isError).toBe(true);
      expect(archived.content[0]!.text).toBe(a.id);
      expect((await deps.repo.findById(a.id, SINGLETON_SCOPE))!.dataVisibility).toBe("own");
    });
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
      upsertDataEntry({ id: "d1", artefactId: a.id, authorId: "u1", blob: "{}", authoredAgainstVersion: null }),
    );
    await deps.dataRepo.save(
      upsertDataEntry({ id: "d2", artefactId: a.id, authorId: "u2", blob: "{}", authoredAgainstVersion: null }),
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
  // ---------------------------------------------------------------- S30 ----
  // Read-back: an agent can pull an artefact's HTML and its own data snapshot,
  // so it can derive a new artefact from an existing one (A) or update one in
  // place after losing the original from context (B) — seeing, for (B), the
  // data shape a breaking HTML change might orphan.

  it("get_artefact_html returns the exact stored HTML with dataAuthorCount", async () => {
    const client = await clientFor("u1");
    const html =
      "<!doctype html><title>Rakna</title><script>localStorage.setItem('k','v')</script>";
    const a = json(
      await call(client, "create_artefact", { title: "Counter", kind: "form", html }),
    );
    await deps.dataRepo.save(
      upsertDataEntry({ id: "d1", artefactId: a.id, authorId: "u2", blob: "{}", authoredAgainstVersion: null }),
    );

    const r = json(await call(client, "get_artefact_html", { id: a.id }));
    expect(r).toEqual({
      id: a.id,
      title: "Counter",
      kind: "form",
      html,
      dataAuthorCount: 1,
    });
  });

  it("get_artefact_html refuses an over-cap payload, naming the real size", async () => {
    const client = await clientFor("u1");
    const html = "<i>" + "a".repeat(MAX_MCP_HTML_BYTES) + "</i>";
    const a = json(
      await call(client, "create_artefact", { title: "Huge", kind: "other", html }),
    );

    const r = await call(client, "get_artefact_html", { id: a.id });
    expect(r.isError).toBe(true);
    // Names the actual size and points at the GUI download — never truncates,
    // since truncated HTML is unusable for editing.
    expect(r.content[0]!.text).toContain(
      String(new TextEncoder().encode(html).byteLength),
    );
    expect(r.content[0]!.text).toMatch(/download/i);
  });

  it("get_artefact_data returns the caller's own blob verbatim", async () => {
    const client = await clientFor("u1");
    const a = json(
      await call(client, "create_artefact", { title: "Tracker", kind: "form", html: "<i>t</i>" }),
    );
    const blob = JSON.stringify({ "habit-tracker-v2": '{"habits":[]}' });
    await deps.dataRepo.save(
      upsertDataEntry({
        id: "d1",
        artefactId: a.id,
        authorId: "u1",
        blob,
        authoredAgainstVersion: null,
        now: new Date("2026-09-12T10:00:00.000Z"),
      }),
    );

    const r = json(await call(client, "get_artefact_data", { id: a.id }));
    expect(r.blob).toBe(blob);
    expect(r.bytes).toBe(new TextEncoder().encode(blob).byteLength);
    expect(r.updatedAt).toBe("2026-09-12T10:00:00.000Z");
    expect(r.dataAuthorCount).toBe(1);
  });

  it("get_artefact_data returns blob: null when the caller has no entry, and never another author's", async () => {
    const client = await clientFor("u1");
    const a = json(
      await call(client, "create_artefact", { title: "Tracker", kind: "form", html: "<i>t</i>" }),
    );
    await deps.dataRepo.save(
      upsertDataEntry({ id: "d1", artefactId: a.id, authorId: "u2", blob: '{"theirs":1}', authoredAgainstVersion: null }),
    );

    const r = json(await call(client, "get_artefact_data", { id: a.id }));
    expect(r.blob).toBeNull();
    expect(r.bytes).toBe(0);
    expect(r.updatedAt).toBeNull();
    // The snapshot is one blob, not the population — the count says others exist.
    expect(r.dataAuthorCount).toBe(1);
    expect(JSON.stringify(r)).not.toContain("theirs");
  });

  it("get_artefact_data refuses an over-cap blob, naming the real size", async () => {
    const client = await clientFor("u1");
    const a = json(
      await call(client, "create_artefact", { title: "Fat", kind: "form", html: "<i>f</i>" }),
    );
    const blob = JSON.stringify({ big: "a".repeat(MAX_MCP_BLOB_BYTES) });
    await deps.dataRepo.save(
      upsertDataEntry({ id: "d1", artefactId: a.id, authorId: "u1", blob, authoredAgainstVersion: null }),
    );

    const r = await call(client, "get_artefact_data", { id: a.id });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain(
      String(new TextEncoder().encode(blob).byteLength),
    );
    expect(r.content[0]!.text).toMatch(/download/i);
  });

  it("get_artefact_data returns the artefact's declared schema as parsed JSON", async () => {
    const client = await clientFor("u1");
    const a = json(
      await call(client, "create_artefact", {
        title: "Habits",
        kind: "form",
        html:
          '<script type="application/artefactor-schema+json">' +
          '{"key":"habit-tracker-v2","version":2,"example":{"habits":[{"id":"h1"}]}}' +
          "</script><h1>habits</h1>",
      }),
    );

    const r = json(await call(client, "get_artefact_data", { id: a.id }));
    // The shape arrives without pulling the whole HTML into context, and it
    // answers the empty-blob case a blob-only read cannot.
    expect(r.schema).toEqual({
      key: "habit-tracker-v2",
      version: 2,
      example: { habits: [{ id: "h1" }] },
    });
  });

  it("get_artefact_data returns schema: null when it is absent or unparseable", async () => {
    const client = await clientFor("u1");
    const none = json(
      await call(client, "create_artefact", { title: "Plain", kind: "form", html: "<i>p</i>" }),
    );
    expect(json(await call(client, "get_artefact_data", { id: none.id })).schema).toBeNull();

    const broken = json(
      await call(client, "create_artefact", {
        title: "Broken",
        kind: "form",
        html: '<script type="application/artefactor-schema+json">{ oops }</script>',
      }),
    );
    const r = await call(client, "get_artefact_data", { id: broken.id });
    // Malformed is never an error — the agent falls back to reading the HTML.
    expect(r.isError).toBeFalsy();
    expect(json(r).schema).toBeNull();
  });

  it("never validates a blob against the declared schema (AD8 opacity)", async () => {
    const client = await clientFor("u1");
    const a = json(
      await call(client, "create_artefact", {
        title: "Habits",
        kind: "form",
        html:
          '<script type="application/artefactor-schema+json">{"key":"habit-tracker-v2","version":2}</script>',
      }),
    );
    // A blob that contradicts the declaration entirely.
    const blob = '{"something-else":"[1,2,3]"}';
    await deps.dataRepo.save(
      upsertDataEntry({ id: "d1", artefactId: a.id, authorId: "u1", blob, authoredAgainstVersion: null }),
    );

    const r = await call(client, "get_artefact_data", { id: a.id });
    expect(r.isError).toBeFalsy();
    expect(json(r).blob).toBe(blob);
  });

  it("get_artefact_data reports the payload version pin (AD9)", async () => {
    const client = await clientFor("u1");
    const a = json(
      await call(client, "create_artefact", { title: "Pinned", kind: "form", html: "<i>p</i>" }),
    );
    const stored = (await deps.repo.findById(a.id, SINGLETON_SCOPE))!;

    // No entry → no pin. The field's presence and shape are unchanged from S30.
    const none = json(await call(client, "get_artefact_data", { id: a.id }));
    expect(none.currentPayloadVersion).toBe(stored.payloadHash);
    expect(none).toHaveProperty("authoredAgainstVersion");
    expect(none.authoredAgainstVersion).toBeNull();

    // A write stamps the live payload hash → pin = current.
    await call(client, "set_artefact_data", { id: a.id, blob: '{"v":"1"}' });
    const fresh = json(await call(client, "get_artefact_data", { id: a.id }));
    expect(fresh.authoredAgainstVersion).toBe(stored.payloadHash);
    expect(fresh.authoredAgainstVersion).toBe(fresh.currentPayloadVersion);

    // The HTML changes under the saved data → pin ≠ current (the staleness signal).
    await call(client, "update_artefact", { id: a.id, html: "<i>p, reshaped</i>" });
    const stale = json(await call(client, "get_artefact_data", { id: a.id }));
    expect(stale.currentPayloadVersion).not.toBe(stored.payloadHash);
    expect(stale.authoredAgainstVersion).toBe(stored.payloadHash);
  });

  it("an entry predating the pin reads authoredAgainstVersion null, never an error (AD9)", async () => {
    const client = await clientFor("u1");
    const a = json(
      await call(client, "create_artefact", { title: "Legacy", kind: "form", html: "<i>l</i>" }),
    );
    await deps.dataRepo.save(
      upsertDataEntry({ id: "d1", artefactId: a.id, authorId: "u1", blob: "{}", authoredAgainstVersion: null }),
    );
    const r = await call(client, "get_artefact_data", { id: a.id });
    expect(r.isError).toBeFalsy();
    expect(json(r).blob).toBe("{}");
    expect(json(r).authoredAgainstVersion).toBeNull();
  });

  it("set_artefact_data stamps the pin exactly as PUT …/data/me does (AD9)", async () => {
    const client = await clientFor("u1");
    const a = json(
      await call(client, "create_artefact", { title: "Same path", kind: "form", html: "<i>s</i>" }),
    );
    const stored = (await deps.repo.findById(a.id, SINGLETON_SCOPE))!;
    await call(client, "set_artefact_data", { id: a.id, blob: '{"via":"agent"}' });
    const viaTool = (await deps.dataRepo.findByArtefactAndAuthor(a.id, "u1"))!;

    // The `PUT …/data/me` route's write, which is this command.
    await putOwnDataEntry(
      { ref: a.id, authorId: "u1", scope: SINGLETON_SCOPE },
      '{"via":"http"}',
      { artefactRepo: deps.repo, collectionRepo: deps.collectionRepo, dataRepo: deps.dataRepo },
    );
    const viaCommand = (await deps.dataRepo.findByArtefactAndAuthor(a.id, "u1"))!;

    expect(viaTool.authoredAgainstVersion).toBe(stored.payloadHash);
    expect(viaCommand.authoredAgainstVersion).toBe(viaTool.authoredAgainstVersion);
  });

  it("both read-back tools are owner-scoped: unknown, another user's, and archived all -> not found", async () => {
    const u1 = await clientFor("u1");
    const a = json(
      await call(u1, "create_artefact", { title: "Mine", kind: "other", html: "<i>m</i>" }),
    );

    const u2 = await clientFor("u2");
    expect((await call(u2, "get_artefact_html", { id: a.id })).isError).toBe(true);
    expect((await call(u2, "get_artefact_data", { id: a.id })).isError).toBe(true);

    expect((await call(u1, "get_artefact_html", { id: "nope" })).isError).toBe(true);
    expect((await call(u1, "get_artefact_data", { id: "nope" })).isError).toBe(true);

    await call(u1, "archive_artefact", { id: a.id });
    expect((await call(u1, "get_artefact_html", { id: a.id })).isError).toBe(true);
    expect((await call(u1, "get_artefact_data", { id: a.id })).isError).toBe(true);
  });

  // S31 — the agent writes the caller's own blob: whole-blob replacement through
  // the same `putOwnDataEntry` the BFF uses, optionally pinned against the
  // `updatedAt` it read.
  describe("set_artefact_data (S31)", () => {
    const PAST = new Date("2026-01-01T00:00:00.000Z");

    async function mine(client: Client, html = "<i>t</i>") {
      return json(
        await call(client, "create_artefact", { title: "Tracker", kind: "form", html }),
      );
    }

    it("states whole-blob replacement outright in its description", async () => {
      const client = await clientFor("u1");
      const tool = (await client.listTools()).tools.find(
        (t) => t.name === "set_artefact_data",
      );
      expect(tool?.description).toMatch(/whole|entire|full/i);
      expect(tool?.description).toMatch(/not a (patch|merge)|no merge|not merged/i);
    });

    it("round-trips: get → set → re-read returns the new blob verbatim, preserving identity (AD1)", async () => {
      const client = await clientFor("u1");
      const a = await mine(client);
      await deps.dataRepo.save(
        upsertDataEntry({ id: "d1", artefactId: a.id, authorId: "u1", blob: '{"k":"old"}', authoredAgainstVersion: null, now: PAST }),
      );

      const read = json(await call(client, "get_artefact_data", { id: a.id }));
      // Deliberately odd spacing — the blob must come back byte-for-byte.
      const next = '{ "k" : "new",  "n":[1,2] }';
      const r = await call(client, "set_artefact_data", {
        id: a.id,
        blob: next,
        if_unmodified_since: read.updatedAt,
      });
      expect(r.isError).toBeFalsy();
      const saved = json(r);
      expect(saved.id).toBe(a.id);
      expect(saved.bytes).toBe(new TextEncoder().encode(next).byteLength);
      expect(new Date(saved.updatedAt).getTime()).toBeGreaterThan(PAST.getTime());

      const again = json(await call(client, "get_artefact_data", { id: a.id }));
      expect(again.blob).toBe(next);
      expect(again.updatedAt).toBe(saved.updatedAt);
      const entry = await deps.dataRepo.findByArtefactAndAuthor(a.id, "u1");
      expect(entry?.id).toBe("d1");
      expect(entry?.createdAt).toEqual(PAST);
    });

    it("creates the entry on first write and updates it in place on the second — never two", async () => {
      const client = await clientFor("u1");
      const a = await mine(client);
      await call(client, "set_artefact_data", { id: a.id, blob: '{"v":1}' });
      const first = await deps.dataRepo.findByArtefactAndAuthor(a.id, "u1");
      await call(client, "set_artefact_data", { id: a.id, blob: '{"v":2}' });
      const second = await deps.dataRepo.findByArtefactAndAuthor(a.id, "u1");

      expect(first?.blob).toBe('{"v":1}');
      expect(second?.blob).toBe('{"v":2}');
      expect(second?.id).toBe(first?.id);
      expect(await deps.dataRepo.listAuthorsByArtefact(a.id)).toHaveLength(1);
    });

    it("writes only the caller's own entry — another author's is untouched (AD2)", async () => {
      const client = await clientFor("u1");
      const a = await mine(client);
      await deps.dataRepo.save(
        upsertDataEntry({ id: "d2", artefactId: a.id, authorId: "u2", blob: '{"theirs":1}', authoredAgainstVersion: null, now: PAST }),
      );
      await call(client, "set_artefact_data", { id: a.id, blob: '{"mine":1}' });

      const theirs = await deps.dataRepo.findByArtefactAndAuthor(a.id, "u2");
      expect(theirs?.blob).toBe('{"theirs":1}');
      expect(theirs?.updatedAt).toEqual(PAST);
      expect((await deps.dataRepo.findByArtefactAndAuthor(a.id, "u1"))?.blob).toBe('{"mine":1}');
    });

    it("rejects invalid JSON with an error naming the parse failure, writing nothing (AD8)", async () => {
      const client = await clientFor("u1");
      const a = await mine(client);
      const r = await call(client, "set_artefact_data", { id: a.id, blob: '{"a":' });
      expect(r.isError).toBe(true);
      let parseMessage = "";
      try {
        JSON.parse('{"a":');
      } catch (e) {
        parseMessage = (e as Error).message;
      }
      expect(r.content[0]!.text).toContain(parseMessage);
      expect(await deps.dataRepo.findByArtefactAndAuthor(a.id, "u1")).toBeNull();
    });

    it("rejects an over-cap blob with an error naming the actual size against the 5 MB cap (AD8)", async () => {
      const client = await clientFor("u1");
      const a = await mine(client);
      const blob = JSON.stringify({ big: "a".repeat(MAX_BLOB_BYTES) });
      const r = await call(client, "set_artefact_data", { id: a.id, blob });
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toContain(String(new TextEncoder().encode(blob).byteLength));
      expect(r.content[0]!.text).toContain(String(MAX_BLOB_BYTES));
      expect(await deps.dataRepo.findByArtefactAndAuthor(a.id, "u1")).toBeNull();
    });

    it("a stale if_unmodified_since → conflict error directing a re-read, nothing written", async () => {
      const client = await clientFor("u1");
      const a = await mine(client);
      await deps.dataRepo.save(
        upsertDataEntry({ id: "d1", artefactId: a.id, authorId: "u1", blob: '{"v":"read"}', authoredAgainstVersion: null, now: PAST }),
      );
      const read = json(await call(client, "get_artefact_data", { id: a.id }));
      // The user's open tab saves between the agent's read and its write.
      const tabAt = new Date("2026-02-01T00:00:00.000Z");
      const existing = (await deps.dataRepo.findByArtefactAndAuthor(a.id, "u1"))!;
      await deps.dataRepo.save(
        upsertDataEntry({ ...existing, blob: '{"v":"tab"}', existing, now: tabAt }),
      );

      const r = await call(client, "set_artefact_data", {
        id: a.id,
        blob: '{"v":"agent"}',
        if_unmodified_since: read.updatedAt,
      });
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toMatch(/get_artefact_data/);
      expect(r.content[0]!.text).toMatch(/re-?read/i);
      expect((await deps.dataRepo.findByArtefactAndAuthor(a.id, "u1"))?.blob).toBe('{"v":"tab"}');
    });

    it("a null if_unmodified_since (the empty read) conflicts once the user has saved", async () => {
      const client = await clientFor("u1");
      const a = await mine(client);
      const read = json(await call(client, "get_artefact_data", { id: a.id }));
      expect(read.updatedAt).toBeNull();
      await deps.dataRepo.save(
        upsertDataEntry({ id: "d1", artefactId: a.id, authorId: "u1", blob: '{"v":"tab"}', authoredAgainstVersion: null }),
      );

      const r = await call(client, "set_artefact_data", {
        id: a.id,
        blob: '{"v":"agent"}',
        if_unmodified_since: read.updatedAt,
      });
      expect(r.isError).toBe(true);
      expect((await deps.dataRepo.findByArtefactAndAuthor(a.id, "u1"))?.blob).toBe('{"v":"tab"}');
    });

    it("without if_unmodified_since, writes unconditionally", async () => {
      const client = await clientFor("u1");
      const a = await mine(client);
      await deps.dataRepo.save(
        upsertDataEntry({ id: "d1", artefactId: a.id, authorId: "u1", blob: '{"v":"tab"}', authoredAgainstVersion: null }),
      );
      const r = await call(client, "set_artefact_data", { id: a.id, blob: '{"v":"agent"}' });
      expect(r.isError).toBeFalsy();
      expect((await deps.dataRepo.findByArtefactAndAuthor(a.id, "u1"))?.blob).toBe('{"v":"agent"}');
    });

    it("is owner-scoped: another user's (even when shared), unknown, archived, and out-of-scope → not found (AD6, AH7)", async () => {
      const u1 = await clientFor("u1");
      const a = await mine(u1);
      await call(u1, "set_visibility", { id: a.id, visibility: "authenticated" });
      const u2 = await clientFor("u2");
      const other = { tenantId: "another-tenant" };
      const u1Elsewhere = await clientFor("u1", other);

      for (const [client, id] of [
        [u2, a.id],
        [u1, "nope"],
        [u1Elsewhere, a.id],
      ] as const) {
        const r = await call(client, "set_artefact_data", { id, blob: "{}" });
        expect(r.isError).toBe(true);
        // The same ArtefactNotFound for every case — existence does not leak.
        expect(r.content[0]!.text).toBe(id);
      }

      await call(u1, "archive_artefact", { id: a.id });
      expect((await call(u1, "set_artefact_data", { id: a.id, blob: "{}" })).isError).toBe(true);
      expect(await deps.dataRepo.listAuthorsByArtefact(a.id)).toHaveLength(0);
    });

    it("a blob written into an empty entry from the declared schema's example is what the served artefact seeds", async () => {
      const client = await clientFor("u1");
      const a = await mine(
        client,
        '<script type="application/artefactor-schema+json">' +
          '{"key":"habit-tracker-v2","version":2,"example":{"habits":[{"id":"h1","name":"Read"}]}}' +
          "</script><head></head><h1>habits</h1>",
      );
      const read = json(await call(client, "get_artefact_data", { id: a.id }));
      expect(read.blob).toBeNull();

      // localStorage values are strings: the blob maps the declared key to the
      // JSON-encoded example.
      const blob = JSON.stringify({ [read.schema.key]: JSON.stringify(read.schema.example) });
      const written = json(
        await call(client, "set_artefact_data", {
          id: a.id,
          blob,
          if_unmodified_since: read.updatedAt,
        }),
      );
      expect(json(await call(client, "get_artefact_data", { id: a.id })).blob).toBe(blob);

      const artefact = (await deps.repo.findById(a.id, SINGLETON_SCOPE))!;
      const served = await renderServedArtefact(artefact, "u1", deps, {
        targetOrigin: "http://localhost:3000",
        channel: "chan",
      });
      expect(served).toContain(`"seed":${JSON.stringify(blob).replace(/</g, "\\u003c")}`);
      // S36 — the reloaded tab's shell pins its own later saves to the entry's
      // updatedAt, the agent's write, so it neither conflicts with it nor can
      // revert it.
      const entry = await deps.dataRepo.findByArtefactAndAuthor(a.id, "u1");
      expect(entry!.updatedAt.toISOString()).toBe(written.updatedAt);
    });
  });

  // S40 — the owner's connector reads every author's entry, as the host
  // data-context switcher does (AD4): list who holds data, then fetch one
  // author's blob verbatim. Read-only (AD2/AD5) and owner-scoped.
  describe("reading every author's data (S40)", () => {
    const T1 = new Date("2026-04-01T00:00:00.000Z");
    const T2 = new Date("2026-04-02T00:00:00.000Z");
    const T3 = new Date("2026-04-03T00:00:00.000Z");
    const noMatch = (v: string) =>
      `No user with saved data on this artefact matches '${v}'. Call list_artefact_data_authors to see who has data.`;

    async function form(client: Client) {
      return json(
        await call(client, "create_artefact", { title: "Survey", kind: "form", html: "<i>s</i>" }),
      );
    }

    async function seed(
      artefactId: string,
      authorId: string,
      blob: string,
      now: Date,
      pin: string | null = null,
    ) {
      await deps.dataRepo.save(
        upsertDataEntry({ id: `d-${authorId}`, artefactId, authorId, blob, authoredAgainstVersion: pin, now }),
      );
    }

    const payloadHash = async (id: string) =>
      (await deps.repo.findById(id, SINGLETON_SCOPE))!.payloadHash;

    it("lists every author with identity, bytes, updatedAt and pin, newest first", async () => {
      const u1 = await clientFor("u1");
      const a = await form(u1);
      const hash = await payloadHash(a.id);
      await seed(a.id, "u1", '{"mine":1}', T2, hash);
      await seed(a.id, "u2", '{"k":"åäö"}', T3, "older-hash");
      await seed(a.id, "u3", "{}", T1);

      const r = await call(u1, "list_artefact_data_authors", { id: a.id });
      expect(r.isError).toBeFalsy();
      expect(json(r)).toEqual({
        id: a.id,
        currentPayloadVersion: hash,
        authors: [
          { authorId: "u2", name: "Ada Two", email: "Ada@Example.com", bytes: 14, updatedAt: T3.toISOString(), authoredAgainstVersion: "older-hash" },
          { authorId: "u1", name: "Owner One", email: "owner@example.com", bytes: 10, updatedAt: T2.toISOString(), authoredAgainstVersion: hash },
          // Missing from the directory → blank identity, as the host route.
          { authorId: "u3", name: "", email: "", bytes: 2, updatedAt: T1.toISOString(), authoredAgainstVersion: null },
        ],
      });
    });

    it("lists no authors when nobody has saved data", async () => {
      const u1 = await clientFor("u1");
      const a = await form(u1);
      expect(json(await call(u1, "list_artefact_data_authors", { id: a.id })).authors).toEqual([]);
    });

    it("without author, get_artefact_data returns the caller's own entry with no author field", async () => {
      const u1 = await clientFor("u1");
      const a = await form(u1);
      await seed(a.id, "u1", '{"mine":1}', T1);
      await seed(a.id, "u2", '{"theirs":1}', T2);

      const r = json(await call(u1, "get_artefact_data", { id: a.id }));
      expect(r.blob).toBe('{"mine":1}');
      expect(r).not.toHaveProperty("author");
    });

    it("returns another author's entry verbatim by id, and by email in any case", async () => {
      const u1 = await clientFor("u1");
      const a = await form(u1);
      const hash = await payloadHash(a.id);
      const blob = '{ "answers" : [1, 2],  "note":"åäö" }';
      await seed(a.id, "u1", '{"mine":1}', T1);
      await seed(a.id, "u2", blob, T2, "older-hash");

      const byId = await call(u1, "get_artefact_data", { id: a.id, author: "u2" });
      expect(byId.isError).toBeFalsy();
      expect(json(byId)).toEqual({
        id: a.id,
        blob,
        bytes: new TextEncoder().encode(blob).byteLength,
        updatedAt: T2.toISOString(),
        dataAuthorCount: 2,
        schema: null,
        currentPayloadVersion: hash,
        authoredAgainstVersion: "older-hash",
        author: { id: "u2", name: "Ada Two", email: "Ada@Example.com" },
      });

      const byEmail = await call(u1, "get_artefact_data", { id: a.id, author: "aDA@example.COM" });
      expect(json(byEmail)).toEqual(json(byId));
    });

    it("naming the caller's own id returns the own entry, plus author", async () => {
      const u1 = await clientFor("u1");
      const a = await form(u1);
      await seed(a.id, "u1", '{"mine":1}', T1);
      await seed(a.id, "u2", '{"theirs":1}', T2);

      const own = json(await call(u1, "get_artefact_data", { id: a.id }));
      const named = json(await call(u1, "get_artefact_data", { id: a.id, author: "u1" }));
      expect(named).toEqual({
        ...own,
        author: { id: "u1", name: "Owner One", email: "owner@example.com" },
      });
    });

    it("refuses an author with no entry the same way, whether or not the user exists", async () => {
      const u1 = await clientFor("u1");
      const a = await form(u1);
      await seed(a.id, "u2", '{"theirs":1}', T1);

      // An unknown id, a registered user's email with no entry, and garbage.
      for (const author of ["u-nobody", "nodata@example.com", "¯\\_(ツ)_/¯"]) {
        const r = await call(u1, "get_artefact_data", { id: a.id, author });
        expect(r.isError).toBe(true);
        expect(r.content[0]!.text).toBe(noMatch(author));
      }
    });

    it("refuses another author's over-cap blob, naming its size, without truncating", async () => {
      const u1 = await clientFor("u1");
      const a = await form(u1);
      const blob = JSON.stringify({ big: "a".repeat(MAX_MCP_BLOB_BYTES) });
      await seed(a.id, "u2", blob, T1);

      const r = await call(u1, "get_artefact_data", { id: a.id, author: "u2" });
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toContain(String(new TextEncoder().encode(blob).byteLength));
      expect(r.content[0]!.text).toContain(String(MAX_MCP_BLOB_BYTES));
      expect(r.content[0]!.text).not.toContain('"big"');
    });

    it("is owner-scoped: a viewer of a shared artefact, unknown, archived and out-of-scope → not found (AD6, AH7)", async () => {
      const u1 = await clientFor("u1");
      const a = await form(u1);
      await call(u1, "set_visibility", { id: a.id, visibility: "authenticated" });
      await seed(a.id, "u1", '{"mine":1}', T1);
      const u2 = await clientFor("u2");
      const u1Elsewhere = await clientFor("u1", { tenantId: "another-tenant" });

      for (const [client, id] of [
        [u2, a.id],
        [u1, "nope"],
        [u1Elsewhere, a.id],
      ] as const) {
        for (const [tool, args] of [
          ["list_artefact_data_authors", { id }],
          ["get_artefact_data", { id, author: "u1" }],
        ] as const) {
          const r = await call(client, tool, args);
          expect(r.isError).toBe(true);
          // The same ArtefactNotFound for every case — existence does not leak.
          expect(r.content[0]!.text).toBe(id);
        }
      }

      await call(u1, "archive_artefact", { id: a.id });
      expect((await call(u1, "list_artefact_data_authors", { id: a.id })).isError).toBe(true);
      expect((await call(u1, "get_artefact_data", { id: a.id, author: "u1" })).isError).toBe(true);
    });

    it("reading another author's entry leaves set_artefact_data writing only the caller's own (AD2/AD5)", async () => {
      const u1 = await clientFor("u1");
      const a = await form(u1);
      await seed(a.id, "u2", '{"theirs":1}', T1);

      const theirs = json(await call(u1, "get_artefact_data", { id: a.id, author: "u2" }));
      await call(u1, "set_artefact_data", { id: a.id, blob: '{"theirs":2}' });

      const stored = await deps.dataRepo.findByArtefactAndAuthor(a.id, "u2");
      expect(stored?.blob).toBe(theirs.blob);
      expect(stored?.updatedAt).toEqual(T1);
      expect((await deps.dataRepo.findByArtefactAndAuthor(a.id, "u1"))?.blob).toBe('{"theirs":2}');
    });

    it("describes another author's entry as read-only and the listing as the way to everyone's data", async () => {
      const client = await clientFor("u1");
      const tools = (await client.listTools()).tools;
      const get = tools.find((t) => t.name === "get_artefact_data")!;
      const list = tools.find((t) => t.name === "list_artefact_data_authors")!;
      expect(get.description).toMatch(/read-only/i);
      expect(get.description).toMatch(/set_artefact_data/);
      expect(list.description).toMatch(/get_artefact_data/);
      expect(list.description).toMatch(/authoredAgainstVersion/);
    });
  });
});
