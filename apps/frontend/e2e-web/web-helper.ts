/**
 * Helper utilities for Web E2E tests
 * Provides utilities for interacting with the web version
 */
import { Page, expect } from '@playwright/test';

export interface WebTestContext {
  page: Page;
  baseURL: string;
}

/**
 * Navigate to a specific route in the web app
 */
export async function navigateToRoute(page: Page, route: string): Promise<void> {
  await page.goto(route);
  await page.waitForLoadState('networkidle');
}

/**
 * Wait for the web app to be ready
 */
export async function waitForAppReady(page: Page): Promise<void> {
  // Wait for the main content to be visible
  await page.waitForSelector('[data-testid="app-container"], body', {
    timeout: 30000,
    state: 'visible'
  });

  // Wait for any loading indicators to disappear
  await page.waitForSelector('[data-testid="loading"], .loading', {
    state: 'hidden',
    timeout: 30000
  }).catch(() => {
    // No loading indicator found - that's OK
  });
}

/**
 * Wait for API call to complete
 */
export async function waitForApiCall(page: Page, apiPath: string): Promise<void> {
  await page.waitForResponse(
    response => response.url().includes(apiPath) && response.status() === 200,
    { timeout: 15000 }
  );
}

/**
 * Take a screenshot for debugging
 */
export async function takeDebugScreenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: `./e2e-web/screenshots/${name}-${Date.now()}.png`,
    fullPage: true
  });
}

/**
 * Mock API responses for testing
 */
export async function mockApiResponse(
  page: Page,
  apiPath: string,
  response: unknown,
  status = 200
): Promise<void> {
  await page.route(`**${apiPath}**`, route => {
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(response)
    });
  });
}

/**
 * Wait for WebSocket connection
 */
export async function waitForWebSocket(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    // Check if WebSocket is connected
    return typeof (window as { ws?: { readyState: number } }).ws !== 'undefined' &&
           (window as { ws: { readyState: number } }).ws.readyState === 1;
  }, { timeout: 15000 }).catch(() => {
    // WebSocket may not be used in all tests
  });
}

/**
 * Send WebSocket message
 */
export async function sendWebSocketMessage(page: Page, message: unknown): Promise<void> {
  await page.evaluate((msg) => {
    const ws = (window as { ws?: { send: (data: string) => void } }).ws;
    if (ws) {
      ws.send(JSON.stringify(msg));
    }
  }, message);
}

/**
 * Wait for WebSocket message
 */
export async function waitForWebSocketMessage(
  page: Page,
  predicate: (message: unknown) => boolean
): Promise<unknown> {
  return page.evaluate((pred) => {
    return new Promise((resolve) => {
      const ws = (window as { ws?: { addEventListener: (event: string, handler: (e: MessageEvent) => void) => void } }).ws;
      if (ws) {
        ws.addEventListener('message', (event: MessageEvent) => {
          const data = JSON.parse(event.data);
          if (pred(data)) {
            resolve(data);
          }
        });
      } else {
        resolve(null);
      }
    });
  }, predicate.toString());
}

/**
 * Check responsive layout at different viewports
 */
export async function testResponsiveLayout(
  page: Page,
  viewportSizes: Array<{ width: number; height: number; name: string }>
): Promise<void> {
  for (const viewport of viewportSizes) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(500); // Wait for layout to adjust

    // Verify basic layout elements are visible
    const mainContent = page.locator('main, [role="main"], .main-content').first();
    await expect(mainContent).toBeVisible();

    console.log(`✓ Layout verified at ${viewport.name} (${viewport.width}x${viewport.height})`);
  }
}

/**
 * Verify mobile navigation (hamburger menu)
 */
export async function verifyMobileNavigation(page: Page): Promise<void> {
  // Set mobile viewport
  await page.setViewportSize({ width: 375, height: 667 });

  // Look for hamburger menu button
  const menuButton = page.locator('button[aria-label*="menu"], button[aria-label*="Menu"], .hamburger-menu').first();
  await expect(menuButton).toBeVisible();

  // Click to open menu
  await menuButton.click();

  // Verify menu is open
  const nav = page.locator('nav, [role="navigation"], .mobile-nav').first();
  await expect(nav).toBeVisible();
}

/**
 * Verify accessibility features
 */
export async function verifyAccessibility(page: Page): Promise<void> {
  // Check for proper ARIA labels
  const buttons = page.locator('button');
  const buttonCount = await buttons.count();

  for (let i = 0; i < buttonCount; i++) {
    const button = buttons.nth(i);
    const ariaLabel = await button.getAttribute('aria-label');
    const text = await button.textContent();
    
    // Button should have either aria-label or text content
    if (!ariaLabel && !text?.trim()) {
      console.warn('Button without label found:', await button.innerHTML());
    }
  }

  // Check for keyboard navigation
  await page.keyboard.press('Tab');
  const focusedElement = await page.locator(':focus');
  await expect(focusedElement).toBeVisible();
}

/**
 * Clear browser storage
 */
export async function clearStorage(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

/**
 * Get local storage data
 */
export async function getLocalStorage(page: Page, key: string): Promise<string | null> {
  return page.evaluate((k) => localStorage.getItem(k), key);
}

/**
 * Set local storage data
 */
export async function setLocalStorage(page: Page, key: string, value: string): Promise<void> {
  await page.evaluate(
    ({ k, v }) => localStorage.setItem(k, v),
    { k: key, v: value }
  );
}

/**
 * Wait for element with text
 */
export async function waitForText(page: Page, text: string, timeout = 10000): Promise<void> {
  await page.waitForSelector(`text=${text}`, { timeout });
}

/**
 * Check for console errors
 */
export async function checkConsoleErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  return errors;
}

/**
 * Mock backend API for offline testing
 */
export async function mockBackendAPI(page: Page): Promise<void> {
  // Mock health check
  await mockApiResponse(page, '/api/health', { status: 'ok' });

  // Mock projects list
  await mockApiResponse(page, '/api/projects', { 
    success: true,
    data: []
  });

  // Mock tasks list
  await mockApiResponse(page, '/api/tasks', {
    success: true,
    data: []
  });
}
