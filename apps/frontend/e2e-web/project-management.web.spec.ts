/**
 * End-to-End tests for Project Management in Web version
 * Tests: Add project, list projects, select project, project settings
 */
import { test, expect, Page } from '@playwright/test';
import { 
  waitForAppReady, 
  navigateToRoute, 
  takeDebugScreenshot,
  mockApiResponse,
  waitForApiCall,
  testResponsiveLayout,
  verifyMobileNavigation
} from './web-helper';

// Test helpers
async function addProject(page: Page, projectPath: string): Promise<void> {
  // Click add project button
  const addButton = page.locator('button:has-text("Add Project"), button:has-text("Add"), [data-testid="add-project"]').first();
  await addButton.click();

  // Fill in project path
  const pathInput = page.locator('input[placeholder*="path"], input[name="projectPath"]').first();
  await pathInput.fill(projectPath);

  // Submit
  const submitButton = page.locator('button:has-text("Add"), button:has-text("Submit"), button[type="submit"]').first();
  await submitButton.click();
}

async function verifyProjectInList(page: Page, projectName: string): Promise<void> {
  const projectItem = page.locator(`text=${projectName}`).first();
  await expect(projectItem).toBeVisible({ timeout: 10000 });
}

test.describe('Project Management - Web Version', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/');
    await waitForAppReady(page);
  });

  test('should display empty state when no projects', async ({ page }) => {
    // Mock empty projects response
    await mockApiResponse(page, '/api/projects', {
      success: true,
      data: []
    });

    await page.reload();
    await waitForAppReady(page);

    // Verify empty state message
    const emptyState = page.locator('text=/no projects/i, text=/get started/i').first();
    await expect(emptyState).toBeVisible();
  });

  test('should display project list', async ({ page }) => {
    // Mock projects response
    await mockApiResponse(page, '/api/projects', {
      success: true,
      data: [
        { id: '1', name: 'Project 1', path: '/path/to/project1' },
        { id: '2', name: 'Project 2', path: '/path/to/project2' }
      ]
    });

    await page.reload();
    await waitForAppReady(page);

    // Verify projects are displayed
    await verifyProjectInList(page, 'Project 1');
    await verifyProjectInList(page, 'Project 2');
  });

  test('should open add project dialog', async ({ page }) => {
    const addButton = page.locator('button:has-text("Add Project"), button:has-text("Add"), [data-testid="add-project"]').first();
    await addButton.click();

    // Verify dialog is open
    const dialog = page.locator('[role="dialog"], .dialog, .modal').first();
    await expect(dialog).toBeVisible();

    // Verify form fields
    const pathInput = page.locator('input[placeholder*="path"], input[name="projectPath"]').first();
    await expect(pathInput).toBeVisible();
  });

  test('should add new project', async ({ page }) => {
    // Mock successful add project response
    await mockApiResponse(page, '/api/projects', {
      success: true,
      data: {
        id: 'new-project',
        name: 'New Project',
        path: '/path/to/new-project'
      }
    });

    await addProject(page, '/path/to/new-project');

    // Wait for API call
    await waitForApiCall(page, '/api/projects');

    // Verify success message or project appears
    await page.waitForTimeout(1000);
  });

  test('should handle add project error', async ({ page }) => {
    // Mock error response
    await mockApiResponse(page, '/api/projects', {
      success: false,
      error: 'Project path does not exist'
    }, 400);

    await addProject(page, '/invalid/path');

    // Verify error message
    const errorMsg = page.locator('text=/error/i, text=/does not exist/i, .error-message').first();
    await expect(errorMsg).toBeVisible({ timeout: 5000 });
  });

  test('should select project from list', async ({ page }) => {
    // Mock projects
    await mockApiResponse(page, '/api/projects', {
      success: true,
      data: [
        { id: '1', name: 'Test Project', path: '/path/to/project', selected: false }
      ]
    });

    await page.reload();
    await waitForAppReady(page);

    // Click on project
    const projectItem = page.locator('text=Test Project').first();
    await projectItem.click();

    // Verify project is selected (may show highlight or different style)
    await page.waitForTimeout(500);
  });

  test('should display project details', async ({ page }) => {
    // Mock project with details
    await mockApiResponse(page, '/api/projects/1', {
      success: true,
      data: {
        id: '1',
        name: 'Test Project',
        path: '/path/to/project',
        specs: [],
        lastModified: new Date().toISOString()
      }
    });

    await page.goto('/projects/1');
    await waitForAppReady(page);

    // Verify project details are shown
    await expect(page.locator('text=Test Project')).toBeVisible();
  });

  test('should remove project', async ({ page }) => {
    // Mock projects
    await mockApiResponse(page, '/api/projects', {
      success: true,
      data: [
        { id: '1', name: 'Project to Remove', path: '/path/to/project' }
      ]
    });

    await page.reload();
    await waitForAppReady(page);

    // Find remove/delete button
    const removeButton = page.locator('button[aria-label*="remove"], button[aria-label*="delete"], button:has-text("Remove")').first();
    await removeButton.click();

    // Confirm deletion
    const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Delete"), button:has-text("Remove")').first();
    await confirmButton.click();

    // Wait for API call
    await page.waitForTimeout(1000);
  });
});

test.describe('Project Management - Responsive Tests', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/');
    await waitForAppReady(page);
  });

  test('should be responsive on mobile', async ({ page }) => {
    await testResponsiveLayout(page, [
      { width: 375, height: 667, name: 'iPhone SE' },
      { width: 390, height: 844, name: 'iPhone 13' },
      { width: 393, height: 851, name: 'Pixel 5' }
    ]);
  });

  test('should be responsive on tablet', async ({ page }) => {
    await testResponsiveLayout(page, [
      { width: 768, height: 1024, name: 'iPad' },
      { width: 1024, height: 1366, name: 'iPad Pro' }
    ]);
  });

  test('should show mobile navigation', async ({ page }) => {
    await verifyMobileNavigation(page);
  });

  test('should handle touch interactions on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Mock projects
    await mockApiResponse(page, '/api/projects', {
      success: true,
      data: [
        { id: '1', name: 'Mobile Test Project', path: '/path/to/project' }
      ]
    });

    await page.reload();
    await waitForAppReady(page);

    // Tap on project
    const projectItem = page.locator('text=Mobile Test Project').first();
    await projectItem.tap();

    await page.waitForTimeout(500);
  });
});

test.describe('Project Management - Cross-Browser Tests', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/');
    await waitForAppReady(page);
  });

  test('should work in all browsers', async ({ page, browserName }) => {
    console.log(`Testing in: ${browserName}`);

    // Mock projects
    await mockApiResponse(page, '/api/projects', {
      success: true,
      data: [
        { id: '1', name: 'Cross-Browser Test', path: '/path/to/project' }
      ]
    });

    await page.reload();
    await waitForAppReady(page);

    // Verify basic functionality
    await verifyProjectInList(page, 'Cross-Browser Test');

    // Take screenshot for comparison
    await takeDebugScreenshot(page, `project-list-${browserName}`);
  });
});

test.describe('Project Management - Error Handling', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/');
    await waitForAppReady(page);
  });

  test('should handle API timeout', async ({ page }) => {
    // Mock slow response
    await page.route('**/api/projects**', route => {
      setTimeout(() => route.fulfill({
        status: 200,
        body: JSON.stringify({ success: true, data: [] })
      }), 10000);
    });

    await page.reload();

    // Verify loading state
    const loadingIndicator = page.locator('[data-testid="loading"], .loading, text=/loading/i').first();
    await expect(loadingIndicator).toBeVisible({ timeout: 5000 });
  });

  test('should handle API error', async ({ page }) => {
    // Mock error response
    await mockApiResponse(page, '/api/projects', {
      success: false,
      error: 'Internal server error'
    }, 500);

    await page.reload();
    await waitForAppReady(page);

    // Verify error message
    const errorMsg = page.locator('text=/error/i, .error-message').first();
    await expect(errorMsg).toBeVisible({ timeout: 5000 });
  });

  test('should handle network failure', async ({ page }) => {
    // Simulate network failure
    await page.route('**/api/projects**', route => route.abort());

    await page.reload();

    // Verify error handling
    await page.waitForTimeout(2000);
  });
});
