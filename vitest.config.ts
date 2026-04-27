import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // Keep Playwright specs and integration tests (separate config) out of
    // the unit-test runner.
    exclude: [
      "node_modules",
      "dist",
      ".next",
      "e2e/**",
      "tests/integration/**",
      // Nested git worktrees (Claude Code spawns these under .claude/worktrees/).
      // Without this, vitest discovers and runs each worktree's test suite —
      // exploding test counts and failing on integration tests that the root
      // exclude above already filters out.
      ".claude/**",
    ],
    // Per-file DOM tests can opt in with: // @vitest-environment jsdom
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/lib/**", "src/app/api/**", "src/scripts/**"],
      exclude: [
        "src/generated/**",
        "**/*.test.*",
        "**/*.d.ts",
        "src/scripts/backup-data.ts",
        "src/scripts/restore-data.ts",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
