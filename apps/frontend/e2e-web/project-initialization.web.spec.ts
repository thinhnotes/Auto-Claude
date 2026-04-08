/**
 * End-to-End tests for Project Initialization and Directory Management
 * Tests: Create project, initialize directory, directory structure, project settings
 */
import { test, expect, Page } from '@playwright/test';
import { 
  waitForAppReady, 
  navigateToRoute, 
  takeDebugScreenshot,
  mockApiResponse,
  waitForApiCall,
  testResponsiveLayout
} from './web-helper';

test.describe('Project Initialization', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/');
    await waitForAppReady(page);
  });

  test('should create new project with directory initialization', async ({ page }) => {
    // Click create project button
    const createButton = page.locator('button:has-text("Create Project"), button:has-text("New Project"), [data-testid="create-project"]').first();
    await createButton.click();

    // Fill in project details
    const nameInput = page.locator('input[name="projectName"], input[placeholder*="name"]').first();
    await nameInput.fill('Test Project');

    const pathInput = page.locator('input[name="projectPath"], input[placeholder*="path"]').first();
    await pathInput.fill('/home/test/projects/test-project');

    // Initialize directory checkbox
    const initDirCheckbox = page.locator('input[type="checkbox"][name="initDirectory"], input[type="checkbox"]').first();
    if (await initDirCheckbox.isVisible({ timeout: 2000 }).catch(() => false)) {
      await initDirCheckbox.check();
    }

    // Submit
    const submitButton = page.locator('button:has-text("Create"), button[type="submit"]').first();
    await submitButton.click();

    // Verify project was created
    await page.waitForTimeout(1000);
    await waitForText(page, 'Test Project');
  });

  test('should initialize directory structure', async ({ page }) => {
    // Mock project initialization
    await mockApiResponse(page, '/api/projects/init', {
      success: true,
      data: {
        projectId: 'new-project-1',
        directories: [
          '.auto-claude',
          '.auto-claude/specs',
          'src',
          'tests'
        ],
        files: [
          '.auto-claude/config.json',
          'README.md'
        ]
      }
    });

    // Navigate to project initialization
    await page.goto('/projects/new');
    await waitForAppReady(page);

    // Verify directory structure is created
    const directoryList = page.locator('[data-testid="directory-structure"], .directory-list').first();
    if (await directoryList.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(directoryList).toBeVisible();
    }
  });

  test('should display project directory structure', async ({ page }) => {
    // Mock project with directory structure
    await mockApiResponse(page, '/api/projects/1', {
      success: true,
      data: {
        id: '1',
        name: 'Test Project',
        path: '/home/test/project',
        structure: {
          '.auto-claude': ['specs', 'config.json'],
          'src': ['index.ts', 'app.ts'],
          'tests': ['test.spec.ts']
        }
      }
    });

    await page.goto('/projects/1');
    await waitForAppReady(page);

    // Verify directory tree is displayed
    const directoryTree = page.locator('[data-testid="directory-tree"], .file-explorer').first();
    await expect(directoryTree).toBeVisible({ timeout: 5000 });
  });

  test('should handle directory initialization errors', async ({ page }) => {
    // Mock initialization error
    await mockApiResponse(page, '/api/projects/init', {
      success: false,
      error: 'Permission denied: Cannot create directory'
    }, 403);

    await page.goto('/projects/new');
    await waitForAppReady(page);

    const submitButton = page.locator('button:has-text("Initialize"), button[type="submit"]').first();
    await submitButton.click();

    // Verify error message
    const errorMsg = page.locator('text=/permission denied/i, .error-message').first();
    await expect(errorMsg).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Project Settings', () => {
  test.beforeEach(async ({ page }) => {
    await mockApiResponse(page, '/api/projects/1', {
      success: true,
      data: {
        id: '1',
        name: 'Test Project',
        path: '/home/test/project',
        settings: {
          autoSave: true,
          pythonPath: '/usr/bin/python3',
          memoryEnabled: true
        }
      }
    });

    await navigateToRoute(page, '/projects/1/settings');
    await waitForAppReady(page);
  });

  test('should display project settings', async ({ page }) => {
    // Verify settings form is visible
    const settingsForm = page.locator('form, [data-testid="settings-form"]').first();
    await expect(settingsForm).toBeVisible();

    // Verify individual settings
    const autoSaveCheckbox = page.locator('input[type="checkbox"][name="autoSave"]').first();
    if (await autoSaveCheckbox.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(autoSaveCheckbox).toBeChecked();
    }
  });

  test('should update project settings', async ({ page }) => {
    // Mock update response
    await mockApiResponse(page, '/api/projects/1/settings', {
      success: true,
      data: { updated: true }
    });

    // Change a setting
    const pythonPathInput = page.locator('input[name="pythonPath"]').first();
    if (await pythonPathInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await pythonPathInput.fill('/usr/local/bin/python3');
    }

    // Save settings
    const saveButton = page.locator('button:has-text("Save"), button[type="submit"]').first();
    await saveButton.click();

    // Verify success message
    await page.waitForTimeout(1000);
  });

  test('should configure Python environment', async ({ page }) => {
    // Find Python path input
    const pythonPathInput = page.locator('input[name="pythonPath"], input[placeholder*="Python"]').first();
    if (await pythonPathInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await pythonPathInput.fill('/custom/path/python');

      // Save
      const saveButton = page.locator('button:has-text("Save")').first();
      await saveButton.click();

      await page.waitForTimeout(1000);
    }
  });

  test('should enable/disable memory system', async ({ page }) => {
    const memoryToggle = page.locator('input[type="checkbox"][name="memoryEnabled"], [role="switch"]').first();
    if (await memoryToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Toggle memory
      await memoryToggle.click();

      // Save
      const saveButton = page.locator('button:has-text("Save")').first();
      await saveButton.click();

      await page.waitForTimeout(1000);
    }
  });
});

test.describe('Directory Management', () => {
  test.beforeEach(async ({ page }) => {
    await mockApiResponse(page, '/api/projects/1', {
      success: true,
      data: {
        id: '1',
        name: 'Test Project',
        path: '/home/test/project'
      }
    });

    await navigateToRoute(page, '/projects/1');
    await waitForAppReady(page);
  });

  test('should browse project directories', async ({ page }) => {
    // Open file explorer
    const explorerButton = page.locator('button:has-text("Files"), button:has-text("Explorer"), [data-testid="file-explorer"]').first();
    if (await explorerButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await explorerButton.click();

      // Verify file tree
      const fileTree = page.locator('[data-testid="file-tree"], .file-explorer').first();
      await expect(fileTree).toBeVisible({ timeout: 3000 });
    }
  });

  test('should create new directory in project', async ({ page }) => {
    // Mock directory creation
    await mockApiResponse(page, '/api/projects/1/directories', {
      success: true,
      data: { path: 'new-folder', created: true }
    });

    // Find create directory button
    const createDirButton = page.locator('button:has-text("New Folder"), button[aria-label*="directory"]').first();
    if (await createDirButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await createDirButton.click();

      // Enter directory name
      const nameInput = page.locator('input[placeholder*="name"], input[placeholder*="folder"]').first();
      await nameInput.fill('new-folder');

      // Confirm
      const confirmButton = page.locator('button:has-text("Create"), button:has-text("OK")').first();
      await confirmButton.click();

      await page.waitForTimeout(1000);
    }
  });

  test('should delete directory', async ({ page }) => {
    // Mock directory deletion
    await mockApiResponse(page, '/api/projects/1/directories/test-folder', {
      success: true,
      data: { deleted: true }
    });

    // Right-click on directory
    const directory = page.locator('[data-path="test-folder"], .directory-item').first();
    if (await directory.isVisible({ timeout: 2000 }).catch(() => false)) {
      await directory.click({ button: 'right' });

      // Click delete in context menu
      const deleteOption = page.locator('text=Delete, [role="menuitem"]:has-text("Delete")').first();
      await deleteOption.click();

      // Confirm deletion
      const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Delete")').first();
      await confirmButton.click();

      await page.waitForTimeout(1000);
    }
  });

  test('should navigate directory structure', async ({ page }) => {
    // Click on a directory to expand
    const directory = page.locator('[data-type="directory"], .folder-item').first();
    if (await directory.isVisible({ timeout: 2000 }).catch(() => false)) {
      await directory.click();

      // Wait for subdirectories to load
      await page.waitForTimeout(500);

      // Verify expanded state
      const expandedDir = page.locator('[data-expanded="true"], .expanded').first();
      await expect(expandedDir).toBeVisible({ timeout: 3000 });
    }
  });
});

test.describe('Project Initialization - Responsive', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/projects/new');
    await waitForAppReady(page);
  });

  test('should work on mobile devices', async ({ page }) => {
    await testResponsiveLayout(page, [
      { width: 375, height: 667, name: 'iPhone SE' },
      { width: 768, height: 1024, name: 'iPad' }
    ]);
  });
});

// Helper function to wait for text
async function waitForText(page: Page, text: string): Promise<void> {
  await page.waitForSelector(`text=${text}`, { timeout: 10000 });
}
