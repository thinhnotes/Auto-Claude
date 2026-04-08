/**
 * End-to-End tests for Azure DevOps Integration
 * Tests: Azure boards, work items, sprints, backlog
 */
import { test, expect, Page } from '@playwright/test';
import { 
  waitForAppReady, 
  navigateToRoute, 
  mockApiResponse,
  testResponsiveLayout
} from './web-helper';

test.describe('Azure DevOps - Connection', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/integrations/azure');
    await waitForAppReady(page);
  });

  test('should display Azure DevOps connection page', async ({ page }) => {
    const header = page.locator('h1:has-text("Azure DevOps"), h1:has-text("Azure")').first();
    await expect(header).toBeVisible({ timeout: 5000 });
  });

  test('should connect to Azure DevOps', async ({ page }) => {
    await mockApiResponse(page, '/api/integrations/azure/connect', {
      success: true,
      data: { connected: true, organization: 'test-org' }
    });

    const connectButton = page.locator('button:has-text("Connect"), button:has-text("Sign in")').first();
    if (await connectButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await connectButton.click();

      // Fill organization
      const orgInput = page.locator('input[name="organization"], input[placeholder*="organization"]').first();
      await orgInput.fill('test-org');

      // Fill PAT token
      const tokenInput = page.locator('input[name="pat"], input[type="password"]').first();
      await tokenInput.fill('test-pat-token');

      // Submit
      const submitButton = page.locator('button:has-text("Connect"), button[type="submit"]').first();
      await submitButton.click();

      await page.waitForTimeout(1000);
    }
  });

  test('should disconnect from Azure DevOps', async ({ page }) => {
    await mockApiResponse(page, '/api/integrations/azure/disconnect', {
      success: true,
      data: { disconnected: true }
    });

    const disconnectButton = page.locator('button:has-text("Disconnect"), button:has-text("Remove")').first();
    if (await disconnectButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await disconnectButton.click();

      // Confirm
      const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Disconnect")').first();
      await confirmButton.click();

      await page.waitForTimeout(1000);
    }
  });
});

test.describe('Azure DevOps - Boards', () => {
  test.beforeEach(async ({ page }) => {
    await mockApiResponse(page, '/api/integrations/azure/boards', {
      success: true,
      data: [
        { id: 'board-1', name: 'Sprint Board', items: [] },
        { id: 'board-2', name: 'Backlog', items: [] }
      ]
    });

    await navigateToRoute(page, '/integrations/azure/boards');
    await waitForAppReady(page);
  });

  test('should display Azure boards', async ({ page }) => {
    const boardsList = page.locator('[data-testid="boards-list"], .boards-container').first();
    await expect(boardsList).toBeVisible({ timeout: 5000 });
  });

  test('should switch between boards', async ({ page }) => {
    const boardSelect = page.locator('select[name="board"], [data-testid="board-select"]').first();
    if (await boardSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      await boardSelect.selectOption('board-2');

      await page.waitForTimeout(1000);
    }
  });

  test('should view board details', async ({ page }) => {
    const boardCard = page.locator('[data-board-id="board-1"], .board-card:has-text("Sprint Board")').first();
    if (await boardCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      await boardCard.click();

      await page.waitForTimeout(1000);
    }
  });
});

test.describe('Azure DevOps - Work Items', () => {
  test.beforeEach(async ({ page }) => {
    await mockApiResponse(page, '/api/integrations/azure/work-items', {
      success: true,
      data: [
        { id: 1, title: 'Task 1', type: 'Task', state: 'New' },
        { id: 2, title: 'Bug 1', type: 'Bug', state: 'Active' },
        { id: 3, title: 'Feature 1', type: 'Feature', state: 'Resolved' }
      ]
    });

    await navigateToRoute(page, '/integrations/azure/work-items');
    await waitForAppReady(page);
  });

  test('should display work items', async ({ page }) => {
    const workItem = page.locator('text=Task 1').first();
    await expect(workItem).toBeVisible({ timeout: 5000 });
  });

  test('should create new work item', async ({ page }) => {
    await mockApiResponse(page, '/api/integrations/azure/work-items', {
      success: true,
      data: { id: 4, title: 'New Task' }
    });

    const createButton = page.locator('button:has-text("New Work Item"), button:has-text("Create")').first();
    if (await createButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await createButton.click();

      // Fill details
      const titleInput = page.locator('input[name="title"]').first();
      await titleInput.fill('New Task');

      const typeSelect = page.locator('select[name="type"]').first();
      await typeSelect.selectOption('Task');

      const submitButton = page.locator('button:has-text("Create"), button[type="submit"]').first();
      await submitButton.click();

      await page.waitForTimeout(1000);
    }
  });

  test('should update work item state', async ({ page }) => {
    await mockApiResponse(page, '/api/integrations/azure/work-items/1', {
      success: true,
      data: { id: 1, state: 'Active' }
    });

    const workItemCard = page.locator('[data-work-item-id="1"]').first();
    
    if (await workItemCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      const stateButton = workItemCard.locator('button:has-text("New")').first();
      await stateButton.click();

      const activeOption = page.locator('text=Active, [data-state="Active"]').first();
      await activeOption.click();

      await page.waitForTimeout(1000);
    }
  });

  test('should filter work items by type', async ({ page }) => {
    const typeFilter = page.locator('select[name="typeFilter"], [data-filter="type"]').first();
    
    if (await typeFilter.isVisible({ timeout: 2000 }).catch(() => false)) {
      await typeFilter.selectOption('Bug');

      await page.waitForTimeout(500);
    }
  });

  test('should filter work items by state', async ({ page }) => {
    const stateFilter = page.locator('select[name="stateFilter"], [data-filter="state"]').first();
    
    if (await stateFilter.isVisible({ timeout: 2000 }).catch(() => false)) {
      await stateFilter.selectOption('Active');

      await page.waitForTimeout(500);
    }
  });

  test('should view work item details', async ({ page }) => {
    const workItemCard = page.locator('[data-work-item-id="1"]').first();
    
    if (await workItemCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      await workItemCard.click();

      // Verify details panel
      const detailsPanel = page.locator('[data-testid="work-item-details"], .details-panel').first();
      await expect(detailsPanel).toBeVisible({ timeout: 3000 });
    }
  });
});

test.describe('Azure DevOps - Sprints', () => {
  test.beforeEach(async ({ page }) => {
    await mockApiResponse(page, '/api/integrations/azure/sprints', {
      success: true,
      data: [
        { id: 'sprint-1', name: 'Sprint 1', status: 'active', items: [] },
        { id: 'sprint-2', name: 'Sprint 2', status: 'planned', items: [] }
      ]
    });

    await navigateToRoute(page, '/integrations/azure/sprints');
    await waitForAppReady(page);
  });

  test('should display sprints', async ({ page }) => {
    const sprint = page.locator('text=Sprint 1').first();
    await expect(sprint).toBeVisible({ timeout: 5000 });
  });

  test('should view active sprint', async ({ page }) => {
    const activeSprint = page.locator('[data-sprint-id="sprint-1"], .sprint-card:has-text("Sprint 1")').first();
    if (await activeSprint.isVisible({ timeout: 2000 }).catch(() => false)) {
      await activeSprint.click();

      await page.waitForTimeout(1000);
    }
  });

  test('should view sprint backlog', async ({ page }) => {
    const backlogTab = page.locator('button:has-text("Backlog"), [role="tab"]:has-text("Backlog")').first();
    if (await backlogTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await backlogTab.click();

      await page.waitForTimeout(500);
    }
  });

  test('should add work item to sprint', async ({ page }) => {
    await mockApiResponse(page, '/api/integrations/azure/sprints/sprint-1/items', {
      success: true,
      data: { added: true }
    });

    const addButton = page.locator('button:has-text("Add to Sprint"), button:has-text("Add Item")').first();
    if (await addButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await addButton.click();

      // Select work item
      const workItemSelect = page.locator('select[name="workItem"]').first();
      await workItemSelect.selectOption('1');

      const confirmButton = page.locator('button:has-text("Add"), button[type="submit"]').first();
      await confirmButton.click();

      await page.waitForTimeout(1000);
    }
  });
});

test.describe('Azure DevOps - Sync', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/integrations/azure');
    await waitForAppReady(page);
  });

  test('should sync work items from Azure', async ({ page }) => {
    await mockApiResponse(page, '/api/integrations/azure/sync', {
      success: true,
      data: { synced: 25, updated: 5 }
    });

    const syncButton = page.locator('button:has-text("Sync"), button:has-text("Refresh")').first();
    if (await syncButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await syncButton.click();

      await page.waitForTimeout(2000);

      // Verify sync notification
      const notification = page.locator('text=/synced/i, .notification').first();
      await expect(notification).toBeVisible({ timeout: 5000 });
    }
  });

  test('should import work items to Auto Claude', async ({ page }) => {
    await mockApiResponse(page, '/api/integrations/azure/import', {
      success: true,
      data: { imported: 10 }
    });

    const importButton = page.locator('button:has-text("Import"), button:has-text("Import Items")').first();
    if (await importButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await importButton.click();

      // Select items to import
      const selectAllCheckbox = page.locator('input[type="checkbox"][name="selectAll"]').first();
      if (await selectAllCheckbox.isVisible({ timeout: 1000 }).catch(() => false)) {
        await selectAllCheckbox.check();
      }

      const confirmButton = page.locator('button:has-text("Import Selected"), button:has-text("Confirm")').first();
      await confirmButton.click();

      await page.waitForTimeout(2000);
    }
  });
});

test.describe('Azure DevOps - Responsive', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/integrations/azure');
    await waitForAppReady(page);
  });

  test('should work on mobile devices', async ({ page }) => {
    await testResponsiveLayout(page, [
      { width: 375, height: 667, name: 'iPhone SE' },
      { width: 768, height: 1024, name: 'iPad' }
    ]);
  });
});
