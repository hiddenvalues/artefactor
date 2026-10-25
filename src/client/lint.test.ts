import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// S43 — the client guardrail: no inline style props and no raw colour literals
// outside the tokens file (src/client/app.css). The one allowed style is CSS
// custom properties carrying a per-item colour token.
const eslint = new ESLint();
const FLAG = /^(Inline styles are not allowed|Raw colour literals belong in the tokens file)/;

async function problems(code: string, filePath = "src/client/Fixture.tsx"): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result!.messages.map((m) => m.message);
}

describe("the client lint guardrail (S43)", () => {
  // r[verify platform.client.inline-style-lint]
  it("fails an inline style with a raw colour", async () => {
    expect(await problems(`export const A = () => <div style={{ color: "#fff" }} />;`)).toContainEqual(expect.stringMatching(FLAG));
  });

  // r[verify platform.client.inline-style-lint]
  it("passes a style of CSS custom properties only", async () => {
    expect(await problems(`export const A = ({ x }: { x: string }) => <div style={{ "--hue": x }} />;`)).toEqual([]);
    expect(
      await problems(`export const A = ({ x }: { x: string }) => <div style={{ "--hue": x } as React.CSSProperties} />;`),
    ).toEqual([]);
  });

  // r[verify platform.client.inline-style-lint]
  it("passes the token helpers, which only ever build custom properties", async () => {
    expect(await problems(`export const A = () => <div style={kindVars("form")} className="text-(--kind)" />;`)).toEqual([]);
  });

  // r[verify platform.client.inline-style-lint]
  it("fails a regular property, a mixed object, a variable or a string style", async () => {
    expect(await problems(`export const A = () => <div style={{ width: 3 }} />;`)).toContainEqual(expect.stringMatching(FLAG));
    expect(await problems(`export const A = ({ x }: { x: string }) => <div style={{ "--hue": x, margin: 0 }} />;`)).toContainEqual(expect.stringMatching(FLAG));
    expect(await problems(`const s = {}; export const A = () => <div style={s} />;`)).toContainEqual(expect.stringMatching(FLAG));
    expect(await problems(`export const A = () => <div style="color:red" />;`)).toContainEqual(expect.stringMatching(FLAG));
  });

  it("fails raw hex, rgb and hsl colour literals anywhere in client code", async () => {
    expect(await problems(`export const c = "#1a2b3c";`)).toContainEqual(expect.stringMatching(FLAG));
    expect(await problems(`export const A = () => <div className="bg-[#123]" />;`)).toContainEqual(expect.stringMatching(FLAG));
    expect(await problems("export const c = `rgba(0, 0, 0, ${0.5})`;")).toContainEqual(expect.stringMatching(FLAG));
    expect(await problems(`export const c = "hsl(10 20% 30%)";`)).toContainEqual(expect.stringMatching(FLAG));
    expect(await problems(`export const c = "var(--kind-form)";`)).toEqual([]);
  });

  it("finds nothing to flag in the client as it stands", async () => {
    const results = await eslint.lintFiles(["src/client"]);
    expect(results.flatMap((r) => r.messages.map((m) => `${r.filePath}:${m.line} ${m.message}`))).toEqual([]);
  });
});

// S49a — Design-system lint: token colours and wrapped Radix only. Tailwind
// palette utilities bypass the tokens as surely as a hex literal, and a direct
// Radix import skips the shadcn/ui wrapper; stock shadcn under
// lib/components/ui/ is exempt from both, but not from S43.
const PALETTE = /^Tailwind palette colours bypass the tokens/;
const RADIX = /Import the shadcn\/ui wrapper from \$lib\/components\/ui\/ instead of Radix directly/;
const UI = "src/client/lib/components/ui/Fixture.tsx";

describe("the design-system lint (S49a)", () => {
  // r[verify platform.lint.palette-utilities]
  it.each([
    `export const A = () => <div className="text-red-600" />;`,
    `export const A = () => <div className="bg-white" />;`,
    `export const A = () => <div className="bg-black/50" />;`,
    `export const A = () => <div className="hover:border-slate-200" />;`,
    `export const A = ({ active }: { active: boolean }) => <div className={cn("p-2", active && "bg-emerald-500")} />;`,
    "export const A = ({ x }: { x: string }) => <div className={`ring-${x} text-zinc-900`} />;",
    // Tailwind 4.3's hues and colour prefixes.
    `export const A = () => <div className="text-mauve-500 bg-olive-100" />;`,
    `export const A = () => <div className="border-mist-200" />;`,
    `export const A = () => <div className="bg-taupe-50" />;`,
    `export const A = () => <div className="inset-ring-red-500" />;`,
    `export const A = () => <div className="text-shadow-red-500" />;`,
    `export const A = () => <div className="drop-shadow-indigo-500" />;`,
  ])("fails a palette colour utility: %s", async (code) => {
    expect(await problems(code)).toContainEqual(expect.stringMatching(PALETTE));
  });

  // r[verify platform.lint.palette-utilities]
  it("passes token utilities", async () => {
    const classes = [
      "bg-primary text-primary-foreground",
      "text-muted-foreground",
      "bg-sidebar-accent",
      "ring-ring/50",
      "border-border",
      "text-(--kind)",
      "from-transparent",
      "bg-current",
      "w-(--radix-popover-trigger-width)",
    ];
    for (const c of classes) expect(await problems(`export const A = () => <div className="${c}" />;`)).toEqual([]);
  });

  // r[verify platform.lint.radix-imports]
  it("fails a direct Radix import and passes the shadcn/ui wrapper", async () => {
    expect(await problems(`import { Dialog } from "radix-ui"; export const A = Dialog;`)).toContainEqual(expect.stringMatching(RADIX));
    expect(await problems(`import * as D from "@radix-ui/react-dialog"; export const A = D;`)).toContainEqual(expect.stringMatching(RADIX));
    expect(await problems(`import { Button } from "$lib/components/ui/button"; export const A = Button;`)).toEqual([]);
  });

  // r[verify platform.lint.radix-imports]
  it("fails a dynamic Radix import", async () => {
    expect(await problems(`export const A = () => import("radix-ui");`)).toContainEqual(expect.stringMatching(RADIX));
    expect(await problems(`export const A = () => import("@radix-ui/react-dialog");`)).toContainEqual(expect.stringMatching(RADIX));
    expect(await problems("export const A = () => import(`radix-ui`);")).toContainEqual(expect.stringMatching(RADIX));
    expect(await problems("export const A = () => import(`@radix-ui/react-dialog`);")).toContainEqual(expect.stringMatching(RADIX));
    expect(await problems("export const A = (x: string) => import(`@radix-ui/react-${x}`);")).toContainEqual(expect.stringMatching(RADIX));
    expect(await problems("export const A = (x: string) => import(`./${x}/radix-ui`);")).toEqual([]);
    expect(await problems(`export const A = () => import("$lib/components/ui/button");`)).toEqual([]);
  });

  // r[verify platform.lint.ui-exemption]
  it("exempts stock shadcn under lib/components/ui/ from both rules, but not from S43", async () => {
    expect(await problems(`export const A = () => <div className="text-white" />;`, UI)).toEqual([]);
    expect(await problems(`import { Dialog } from "radix-ui"; export const A = Dialog;`, UI)).toEqual([]);
    expect(await problems(`export const A = () => <div style={{ color: "#fff" }} />;`, UI)).toContainEqual(expect.stringMatching(FLAG));
  });

  // r[verify platform.lint.ui-exemption]
  it("does not exempt the catalog chrome", async () => {
    expect(await problems(`export const A = () => <div className="bg-white" />;`, "src/client/design/Fixture.tsx")).toContainEqual(
      expect.stringMatching(PALETTE),
    );
  });

  // r[verify platform.lint.disable-needs-reason]
  it("requires a reason on a disable directive and fails an unused one", async () => {
    const line = `export const A = () => <div className="bg-white" />;`;
    expect(await problems(`// eslint-disable-next-line no-restricted-syntax\n${line}`)).toContainEqual(
      expect.stringContaining("Unexpected undescribed directive comment"),
    );
    expect(await problems(`// eslint-disable-next-line no-restricted-syntax -- the reason\n${line}`)).toEqual([]);
    expect(await problems(`// eslint-disable-next-line no-restricted-syntax -- nothing here\nexport const n = 1;`)).toContainEqual(
      expect.stringContaining("Unused eslint-disable directive"),
    );
  });
});

// S49b — Design-system lint: library controls only. A raw <button>, <input>,
// <select>, <textarea>, <label> or <dialog> re-implements what the shadcn/ui
// wrappers already give (focus ring, hover, cursor); stock shadcn under
// lib/components/ui/ is where the raw element belongs.
const CONTROLS = /^Hand-rolled control — compose the shadcn\/ui wrapper/;

describe("the design-system lint (S49b)", () => {
  // r[verify platform.lint.library-controls]
  it.each([
    `export const A = ({ f }: { f: () => void }) => <button onClick={f}>x</button>;`,
    `export const A = () => <input />;`,
    `export const A = () => <select />;`,
    `export const A = () => <textarea />;`,
    `export const A = () => <label>x</label>;`,
    `export const A = () => <dialog open />;`,
  ])("fails a hand-rolled control: %s", async (code) => {
    expect(await problems(code)).toContainEqual(expect.stringMatching(CONTROLS));
  });

  // r[verify platform.lint.library-controls]
  it("passes the shadcn/ui wrappers", async () => {
    for (const code of [
      `export const A = () => <Button>x</Button>;`,
      `export const A = () => <Input />;`,
      `export const A = () => <Label>x</Label>;`,
      `export const A = () => <Textarea />;`,
    ])
      expect(await problems(code)).toEqual([]);
  });

  // r[verify platform.lint.library-controls]
  it("exempts stock shadcn under lib/components/ui/", async () => {
    expect(await problems(`export const A = () => <button>x</button>;`, UI)).toEqual([]);
  });

  // r[verify platform.lint.library-controls]
  it("passes a raw control under a disable directive with a reason", async () => {
    expect(
      await problems(`// eslint-disable-next-line no-restricted-syntax -- the reason\nexport const A = () => <button>x</button>;`),
    ).toEqual([]);
  });
});
