import { beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer, type McpScopeRefusal, type McpToolDeps } from "./server";
import { singletonMcpScopeResolver } from "./routes";
import { MAX_MCP_BLOB_BYTES, MAX_MCP_HTML_BYTES } from "./tools";
import { InMemoryArtefactRepository } from "../../domain/artefact/in-memory-artefact-repository";
import { InMemoryCollectionRepository } from "../../domain/collection/in-memory-collection-repository";
import { SINGLETON_SCOPE, type TenantScope } from "../../domain/artefact/tenant-scope";
import { ArtefactConflict } from "../../domain/artefact/errors";
import { ossEnforcement } from "../../domain/artefact/enforcement";
import { env } from "../env";
import {
  archiveCollection,
  createCollection,
  grantCollectionAccess,
  type Collection,
} from "../../domain/collection/collection";
import type { Visibility } from "../../domain/artefact/visibility";
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
    scope: TenantScope | McpScopeRefusal = SINGLETON_SCOPE,
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

  // S23 — EE enforcement policy seams (quota / payload-size / branding): the connector runs the
  // same commands as the upload route, so a quota deny reaches the model as a tool error.
  // r[verify platform.enforcement.quota-denies-create+2]
  it("returns a quota deny from create_artefact as a tool error with the reason and upgrade path", async () => {
    deps.enforcement = {
      ...ossEnforcement,
      quota: {
        check: async () => ({
          decision: "deny",
          reason: "You have used all 20 artefacts on the Free plan.",
          upgradePath: "https://app.example.com/settings/billing",
          retryAfter: 30,
        }),
      },
    };
    const client = await clientFor("u1");
    const r = await call(client, "create_artefact", { title: "T", kind: "other", html: "<h1>q</h1>" });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain("You have used all 20 artefacts on the Free plan.");
    expect(r.content[0]!.text).toContain("https://app.example.com/settings/billing");
    expect(r.content[0]!.text).toContain("30 seconds");
    expect(await deps.repo.listByOwner("u1", SINGLETON_SCOPE)).toEqual([]);
  });

  it("turns a quota deny's app path into a full link, and names none when the deny has none", async () => {
    let upgradePath = "/settings/billing";
    deps.enforcement = {
      ...ossEnforcement,
      quota: { check: async () => ({ decision: "deny", reason: "Over.", upgradePath }) },
    };
    const client = await clientFor("u1");
    const args = { title: "T", kind: "other", html: "<h1>q</h1>" };
    const linked = await call(client, "create_artefact", args);
    expect(linked.content[0]!.text).toBe(`Over. Upgrade: ${env.BETTER_AUTH_URL}/settings/billing`);
    upgradePath = "";
    expect((await call(client, "create_artefact", args)).content[0]!.text).toBe("Over.");
  });

  // r[verify mcp.tools.surface+4]
  // r[verify mcp.collections.web-app-only]
  it("advertises the full tool set, with no tool for people, link protection or permanent deletion", async () => {
    const client = await clientFor("u1");
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names.filter((n) => /delete|grant|revoke|access|gate|eject/.test(n))).toEqual([]);
    expect(names).toEqual(
      [
        "archive_artefact",
        "archive_collection",
        "create_artefact",
        "create_collection",
        "get_artefact",
        "get_artefact_data",
        "get_artefact_html",
        "get_authoring_guide",
        "list_artefact_data_authors",
        "list_artefacts",
        "list_collections",
        "move_artefact",
        "restore_artefact",
        "restore_collection",
        "set_artefact_data",
        "set_collection_visibility",
        "set_data_visibility",
        "set_visibility",
        "update_artefact",
        "update_collection",
      ].sort(),
    );
  });

  // r[verify mcp.guide.instructions-summary]
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
    // S75 — and placing an artefact in a collection.
    expect(instructions).toMatch(/list_collections/);
    expect(instructions).toMatch(/move_artefact/);
  });

  // r[verify mcp.guide.full-guide-tool]
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
  // r[verify hosting.frame.guide-warns-storage]
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

  // S78 — two paragraphs carried word for word by both channels of the
  // authoring contract: verify the rendered result, share only on request.
  const VERIFY_PARAGRAPH =
    "Verify before you call an artefact done. A preview you show the user must be its own HTML, rendered — never an illustration or mockup of what you plan to build; if you can't render HTML, say so. Publish it private, then look at the published result yourself or ask the user to open it (from appUrl while it's private) and confirm it, compared with what they approved at desktop and phone widths; share it at the tier they asked for only after that. Don't claim saved data persists until a reload has shown it does.";
  const SHARE_PARAGRAPH =
    "Keep an artefact private unless the user asked to share it. Never pick a shared tier on their behalf, not even to get a link to post in the chat: a private artefact has no share link, so give the user the result's appUrl (the Artefactor web app, where they open it) and ask whether, and with whom, to share it. When they want a link, offer the tiers — selected (named people, added in the web app), authenticated (anyone signed in) or public (anyone with the link) — and set public only when they ask for it.";
  const normalised = (text: string) => text.replace(/\s+/g, " ");

  async function bothChannels(): Promise<string[]> {
    const client = await clientFor("u1");
    const guide = (await call(client, "get_authoring_guide", {})).content[0]!.text;
    return [client.getInstructions()!, guide].map(normalised);
  }

  // r[verify mcp.guide.verify-rendered]
  it("tells the agent, in both the instructions and the guide, to verify the rendered result", async () => {
    for (const text of await bothChannels()) expect(text).toContain(VERIFY_PARAGRAPH);
  });

  // r[verify mcp.guide.share-on-request]
  it("tells the agent, in both the instructions and the guide, to share only on request", async () => {
    for (const text of await bothChannels()) expect(text).toContain(SHARE_PARAGRAPH);
  });

  // r[verify mcp.guide.verify-rendered]
  // r[verify mcp.guide.share-on-request]
  it("the guide's verify-and-share section and shipping checklist", async () => {
    const [, guide] = await bothChannels();
    expect(guide).toContain("### Verify and share — before calling it done");
    for (const item of [
      "- [ ] The preview the user approved was the artefact's own rendered HTML, not an illustration.",
      "- [ ] Published private first; the rendered result was seen (by you or by the user) and matches what the user approved at desktop and phone widths, before sharing or calling it done.",
      "- [ ] Persistence was tested by a reload before claiming it works.",
      "- [ ] Shared only at the tier the user asked for — never public by default, never just to get a link.",
    ]) {
      expect(guide).toContain(item);
    }
  });

  // S83 — a change still waiting in the artefact's own timer is lost on a reload,
  // and the frame's pagehide is too late to flush it.
  const FLUSH_SENTENCE =
    "If you debounce a write, flush it on beforeunload and on visibilitychange to hidden — a change still waiting in your timer when the page goes away is lost, and pagehide is too late.";
  const COVERS_SENTENCE = "That covers what is in localStorage, not a change your code still holds in a timer.";
  const unticked = (text: string) => text.replace(/`/g, "");

  // r[verify mcp.guide.write-at-once]
  it("tells the agent, in both the instructions and the guide, to flush a debounced write on beforeunload", async () => {
    for (const text of (await bothChannels()).map(unticked)) {
      expect(text).toContain(FLUSH_SENTENCE);
      expect(text).toContain(COVERS_SENTENCE);
    }
  });

  // r[verify mcp.guide.write-at-once]
  it("puts both write-at-once sentences within the instructions' first 4,000 characters", async () => {
    const client = await clientFor("u1");
    const head = unticked(normalised(client.getInstructions()!.slice(0, 4000)));
    expect(head).toContain(FLUSH_SENTENCE);
    expect(head).toContain(COVERS_SENTENCE);
  });

  // r[verify mcp.guide.write-at-once]
  it("the guide's checklist asks for writes at once and drops the debounce item", async () => {
    const [, guide] = await bothChannels();
    expect(guide).toContain(
      "- [ ] Each change is written to localStorage at once — or, if debounced, flushed on beforeunload and on visibilitychange to hidden.",
    );
    expect(guide).not.toContain("- [ ] Frequent writes are debounced.");
  });

  // r[verify mcp.guide.write-at-once]
  it("the guide's recommended template writes at once, with no saveSoon", async () => {
    const [, guide] = await bothChannels();
    const template = guide!.split("### Recommended template")[1]!.split("### Checklist")[0]!;
    expect(template).not.toContain("saveSoon");
    expect(template).not.toContain("flush is handled by Artefactor");
  });

  // r[verify mcp.guide.verify-rendered]
  // r[verify mcp.guide.share-on-request]
  it("puts both paragraphs and the get_authoring_guide pointer within the instructions' first 4,000 characters", async () => {
    const client = await clientFor("u1");
    const head = normalised(client.getInstructions()!.slice(0, 4000));
    expect(head).toContain(VERIFY_PARAGRAPH);
    expect(head).toContain(SHARE_PARAGRAPH);
    expect(head).toContain("Call get_authoring_guide for the full contract");
  });

  // r[verify mcp.tools.create-app-url]
  it("create_artefact returns appUrl beside the share url, private or shared", async () => {
    const client = await clientFor("u1");
    const priv = json(
      await call(client, "create_artefact", { title: "P", kind: "other", html: "<h1>p</h1>" }),
    );
    expect(priv.url).toBeNull();
    expect(priv.appUrl).toBe("http://localhost:3000/");
    const pub = json(
      await call(client, "create_artefact", {
        title: "Q",
        kind: "other",
        html: "<h1>q</h1>",
        visibility: "public",
      }),
    );
    expect(pub.url).toBe(`http://localhost:3000/a/${pub.publicSlug}`);
    expect(pub.appUrl).toBe("http://localhost:3000/");
  });

  it("the sharing tools' descriptions say to share only on the user's request", async () => {
    const client = await clientFor("u1");
    const tools = (await client.listTools()).tools;
    const create = tools.find((t) => t.name === "create_artefact")!;
    const setVisibility = tools.find((t) => t.name === "set_visibility")!;
    expect(create.description).toContain("Always leave visibility unset");
    const visibilityArg = (create.inputSchema.properties as Record<string, { description?: string }>)
      .visibility!;
    expect(visibilityArg.description).toContain("Leave it unset: create private, verify, then share with set_visibility");
    expect(setVisibility.description).toContain("Only on the user's request");
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

  describe("link protection (S32a)", () => {
    const EXPIRES = new Date(Date.now() + 24 * 60 * 60 * 1000);

    async function gatedPublic(client: Client) {
      const { id } = json(
        await call(client, "create_artefact", { title: "G", kind: "prototype", html: "<h1>g</h1>", visibility: "public" }),
      );
      const stored = (await deps.repo.findById(id, SINGLETON_SCOPE))!;
      await deps.repo.save({
        ...stored,
        linkGate: { passwordHash: "scrypt$salt$key", expiresAt: EXPIRES, version: 3 },
      });
      return id as string;
    }

    // r[verify hosting.link-gate.owner-summary-only]
    it("the owner's summaries carry linkGate, never the hash", async () => {
      const u1 = await clientFor("u1");
      const id = await gatedPublic(u1);
      for (const r of [await call(u1, "get_artefact", { id }), await call(u1, "list_artefacts", {})]) {
        expect(r.content[0]!.text).not.toMatch(/passwordHash|scrypt/);
      }
      expect(json(await call(u1, "get_artefact", { id })).linkGate).toEqual({
        passwordProtected: true,
        expiresAt: EXPIRES.toISOString(),
      });
    });

    it("set_visibility away from public clears the gate, and says so", async () => {
      const u1 = await clientFor("u1");
      const id = await gatedPublic(u1);
      const r = json(await call(u1, "set_visibility", { id, visibility: "authenticated" }));
      expect(r.linkGate).toBeNull();
      expect((await deps.repo.findById(id, SINGLETON_SCOPE))!.linkGate).toEqual({
        passwordHash: null,
        expiresAt: null,
        version: 4,
      });
      const tools = (await u1.listTools()).tools;
      const desc = tools.find((t) => t.name === "set_visibility")!.description!;
      expect(desc).toMatch(/link protection/i);
      expect(desc).toMatch(/Artefactor (web )?(app|UI)/);
    });

    it("offers no tool that sets a password or an expiry", async () => {
      const u1 = await clientFor("u1");
      const tools = (await u1.listTools()).tools;
      for (const t of tools) {
        expect(Object.keys((t.inputSchema as { properties?: object }).properties ?? {})).not.toContain("password");
      }
    });
  });

  // r[verify hosting.create.owner-is-creator]
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

  // r[verify hosting.create.owner-is-creator]
  it("create_artefact never takes an owner from its arguments", async () => {
    const client = await clientFor("u1");
    const r = await call(client, "create_artefact", {
      title: "Spoofed",
      kind: "form",
      html: "<h1>x</h1>",
      ownerId: "u2",
    });
    // The unknown argument is ignored: the artefact is created, and owned by the caller.
    expect(r.isError).toBeFalsy();
    expect(json(r).ownerId).toBe("u1");
    expect(json(await call(await clientFor("u2"), "list_artefacts", {})).artefacts).not.toContainEqual(
      expect.objectContaining({ title: "Spoofed" }),
    );
  });

  // r[verify hosting.ingestion.parity]
  it("create_artefact refuses a blank title, as the upload does, and creates nothing", async () => {
    const client = await clientFor("parity");
    const r = await call(client, "create_artefact", {
      title: "   ",
      kind: "form",
      html: "<!doctype html><h1>hi</h1>",
    });
    expect(r.isError).toBe(true);
    expect(json(await call(client, "list_artefacts", {}))).toMatchObject({ artefacts: [] });
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

  // S60 — Save concurrency: a save never overwrites a newer artefact.
  // r[verify mcp.tools.save-conflict]
  it("update_artefact whose save keeps conflicting returns an error naming get_artefact", async () => {
    const client = await clientFor("u1");
    const created = json(
      await call(client, "create_artefact", { title: "Old", kind: "other", html: "<h1>1</h1>" }),
    );
    deps.repo.save = async (a) => {
      throw new ArtefactConflict(a.id);
    };
    const r = await call(client, "update_artefact", { id: created.id, title: "New" });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/get_artefact/);
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

  // r[verify mcp.tools.data-author-count]
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

  // r[verify mcp.tools.update-replaces-html]
  // r[verify data.entry.survives-payload-edit]
  it("update_artefact replaces the HTML and leaves every saved data blob in place", async () => {
    const client = await clientFor("u1");
    const a = json(
      await call(client, "create_artefact", { title: "Form", kind: "form", html: "<i>v1</i>" }),
    );
    await deps.dataRepo.save(
      upsertDataEntry({ id: "d1", artefactId: a.id, authorId: "u1", blob: '{"mine":"1"}', authoredAgainstVersion: null }),
    );
    await deps.dataRepo.save(
      upsertDataEntry({ id: "d2", artefactId: a.id, authorId: "u2", blob: '{"theirs":"2"}', authoredAgainstVersion: null }),
    );

    const r = await call(client, "update_artefact", { id: a.id, html: "<i>v2</i>" });
    expect(r.isError).toBeFalsy();

    expect(json(await call(client, "get_artefact_html", { id: a.id })).html).toBe("<i>v2</i>");
    expect((await deps.dataRepo.findByArtefactAndAuthor(a.id, "u1"))?.blob).toBe('{"mine":"1"}');
    expect((await deps.dataRepo.findByArtefactAndAuthor(a.id, "u2"))?.blob).toBe('{"theirs":"2"}');
  });

  // r[verify identity.mcp.token-one-account]
  // r[verify hosting.authority.owner-only]
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

  // r[verify mcp.tools.refusal-is-error-result]
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

  // r[verify mcp.read.html-exact]
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

  // r[verify mcp.read.over-cap-refused+2]
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

  // r[verify mcp.read.own-entry-default]
  // r[verify data.blob.bounded-opaque-json]
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

  // r[verify mcp.read.own-entry-default]
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

  // r[verify mcp.read.over-cap-refused+2]
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

  // r[verify mcp.read.schema-best-effort+2]
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

  // r[verify mcp.read.schema-best-effort+2]
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

  // r[verify data.blob.bounded-opaque-json]
  it("never validates a blob against the declared schema", async () => {
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

  // r[verify mcp.read.version-pair+2]
  // r[verify data.pin.stamped-on-write]
  it("get_artefact_data reports the payload version pin", async () => {
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

  // r[verify mcp.read.version-pair+2]
  // r[verify data.pin.null-before-pin]
  it("an entry predating the pin reads authoredAgainstVersion null, never an error", async () => {
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

  // r[verify data.pin.stamped-on-write]
  it("set_artefact_data stamps the pin exactly as PUT …/data/me does", async () => {
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

  // r[verify mcp.read.owner-scoped+2]
  // r[verify hosting.access.no-existence-leak+3]
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

  // r[verify mcp.read.owner-scoped+2]
  // r[verify hosting.tenant.scope-excludes-other-tenants+2]
  it("both read-back tools treat the owner's artefact as not found from another tenant scope", async () => {
    const u1 = await clientFor("u1");
    const a = json(
      await call(u1, "create_artefact", { title: "Mine", kind: "other", html: "<i>m</i>" }),
    );
    const u1Elsewhere = await clientFor("u1", { tenantId: "another-tenant" });

    for (const tool of ["get_artefact_html", "get_artefact_data"]) {
      const r = await call(u1Elsewhere, tool, { id: a.id });
      expect(r.isError).toBe(true);
      // The same ArtefactNotFound as an unknown id — existence does not leak.
      expect(r.content[0]!.text).toBe(a.id);
    }
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

    // r[verify mcp.data-write.round-trip+2]
    // r[verify data.entry.identity-immutable+2]
    // r[verify data.entry.one-per-pair]
    it("round-trips: get → set → re-read returns the new blob verbatim, preserving identity", async () => {
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

    // r[verify data.entry.one-per-pair]
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

    // r[verify data.write.author-is-caller]
    it("writes only the caller's own entry — another author's is untouched", async () => {
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

    // r[verify mcp.data-write.refusal-names-fix]
    // r[verify data.blob.bounded-opaque-json]
    it("rejects invalid JSON with an error naming the parse failure, writing nothing", async () => {
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

    // r[verify mcp.data-write.refusal-names-fix]
    // r[verify data.blob.bounded-opaque-json]
    it("rejects an over-cap blob with an error naming the actual size against the 5 MB cap", async () => {
      const client = await clientFor("u1");
      const a = await mine(client);
      const blob = JSON.stringify({ big: "a".repeat(MAX_BLOB_BYTES) });
      const r = await call(client, "set_artefact_data", { id: a.id, blob });
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toContain(String(new TextEncoder().encode(blob).byteLength));
      expect(r.content[0]!.text).toContain(String(MAX_BLOB_BYTES));
      expect(await deps.dataRepo.findByArtefactAndAuthor(a.id, "u1")).toBeNull();
    });

    // r[verify mcp.data-write.refusal-names-fix]
    // r[verify data.write.stale-pin-refused]
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

    // r[verify data.write.stale-pin-refused]
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

    // r[verify mcp.data-write.no-pin-unconditional+2]
    // r[verify data.write.stale-pin-refused]
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

    // r[verify mcp.data-write.owner-scoped+2]
    // r[verify hosting.access.no-existence-leak+3]
    // r[verify hosting.lifecycle.archived-data-inert]
    // r[verify data.lifecycle.archived-inert]
    it("is owner-scoped: another user's (even when shared), unknown, archived, and out-of-scope → not found", async () => {
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

    // r[verify mcp.data-write.seeds-served-artefact]
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
  // data-context switcher does (data.read.follows-artefact-access): list who holds data, then fetch one
  // author's blob verbatim. Read-only (data.write.author-is-caller,
  // data.write.own-context-only) and owner-scoped.
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

    // r[verify mcp.authors.listing+2]
    // r[verify data.read.follows-artefact-access]
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

    // r[verify mcp.authors.listing+2]
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

    // r[verify mcp.authors.resolve-author]
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

    // r[verify mcp.authors.resolve-author]
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

    // r[verify mcp.authors.no-email-probe+2]
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

    // r[verify mcp.authors.over-cap-refused+2]
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

    // r[verify mcp.authors.owner-scoped+2]
    // r[verify hosting.lifecycle.archived-data-inert]
    // r[verify data.lifecycle.archived-inert]
    it("is owner-scoped: a viewer of a shared artefact, unknown, archived and out-of-scope → not found", async () => {
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

    // r[verify data.write.author-is-caller]
    // r[verify data.write.own-context-only]
    it("reading another author's entry leaves set_artefact_data writing only the caller's own", async () => {
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

  describe("placing an artefact in a collection (S75)", () => {
    async function collection(
      id: string,
      ownerId: string,
      options: { parent?: Collection; visibility?: Visibility; grant?: string[] } = {},
    ): Promise<Collection> {
      let c = createCollection({
        id,
        ownerId,
        name: id,
        parent: options.parent ?? null,
        visibility: options.visibility,
      });
      for (const userId of options.grant ?? []) c = grantCollectionAccess(c, userId);
      await deps.collectionRepo.save(c);
      return c;
    }

    async function publish(client: Client) {
      return json(
        await call(client, "create_artefact", { title: "T", kind: "other", html: "<h1>x</h1>" }),
      );
    }

    // r[verify mcp.collections.list-shape]
    it("list_collections returns a tree's rows root first, with path, parentId, own and the root's tier", async () => {
      const a = await collection("A", "u1", { visibility: "authenticated" });
      const a1 = await collection("A1", "u1", { parent: a });
      await collection("A2", "u1", { parent: a1 });

      const r = await call(await clientFor("u1"), "list_collections", {});
      expect(json(r)).toEqual({
        collections: [
          { id: "A", name: "A", parentId: null, path: ["A"], own: true, visibility: "authenticated" },
          { id: "A1", name: "A1", parentId: "A", path: ["A", "A1"], own: true, visibility: "authenticated" },
          {
            id: "A2",
            name: "A2",
            parentId: "A1",
            path: ["A", "A1", "A2"],
            own: true,
            visibility: "authenticated",
          },
        ],
      });
    });

    // r[verify mcp.collections.list-placeable]
    it("list_collections lists contributed trees after the caller's own, and nothing for a user with none", async () => {
      await collection("Mine", "u1");
      await collection("Theirs", "u2", { visibility: "selected", grant: ["u1"] });
      await collection("Viewable", "u2", { visibility: "authenticated" });

      const rows = json(await call(await clientFor("u1"), "list_collections", {})).collections;
      expect(rows.map((r: { id: string; own: boolean }) => [r.id, r.own])).toEqual([
        ["Mine", true],
        ["Theirs", false],
      ]);
      expect(json(await call(await clientFor("u3"), "list_collections", {}))).toEqual({
        collections: [],
      });
    });

    // r[verify mcp.collections.move-runs-command]
    it("move_artefact places an artefact in an own collection, and get_artefact agrees", async () => {
      const client = await clientFor("u1");
      const a = await publish(client);
      await collection("C", "u1");

      const moved = await call(client, "move_artefact", { id: a.id, collection_id: "C" });
      expect(moved.isError).toBeFalsy();
      expect(json(moved)).toMatchObject({ id: a.id, collectionId: "C", dataAuthorCount: 0 });
      expect(json(await call(client, "get_artefact", { id: a.id })).collectionId).toBe("C");
    });

    // r[verify mcp.collections.move-runs-command]
    it("move_artefact with collection_id null takes it back to top level, where its own tier resurfaces", async () => {
      const client = await clientFor("u1");
      const a = await publish(client);
      await call(client, "set_visibility", { id: a.id, visibility: "public" });
      await collection("C", "u1");
      const inside = json(await call(client, "move_artefact", { id: a.id, collection_id: "C" }));
      expect(inside.effectiveVisibility).toBe("private");

      const out = json(await call(client, "move_artefact", { id: a.id, collection_id: null }));
      expect(out).toMatchObject({ collectionId: null, effectiveVisibility: "public" });
      expect(out.url).toMatch(/\/a\//);
    });

    // r[verify mcp.collections.move-runs-command]
    it("move_artefact requires collection_id, so an omitted one is never read as top level", async () => {
      const client = await clientFor("u1");
      const a = await publish(client);
      await collection("C", "u1");
      await call(client, "move_artefact", { id: a.id, collection_id: "C" });

      const r = await call(client, "move_artefact", { id: a.id });
      expect(r.isError).toBe(true);
      expect((await deps.repo.findById(a.id, SINGLETON_SCOPE))!.collectionId).toBe("C");
    });

    // r[verify mcp.collections.move-runs-command]
    it("move_artefact places into a node of a tree the caller contributes to", async () => {
      const root = await collection("Theirs", "u2", { visibility: "selected", grant: ["u1"] });
      await collection("Theirs-1", "u2", { parent: root });
      const client = await clientFor("u1");
      const a = await publish(client);

      const moved = await call(client, "move_artefact", { id: a.id, collection_id: "Theirs-1" });
      expect(moved.isError).toBeFalsy();
      expect(json(moved).collectionId).toBe("Theirs-1");
    });

    // r[verify mcp.collections.move-runs-command]
    it("move_artefact into an authenticated tree shares a never-shared artefact and mints its link", async () => {
      const client = await clientFor("u1");
      const a = await publish(client);
      expect(a.publicSlug).toBeNull();
      await collection("Team", "u1", { visibility: "authenticated" });

      const moved = json(await call(client, "move_artefact", { id: a.id, collection_id: "Team" }));
      expect(moved.publicSlug).toEqual(expect.any(String));
      expect(moved.url).toContain(moved.publicSlug);
      expect(moved.effectiveVisibility).toBe("authenticated");
    });

    // r[verify mcp.collections.target-refusal+2]
    it("refuses an unknown, another user's and a viewer-only collection with one message naming list_collections", async () => {
      await collection("Private", "u2");
      await collection("Viewable", "u2", { visibility: "authenticated" });
      const client = await clientFor("u1");
      const a = await publish(client);

      const texts: string[] = [];
      for (const id of ["nope", "Private", "Viewable"]) {
        const r = await call(client, "move_artefact", { id: a.id, collection_id: id });
        expect(r.isError).toBe(true);
        texts.push(r.content[0]!.text.replace(id, "<id>"));
        expect(r.content[0]!.text).toContain(id);
      }
      expect(new Set(texts).size).toBe(1);
      expect(texts[0]).toMatch(/list_collections/);
      expect((await deps.repo.findById(a.id, SINGLETON_SCOPE))!.collectionId).toBeNull();
    });

    // r[verify mcp.collections.move-runs-command]
    it("move_artefact into an archived own collection is refused and changes nothing", async () => {
      const c = await collection("Old", "u1");
      await deps.collectionRepo.save(archiveCollection(c));
      const client = await clientFor("u1");
      const a = await publish(client);

      const r = await call(client, "move_artefact", { id: a.id, collection_id: "Old" });
      expect(r.isError).toBe(true);
      expect((await deps.repo.findById(a.id, SINGLETON_SCOPE))!.collectionId).toBeNull();
    });

    // r[verify mcp.collections.move-runs-command]
    it("move_artefact on another user's, an archived and an unknown artefact is get_artefact's not-found", async () => {
      await collection("C", "u1");
      const u1 = await clientFor("u1");
      const u2 = await clientFor("u2");
      const theirs = await publish(u2);
      const archived = await publish(u1);
      await call(u1, "archive_artefact", { id: archived.id });

      for (const id of [theirs.id, archived.id, "nope"]) {
        const r = await call(u1, "move_artefact", { id, collection_id: "C" });
        const got = await call(u1, "get_artefact", { id });
        expect(r).toEqual(got);
        expect(r.isError).toBe(true);
      }
    });

    // r[verify mcp.tools.save-conflict]
    it("move_artefact whose save keeps conflicting returns the save-conflict error", async () => {
      const client = await clientFor("u1");
      const a = await publish(client);
      await collection("C", "u1");
      deps.repo.save = async (x) => {
        throw new ArtefactConflict(x.id);
      };
      const r = await call(client, "move_artefact", { id: a.id, collection_id: "C" });
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toMatch(/get_artefact/);
    });
  });

  describe("managing collections (S76)", () => {
    async function collection(
      id: string,
      ownerId: string,
      options: { parent?: Collection; visibility?: Visibility; grant?: string[]; tenantId?: string } = {},
    ): Promise<Collection> {
      let c = createCollection({
        id,
        ownerId,
        name: id,
        parent: options.parent ?? null,
        visibility: options.visibility,
        tenantId: options.tenantId,
      });
      for (const userId of options.grant ?? []) c = grantCollectionAccess(c, userId);
      await deps.collectionRepo.save(c);
      return c;
    }

    async function publishInto(client: Client, collectionId: string) {
      const a = json(
        await call(client, "create_artefact", { title: "T", kind: "other", html: "<h1>x</h1>" }),
      );
      const moved = await call(client, "move_artefact", { id: a.id, collection_id: collectionId });
      expect(moved.isError).toBeFalsy();
      return a.id as string;
    }

    const stored = async (id: string) => (await deps.collectionRepo.findById(id, SINGLETON_SCOPE))!;
    const ownCollectionIds = async (ownerId: string) =>
      (await deps.collectionRepo.listByOwner(ownerId, SINGLETON_SCOPE, { includeArchived: true })).map(
        (c) => c.id,
      );

    // r[verify mcp.collections.writes-run-commands]
    it("create_collection makes a private root owned by the caller, which list_collections then lists", async () => {
      const client = await clientFor("u1");
      const r = await call(client, "create_collection", { name: "Landing page" });
      expect(r.isError).toBeFalsy();
      const created = json(r);
      expect(created).toMatchObject({
        name: "Landing page",
        ownerId: "u1",
        parentId: null,
        visibility: "private",
        status: "active",
        publicSlug: null,
        linkGate: null,
        path: ["Landing page"],
      });
      expect(json(await call(client, "list_collections", {})).collections).toEqual([
        expect.objectContaining({ id: created.id, path: ["Landing page"], own: true }),
      ]);
    });

    // r[verify mcp.collections.writes-run-commands]
    it("create_collection under an own root makes a child whose path runs from the root", async () => {
      const client = await clientFor("u1");
      const root = json(await call(client, "create_collection", { name: "Landing page" }));
      const child = json(
        await call(client, "create_collection", { name: "Gallery", parent_id: root.id, description: "Shots" }),
      );
      expect(child).toMatchObject({
        parentId: root.id,
        rootId: root.id,
        description: "Shots",
        path: ["Landing page", "Gallery"],
      });
    });

    // r[verify mcp.collections.writes-run-commands]
    it("a nested collection's result reports the tier its tree root serves it under, following the root's changes", async () => {
      const client = await clientFor("u1");
      const root = json(await call(client, "create_collection", { name: "Site", visibility: "public" }));
      const child = json(await call(client, "create_collection", { name: "Games", parent_id: root.id }));
      expect(child.visibility).toBe("public");
      expect((await stored(child.id)).visibility).toBe("private"); // the stored row is untouched

      await call(client, "set_collection_visibility", { id: root.id, visibility: "authenticated" });
      const renamed = json(await call(client, "update_collection", { id: child.id, name: "Play" }));
      expect(renamed.visibility).toBe("authenticated");

      const archived = json(await call(client, "archive_collection", { id: child.id }));
      expect(archived.collection.visibility).toBe("authenticated");
      const restored = json(await call(client, "restore_collection", { id: child.id }));
      expect(restored.collection.visibility).toBe("authenticated");
    });

    // r[verify mcp.collections.writes-run-commands]
    it("create_collection with a shared tier mints the root's public slug", async () => {
      const client = await clientFor("u1");
      const r = json(await call(client, "create_collection", { name: "Site", visibility: "public" }));
      expect(r.visibility).toBe("public");
      expect(r.publicSlug).toEqual(expect.any(String));
    });

    // r[verify mcp.collections.target-refusal+2]
    it("create_collection under an unknown, another user's, a contributed or an out-of-scope parent is the uniform refusal", async () => {
      await collection("Theirs", "u2");
      const shared = await collection("Shared", "u2", { visibility: "selected", grant: ["u1"] });
      await collection("Shared-1", "u2", { parent: shared });
      await collection("Elsewhere", "u1", { tenantId: "other-tenant" });
      const client = await clientFor("u1");

      const texts: string[] = [];
      for (const id of ["nope", "Theirs", "Shared", "Shared-1", "Elsewhere"]) {
        const r = await call(client, "create_collection", { name: "X", parent_id: id });
        expect(r.isError).toBe(true);
        expect(r.content[0]!.text).toContain(id);
        texts.push(r.content[0]!.text.replace(id, "<id>"));
      }
      expect(new Set(texts).size).toBe(1);
      expect(texts[0]).toMatch(/list_collections/);
      expect(await ownCollectionIds("u1")).toEqual([]);
    });

    // r[verify mcp.collections.writes-run-commands]
    it("create_collection under an archived own parent is refused and creates nothing", async () => {
      const old = await collection("Old", "u1");
      await deps.collectionRepo.save(archiveCollection(old));
      const r = await call(await clientFor("u1"), "create_collection", { name: "X", parent_id: "Old" });
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toMatch(/archived/);
      expect(await ownCollectionIds("u1")).toEqual(["Old"]);
    });

    // r[verify mcp.collections.writes-run-commands]
    // r[verify collections.access.set-on-root-only+2]
    it("create_collection with both parent_id and visibility is refused: a nested collection takes its root's tier", async () => {
      await collection("Root", "u1");
      const r = await call(await clientFor("u1"), "create_collection", {
        name: "Games",
        parent_id: "Root",
        visibility: "public",
      });
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toMatch(/a nested collection takes its tree root's tier/);
      expect(await ownCollectionIds("u1")).toEqual(["Root"]);
    });

    // r[verify mcp.collections.writes-run-commands]
    it("update_collection renames, sets and clears the description, and refuses an empty update", async () => {
      const root = await collection("Root", "u1");
      await collection("Kid", "u1", { parent: root });
      const client = await clientFor("u1");

      const renamed = json(await call(client, "update_collection", { id: "Kid", name: "Games" }));
      expect(renamed).toMatchObject({ id: "Kid", name: "Games", path: ["Root", "Games"] });
      const described = json(await call(client, "update_collection", { id: "Kid", description: "Play" }));
      expect(described.description).toBe("Play");
      const cleared = json(await call(client, "update_collection", { id: "Kid", description: null }));
      expect(cleared.description).toBeNull();

      const empty = await call(client, "update_collection", { id: "Kid" });
      expect(empty.isError).toBe(true);
      expect(empty.content[0]!.text).toMatch(/nothing to update/i);
      expect((await stored("Kid")).name).toBe("Games");
    });

    // r[verify mcp.collections.writes-run-commands]
    it("update_collection with a blank name carries the domain's refusal and changes nothing", async () => {
      await collection("Root", "u1");
      const r = await call(await clientFor("u1"), "update_collection", { id: "Root", name: "  " });
      expect(r.isError).toBe(true);
      expect((await stored("Root")).name).toBe("Root");
    });

    // r[verify mcp.collections.writes-run-commands]
    it("set_collection_visibility on a root changes the tree's tier, mints its slug and back-fills artefact slugs", async () => {
      const root = await collection("Root", "u1");
      await collection("Kid", "u1", { parent: root });
      const client = await clientFor("u1");
      const artefactId = await publishInto(client, "Kid");
      expect((await deps.repo.findById(artefactId, SINGLETON_SCOPE))!.publicSlug).toBeNull();

      const r = json(
        await call(client, "set_collection_visibility", { id: "Root", visibility: "authenticated" }),
      );
      expect(r).toMatchObject({ id: "Root", visibility: "authenticated", path: ["Root"] });
      expect(r.publicSlug).toEqual(expect.any(String));
      expect((await deps.repo.findById(artefactId, SINGLETON_SCOPE))!.publicSlug).toEqual(
        expect.any(String),
      );
    });

    // r[verify mcp.collections.web-app-only]
    it("set_collection_visibility away from public clears the root's link protection", async () => {
      const root = await collection("Root", "u1", { visibility: "public" });
      await deps.collectionRepo.save({
        ...root,
        linkGate: { passwordHash: "scrypt$salt$key", expiresAt: null, version: 1 },
      });
      const r = await call(await clientFor("u1"), "set_collection_visibility", {
        id: "Root",
        visibility: "authenticated",
      });
      expect(r.content[0]!.text).not.toMatch(/passwordHash|scrypt/);
      expect(json(r).linkGate).toBeNull();
      // Cleared, its version bumped so every outstanding pass is void.
      expect((await stored("Root")).linkGate).toEqual({ passwordHash: null, expiresAt: null, version: 2 });
    });

    // r[verify mcp.collections.writes-run-commands]
    it("set_collection_visibility on a non-root is refused, saying the root governs the tree", async () => {
      const root = await collection("Root", "u1");
      await collection("Kid", "u1", { parent: root });
      const r = await call(await clientFor("u1"), "set_collection_visibility", {
        id: "Kid",
        visibility: "public",
      });
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toMatch(/root/);
      expect((await stored("Kid")).visibility).toBe("private");
      expect((await stored("Root")).visibility).toBe("private");
    });

    // r[verify mcp.collections.archive-reports-cascade]
    // r[verify mcp.collections.writes-run-commands]
    it("archive_collection cascades over the tree, evicts a contributor's artefact and reports the counts; restore brings it back", async () => {
      const root = await collection("Root", "u1", { visibility: "selected", grant: ["u2"] });
      await collection("Kid", "u1", { parent: root });
      const u1 = await clientFor("u1");
      const own = await publishInto(u1, "Kid");
      const theirs = await publishInto(await clientFor("u2"), "Kid");

      const archived = await call(u1, "archive_collection", { id: "Root" });
      expect(archived.isError).toBeFalsy();
      expect(json(archived)).toMatchObject({
        collection: { id: "Root", status: "archived", path: ["Root"] },
        cascade: { collections: 1, artefacts: 1, evicted: 1 },
      });
      expect((await deps.repo.findById(theirs, SINGLETON_SCOPE))!).toMatchObject({
        collectionId: null,
        status: "active",
      });
      expect((await deps.repo.findById(own, SINGLETON_SCOPE))!.status).toBe("archived");
      expect(json(await call(u1, "list_collections", {})).collections).toEqual([]);

      const restored = await call(u1, "restore_collection", { id: "Root" });
      expect(json(restored)).toMatchObject({
        collection: { id: "Root", status: "active" },
        cascade: { collections: 1, artefacts: 1, evicted: 0 },
      });
      expect((await stored("Kid")).status).toBe("active");
      expect((await deps.repo.findById(own, SINGLETON_SCOPE))!).toMatchObject({
        status: "active",
        collectionId: "Kid",
      });
    });

    // r[verify mcp.collections.writes-run-commands]
    // r[verify collections.lifecycle.restore-under-active-parent+2]
    it("restore_collection under an archived ancestor is refused, naming the topmost archived ancestor, and restores nothing", async () => {
      const root = await collection("Root", "u1");
      const mid = await collection("Mid", "u1", { parent: root });
      await collection("Kid", "u1", { parent: mid });
      const u1 = await clientFor("u1");
      const own = await publishInto(u1, "Kid");
      expect((await call(u1, "archive_collection", { id: "Root" })).isError).toBeFalsy();

      const r = await call(u1, "restore_collection", { id: "Kid" });
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toMatch(
        /restore 'Root' \(Root\) instead, which restores this one with it — nothing was restored/,
      );
      expect((await stored("Kid")).status).toBe("archived");
      expect((await stored("Mid")).status).toBe("archived");
      expect((await deps.repo.findById(own, SINGLETON_SCOPE))!.status).toBe("archived");
    });

    // r[verify collections.lifecycle.restore-under-active-parent+2]
    it("restore_artefact inside an archived collection is refused, naming the topmost archived collection by id, and restores nothing", async () => {
      const root = await collection("Root", "u1");
      await collection("Kid", "u1", { parent: root });
      const u1 = await clientFor("u1");
      const own = await publishInto(u1, "Kid");
      expect((await call(u1, "archive_collection", { id: "Root" })).isError).toBeFalsy();

      const r = await call(u1, "restore_artefact", { id: own });
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toBe(
        `artefact '${own}' sits under an archived collection: restore 'Root' (Root) instead, which restores this one with it — nothing was restored`,
      );
      expect((await deps.repo.findById(own, SINGLETON_SCOPE))!.status).toBe("archived");
    });

    // r[verify mcp.collections.target-refusal+2]
    it("every write tool on another user's, a contributed, an unknown and an out-of-scope collection is the uniform refusal", async () => {
      await collection("Theirs", "u2");
      const shared = await collection("Shared", "u2", { visibility: "selected", grant: ["u1"] });
      await collection("Shared-1", "u2", { parent: shared });
      await collection("Elsewhere", "u1", { tenantId: "other-tenant" });
      const before = await Promise.all(["Theirs", "Shared", "Shared-1"].map(stored));
      const client = await clientFor("u1");
      const calls: [string, Record<string, unknown>][] = [
        ["update_collection", { name: "Hijacked" }],
        ["set_collection_visibility", { visibility: "public" }],
        ["archive_collection", {}],
        ["restore_collection", {}],
      ];

      const texts = new Set<string>();
      for (const [tool, args] of calls) {
        for (const id of ["Theirs", "Shared", "Shared-1", "nope", "Elsewhere"]) {
          const r = await call(client, tool, { id, ...args });
          expect(r.isError).toBe(true);
          expect(r.content[0]!.text).toContain(id);
          texts.add(r.content[0]!.text.replace(id, "<id>"));
        }
      }
      expect(texts.size).toBe(1);
      expect([...texts][0]).toMatch(/list_collections/);
      expect(await Promise.all(["Theirs", "Shared", "Shared-1"].map(stored))).toEqual(before);
      expect(
        (await deps.collectionRepo.findById("Elsewhere", { tenantId: "other-tenant" }))!,
      ).toMatchObject({ name: "Elsewhere", status: "active" });
    });
  });

  describe("a refused scope", () => {
    const REFUSAL = "This account can't use the connector right now.";

    // Arguments that pass a tool's input schema, from its advertised JSON Schema: the refusal
    // must be what answers, not a validation error.
    type Schema = { type?: string; enum?: unknown[]; required?: string[]; properties?: Record<string, Schema> };
    const valueFor = (s: Schema): unknown =>
      s.enum ? s.enum[0] : s.type === "number" || s.type === "integer" ? 1 : s.type === "boolean" ? true
        : s.type === "object" ? {} : s.type === "array" ? [] : "x";
    const argsFor = (schema: Schema) =>
      Object.fromEntries((schema.required ?? []).map((k) => [k, valueFor(schema.properties?.[k] ?? {})]));

    // r[verify mcp.tools.scope-refusal]
    it("answers every tool with the refusal's message, while initialize and tools/list still work", async () => {
      const client = await clientFor("u1", { refused: REFUSAL });
      const tools = (await client.listTools()).tools;
      const full = (await (await clientFor("u1")).listTools()).tools;
      expect(tools).toEqual(full);
      for (const tool of tools) {
        const result = (await client.callTool({
          name: tool.name,
          arguments: argsFor(tool.inputSchema as Schema),
        })) as ToolResult;
        expect({ tool: tool.name, result }).toEqual({
          tool: tool.name,
          result: { content: [{ type: "text", text: REFUSAL }], isError: true },
        });
      }
    });

    // r[verify mcp.tools.scope-refusal]
    it("the OSS resolver never refuses: every Account gets the single tenant", async () => {
      expect(await singletonMcpScopeResolver({ userId: "u1" })).toBe(SINGLETON_SCOPE);
    });
  });
});
