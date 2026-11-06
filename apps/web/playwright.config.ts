import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  expect: {
    timeout: 30000,
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "https://deeptutor.notesvnn.click",
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
  },
  reporter: [["list"]],
});
