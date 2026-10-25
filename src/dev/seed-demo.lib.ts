import type { ArtefactSummary, CollectionSummary } from "../shared/contracts";
import { DEMO_FIXTURE, DEMO_PASSWORD, type DemoFixture, type PersonKey } from "./seed-demo.fixtures";

// ALI-414 — walks the demo fixture through the real BFF routes, so every item
// passes the same commands and invariants a human upload would (the sign-up gate
// and domain allowlist, the access matrix). Nothing is inserted by SQL.

// `app.request` from `createApp()`, or anything with its shape.
export type SeedRequest = (path: string, init?: RequestInit) => Promise<Response>;

export class SeedRequestFailed extends Error {
  constructor(
    readonly route: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`seed request failed: ${route} → ${status} ${body}`);
    this.name = "SeedRequestFailed";
  }
}

interface Session {
  id: string;
  cookie: string;
}

type Body = { json: unknown } | { form: FormData } | { text: string };

export async function seedDemo(
  request: SeedRequest,
  fixture: DemoFixture = DEMO_FIXTURE,
): Promise<void> {
  async function call<T>(method: string, path: string, cookie: string | null, body?: Body): Promise<T> {
    const headers: Record<string, string> = {};
    if (cookie) headers.cookie = cookie;
    let payload: RequestInit["body"];
    if (body && "json" in body) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body.json);
    } else if (body && "text" in body) {
      headers["Content-Type"] = "application/json";
      payload = body.text;
    } else if (body) {
      payload = body.form;
    }
    const res = await request(path, { method, headers, body: payload });
    const text = await res.text();
    if (!res.ok) throw new SeedRequestFailed(`${method} ${path}`, res.status, text);
    return (text ? JSON.parse(text) : null) as T;
  }

  // Sign-up opens a session, so its cookie is the person's sign-in.
  async function signUp(key: PersonKey): Promise<Session> {
    const { name, email } = fixture.people[key];
    const path = "/api/auth/sign-up/email";
    const res = await request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password: DEMO_PASSWORD }),
    });
    const text = await res.text();
    if (!res.ok) throw new SeedRequestFailed(`POST ${path}`, res.status, text);
    const cookie = res.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new SeedRequestFailed(`POST ${path}`, res.status, "no session cookie");
    return { id: (JSON.parse(text) as { user: { id: string } }).user.id, cookie };
  }

  const people = {} as Record<PersonKey, Session>;
  for (const key of Object.keys(fixture.people) as PersonKey[]) {
    people[key] = await signUp(key);
  }

  // Parents before children: the fixture lists them in that order.
  const collections = new Map<string, CollectionSummary>();
  for (const c of fixture.collections) {
    const created = await call<CollectionSummary>("POST", "/api/collections", people[c.owner].cookie, {
      json: {
        name: c.name,
        parentId: c.parent ? collections.get(c.parent)!.id : null,
        ...(c.visibility ? { visibility: c.visibility } : {}),
      },
    });
    collections.set(c.key, created);
  }

  for (const a of fixture.artefacts) {
    const owner = people[a.owner].cookie;
    const form = new FormData();
    form.set("title", a.title);
    form.set("kind", a.kind);
    form.set("payload", new File([a.html], `${a.key}.html`, { type: "text/html" }));
    let artefact = await call<ArtefactSummary>("POST", "/api/artefacts", owner, { form });
    const at = `/api/artefacts/${artefact.id}`;

    if (a.collection) {
      artefact = await call("PUT", `${at}/collection`, owner, {
        json: { collectionId: collections.get(a.collection)!.id },
      });
    }
    if (a.visibility) {
      artefact = await call("PUT", `${at}/visibility`, owner, { json: { visibility: a.visibility } });
    }
    for (const grantee of a.grantTo ?? []) {
      await call("POST", `${at}/access`, owner, { json: { userId: people[grantee].id } });
    }
    if (a.dataVisibility) {
      await call("PUT", `${at}/data-visibility`, owner, { json: { dataVisibility: a.dataVisibility } });
    }
    const ref = encodeURIComponent(artefact.publicSlug ?? artefact.id);
    for (const [author, blob] of Object.entries(a.data ?? {}) as [PersonKey, Record<string, string>][]) {
      await call("PUT", `/api/artefacts/${ref}/data/me`, people[author].cookie, {
        text: JSON.stringify(blob),
      });
    }
    for (const who of a.bookmarkedBy ?? []) {
      await call("PUT", `${at}/bookmark`, people[who].cookie);
    }
    if (a.archived) {
      await call("POST", `${at}/archive`, owner);
    }
  }
}
