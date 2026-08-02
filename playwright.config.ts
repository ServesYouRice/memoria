import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // Release evidence uses real registration and Auth.js sessions. Opt-in Percy
  // visual specs are run separately by the test:visual command.
  testMatch: "**/*.spec.ts",
  testIgnore: "visual/**",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  // The production stack intentionally rate-limits one client IP. Docker NAT
  // makes every browser worker share that IP, so release journeys run serially.
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  outputDir: "test-results/playwright",
  timeout: 60_000,
  use: {
    baseURL: process.env["BASE_URL"] || "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],

  webServer: process.env["E2E_EXTERNAL_SERVER"]
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env["CI"],
      },
});
