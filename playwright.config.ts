import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? "github" : "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "mise exec -- pnpm start",
    url: "http://localhost:3000",
    reuseExistingServer: !isCI,
    timeout: 120_000,
    env: {
      AUTH_SECRET: "",
      AUTH_GOOGLE_ID: "",
      AUTH_GOOGLE_SECRET: "",
    },
  },
});
