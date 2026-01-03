import { defineConfig } from "@playwright/test"

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:4321"

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
})

