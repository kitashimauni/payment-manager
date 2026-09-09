import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vitest/config";

const repositoryRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(repositoryRoot, "src"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
