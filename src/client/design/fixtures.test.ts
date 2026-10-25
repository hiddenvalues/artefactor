import { afterEach, describe, expect, it, vi } from "vitest";
import { installFixtureApi, organization } from "./fixtures";

// The catalog's fixture API (docs/design/README.md): it answers a preview's BFF
// calls in the page, so a call it doesn't answer must surface as a console
// error, which the catalog's browser suite fails on.

describe("the fixture API", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function install() {
    vi.stubGlobal("window", { fetch: vi.fn() });
    vi.stubGlobal("location", { href: "http://catalog.test/" });
    vi.useFakeTimers();
    installFixtureApi();
    return async (path: string, init?: RequestInit) => {
      const res = (window.fetch as typeof fetch)(path, init);
      await vi.runAllTimersAsync();
      return res;
    };
  }

  it("logs a console error for a call it doesn't answer", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await install()("/api/artefacts");
    expect(res.status).toBe(404);
    expect(error).toHaveBeenCalledWith("fixture API: no answer for GET /api/artefacts");
  });

  it("names a Request's own method in the error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchIt = install() as unknown as (input: Request) => Promise<Response>;
    await fetchIt(new Request("http://catalog.test/api/artefacts", { method: "POST" }));
    expect(error).toHaveBeenCalledWith("fixture API: no answer for POST /api/artefacts");
  });

  it("answers a revoke with only that invitation gone, and no revoke of an unknown one", async () => {
    const gone = await install()("/api/organization/invitations/inv-katherine", { method: "DELETE" });
    expect(((await gone.json()) as typeof organization).invitations).toEqual([]);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const unknown = await install()("/api/organization/invitations/%E0%A4", { method: "DELETE" });
    expect(unknown.status).toBe(404);
    expect(error).toHaveBeenCalledWith("fixture API: no answer for DELETE /api/organization/invitations/%E0%A4");
  });

  it("gives no answer to a write whose body lacks its field", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await install()("/api/organization", { method: "PATCH", body: "not json" });
    expect(res.status).toBe(404);
    expect(error).toHaveBeenCalledWith("fixture API: no answer for PATCH /api/organization");
  });

  it("answers the organization screen's rename with its fresh settings", async () => {
    const res = await install()("/api/organization", { method: "PATCH", body: JSON.stringify({ name: "Renamed" }) });
    expect(await res.json()).toEqual({ ...organization, name: "Renamed" });
  });
});
