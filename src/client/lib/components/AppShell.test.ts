import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, expectTypeOf, it } from "vitest";
import { AppShell, type AppShellProps } from "./AppShell";

// S69 — the signed-in app's frame is a layout component that places its slots
// and never looks inside them. The type check runs under `pnpm check`.
const frame = (sidebar: ReactNode = createElement("aside", { "data-slot": "sidebar" })) =>
  renderToStaticMarkup(
    createElement(AppShell, {
      sidebar,
      topBar: createElement("header", { "data-slot": "top-bar" }),
      children: createElement("p", { "data-slot": "content" }),
    }),
  );

describe("AppShell", () => {
  // r[verify platform.shell.layout-slots]
  it("places the sidebar beside the column, the top bar above main and the children inside main", () => {
    expect(frame()).toBe(
      '<div class="flex min-h-screen">' +
        '<aside data-slot="sidebar"></aside>' +
        '<div class="flex min-w-0 flex-1 flex-col">' +
        '<header data-slot="top-bar"></header>' +
        '<main class="mx-auto w-full max-w-7xl flex-1 px-6 pt-6 pb-16"><p data-slot="content"></p></main>' +
        "</div></div>",
    );
  });

  // r[verify platform.shell.layout-slots]
  it("renders the frame without a sidebar when the slot is empty", () => {
    // `false` is what the app passes when the sidebar is closed.
    for (const empty of [null, false])
      expect(frame(empty)).toMatch(/^<div class="flex min-h-screen"><div class="flex min-w-0 flex-1 flex-col"><header/);
  });

  // r[verify platform.shell.layout-slots]
  it("takes exactly the three slots", () => {
    expectTypeOf<AppShellProps>().toEqualTypeOf<{ sidebar: ReactNode; topBar: ReactNode; children: ReactNode }>();
  });

  // r[verify platform.shell.layout-slots]
  it("is what the app container renders its frame with, holding no `main` of its own", () => {
    const app = readFileSync(new URL("../../AppShell.tsx", import.meta.url), "utf8");
    expect(app).toMatch(/^import \{ AppShell as AppFrame \} from "\$lib\/components\/AppShell";$/m);
    expect(app).toMatch(/<AppFrame\s+sidebar=\{[\s\S]*<Sidebar[\s\S]*topBar=\{\s*<TopBar/);
    expect(app).not.toMatch(/<main\b|min-h-screen/);
  });
});
