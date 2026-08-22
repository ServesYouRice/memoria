import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    // The @mui/icons-material barrel resolves to one module per icon. Left
    // unbundled it opens thousands of files at once and trips EMFILE on
    // Windows, so pre-bundle it into a single dependency chunk.
    deps: {
      optimizer: {
        client: {
          enabled: true,
          include: ["@mui/icons-material"],
        },
      },
    },
    exclude: [
      "**/node_modules/**",
      "**/.pnpm/**",
      "e2e/**",
      "tests/e2e/**",
      "tests/e2e/visual/**",
      "tests/integration/**",
      "**/.claude/worktrees/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "tests/",
        "e2e/",
        "scripts/**",
        "prisma/**",
        ".next/**",
        "src/types/**",
      ],
      // TST-01: enforced non-regression floor, re-baselined against the first
      // run of a fully collecting suite.
      //
      // The previous numbers (lines/statements 8, functions 28, branches 50)
      // could not have been measured against a passing run: three suites threw
      // during collection, so `pnpm test:coverage` failed before reporting, and
      // CI had not reached this step at all while the pnpm pin was broken. That
      // made the floor unenforced rather than met.
      //
      // Measured now that all 59 files collect: statements 51.15, branches
      // 43.88, functions 49.91, lines 52.45. Each threshold sits just under its
      // measurement. Three of the four tighten by a wide margin; branches moves
      // down because repairing collection loaded far more of the tree into the
      // denominator than the old figure was taken over.
      //
      // Ratchet upward as behavioral coverage lands (IMP-056 through IMP-061).
      // Never lower one to make a red run pass.
      thresholds: {
        lines: 52,
        statements: 51,
        functions: 49,
        branches: 43,
      },
    },
  },
});
