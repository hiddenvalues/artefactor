import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import {
  ossEnforcement,
  type EnforcementPolicies,
  type QuotaVerdict,
} from "../domain/artefact/enforcement";
import type { ArtefactListResponse, ArtefactSummary } from "../shared/contracts";

// End-to-end S23 — EE enforcement policy seams (quota / payload-size / branding): the composition
// root injects the policies, and the upload routes, the commands and the serve route consult them.
// The stubs below stand in for the EE Usage & Quota policies; each test sets the answers it needs.
const MB = 1024 * 1024;

describe("injected enforcement policies (S23)", () => {
  let app: Hono;
  let ossApp: Hono;
  let owner: string;

  let cap = 10 * MB;
  let verdict: QuotaVerdict = { decision: "allow" };
  let quotaChecks: Parameters<EnforcementPolicies["quota"]["check"]>[0][] = [];
  const BADGE = { label: "Made with Artefactor", href: "https://artefactor.cloud/?ref=badge" };
  let badgeAsks: Parameters<EnforcementPolicies["branding"]["badgeFor"]>[0][] = [];
  // How the branding stub fails: by rejecting, by throwing before it returns a promise, or not.
  let badgeFails: "reject" | "throw" | false = false;
  const enforcement: EnforcementPolicies = {
    branding: {
      badgeFor: (ctx) => {
        badgeAsks.push(ctx);
        if (badgeFails === "throw") throw new Error("entitlements unavailable");
        if (badgeFails === "reject") return Promise.reject(new Error("entitlements unavailable"));
        return Promise.resolve(BADGE);
      },
    },
    payloadSize: { maxBytes: async () => cap },
    quota: {
      check: async (ctx) => {
        quotaChecks.push(ctx);
        return verdict;
      },
    },
  };
  const DENY: QuotaVerdict = {
    decision: "deny",
    reason: "You have used all 20 artefacts on the Free plan.",
    upgradePath: "/settings/billing",
  };

  async function signUp(target: Hono, email: string): Promise<string> {
    const res = await target.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "correct-horse-battery", name: email }),
    });
    return res.headers.get("set-cookie")!.split(";")[0]!;
  }

  function html(bytes: number): File {
    return new File([new Uint8Array(bytes).fill(0x20)], "a.html");
  }

  function post(target: Hono, payload: File, cookie = owner, title = "Enforced") {
    const form = new FormData();
    form.set("title", title);
    form.set("kind", "prototype");
    form.set("payload", payload);
    return target.request("/api/artefacts", { method: "POST", body: form, headers: { cookie } });
  }

  function patch(id: string, fields: Record<string, string | File>) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    return app.request(`/api/artefacts/${id}`, { method: "PATCH", body: form, headers: { cookie: owner } });
  }

  async function created(payload = html(1024)): Promise<ArtefactSummary> {
    const res = await post(app, payload);
    expect(res.status).toBe(201);
    return (await res.json()) as ArtefactSummary;
  }

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const { db } = await import("../infra/db/client");
    migrate(db, { migrationsFolder: "./src/infra/db/migrations" });
    const { createApp } = await import("./app");
    app = createApp(
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined,
      enforcement,
    );
    ossApp = createApp();
    owner = await signUp(app, "owner-s23@example.com");
  });

  beforeEach(() => {
    cap = 10 * MB;
    verdict = { decision: "allow" };
    quotaChecks = [];
    badgeFails = false;
  });

  async function own(): Promise<ArtefactSummary[]> {
    const res = await app.request("/api/artefacts", { headers: { cookie: owner } });
    return ((await res.json()) as ArtefactListResponse).artefacts;
  }

  describe("quota policy", () => {
    // r[verify platform.enforcement.quota-denies-create+2]
    it("answers a denied create with 402, its reason and upgrade path, saving nothing", async () => {
      const before = await own();
      verdict = DENY;
      const res = await post(app, html(1024));
      expect(res.status).toBe(402);
      expect(await res.json()).toEqual({ error: DENY.reason, upgradePath: DENY.upgradePath });
      expect(await own()).toEqual(before);
      expect(quotaChecks).toEqual([
        { ownerId: expect.any(String), tenantId: "default", action: "create", bytes: 1024 },
      ]);
    });

    // r[verify platform.enforcement.quota-retry-after]
    it("answers a rate deny with 429 and a matching Retry-After header", async () => {
      verdict = { ...DENY, retryAfter: 30 };
      const res = await post(app, html(1024));
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("30");
      expect(await res.json()).toEqual({
        error: DENY.reason,
        upgradePath: DENY.upgradePath,
        retryAfter: 30,
      });
    });

    it("rounds a fractional wait up to whole seconds in the Retry-After header", async () => {
      verdict = { ...DENY, retryAfter: 1.5 };
      const res = await post(app, html(1024));
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("2");
      expect(((await res.json()) as { retryAfter: number }).retryAfter).toBe(2);
    });

    it("never tells a client to retry at once: a zero wait is one second", async () => {
      verdict = { ...DENY, retryAfter: 0 };
      const res = await post(app, html(1024));
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("1");
    });

    it("says why on a deny whose policy gives an empty reason", async () => {
      verdict = { ...DENY, reason: "" };
      const res = await post(app, html(1024));
      expect(res.status).toBe(402);
      expect(((await res.json()) as { error: string }).error).toBe("quota exceeded");
    });

    it("keeps an outsized wait a plain integer in the Retry-After header", async () => {
      verdict = { ...DENY, retryAfter: 1e21 };
      const res = await post(app, html(1024));
      expect(res.headers.get("retry-after")).toBe(String(Number.MAX_SAFE_INTEGER));
    });

    it("treats a verdict that is neither allow nor warn as a deny", async () => {
      verdict = { ...DENY, decision: "DENY" as unknown as QuotaVerdict["decision"] };
      expect((await post(app, html(1024))).status).toBe(402);
    });

    it("refuses a blank title as a 400 before asking the quota", async () => {
      verdict = DENY;
      const res = await post(app, html(1024), owner, "   ");
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "title must not be empty" });
      expect(quotaChecks).toEqual([]);
    });

    // r[verify platform.enforcement.warn-proceeds]
    it("creates the artefact on a warn verdict, as on allow", async () => {
      verdict = { decision: "warn", reason: "You are close to your allowance." };
      await created();
    });

    // r[verify platform.enforcement.quota-edit-payload-only]
    it("denies a payload-replacing edit and leaves the artefact unchanged", async () => {
      const a = await created();
      verdict = DENY;
      quotaChecks = [];
      const res = await patch(a.id, { payload: html(2048) });
      expect(res.status).toBe(402);
      expect(await res.json()).toEqual({ error: DENY.reason, upgradePath: DENY.upgradePath });
      expect(quotaChecks).toEqual([
        { ownerId: expect.any(String), tenantId: "default", action: "edit", bytes: 2048 },
      ]);
      expect((await own()).find((x) => x.id === a.id)).toEqual(a);
    });

    // r[verify platform.enforcement.quota-edit-payload-only]
    it("never asks the quota about a title-only edit", async () => {
      const a = await created();
      verdict = DENY;
      quotaChecks = [];
      const res = await patch(a.id, { title: "Renamed" });
      expect(res.status).toBe(200);
      expect(((await res.json()) as ArtefactSummary).title).toBe("Renamed");
      expect(quotaChecks).toEqual([]);
    });
  });

  describe("branding policy", () => {
    async function shared(visibility: string): Promise<ArtefactSummary> {
      const a = await created();
      const res = await app.request(`/api/artefacts/${a.id}/visibility`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie: owner },
        body: JSON.stringify({ visibility }),
      });
      return (await res.json()) as ArtefactSummary;
    }

    function serve(target: Hono, slug: string, cookie?: string) {
      return target.request(`/a/${slug}`, { headers: cookie ? { cookie } : {} });
    }

    // r[verify platform.enforcement.branding-badge-on-public+2]
    it("renders the policy's badge on a public serve, anonymous or signed in", async () => {
      const a = await shared("public");
      const viewer = await signUp(app, "viewer-s23@example.com");
      for (const cookie of [undefined, viewer, owner]) {
        badgeAsks = [];
        const res = await serve(app, a.publicSlug!, cookie);
        expect(res.status).toBe(200);
        expect(await res.text()).toContain(
          `<a class="ae-badge" href="${BADGE.href}" target="_blank" rel="noopener">${BADGE.label}</a>`,
        );
        expect(badgeAsks).toEqual([
          { ownerId: expect.any(String), tenantId: "default", artefactId: a.id },
        ]);
      }
    });

    // r[verify platform.enforcement.branding-badge-on-public+2]
    it("never asks about a non-public serve", async () => {
      const a = await shared("authenticated");
      const viewer = await signUp(app, "member-s23@example.com");
      badgeAsks = [];
      const res = await serve(app, a.publicSlug!, viewer);
      expect(res.status).toBe(200);
      expect(await res.text()).not.toContain("ae-badge");
      expect(badgeAsks).toEqual([]);
    });

    it("serves a public artefact without a badge when the policy fails", async () => {
      const a = await shared("public");
      for (const failure of ["reject", "throw"] as const) {
        badgeFails = failure;
        const res = await serve(app, a.publicSlug!);
        expect(res.status).toBe(200);
        expect(await res.text()).not.toContain("ae-badge");
      }
    });

    // r[verify platform.enforcement.oss-defaults+2]
    it("renders no badge on a public serve under the OSS defaults", async () => {
      const cookie = await signUp(ossApp, "oss-public-s23@example.com");
      const a = (await (await post(ossApp, html(1024), cookie)).json()) as ArtefactSummary;
      const res = await ossApp.request(`/api/artefacts/${a.id}/visibility`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ visibility: "public" }),
      });
      const { publicSlug } = (await res.json()) as ArtefactSummary;
      const served = await serve(ossApp, publicSlug!);
      expect(served.status).toBe(200);
      expect(await served.text()).not.toContain("ae-badge");
    });
  });

  describe("payload-size policy", () => {
    // r[verify hosting.payload.cap-policy-decided+2]
    it("rejects a create over the policy's cap with a message naming it", async () => {
      const res = await post(app, html(11 * MB));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "payload exceeds the 10 MB cap" });
    });

    // r[verify hosting.payload.cap-policy-decided+2]
    it("rejects a payload edit over the policy's cap", async () => {
      const a = await created();
      const res = await patch(a.id, { payload: html(11 * MB) });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "payload exceeds the 10 MB cap" });
    });

    // r[verify hosting.payload.cap-policy-decided+2]
    it("accepts a create under the policy's cap", async () => {
      await created(html(9 * MB));
    });

    // One file just over the OSS ceiling, shared by the ceiling tests.
    const overCeiling = html(100 * MB + 1);
    const ceilingError = { error: "payload exceeds the 100 MB cap" };

    // r[verify hosting.payload.cap-policy-decided+2]
    it("holds a policy above 100 MB to the 100 MB ceiling, on create and edit", async () => {
      const a = await created();
      cap = 200 * MB;
      const res = await post(app, overCeiling);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(ceilingError);
      const edit = await patch(a.id, { payload: overCeiling });
      expect(edit.status).toBe(400);
      expect(await edit.json()).toEqual(ceilingError);
    });

    // r[verify hosting.payload.cap-policy-decided+2]
    it("reads a cap that is not a finite number as 100 MB", async () => {
      for (const odd of [Number.NaN, Number.POSITIVE_INFINITY]) {
        cap = odd;
        const res = await post(app, overCeiling);
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual(ceilingError);
      }
    });

    // r[verify hosting.payload.cap-policy-decided+2]
    it("reads a cap below 1 MB as 1 MB", async () => {
      for (const low of [0, -5, 1024]) {
        cap = low;
        const res = await post(app, html(2 * MB));
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "payload exceeds the 1 MB cap" });
        await created(html(512 * 1024));
      }
    });

    // r[verify platform.enforcement.oss-defaults+2]
    it("accepts the same 11 MB create under the OSS defaults", async () => {
      const cookie = await signUp(ossApp, "oss-s23@example.com");
      expect((await post(ossApp, html(11 * MB), cookie)).status).toBe(201);
    });
  });
});
