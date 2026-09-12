import { describe, expect, it } from "vitest";
import { artefactFilename, attachmentDisposition } from "./artefact-filename";

// S30 — the pure download-filename helper. The export endpoint turns an
// artefact's (title, fallback ref) into the name a browser saves the file as.
// Pure and framework-free, so it is unit-tested on its own.
describe("artefactFilename (S30)", () => {
  it("slugifies an ASCII title", () => {
    expect(artefactFilename("My Quarterly Report", "abc123")).toBe(
      "my-quarterly-report.html",
    );
  });

  it("keeps non-ASCII letters in the name", () => {
    expect(artefactFilename("Mötesprotokoll Öst", "abc123")).toBe(
      "mötesprotokoll-öst.html",
    );
  });

  it("falls back to the ref when the title has no usable characters", () => {
    expect(artefactFilename("★ ※ ★", "abc123")).toBe("abc123.html");
  });

  it("falls back to the ref when the title is blank", () => {
    expect(artefactFilename("   ", "abc123")).toBe("abc123.html");
  });

  it("bounds a very long title", () => {
    const name = artefactFilename("a".repeat(300), "abc123");
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.endsWith(".html")).toBe(true);
  });

  it("collapses separators and strips path characters", () => {
    expect(artefactFilename("../etc/passwd  — v2", "abc123")).toBe(
      "etc-passwd-v2.html",
    );
  });

  it("always ends in .html", () => {
    expect(artefactFilename("index.html", "abc123")).toBe("index-html.html");
  });
});

describe("attachmentDisposition (S30)", () => {
  it("carries an ASCII filename and the RFC 5987 filename*", () => {
    const header = attachmentDisposition("mötesprotokoll-öst.html");
    expect(header).toBe(
      "attachment; filename=\"motesprotokoll-ost.html\"; filename*=UTF-8''m%C3%B6tesprotokoll-%C3%B6st.html",
    );
  });

  it("leaves an already-ASCII name identical in both forms", () => {
    expect(attachmentDisposition("report.html")).toBe(
      "attachment; filename=\"report.html\"; filename*=UTF-8''report.html",
    );
  });

  it("replaces characters that survive neither folding nor quoting", () => {
    // A name that folds to nothing ASCII still needs a usable plain filename.
    expect(attachmentDisposition("日本語.html")).toContain(
      'filename="artefact.html"',
    );
  });
});
