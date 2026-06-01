import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "output/playwright/html-report", open: "never" }],
  ],
  outputDir: "output/playwright/test-results",
  // Server actions re-fetch server components against a remote Supabase, so a
  // successful mutation can take a few seconds to reflect via router.refresh().
  // Give assertions headroom beyond the 5s default.
  expect: { timeout: 15000 },
  timeout: 60000,
  use: {
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run build && npm run start:e2e",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      E2E_AUTH_BYPASS: "1",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
