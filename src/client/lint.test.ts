import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// S43 — the client guardrail: no inline style props and no raw colour literals
// outside the tokens file (src/client/app.css). The one allowed style is CSS
// custom properties carrying a per-item colour token.
const eslint = new ESLint();
const FLAG = /^(Inline styles are not allowed|Raw colour literals belong in the tokens file)/;

async function problems(code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: "src/client/Fixture.tsx" });
  return result!.messages.map((m) => m.message);
}

describe("the client lint guardrail (S43)", () => {
  it("fails an inline style with a raw colour", async () => {
    expect(await problems(`export const A = () => <div style={{ color: "#fff" }} />;`)).toContainEqual(expect.stringMatching(FLAG));
  });

  it("passes a style of CSS custom properties only", async () => {
    expect(await problems(`export const A = ({ x }: { x: string }) => <div style={{ "--hue": x }} />;`)).toEqual([]);
    expect(
      await problems(`export const A = ({ x }: { x: string }) => <div style={{ "--hue": x } as React.CSSProperties} />;`),
    ).toEqual([]);
  });

  it("passes the token helpers, which only ever build custom properties", async () => {
    expect(await problems(`export const A = () => <div style={kindVars("form")} className="text-(--kind)" />;`)).toEqual([]);
  });

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
