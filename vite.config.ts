import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { THEME_BOOT_JS } from "./src/shared/theme-boot";

// S45 — inline the theme boot script at the top of index.html's <head>, ahead
// of every stylesheet, so a dark-mode visitor never sees a light first paint.
// The host shell inlines the same string (src/server/runtime/shell.ts).
const themeBoot = (): Plugin => ({
  name: "artefactor-theme-boot",
  transformIndexHtml: () => [{ tag: "script", children: THEME_BOOT_JS, injectTo: "head-prepend" }],
});

export default defineConfig({
  plugins: [react(), tailwindcss(), themeBoot()],
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL("./src/client/lib", import.meta.url)),
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
  server: {
    // Dedicated, deterministic dev port (5173 commonly collides with other Vite
    // projects). strictPort makes a collision fail loudly instead of silently
    // drifting to 5174+, which would break BetterAuth's trusted-origin check.
    port: 5273,
    strictPort: true,
    // Proxy API + health + served artefacts to the Hono server during
    // development. `/a/` (trailing slash) targets the slug-serving route
    // (`/a/:slug` host shell + `/a/:slug/frame`) without swallowing `/assets`.
    proxy: {
      "/api": "http://localhost:3000",
      "/health": "http://localhost:3000",
      "/a/": "http://localhost:3000",
    },
  },
});
