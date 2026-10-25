import { describe, expect, it } from "vitest";
import { artefactFilename, attachmentDisposition } from "./artefact-filename";

// S30 — the pure download-filename helper. The export endpoint turns an
// artefact's (title, fallback ref) into the name a browser saves the file as.
// Pure and framework-free, so it is unit-tested on its own.
describe("artefactFilename (S30)", () => {
  // r[verify mcp.download.filename+3]
  it("slugifies an ASCII title", () => {
    expect(artefactFilename("My Quarterly Report", "abc123")).toBe(
      "my-quarterly-report.html",
    );
  });

  // r[verify mcp.download.filename+3]
  it("keeps non-ASCII letters in the name", () => {
    expect(artefactFilename("Mötesprotokoll Öst", "abc123")).toBe(
      "mötesprotokoll-öst.html",
    );
  });

  // r[verify mcp.download.filename+3]
  it("falls back to the ref when the title has no usable characters", () => {
    expect(artefactFilename("★ ※ ★", "abc123")).toBe("abc123.html");
  });

  it("falls back to the ref when the title is blank", () => {
    expect(artefactFilename("   ", "abc123")).toBe("abc123.html");
  });

  // r[verify mcp.download.filename+3]
  it("bounds a very long title", () => {
    const name = artefactFilename("a".repeat(300), "abc123");
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.endsWith(".html")).toBe(true);
  });

  // r[verify mcp.download.filename+3]
  it("never splits a surrogate pair when it bounds the name", () => {
    // U+20000 is a CJK letter outside the BMP: two UTF-16 code units, one code point.
    const name = artefactFilename("a".repeat(94) + "\u{20000}" + "b".repeat(10), "abc123");
    expect(name).toBe("a".repeat(94) + "\u{20000}.html");
    expect(() => encodeURIComponent(name)).not.toThrow();
  });

  it("collapses separators and strips path characters", () => {
    expect(artefactFilename("../etc/passwd  — v2", "abc123")).toBe(
      "etc-passwd-v2.html",
    );
  });

  // r[verify mcp.download.filename+3]
  it("always ends in .html", () => {
    expect(artefactFilename("index.html", "abc123")).toBe("index-html.html");
  });
});

describe("attachmentDisposition (S30)", () => {
  it("carries an ASCII filename and the RFC 5987 filename*", () => {
    const header = attachmentDisposition("mötesprotokoll-öst.html", "abc123");
    expect(header).toBe(
      "attachment; filename=\"motesprotokoll-ost.html\"; filename*=UTF-8''m%C3%B6tesprotokoll-%C3%B6st.html",
    );
  });

  it("leaves an already-ASCII name identical in both forms", () => {
    expect(attachmentDisposition("report.html", "abc123")).toBe(
      "attachment; filename=\"report.html\"; filename*=UTF-8''report.html",
    );
  });

  // r[verify mcp.download.filename+3]
  it("falls back to the ref for the plain filename when the name folds to nothing ASCII", () => {
    const header = attachmentDisposition("отчёт.html", "abc123");
    expect(header).toContain('filename="abc123.html"');
    expect(header).toContain("filename*=UTF-8''%D0%BE%D1%82%D1%87%D1%91%D1%82.html");
  });

  it("uses the generic name only when neither the name nor the ref folds to ASCII", () => {
    expect(attachmentDisposition("日本語.html", "")).toContain('filename="artefact.html"');
  });
});
