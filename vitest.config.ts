import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  esbuild: { jsx: "automatic" },
  // Node built-in runner owns governance scripts; Vitest should not collect them.
  test: { exclude: [...configDefaults.exclude, "scripts/*.test.mjs"] },
});
