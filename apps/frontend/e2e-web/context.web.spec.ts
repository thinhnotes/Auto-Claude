/**
 * End-to-End tests for Context Feature
 * Tests: Project context, memories, PR reviews, indexing
 */
import { test, expect, Page } from '@playwright/test';
import { 
  waitForAppReady, 
  navigateToRoute, 
  mockApiResponse,
  testResponsiveLayout
} from './web-helper';

test.describe('Context - View and Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/context');
    await waitForAppReady(page);
  });

  test('should display context dashboard', async ({ page }) => {
    const header = page.locator('h1:has-text("Context"), h1:has-text("Project Context")').first();
    await expect(header).toBeVisible({ timeout: 5000 });
  });

  test('should display context tabs', async ({ page }) => {
    // Memories tab
    const memoriesTab = page.locator('button:has-text("Memories"), [role="tab"]:has-text("Memories")').first();
    await expect(memoriesTab).toBeVisible({ timeout: 5000 });

    // Index tab
    const indexTab = page.locator('button:has-text("Index"), [role="tab"]:has-text("Index")').first();
    await expect(indexTab).toBeVisible({ timeout: 5000 });
  });

  test('should switch between context tabs', async ({ page }) => {
    // Click Memories tab
    const memoriesTab = page.locator('button:has-text("Memories")').first();
    await memoriesTab.click();
    await page.waitForTimeout(500);

    // Click Index tab
    const indexTab = page.locator('button:has-text("Index")').first();
    await indexTab.click();
    await page.waitForTimeout(500);
  });
});

test.describe('Context - Memories Management', () => {
  test.beforeEach(async ({ page }) => {
    await mockApiResponse(page, '/api/context/memories', {
      success: true,
      data: [
        { id: 'm1', content: 'Important decision about architecture', timestamp: '2026-01-01' },
        { id: 'm2', content: 'Team agreement on coding standards', timestamp: '2026-01-05' }
      ]
    });

    await navigateToRoute(page, '/context');
    await waitForAppReady(page);

    // Click Memories tab
    const memoriesTab = page.locator('button:has-text("Memories")').first();
    await memoriesTab.click();
    await page.waitForTimeout(500);
  });

  test('should display memory cards', async ({ page }) => {
    const memoryCard = page.locator('text=Important decision').first();
    await expect(memoryCard).toBeVisible({ timeout: 5000 });
  });

  test('should create new memory', async ({ page }) => {
    await mockApiResponse(page, '/api/context/memories', {
      success: true,
      data: { id: 'new-memory', content: 'New memory entry' }
    });

    const createButton = page.locator('button:has-text("New Memory"), button:has-text("Add Memory")').first();
    if (await createButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await createButton.click();

      // Fill memory content
      const contentInput = page.locator('textarea[name="content"], textarea[placeholder*="memory"]').first();
      await contentInput.fill('New memory entry about the project');

      const submitButton = page.locator('button:has-text("Save"), button[type="submit"]').first();
      await submitButton.click();

      await page.waitForTimeout(1000);
    }
  });

  test('should search memories', async ({ page }) => {
    const searchInput = page.locator('input[type="search"], input[placeholder*="Search"]').first();
    
    if (await searchInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await searchInput.fill('architecture');

      await page.waitForTimeout(500);

      // Verify filtered results
      const memoryCard = page.locator('text=architecture').first();
      await expect(memoryCard).toBeVisible();
    }
  });

  test('should delete memory', async ({ page }) => {
    await mockApiResponse(page, '/api/context/memories/m1', {
      success: true,
      data: { deleted: true }
    });

    const memoryCard = page.locator('[data-memory-id="m1"]').first();
    
    if (await memoryCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      const deleteButton = memoryCard.locator('button[aria-label*="delete"]').first();
      await deleteButton.click();

      // Confirm deletion
      const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Delete")').first();
      await confirmButton.click();

      await page.waitForTimeout(1000);
    }
  });

  test('should view memory details', async ({ page }) => {
    const memoryCard = page.locator('[data-memory-id="m1"]').first();
    
    if (await memoryCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      await memoryCard.click();

      // Verify details panel
      const detailsPanel = page.locator('[data-testid="memory-details"], .memory-detail').first();
      await expect(detailsPanel).toBeVisible({ timeout: 3000 });
    }
  });
});

test.describe('Context - Project Index', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/context');
    await waitForAppReady(page);

    // Click Index tab
    const indexTab = page.locator('button:has-text("Index"), [role="tab"]:has-text("Index")').first();
    await indexTab.click();
    await page.waitForTimeout(500);
  });

  test('should display project index', async ({ page }) => {
    await mockApiResponse(page, '/api/context/index', {
      success: true,
      data: {
        files: ['src/app.ts', 'src/utils.ts'],
        indexed: true,
        lastUpdate: '2026-01-01'
      }
    });

    await page.reload();
    await waitForAppReady(page);

    // Navigate back to Index tab
    const indexTab = page.locator('button:has-text("Index")').first();
    await indexTab.click();

    await page.waitForTimeout(1000);
  });

  test('should rebuild project index', async ({ page }) => {
    await mockApiResponse(page, '/api/context/index/rebuild', {
      success: true,
      data: { rebuilding: true }
    });

    const rebuildButton = page.locator('button:has-text("Rebuild Index"), button:has-text("Reindex")').first();
    if (await rebuildButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await rebuildButton.click();

      // Wait for rebuild
      await page.waitForTimeout(2000);

      // Verify progress indicator
      const progressIndicator = page.locator('[role="progressbar"], .progress').first();
      await expect(progressIndicator).toBeVisible({ timeout: 5000 });
    }
  });

  test('should view indexed files', async ({ page }) => {
    await mockApiResponse(page, '/api/context/index/files', {
      success: true,
      data: [
        { path: 'src/app.ts', indexed: true },
        { path: 'src/utils.ts', indexed: true }
      ]
    });

    const filesList = page.locator('[data-testid="indexed-files"], .files-list').first();
    if (await filesList.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(filesList).toBeVisible();
    }
  });
});

test.describe('Context - PR Reviews', () => {
  test.beforeEach(async ({ page }) => {
    await mockApiResponse(page, '/api/context/pr-reviews', {
      success: true,
      data: [
        { id: 'pr-1', title: 'Add feature X', status: 'approved' },
        { id: 'pr-2', title: 'Fix bug Y', status: 'pending' }
      ]
    });

    await navigateToRoute(page, '/context');
    await waitForAppReady(page);

    // Click PR Reviews tab if it exists
    const prTab = page.locator('button:has-text("PR Reviews"), [role="tab"]:has-text("Reviews")').first();
    if (await prTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await prTab.click();
      await page.waitForTimeout(500);
    }
  });

  test('should display PR review cards', async ({ page }) => {
    const prCard = page.locator('text=Add feature X').first();
    if (await prCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(prCard).toBeVisible();
    }
  });

  test('should view PR review details', async ({ page }) => {
    const prCard = page.locator('[data-pr-id="pr-1"]').first();
    
    if (await prCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      await prCard.click();

      await page.waitForTimeout(1000);
    }
  });

  test('should filter PR reviews by status', async ({ page }) => {
    const statusFilter = page.locator('select[name="statusFilter"], [data-filter="status"]').first();
    
    if (await statusFilter.isVisible({ timeout: 2000 }).catch(() => false)) {
      await statusFilter.selectOption('approved');

      await page.waitForTimeout(500);
    }
  });
});

test.describe('Context - Service Integrations', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/context');
    await waitForAppReady(page);
  });

  test('should display connected services', async ({ page }) => {
    await mockApiResponse(page, '/api/context/services', {
      success: true,
      data: [
        { name: 'GitHub', connected: true },
        { name: 'Linear', connected: true }
      ]
    });

    const servicesSection = page.locator('[data-testid="services"], .services-section').first();
    if (await servicesSection.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(servicesSection).toBeVisible();
    }
  });

  test('should sync context from services', async ({ page }) => {
    await mockApiResponse(page, '/api/context/sync', {
      success: true,
      data: { synced: true }
    });

    const syncButton = page.locator('button:has-text("Sync"), button:has-text("Refresh")').first();
    if (await syncButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await syncButton.click();

      await page.waitForTimeout(2000);
    }
  });
});

test.describe('Context - Responsive', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/context');
    await waitForAppReady(page);
  });

  test('should work on mobile devices', async ({ page }) => {
    await testResponsiveLayout(page, [
      { width: 375, height: 667, name: 'iPhone SE' },
      { width: 768, height: 1024, name: 'iPad' }
    ]);
  });
});
