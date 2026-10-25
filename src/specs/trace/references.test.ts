import { describe, expect, it } from "vitest";
import { parseReferences } from "./references";
import { isScanned, selectScanned } from "./scan";

const refs = (path: string, text: string) =>
  parseReferences({ path, text }).map((r) => `${r.kind} ${r.id}+${r.version} @${r.line}`);

describe("the scanned file set", () => {
  // r[verify platform.trace.scan+3]
  it("scans code, SQL, shell, YAML and Dockerfiles, never node_modules, dist or build output", () => {
    const scanned = [
      "src/domain/a.ts",
      "src/client/b.tsx",
      "eslint.config.js",
      "ee/scripts/c.mjs",
      "Dockerfile",
      "docker-entrypoint.sh",
      "ee/infra/db/migrations/0001.sql",
      "ee/scripts/setup.sh",
      "ee/deploy/compose.yml",
      "ee/Dockerfile",
      "ee/Dockerfile.renderer",
      "deploy/renderer-egress.sh",
      "deploy/docker-compose.example.yml",
    ];
    const skipped = [
      "src/specs/README.md",
      "src/client/app.css",
      "src/dist/a.ts",
      "dist/server/index.js",
      "ee/dist/server/index.ts",
      "ee/node_modules/pg/index.ts",
      "node_modules/x/index.ts",
      "src/build/out.ts",
      "src/coverage/x.ts",
      "ee/data.json",
      "deploy/chromium-seccomp.json",
    ];
    expect(scanned.filter(isScanned)).toEqual(scanned);
    expect(skipped.filter(isScanned)).toEqual([]);
  });

  // r[verify platform.trace.scan+3]
  it("selects src/, deploy/ and the root's own files for the core gate, plus ee/ for the EE gate", () => {
    const paths = [
      "src/a.ts",
      "deploy/egress.sh",
      "deploy/seccomp.json",
      "ee/b.ts",
      "scripts/c.ts",
      "Dockerfile",
      "eslint.config.js",
      "ee/dist/d.ts",
    ];
    expect(selectScanned(paths, ["core"])).toEqual(["src/a.ts", "deploy/egress.sh", "Dockerfile", "eslint.config.js"]);
    expect(selectScanned(paths, ["core", "ee"])).toEqual([
      "src/a.ts",
      "deploy/egress.sh",
      "ee/b.ts",
      "Dockerfile",
      "eslint.config.js",
    ]);
  });

  // r[verify platform.trace.scan+3]
  it("reads a .js or .mjs file's // and /* */ comments as code comments", () => {
    expect(refs("eslint.config.js", 'const a = "#"; // r[impl x.y]\n/* r[impl x.z] */\n')).toEqual([
      "impl x.y+1 @1",
      "impl x.z+1 @2",
    ]);
    expect(refs("ee/scripts/c.mjs", "// r[impl x.y]\n")).toEqual(["impl x.y+1 @1"]);
  });
});

describe("parseReferences", () => {
  // r[verify platform.trace.references]
  it("reads verify and impl references, with an optional version, from // and /* */ comments", () => {
    const text = [
      "// r[verify x.y]",
      "const a = 1; // r[impl x.z+2]",
      "/*",
      " * r[verify x.w+3] and r[verify x.v]",
      " */",
    ].join("\n");
    expect(refs("src/a.test.ts", text)).toEqual([
      "verify x.y+1 @1",
      "impl x.z+2 @2",
      "verify x.w+3 @4",
      "verify x.v+1 @4",
    ]);
  });

  // r[verify platform.trace.references]
  it("finds impl references in SQL, shell, YAML and Dockerfile comments", () => {
    expect(refs("ee/infra/db/migrations/0001.sql", "select 1; -- r[impl x.y]\n")).toEqual([
      "impl x.y+1 @1",
    ]);
    expect(refs("ee/scripts/a.sh", 'echo "$#"\n# r[impl x.y]\n')).toEqual(["impl x.y+1 @2"]);
    expect(refs("ee/deploy/compose.yml", "services:\n  app: # r[impl x.y]\n")).toEqual([
      "impl x.y+1 @2",
    ]);
    expect(refs("ee/Dockerfile", "FROM node\n# r[impl x.y]\n")).toEqual(["impl x.y+1 @2"]);
  });

  // r[verify platform.trace.references]
  it("never reads a reference out of a string, template or regex literal", () => {
    const text = [
      'const a = "// r[verify x.a]";',
      "const b = '/* r[impl x.b] */';",
      "const c = `",
      "  // r[verify x.c] ${d('// r[impl x.d]')}",
      "`;",
      'const e = /"/g; // r[impl x.e]',
      "const f = /\\/\\/ r[impl x.f]/;",
    ].join("\n");
    expect(refs("src/a.test.ts", text)).toEqual(["impl x.e+1 @6"]);
  });

  // r[verify platform.trace.references]
  it("reads no reference out of a prose placeholder such as … or <id>", () => {
    expect(refs("src/a.ts", "// cite it with r[verify …] or r[impl <id>]\n")).toEqual([]);
    expect(refs("src/a.ts", "// r[verify Hosting.x]\n")).toEqual(["verify Hosting.x+1 @1"]);
  });

  // r[verify platform.trace.references]
  it("keeps lexing after JSX text with an apostrophe", () => {
    const text = ["const v = <p>Don't panic</p>;", "// r[impl x.y]"].join("\n");
    expect(refs("src/client/a.tsx", text)).toEqual(["impl x.y+1 @2"]);
  });
});
