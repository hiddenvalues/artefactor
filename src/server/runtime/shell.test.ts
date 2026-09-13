import { describe, expect, it } from "vitest";
import { renderHostShell, type HostShellContext } from "./shell";

const ctx: HostShellContext = {
  title: "Tracker",
  kind: "form",
  updatedAt: "2026-09-12T10:00:00.000Z",
  framePath: "/a/slug1/frame",
  authorsEndpoint: "/api/artefacts/slug1/data/authors",
  viewersEndpoint: "/api/artefacts/slug1/viewers",
  viewerId: "u1",
  ownerId: "u1",
  usesStorage: true,
};

// S31 — when the framed artefact's saves are refused because the data was
// replaced elsewhere (e.g. by an agent), the shim posts a conflict message and
// the host shell — outside the artefact — tells the viewer and offers a reload.
describe("host shell — data conflict banner (S31)", () => {
  it("renders a hidden conflict banner with a reload action for a signed-in viewer", () => {
    const html = renderHostShell(ctx);
    expect(html).toMatch(/<div[^>]*id="ae-conflict"[^>]*hidden/);
    expect(html).toContain('id="ae-conflict-reload"');
    expect(html).toMatch(/changed elsewhere/i);
  });

  it("reveals the banner only for a conflict message from its own frame", () => {
    const html = renderHostShell(ctx);
    expect(html).toContain('"artefactor:data-conflict"');
    expect(html).toContain("e.source !== frame.contentWindow");
    expect(html).toContain("e.origin !== location.origin");
  });

  it("omits the banner for anonymous viewers, whose context is never writable", () => {
    expect(renderHostShell({ ...ctx, viewerId: null })).not.toContain('id="ae-conflict"');
  });
});
