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
      // TST-01: enforced non-regression floor. These numbers sit just below the
      // current measured coverage (lines/statements ~8.4%, functions ~29%,
      // branches ~51%); the global rate is diluted by the large, still-untested
      // UI component tree. Ratchet these upward as behavioral coverage lands on
      // collab/uploads/AI/agent/middleware (TST-02) — never lower them.
      thresholds: {
        lines: 8,
        statements: 8,
        functions: 28,
        branches: 50,
      },
    },
  },
});
