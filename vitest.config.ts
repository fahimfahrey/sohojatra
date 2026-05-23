import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // `server-only` is a Next.js boundary marker that throws when imported
      // from a client bundle. Node test runs don't ship it; stub it out so
      // any module that imports it can still be required in tests.
      "server-only": fileURLToPath(
        new URL("./tests/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    setupFiles: ["tests/setup.ts"],
  },
});
