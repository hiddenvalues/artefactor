import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The client's `$lib` alias (vite.config.ts), so a test can render a component.
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL("./src/client/lib", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
  },
});
