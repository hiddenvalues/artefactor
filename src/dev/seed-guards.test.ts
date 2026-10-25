import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { seedGuardProblem, type SeedGuardInput } from "./seed-guards";

// ALI-414 — the three guards that keep the fixed demo password off anything but
// a local checkout. Each returns a reason to refuse, or null.
const repoRoot = "/work/artefactor";
const safe: SeedGuardInput = {
  nodeEnv: "development",
  authUrl: "http://localhost:3000",
  reset: false,
  paths: ["./data/artefactor.db", "./data/payloads", "./data/thumbnails"],
  cwd: repoRoot,
  repoRoot,
};

describe("seedGuardProblem", () => {
  it("accepts a local development checkout", () => {
    expect(seedGuardProblem(safe)).toBeNull();
  });

  it("refuses NODE_ENV=production (guard 1)", () => {
    expect(seedGuardProblem({ ...safe, nodeEnv: "production" })).toMatch(/production/);
  });

  it.each(["https://app.example.com", "https://artefactor.localhost.example.com", "not a url"])(
    "refuses a non-local BETTER_AUTH_URL %s (guard 2)",
    (authUrl) => {
      expect(seedGuardProblem({ ...safe, authUrl })).toMatch(/BETTER_AUTH_URL/);
    },
  );

  it.each([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://artefactor.localhost",
    "https://x.artefactor.localhost",
  ])("accepts a local BETTER_AUTH_URL %s (guard 2)", (authUrl) => {
    expect(seedGuardProblem({ ...safe, authUrl })).toBeNull();
  });

  it("refuses --reset on a path outside the checkout (guard 3)", () => {
    const problem = seedGuardProblem({ ...safe, reset: true, paths: ["/tmp/elsewhere/artefactor.db"] });
    expect(problem).toMatch(/outside/);
    expect(problem).toContain("/tmp/elsewhere/artefactor.db");
  });

  it("refuses --reset on a relative path that climbs out of the checkout (guard 3)", () => {
    expect(seedGuardProblem({ ...safe, reset: true, paths: ["../other/db.sqlite"] })).toMatch(/outside/);
  });

  it("refuses --reset on the checkout root itself (guard 3)", () => {
    expect(seedGuardProblem({ ...safe, reset: true, paths: ["."] })).toMatch(/outside/);
  });

  it("treats a sibling name starting with two dots as inside the checkout (guard 3)", () => {
    expect(seedGuardProblem({ ...safe, reset: true, paths: ["./..data/artefactor.db"] })).toBeNull();
  });

  it("refuses --reset through a symlinked ancestor that points outside the checkout (guard 3)", () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "seed-guard-")));
    const checkout = join(base, "checkout");
    const elsewhere = join(base, "elsewhere");
    mkdirSync(checkout);
    mkdirSync(join(elsewhere, "payloads"), { recursive: true });
    symlinkSync(elsewhere, join(checkout, "data"));
    try {
      const problem = seedGuardProblem({
        ...safe,
        reset: true,
        cwd: checkout,
        repoRoot: checkout,
        paths: ["./data/payloads", "./data/not-yet/artefactor.db"],
      });
      expect(problem).toMatch(/outside/);
      expect(problem).toContain(join(elsewhere, "payloads"));
      expect(problem).toContain(join(elsewhere, "not-yet", "artefactor.db"));
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("allows --reset inside the checkout, and a path outside it without --reset", () => {
    expect(seedGuardProblem({ ...safe, reset: true })).toBeNull();
    expect(seedGuardProblem({ ...safe, paths: ["/tmp/elsewhere/artefactor.db"] })).toBeNull();
  });
});
