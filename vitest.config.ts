import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Amplify injects AUTH_MODE and DATA_MODE for the production bake. Tests
    // opt into those modes themselves. Clear inherited values before each file
    // so `npm test` matches the isolated Amplify preBuild commands.
    setupFiles: ["./tests/setup-env.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
