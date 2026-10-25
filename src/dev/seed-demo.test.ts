import { beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "../infra/db/client";
import { createApp } from "../server/app";
import type {
  ArtefactListResponse,
  BookmarksResponse,
  CollectionListResponse,
  DataAuthorsResponse,
  DataEntryResponse,
  SharedCollectionsResponse,
  SharedListResponse,
} from "../shared/contracts";
import { DEMO_PASSWORD, DEMO_PEOPLE, SURVEY_STORAGE_KEY } from "./seed-demo.fixtures";
import { SeedRequestFailed, seedDemo, type SeedRequest } from "./seed-demo.lib";

// ALI-414 — the local demo seed, walked through the real BFF in-process against
// the suite's throwaway SQLite database (src/test/setup.ts).
describe("seedDemo (local demo bootstrap)", () => {
  const app = createApp();
  const request: SeedRequest = (path, init) => Promise.resolve(app.request(path, init));
  let cookie: string;

  async function get<T>(path: string, who = cookie): Promise<T> {
    const res = await app.request(path, { headers: { cookie: who } });
    expect(res.status, path).toBe(200);
    return (await res.json()) as T;
  }

  beforeAll(async () => {
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    await seedDemo(request);
    const res = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: DEMO_PEOPLE.demo.email, password: DEMO_PASSWORD }),
    });
    expect(res.status).toBe(200);
    cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  });

  it("lets the demo person sign in with the fixed password", async () => {
    const me = await get<{ email: string }>("/api/me");
    expect(me.email).toBe("demo@example.com");
  });

  it("gives Demo the six active artefacts with their kinds and collections, and Drafts under Specs", async () => {
    const { collections } = await get<CollectionListResponse>("/api/collections");
    const byName = new Map(collections.map((c) => [c.name, c]));
    expect([...byName.keys()].sort()).toEqual(["Drafts", "Roadmap planning", "Specs"]);
    expect(byName.get("Drafts")!.parentId).toBe(byName.get("Specs")!.id);

    const { artefacts } = await get<ArtefactListResponse>("/api/artefacts");
    const shape = Object.fromEntries(
      artefacts.map((a) => [
        a.title,
        { kind: a.kind, collection: collections.find((c) => c.id === a.collectionId)?.name ?? null },
      ]),
    );
    expect(shape).toEqual({
      "Roadmap Q3": { kind: "interactive-doc", collection: "Specs" },
      "Onboarding flow prototype": { kind: "prototype", collection: "Drafts" },
      "Style guide": { kind: "interactive-doc", collection: null },
      "Launch deck": { kind: "slide-deck", collection: null },
      "Customer survey": { kind: "form", collection: null },
      "Pricing page": { kind: "prototype", collection: null },
    });

    const archived = await get<ArtefactListResponse>("/api/artefacts?archived=true");
    expect(archived.artefacts.map((a) => [a.title, a.status])).toEqual([["Old pitch", "archived"]]);
  });

  it("shares Maya's deck, handbook and Design roadmaps collection with Demo", async () => {
    const shared = await get<SharedListResponse>("/api/shared");
    expect(shared.artefacts.map((a) => a.title)).toEqual(
      expect.arrayContaining(["Roadmap review deck", "Team handbook"]),
    );

    const { collections } = await get<SharedCollectionsResponse>("/api/shared/collections");
    const design = collections.find((c) => c.name === "Design roadmaps");
    expect(design).toBeDefined();
    expect(design!.canContribute).toBe(false);
    const inside = shared.artefacts.find((a) => a.title === "Mobile nav prototype");
    expect(inside?.collectionId).toBe(design!.id);
  });

  it("publishes the pricing page on a slug an anonymous visitor can open", async () => {
    const { artefacts } = await get<ArtefactListResponse>("/api/artefacts");
    const pricing = artefacts.find((a) => a.title === "Pricing page")!;
    expect(pricing.visibility).toBe("public");
    expect(pricing.publicSlug).toBeTruthy();
    const res = await app.request(`/a/${pricing.publicSlug}`);
    expect(res.status).toBe(200);
  });

  it("stores survey answers from both people, and Demo can read Maya's", async () => {
    const { artefacts } = await get<ArtefactListResponse>("/api/artefacts");
    const survey = artefacts.find((a) => a.title === "Customer survey")!;
    const { authors } = await get<DataAuthorsResponse>(`/api/artefacts/${survey.publicSlug}/data/authors`);
    const maya = authors.find((a) => a.email === "maya@example.com");
    expect(authors.map((a) => a.email).sort()).toEqual(["demo@example.com", "maya@example.com"]);

    const entry = await get<DataEntryResponse>(
      `/api/artefacts/${survey.publicSlug}/data/${maya!.authorId}`,
    );
    const blob = JSON.parse(entry.blob!) as Record<string, string>;
    expect(JSON.parse(blob[SURVEY_STORAGE_KEY]!).name).toBe("Maya Chen");
  });

  it("bookmarks exactly the two roadmap artefacts for Demo", async () => {
    const bookmarks = await get<BookmarksResponse>("/api/bookmarks");
    expect(bookmarks.artefacts.map((a) => a.title).sort()).toEqual(["Roadmap Q3", "Roadmap review deck"]);
    expect(bookmarks.collections).toEqual([]);
  });
});

describe("seedDemo on a failing route", () => {
  it("aborts with the route and status in the message", async () => {
    const request: SeedRequest = async (path) =>
      path === "/api/auth/sign-up/email"
        ? new Response(JSON.stringify({ message: "nope" }), { status: 422 })
        : new Response("{}", { status: 200 });
    const failure = await seedDemo(request).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(SeedRequestFailed);
    expect((failure as Error).message).toContain("POST /api/auth/sign-up/email");
    expect((failure as Error).message).toContain("422");
    expect((failure as Error).message).toContain("nope");
  });
});
