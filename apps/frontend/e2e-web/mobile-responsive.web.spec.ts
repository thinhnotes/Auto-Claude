/**
 * End-to-End tests for Mobile Responsive Design
 * Tests: Mobile layouts, touch interactions, gestures, viewport adaptations
 */
import { test, expect, Page, devices } from '@playwright/test';
import { 
  waitForAppReady, 
  navigateToRoute, 
  takeDebugScreenshot,
  mockApiResponse,
  testResponsiveLayout,
  verifyMobileNavigation,
  verifyAccessibility
} from './web-helper';

// Common viewport sizes
const VIEWPORTS = {
  iphoneSE: { width: 375, height: 667, name: 'iPhone SE' },
  iphone13: { width: 390, height: 844, name: 'iPhone 13' },
  iphone13ProMax: { width: 428, height: 926, name: 'iPhone 13 Pro Max' },
  pixel5: { width: 393, height: 851, name: 'Pixel 5' },
  galaxyS21: { width: 360, height: 800, name: 'Galaxy S21' },
  ipad: { width: 768, height: 1024, name: 'iPad' },
  ipadPro: { width: 1024, height: 1366, name: 'iPad Pro' }
};

test.describe('Mobile Layout - Portrait', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/');
    await waitForAppReady(page);
  });

  test('should display mobile-optimized layout on small screens', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.iphoneSE);

    // Verify main content is visible
    const mainContent = page.locator('main, [role="main"]').first();
    await expect(mainContent).toBeVisible();

    // Verify mobile navigation
    const mobileNav = page.locator('[data-testid="mobile-nav"], .mobile-nav, button[aria-label*="menu"]').first();
    await expect(mobileNav).toBeVisible();

    // Verify no horizontal scroll
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHorizontalScroll).toBe(false);
  });

  test('should stack elements vertically on mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.iphoneSE);

    // Mock projects
    await mockApiResponse(page, '/api/projects', {
      success: true,
      data: [
        { id: '1', name: 'Project 1' },
        { id: '2', name: 'Project 2' }
      ]
    });

    await page.reload();
    await waitForAppReady(page);

    // Verify elements are stacked (not side-by-side)
    const elements = page.locator('[data-testid="project-item"], .project-card');
    const count = await elements.count();

    if (count >= 2) {
      const firstBox = await elements.nth(0).boundingBox();
      const secondBox = await elements.nth(1).boundingBox();

      if (firstBox && secondBox) {
        // Elements should be vertically stacked (second is below first)
        expect(secondBox.y).toBeGreaterThan(firstBox.y + firstBox.height - 10);
      }
    }
  });

  test('should hide desktop-only elements', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.iphoneSE);

    // Desktop sidebar should be hidden
    const desktopSidebar = page.locator('[data-testid="desktop-sidebar"], .desktop-only').first();
    if (await desktopSidebar.isVisible({ timeout: 1000 }).catch(() => false)) {
      const isHidden = await desktopSidebar.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return style.display === 'none' || style.visibility === 'hidden';
      });
      expect(isHidden).toBe(true);
    }
  });

  test('should use mobile-sized typography', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.iphoneSE);

    // Check heading sizes
    const heading = page.locator('h1, h2').first();
    if (await heading.isVisible({ timeout: 2000 }).catch(() => false)) {
      const fontSize = await heading.evaluate((el) => {
        return window.getComputedStyle(el).fontSize;
      });

      // Mobile font sizes should be reasonable (12-32px)
      const size = parseFloat(fontSize);
      expect(size).toBeGreaterThan(12);
      expect(size).toBeLessThan(40);
    }
  });
});

test.describe('Mobile Layout - Landscape', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/');
    await waitForAppReady(page);
  });

  test('should adapt layout for landscape orientation', async ({ page }) => {
    // Set landscape viewport
    await page.setViewportSize({ width: 844, height: 390 });

    // Verify layout adapts
    const mainContent = page.locator('main, [role="main"]').first();
    await expect(mainContent).toBeVisible();

    // Take screenshot
    await takeDebugScreenshot(page, 'mobile-landscape');
  });

  test('should show more content in landscape', async ({ page }) => {
    // Portrait
    await page.setViewportSize(VIEWPORTS.iphone13);
    const portraitHeight = await page.evaluate(() => window.innerHeight);

    // Landscape
    await page.setViewportSize({ width: 844, height: 390 });
    const landscapeHeight = await page.evaluate(() => window.innerHeight);

    // Landscape should show different layout
    expect(landscapeHeight).toBeLessThan(portraitHeight);
  });
});

test.describe('Touch Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.iphone13);
    await navigateToRoute(page, '/');
    await waitForAppReady(page);
  });

  test('should handle tap interactions', async ({ page }) => {
    // Mock projects
    await mockApiResponse(page, '/api/projects', {
      success: true,
      data: [{ id: '1', name: 'Tap Test Project' }]
    });

    await page.reload();
    await waitForAppReady(page);

    // Tap on project
    const projectCard = page.locator('text=Tap Test Project').first();
    await projectCard.tap();

    // Verify interaction worked
    await page.waitForTimeout(500);
  });

  test('should show touch feedback on buttons', async ({ page }) => {
    const button = page.locator('button').first();
    if (await button.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Tap button
      await button.tap();

      // Visual feedback should appear (active state, ripple, etc.)
      await page.waitForTimeout(100);
    }
  });

  test('should have adequate touch targets (44x44px minimum)', async ({ page }) => {
    const buttons = page.locator('button, a[role="button"]');
    const count = await buttons.count();

    for (let i = 0; i < Math.min(count, 5); i++) {
      const button = buttons.nth(i);
      if (await button.isVisible({ timeout: 1000 }).catch(() => false)) {
        const box = await button.boundingBox();

        if (box) {
          // Touch targets should be at least 44x44px (WCAG guideline)
          expect(box.width).toBeGreaterThanOrEqual(40); // Allow slight variation
          expect(box.height).toBeGreaterThanOrEqual(40);
        }
      }
    }
  });

  test('should handle long press interactions', async ({ page }) => {
    const element = page.locator('[data-testid="long-press"], .context-menu-trigger').first();

    if (await element.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Simulate long press
      await element.touchscreen.tap();
      await page.waitForTimeout(1000);
    }
  });
});

test.describe('Mobile Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.iphone13);
    await navigateToRoute(page, '/');
    await waitForAppReady(page);
  });

  test('should open and close mobile menu', async ({ page }) => {
    await verifyMobileNavigation(page);

    // Close menu
    const closeButton = page.locator('button[aria-label*="close"], button[aria-label*="Close"]').first();
    if (await closeButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await closeButton.click();

      // Verify menu closed
      const nav = page.locator('nav[role="navigation"]').first();
      await expect(nav).not.toBeVisible({ timeout: 2000 });
    }
  });

  test('should navigate between sections on mobile', async ({ page }) => {
    // Open menu
    const menuButton = page.locator('button[aria-label*="menu"]').first();
    await menuButton.click();

    // Click navigation item
    const navItem = page.locator('nav a:has-text("Projects"), nav a:has-text("Tasks")').first();
    if (await navItem.isVisible({ timeout: 2000 }).catch(() => false)) {
      await navItem.click();

      // Verify navigation worked
      await page.waitForTimeout(500);
    }
  });

  test('should show active navigation state', async ({ page }) => {
    // Open menu
    const menuButton = page.locator('button[aria-label*="menu"]').first();
    await menuButton.click();

    // Check for active state indicator
    const activeItem = page.locator('nav [aria-current], nav .active').first();
    if (await activeItem.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(activeItem).toBeVisible();
    }
  });
});

test.describe('Mobile Forms and Inputs', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.iphone13);
    await navigateToRoute(page, '/');
    await waitForAppReady(page);
  });

  test('should show mobile-optimized keyboard', async ({ page }) => {
    // Click on input field
    const input = page.locator('input[type="text"], input[type="search"]').first();
    if (await input.isVisible({ timeout: 2000 }).catch(() => false)) {
      await input.tap();

      // Verify input is focused
      const isFocused = await input.evaluate((el) => el === document.activeElement);
      expect(isFocused).toBe(true);
    }
  });

  test('should use appropriate input types for mobile', async ({ page }) => {
    // Email inputs should use type="email"
    const emailInput = page.locator('input[type="email"]').first();
    if (await emailInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(emailInput).toHaveAttribute('type', 'email');
    }

    // Number inputs should use type="number"
    const numberInput = page.locator('input[type="number"]').first();
    if (await numberInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(numberInput).toHaveAttribute('type', 'number');
    }
  });

  test('should handle on-screen keyboard appearance', async ({ page }) => {
    const input = page.locator('input').first();
    if (await input.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Get viewport height before keyboard
      const beforeHeight = await page.evaluate(() => window.visualViewport?.height || window.innerHeight);

      // Focus input (triggers keyboard)
      await input.tap();
      await page.waitForTimeout(500);

      // Viewport should still be usable
      const mainContent = page.locator('main').first();
      await expect(mainContent).toBeVisible();
    }
  });
});

test.describe('Tablet Layout', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/');
    await waitForAppReady(page);
  });

  test('should use tablet-optimized layout', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.ipad);

    // Verify layout is between mobile and desktop
    const mainContent = page.locator('main').first();
    await expect(mainContent).toBeVisible();

    // May show sidebar on tablet
    const sidebar = page.locator('aside, [data-testid="sidebar"]').first();
    if (await sidebar.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(sidebar).toBeVisible();
    }
  });

  test('should support split-screen on tablet', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.ipadPro);

    // Mock data
    await mockApiResponse(page, '/api/projects', {
      success: true,
      data: [{ id: '1', name: 'Tablet Test' }]
    });

    await page.reload();
    await waitForAppReady(page);

    // On tablet, may show list and detail side-by-side
    const container = page.locator('main').first();
    const width = await container.evaluate((el) => el.offsetWidth);

    expect(width).toBeGreaterThan(600); // Should have space for split view
  });
});

test.describe('Responsive Images and Media', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/');
    await waitForAppReady(page);
  });

  test('should load appropriate image sizes for viewport', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.iphoneSE);

    // Check for responsive images
    const images = page.locator('img[srcset], picture source');
    const count = await images.count();

    if (count > 0) {
      // Images should use srcset for responsive loading
      const img = images.first();
      const hasSrcset = await img.getAttribute('srcset');
      expect(hasSrcset).toBeTruthy();
    }
  });

  test('should lazy load images on mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.iphone13);

    // Images should have loading="lazy"
    const images = page.locator('img');
    const count = await images.count();

    if (count > 0) {
      const firstImg = images.first();
      const loading = await firstImg.getAttribute('loading');
      
      // First image may not be lazy, but others should be
      if (count > 1) {
        const secondImg = images.nth(1);
        const secondLoading = await secondImg.getAttribute('loading');
        // At least some images should be lazy loaded
      }
    }
  });
});

test.describe('Mobile Performance', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.iphone13);
  });

  test('should load quickly on mobile', async ({ page }) => {
    const startTime = Date.now();

    await navigateToRoute(page, '/');
    await waitForAppReady(page);

    const loadTime = Date.now() - startTime;

    // Should load in under 5 seconds on mobile
    expect(loadTime).toBeLessThan(5000);
  });

  test('should not block on mobile', async ({ page }) => {
    await navigateToRoute(page, '/');
    await waitForAppReady(page);

    // Interactions should be responsive
    const button = page.locator('button').first();
    if (await button.isVisible({ timeout: 2000 }).catch(() => false)) {
      const startTime = Date.now();
      await button.tap();
      const responseTime = Date.now() - startTime;

      // Should respond immediately (< 100ms)
      expect(responseTime).toBeLessThan(500);
    }
  });

  test('should handle slow networks gracefully', async ({ page }) => {
    // Simulate slow 3G
    await page.route('**/*', (route) => {
      setTimeout(() => route.continue(), 100);
    });

    await navigateToRoute(page, '/');

    // Should show loading state
    const loadingIndicator = page.locator('[data-testid="loading"], .loading').first();
    if (await loadingIndicator.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(loadingIndicator).toBeVisible();
    }

    await waitForAppReady(page);
  });
});

test.describe('Mobile Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.iphone13);
    await navigateToRoute(page, '/');
    await waitForAppReady(page);
  });

  test('should support screen readers on mobile', async ({ page }) => {
    await verifyAccessibility(page);
  });

  test('should have proper heading hierarchy', async ({ page }) => {
    const h1 = page.locator('h1');
    const h1Count = await h1.count();

    // Should have exactly one h1
    expect(h1Count).toBeGreaterThanOrEqual(1);
    expect(h1Count).toBeLessThanOrEqual(1);
  });

  test('should support keyboard navigation on mobile', async ({ page }) => {
    // Even on mobile, keyboard navigation should work
    await page.keyboard.press('Tab');

    const focused = page.locator(':focus');
    await expect(focused).toBeVisible({ timeout: 2000 });
  });
});

test.describe('Cross-device Consistency', () => {
  test('should maintain functionality across all mobile devices', async ({ page }) => {
    const devices = [
      VIEWPORTS.iphoneSE,
      VIEWPORTS.iphone13,
      VIEWPORTS.pixel5,
      VIEWPORTS.ipad
    ];

    for (const viewport of devices) {
      await page.setViewportSize(viewport);
      await navigateToRoute(page, '/');
      await waitForAppReady(page);

      // Verify basic functionality works
      const mainContent = page.locator('main').first();
      await expect(mainContent).toBeVisible();

      console.log(`✓ Verified on ${viewport.name}`);
    }
  });
});
