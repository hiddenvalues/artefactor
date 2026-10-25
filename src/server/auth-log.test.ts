import { format } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { authLog, renderLogArg } from "./auth-log";

// S51 — BetterAuth's log prints no credential: the sink prints what failed,
// never a value it was handed.

let error: MockInstance<typeof console.error>;
let warn: MockInstance<typeof console.warn>;
let log: MockInstance<typeof console.log>;

beforeEach(() => {
  error = vi.spyOn(console, "error").mockImplementation(() => {});
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Everything the three console sinks received, one entry per call.
function printed(): string[] {
  return [...error.mock.calls, ...warn.mock.calls, ...log.mock.calls].map((args) => format(...args));
}

// A BetterAuth `StateError` as `parseGenericState` throws it (better-auth 1.6.20).
function stateError(): Error {
  const err = new Error("State mismatch: verification not found") as Error & Record<string, unknown>;
  err.name = "StateError";
  err.code = "state_mismatch";
  err.details = { state: "ST4TE" };
  err.errorURL = undefined;
  return err;
}

// r[verify identity.log.auth-log-sink]
describe("authLog (S51)", () => {
  it("prints a StateError's name, message and code, and redacts its state", () => {
    authLog("error", "Failed to parse state", stateError());
    expect(error).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    const [line] = printed();
    expect(line).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z ERROR \[Better Auth\]: Failed to parse state /);
    for (const text of ["StateError", "State mismatch", "state_mismatch", "details: [redacted]", "errorURL: [redacted]"]) {
      expect(line).toContain(text);
    }
    expect(line).not.toContain("ST4TE");
  });

  it("prints an object argument's key names only", () => {
    authLog("warn", "OAuth provider not found", { providerId: "google" });
    expect(warn).toHaveBeenCalledTimes(1);
    const [line] = printed();
    expect(line).toContain("WARN [Better Auth]: OAuth provider not found");
    expect(line).toContain("providerId: [redacted]");
    expect(line).not.toContain("google");
  });

  it.each(["info", "debug"])("routes %s to console.log", (level) => {
    authLog(level, "hello");
    expect(log).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(printed()[0]).toContain(`${level.toUpperCase()} [Better Auth]: hello`);
  });

  it("prints a cause's name and message, never its fields", () => {
    const cause = Object.assign(new TypeError("inner failure"), { token: "S3CRET" });
    authLog("error", "outer", new Error("outer failure", { cause }));
    const [line] = printed();
    expect(line).toContain("TypeError: inner failure");
    expect(line).toContain("token: [redacted]");
    expect(line).not.toContain("S3CRET");
  });

  it("survives a self-cause and a throwing getter, printing one line", () => {
    const cyclic = new Error("loop");
    (cyclic as Error & { cause: unknown }).cause = cyclic;
    const hostile = {
      get boom(): never {
        throw new Error("getter");
      },
    };
    expect(() => authLog("error", "cyclic", cyclic)).not.toThrow();
    expect(() => authLog("error", "hostile", hostile)).not.toThrow();
    expect(error).toHaveBeenCalledTimes(2);
  });
});

// r[verify identity.log.auth-log-no-values]
describe("renderLogArg (S51)", () => {
  it("prints strings and numbers as they are", () => {
    expect(renderLogArg("abc")).toBe("abc");
    expect(renderLogArg(42)).toBe("42");
    expect(renderLogArg(true)).toBe("true");
    expect(renderLogArg(null)).toBe("null");
    expect(renderLogArg(undefined)).toBe("undefined");
  });

  it("redacts an array's values", () => {
    expect(renderLogArg(["S3CRET"])).not.toContain("S3CRET");
  });

  it("redacts an object's values one level deep", () => {
    expect(renderLogArg({ a: 1, b: { c: "S3CRET" } })).toBe("{ a: [redacted], b: [redacted] }");
  });

  it("prints a string code but redacts any other", () => {
    const err = Object.assign(new Error("x"), { code: 12345 });
    expect(renderLogArg(err)).toContain("code: [redacted]");
    expect(renderLogArg(err)).not.toContain("12345");
  });
});
