import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "istanbul",
      reportsDirectory: "coverage",
      reporter: ["text", "lcov"]
    }
  }
});
