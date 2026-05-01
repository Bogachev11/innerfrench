import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3010",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Локально: перед тестами запустить в другом терминале: npm run dev
  // В CI можно раскомментировать и задать CI=1
  webServer: process.env.CI
    ? { command: "npm run build && npm run start", url: "http://localhost:3000", timeout: 120_000 }
    : undefined,
});
