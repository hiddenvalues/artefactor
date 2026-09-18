import { describe, expect, it } from "vitest";
import { parseRendererEnv, selfCheck } from "./env";

// S37 (AH29) — the renderer role's own configuration, and the production
// self-check that refuses to run a renderer that could see secrets, storage or
// the database, or that runs as root.

const nobody = { uid: 1000, exists: () => false };

describe("renderer env (S37)", () => {
  it("parses with no secrets set, to the defaults", () => {
    expect(parseRendererEnv({})).toEqual({
      NODE_ENV: "development",
      PORT: 3001,
      ARTEFACTOR_RENDERER_EXIT_AFTER_JOB: true,
      ARTEFACTOR_RENDERER_MIN_UPTIME_MS: 10_000,
    });
  });

  it("reads its own variables", () => {
    expect(
      parseRendererEnv({
        NODE_ENV: "production",
        PORT: "4000",
        ARTEFACTOR_RENDERER_EXIT_AFTER_JOB: "false",
        ARTEFACTOR_RENDERER_MIN_UPTIME_MS: "2500",
      }),
    ).toEqual({
      NODE_ENV: "production",
      PORT: 4000,
      ARTEFACTOR_RENDERER_EXIT_AFTER_JOB: false,
      ARTEFACTOR_RENDERER_MIN_UPTIME_MS: 2500,
    });
  });

  it("rejects a malformed exit-after-job flag", () => {
    expect(() => parseRendererEnv({ ARTEFACTOR_RENDERER_EXIT_AFTER_JOB: "yes" })).toThrow();
  });
});

describe("renderer startup self-check (S37, AH29)", () => {
  const prod = parseRendererEnv({ NODE_ENV: "production" });

  it("passes in production with nothing to leak, as a non-root user", () => {
    expect(selfCheck(prod, { NODE_ENV: "production" }, nobody)).toBeNull();
  });

  it.each(["BETTER_AUTH_SECRET", "GOOGLE_CLIENT_SECRET", "DATABASE_URL"])(
    "fails in production when %s is set, naming it",
    (name) => {
      expect(selfCheck(prod, { [name]: "x" }, nobody)).toMatch(new RegExp(name));
    },
  );

  it("fails in production when the DATABASE_PATH directory exists", () => {
    const exists = (p: string) => p === "/data";
    expect(selfCheck(prod, { DATABASE_PATH: "/data/artefactor.db" }, { uid: 1000, exists })).toMatch(
      /DATABASE_PATH.*\/data/,
    );
  });

  it.each(["ARTEFACTOR_PAYLOAD_DIR", "ARTEFACTOR_THUMBNAIL_DIR"])(
    "fails in production when the %s directory exists",
    (name) => {
      const exists = (p: string) => p === "/data/dir";
      expect(selfCheck(prod, { [name]: "/data/dir" }, { uid: 1000, exists })).toMatch(new RegExp(name));
    },
  );

  it("passes when those paths are configured (the image bakes them in) but absent", () => {
    const raw = {
      DATABASE_PATH: "/data/artefactor.db",
      ARTEFACTOR_PAYLOAD_DIR: "/data/payloads",
      ARTEFACTOR_THUMBNAIL_DIR: "/data/thumbnails",
    };
    expect(selfCheck(prod, raw, nobody)).toBeNull();
  });

  it("fails in production when running as uid 0", () => {
    expect(selfCheck(prod, {}, { uid: 0, exists: () => false })).toMatch(/root|uid 0/);
  });

  it("passes in development whatever is set", () => {
    const dev = parseRendererEnv({ NODE_ENV: "development" });
    const raw = { BETTER_AUTH_SECRET: "x", DATABASE_PATH: "/data/artefactor.db" };
    expect(selfCheck(dev, raw, { uid: 0, exists: () => true })).toBeNull();
  });
});
