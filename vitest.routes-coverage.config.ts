import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "./vitest.config";

/**
 * Explicit API Route Coverage Config (IMP-061).
 *
 * Dedicated whole-source coverage denominator for all API route handlers.
 * Unlike the loaded-file primary coverage report, every `src/app/api/**\/route.ts`
 * file appears in this denominator, with untouched files reporting at zero.
 *
 * Baseline measured after IMP-055 through IMP-060 and IMP-062 through IMP-066 landed:
 * - Commit: ff9c51a
 * - Route files in denominator: 73
 * - Zero-covered routes: 32 (41 covered or partially covered)
 * - Measured metrics:
 *   - Statements: 36.99% (691/1868)
 *   - Branches: 26.90% (276/1026)
 *   - Functions: 45.45% (100/220)
 *   - Lines: 37.41% (685/1831)
 *
 * Thresholds are set with a tight margin just below measured values to prevent
 * regression or silent loss of route coverage.
 */
export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      coverage: {
        provider: "v8",
        reporter: ["text", "json", "html", "json-summary"],
        reportsDirectory: "./coverage/routes",
        include: ["src/app/api/**/route.ts"],
        exclude: [],
        thresholds: {
          lines: 37,
          statements: 36,
          functions: 45,
          branches: 26,
        },
      },
    },
  }),
);
