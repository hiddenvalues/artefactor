import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { redactQuery, requestLog } from "./request-log";

// S50 — Secrets stay out of the request log: the log keeps method, path,
// status, duration and query parameter names — never a query value.

function appWith(lines: string[]) {
  const app = new Hono();
  app.use("*", requestLog((line) => lines.push(line)));
  return app;
}

// r[verify identity.log.request-log-lines]
describe("requestLog (S50)", () => {
  // r[verify identity.log.request-log-no-values]
  it("redacts every query value on both lines", async () => {
    const lines: string[] = [];
    const app = appWith(lines);
    app.get("/x", (c) => c.text("ok"));
    await app.request("/x?token=abc&callbackURL=%2F");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("<-- GET /x?token=[redacted]&callbackURL=[redacted]");
    expect(lines[1]).toMatch(
      /^--> GET \/x\?token=\[redacted\]&callbackURL=\[redacted\] 200 \d+ms$/,
    );
    for (const line of lines) {
      expect(line).not.toContain("abc");
      expect(line).not.toContain("%2F");
    }
  });

  it("logs a query-less URL with no trailing ?", async () => {
    const lines: string[] = [];
    const app = appWith(lines);
    app.get("/x", (c) => c.text("ok"));
    await app.request("/x");
    expect(lines[0]).toBe("<-- GET /x");
  });

  // r[verify identity.log.request-log-no-values]
  it("keeps a valueless part bare and still redacts an empty value", () => {
    expect(redactQuery("http://localhost/x?flag&a=")).toBe("/x?flag&a=[redacted]");
  });

  it("keeps order and repeats", () => {
    expect(redactQuery("http://localhost/x?a=1&a=2")).toBe("/x?a=[redacted]&a=[redacted]");
  });

  it("logs names raw, so a crafted name can't inject a newline", async () => {
    const lines: string[] = [];
    const app = appWith(lines);
    app.get("/x", (c) => c.text("ok"));
    await app.request("/x?%0Aevil=1");
    for (const line of lines) {
      expect(line).toContain("%0Aevil=[redacted]");
      expect(line).not.toContain("\n");
    }
  });

  it("prints the incoming line before the handler runs", async () => {
    const lines: string[] = [];
    const app = appWith(lines);
    let seen: string[] = [];
    app.get("/x", (c) => {
      seen = [...lines];
      return c.text("ok");
    });
    await app.request("/x?t=1");
    expect(seen).toEqual(["<-- GET /x?t=[redacted]"]);
  });

  it("logs the outgoing line with 500 when the handler throws", async () => {
    const lines: string[] = [];
    const app = appWith(lines);
    app.get("/x", () => {
      throw new Error("boom");
    });
    const res = await app.request("/x?t=1");
    expect(res.status).toBe(500);
    expect(lines[1]).toMatch(/^--> GET \/x\?t=\[redacted\] 500 \d+ms$/);
  });

  it("logs a POST's method and path, never its body", async () => {
    const lines: string[] = [];
    const app = appWith(lines);
    app.post("/x", (c) => c.text("ok"));
    await app.request("/x", { method: "POST", body: "password=hunter2" });
    expect(lines[0]).toBe("<-- POST /x");
    expect(lines[1]).toMatch(/^--> POST \/x 200 \d+ms$/);
    expect(lines.join("\n")).not.toContain("hunter2");
  });
});
