/**
 * Playwright configuration for Docker-based Web E2E tests
 * Tests the containerized web version with backend
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.web.spec.ts',
  timeout: 120_000, // Longer timeout for Docker environments
  expect: {
    timeout: 20_000
  },
  fullyParallel: false, // Run serially in Docker
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 1,
  workers: 1, // Single worker for Docker
  reporter: [
    ['html', { outputFolder: 'playwright-report-docker' }],
    ['json', { outputFile: 'test-results-docker.json' }],
    ['list'],
    ['junit', { outputFile: 'test-results-docker.xml' }]
  ],
  use: {
    baseURL: process.env.DOCKER_WEB_URL || 'http://localhost:3001',
    trace: 'on',
    screenshot: 'on',
    video: 'on',
    // Extended timeouts for Docker
    navigationTimeout: 60_000,
    actionTimeout: 20_000
  },
  projects: [
    {
      name: 'docker-chromium',
      use: { 
        ...devices['Desktop Chrome'],
        contextOptions: {
          acceptDownloads: true
        }
      }
    }
  ],
  // Global setup/teardown for Docker
  globalSetup: require.resolve('./docker-setup.ts'),
  globalTeardown: require.resolve('./docker-teardown.ts')
});
