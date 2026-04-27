import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated + test artefacts.
    "src/generated/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    // Nested git worktrees (Claude Code spawns these under .claude/worktrees/).
    // Each one carries its own .next build output that eslint would otherwise
    // descend into — surfacing tens of thousands of false-positive errors from
    // compiled webpack/turbopack chunks. Top-level `.next/**` only matches the
    // root build dir, not these nested ones.
    ".claude/**",
  ]),
  // The new React-19/React-Compiler rules shipped in eslint-config-next flag
  // a large amount of pre-existing code. Keep them visible as warnings for
  // now; tracked in follow-up to fix case-by-case (setState-in-effect vs.
  // useSyncExternalStore vs. derived state).
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      // Underscore-prefixed args/vars are the conventional "intentionally
      // unused" marker; keep them for documentation / future use without lint
      // noise.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // Playwright specs have their own test globals (`test`, `expect`) and
  // shouldn't be checked with React rules.
  {
    files: ["e2e/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
]);

export default eslintConfig;
