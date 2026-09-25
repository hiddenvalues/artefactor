import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig, type Plugin } from "vite";
import app from "./vite.config";
import { COMPONENTS_DIR, previewGroup, previewId } from "./src/client/design/registry";

// The design catalog (docs/design/README.md): every component's `*.preview.tsx`
// on one page. Its own Vite root, so the app's build never sees it.
//   pnpm design:catalog — the catalog in dev, on http://localhost:5274
//   pnpm design:export  — dist/design: the catalog page plus one standalone page
//                         per preview (components/<id>.html) for `/design-sync`

const root = fileURLToPath(new URL("./src/client/design", import.meta.url));

// Each standalone page is the catalog page narrowed to one preview by a meta
// tag, with Claude design's card marker on its first line.
function standalonePages(): Plugin {
  return {
    name: "artefactor-design-standalone-pages",
    apply: "build",
    writeBundle({ dir }) {
      if (!dir) return;
      const catalog = readFileSync(join(dir, "index.html"), "utf8").replaceAll('"./', '"../');
      const previews = readdirSync(COMPONENTS_DIR, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(".preview.tsx"))
        .map((e) => join(e.parentPath, e.name).split("\\").join("/"));
      mkdirSync(join(dir, "components"), { recursive: true });
      for (const file of previews) {
        const id = previewId(file);
        const page = catalog.replace("<head>", `<head>\n    <meta name="artefactor-preview" content="${id}" />`);
        writeFileSync(join(dir, "components", `${id}.html`), `<!-- @dsCard group="${previewGroup(file)}" -->\n${page}`);
      }
    },
  };
}

export default mergeConfig(
  app,
  defineConfig({
    root,
    base: "./",
    publicDir: false,
    plugins: [standalonePages()],
    build: {
      outDir: fileURLToPath(new URL("./dist/design", import.meta.url)),
      emptyOutDir: true,
      // One bundle holds every preview; it is never served to users.
      chunkSizeWarningLimit: 2048,
    },
    server: { port: 5274, open: "/" },
  }),
);
