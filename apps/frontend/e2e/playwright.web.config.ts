/**
 * Playwright configuration for Web E2E tests
 * Tests the web frontend against the backend API
 */
import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5173';
const API_URL = process.env.E2E_API_URL || 'http://localhost:8000';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.web.e2e.ts',
  timeout: 60_000,
  expect: {
    timeout: 15_000
  },
  fullyParallel: false, // Run tests serially to avoid state conflicts
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { outputFolder: 'playwright-report-web' }],
    ['list']
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    // Increase timeouts for real API calls
    actionTimeout: 15_000,
    navigationTimeout: 30_000
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] }
    }
  ]
  // NOTE: Run `npm run web` from project root before running tests
  // webServer is disabled - start servers manually with: npm run web
});
