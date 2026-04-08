/**
 * Playwright configuration for Web E2E tests
 * Tests the browser-based web version of Auto Claude
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.web.spec.ts',
  timeout: 90_000, // Longer timeout for Docker-based tests
  expect: {
    timeout: 15_000
  },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report-web' }],
    ['json', { outputFile: 'test-results-web.json' }],
    ['list']
  ],
  use: {
    baseURL: process.env.WEB_BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Extended navigation timeout for slow Docker starts
    navigationTimeout: 30_000,
    actionTimeout: 15_000
  },
  projects: [
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        // Enable WebSocket support
        contextOptions: {
          acceptDownloads: true
        }
      }
    },
    {
      name: 'firefox',
      use: { 
        ...devices['Desktop Firefox'],
        contextOptions: {
          acceptDownloads: true
        }
      }
    },
    {
      name: 'webkit',
      use: { 
        ...devices['Desktop Safari'],
        contextOptions: {
          acceptDownloads: true
        }
      }
    },
    // Mobile viewports
    {
      name: 'mobile-chrome',
      use: { 
        ...devices['Pixel 5']
      }
    },
    {
      name: 'mobile-safari',
      use: { 
        ...devices['iPhone 13']
      }
    },
    // Tablet viewports
    {
      name: 'tablet',
      use: { 
        ...devices['iPad Pro']
      }
    }
  ],
  // Web server configuration for local development
  webServer: process.env.CI ? undefined : {
    command: 'npm run dev:web',
    url: 'http://localhost:5173',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe'
  }
});
