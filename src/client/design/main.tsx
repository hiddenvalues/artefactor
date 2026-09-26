import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Moon, Sun } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { Toaster } from "$lib/components/ui/sonner";
import { TooltipProvider } from "$lib/components/ui/tooltip";
import "./catalog.css";
import { installFixtureApi } from "./fixtures";
import { StandaloneContext } from "./Launcher";
import { CATALOG_MARKER, type DefinedPreview } from "./preview";
import { previewGroup, previewId } from "./registry";

// The design catalog: every component's preview on one page, grouped UI (the
// stock shadcn/ui primitives), App, then Theme (the tokens themselves). A standalone page (the export's
// components/<id>.html, or ?preview=<id> in dev) narrows it to one preview.

const modules = import.meta.glob<{ default: DefinedPreview }>("../lib/components/**/*.preview.tsx", { eager: true });
const GROUPS = ["UI", "App", "Theme"] as const;
const HEADINGS: Record<(typeof GROUPS)[number], string> = { UI: "UI primitives", App: "App components", Theme: "Theme" };

const entries = Object.entries(modules)
  .map(([path, m]) => ({ id: previewId(path), group: previewGroup(path), preview: m.default }))
  .sort((a, b) => a.preview.title.localeCompare(b.preview.title));

const only =
  document.querySelector<HTMLMetaElement>('meta[name="artefactor-preview"]')?.content ??
  new URLSearchParams(location.search).get("preview");

function ThemeToggle() {
  const [dark, setDark] = useState(() => new URLSearchParams(location.search).get("theme") === "dark");
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  return (
    <Button variant="outline" size="sm" onClick={() => setDark((d) => !d)}>
      {dark ? <Sun /> : <Moon />}
      {dark ? "Light" : "Dark"}
    </Button>
  );
}

function Section({ id, preview }: { id: string; preview: DefinedPreview }) {
  return (
    <section data-preview={id} id={id} className="flex scroll-mt-6 flex-col gap-4">
      <h2 className="text-lg font-semibold">{preview.title}</h2>
      <div className="grid gap-4">
        {preview.variants.map((v) => (
          <div key={v.name} className="flex flex-col gap-2">
            <div className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{v.name}</div>
            <div className="flex flex-wrap items-start gap-3 rounded-xl border bg-background p-5">{v.render()}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Catalog() {
  const shown = only ? entries.filter((e) => e.id === only) : entries;
  useEffect(() => {
    document.getElementById("catalog")?.setAttribute("data-catalog-ready", "");
    if (only && shown[0]) document.title = shown[0].preview.title;
  }, [shown]);

  if (only)
    return (
      <main data-catalog={CATALOG_MARKER} className="min-h-screen bg-muted/40 p-6 text-foreground">
        {shown[0] ? <Section {...shown[0]} /> : <p className="text-sm">No preview named “{only}”.</p>}
      </main>
    );

  return (
    <div data-catalog={CATALOG_MARKER} className="flex min-h-screen bg-muted/40 text-foreground">
      <nav className="sticky top-0 flex h-screen w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r bg-sidebar p-4 text-sm">
        <div className="font-semibold">Design catalog</div>
        <ThemeToggle />
        {GROUPS.map((g) => (
          <div key={g} className="flex flex-col gap-1">
            <div className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{g}</div>
            {entries
              .filter((e) => e.group === g)
              .map((e) => (
                <a key={e.id} href={`#${e.id}`} className="rounded-md px-2 py-1 hover:bg-sidebar-accent">
                  {e.preview.title}
                </a>
              ))}
          </div>
        ))}
      </nav>
      <main className="flex min-w-0 flex-1 flex-col gap-12 p-8">
        {GROUPS.map((g) => (
          <div key={g} className="flex flex-col gap-10">
            <h1 className="text-2xl font-bold">{HEADINGS[g]}</h1>
            {entries
              .filter((e) => e.group === g)
              .map((e) => (
                <Section key={e.id} {...e} />
              ))}
          </div>
        ))}
      </main>
    </div>
  );
}

installFixtureApi();
const target = document.getElementById("catalog");
if (!target) throw new Error("#catalog mount target not found");
createRoot(target).render(
  <StrictMode>
    <StandaloneContext.Provider value={!!only}>
      <TooltipProvider>
        <Catalog />
        <Toaster position="bottom-center" />
      </TooltipProvider>
    </StandaloneContext.Provider>
  </StrictMode>,
);
