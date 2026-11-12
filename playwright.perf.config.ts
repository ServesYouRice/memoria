import { defineConfig, devices } from "@playwright/test";

/**
 * IMP-103 — canvas speed check against the production image (`pnpm gate
 * perf`). One browser, one worker and no retries, so a missed budget fails.
 */
export default defineConfig({
  testDir: "./tests/perf",
  testMatch: "**/*.perf.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results/perf-playwright",
  timeout: 240_000,
  use: {
    baseURL: process.env["BASE_URL"] || "http://localhost:3000",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
