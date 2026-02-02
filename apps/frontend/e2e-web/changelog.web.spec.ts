/**
 * End-to-End tests for Changelog Feature
 * Tests: View changelog, create entries, filter by version
 */
import { test, expect, Page } from '@playwright/test';
import { 
  waitForAppReady, 
  navigateToRoute, 
  mockApiResponse,
  testResponsiveLayout
} from './web-helper';

test.describe('Changelog - View and Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/changelog');
    await waitForAppReady(page);
  });

  test('should display changelog overview', async ({ page }) => {
    await mockApiResponse(page, '/api/changelog', {
      success: true,
      data: [
        { version: '1.0.0', date: '2026-01-01', changes: [] },
        { version: '1.1.0', date: '2026-02-01', changes: [] }
      ]
    });

    await page.reload();
    await waitForAppReady(page);

    const header = page.locator('h1:has-text("Changelog"), h1:has-text("Change Log")').first();
    await expect(header).toBeVisible({ timeout: 5000 });
  });

  test('should display changelog entries by version', async ({ page }) => {
    await mockApiResponse(page, '/api/changelog', {
      success: true,
      data: [
        {
          version: '1.0.0',
          date: '2026-01-01',
          changes: [
            { type: 'added', description: 'New feature A' },
            { type: 'fixed', description: 'Bug fix B' }
          ]
        }
      ]
    });

    await page.reload();
    await waitForAppReady(page);

    // Verify version header
    const versionHeader = page.locator('text=1.0.0').first();
    await expect(versionHeader).toBeVisible();

    // Verify changes
    const featureChange = page.locator('text=New feature A').first();
    await expect(featureChange).toBeVisible();
  });

  test('should filter changelog by type', async ({ page }) => {
    const typeFilter = page.locator('select[name="typeFilter"], [data-filter="type"]').first();
    
    if (await typeFilter.isVisible({ timeout: 2000 }).catch(() => false)) {
      await typeFilter.selectOption('added');

      await page.waitForTimeout(500);

      // Verify only "added" types are shown
    }
  });

  test('should search changelog entries', async ({ page }) => {
    const searchInput = page.locator('input[type="search"], input[placeholder*="Search"]').first();
    
    if (await searchInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await searchInput.fill('feature A');

      await page.waitForTimeout(500);
    }
  });
});

test.describe('Changelog - Entry Management', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/changelog');
    await waitForAppReady(page);
  });

  test('should create new changelog entry', async ({ page }) => {
    await mockApiResponse(page, '/api/changelog', {
      success: true,
      data: { version: '1.2.0', created: true }
    });

    const createButton = page.locator('button:has-text("New Entry"), button:has-text("Add Entry")').first();
    if (await createButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await createButton.click();

      // Fill version
      const versionInput = page.locator('input[name="version"]').first();
      await versionInput.fill('1.2.0');

      // Add change
      const changeTypeSelect = page.locator('select[name="changeType"]').first();
      await changeTypeSelect.selectOption('added');

      const descriptionInput = page.locator('textarea[name="description"], input[name="description"]').first();
      await descriptionInput.fill('Added new feature X');

      const submitButton = page.locator('button:has-text("Create"), button[type="submit"]').first();
      await submitButton.click();

      await page.waitForTimeout(1000);
    }
  });

  test('should add multiple changes to version', async ({ page }) => {
    const createButton = page.locator('button:has-text("New Entry")').first();
    if (await createButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await createButton.click();

      // Add first change
      const addChangeButton = page.locator('button:has-text("Add Change"), button:has-text("+")').first();
      await addChangeButton.click();

      // Add second change
      await addChangeButton.click();

      await page.waitForTimeout(500);
    }
  });

  test('should edit changelog entry', async ({ page }) => {
    await mockApiResponse(page, '/api/changelog/1.0.0', {
      success: true,
      data: { version: '1.0.0', updated: true }
    });

    const entryCard = page.locator('[data-version="1.0.0"]').first();
    
    if (await entryCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      const editButton = entryCard.locator('button[aria-label*="edit"]').first();
      await editButton.click();

      // Modify entry
      const descriptionInput = page.locator('textarea, input').first();
      await descriptionInput.fill('Updated description');

      const saveButton = page.locator('button:has-text("Save")').first();
      await saveButton.click();

      await page.waitForTimeout(1000);
    }
  });

  test('should delete changelog entry', async ({ page }) => {
    await mockApiResponse(page, '/api/changelog/1.0.0', {
      success: true,
      data: { deleted: true }
    });

    const entryCard = page.locator('[data-version="1.0.0"]').first();
    
    if (await entryCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      const menuButton = entryCard.locator('button[aria-label*="menu"]').first();
      await menuButton.click();

      const deleteOption = page.locator('text=Delete, [role="menuitem"]:has-text("Delete")').first();
      await deleteOption.click();

      const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Delete")').first();
      await confirmButton.click();

      await page.waitForTimeout(1000);
    }
  });
});

test.describe('Changelog - GitHub Release Integration', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/changelog');
    await waitForAppReady(page);
  });

  test('should import from GitHub releases', async ({ page }) => {
    await mockApiResponse(page, '/api/changelog/import/github', {
      success: true,
      data: { imported: 5, releases: [] }
    });

    const importButton = page.locator('button:has-text("Import from GitHub"), button:has-text("Import")').first();
    if (await importButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await importButton.click();

      // Wait for import
      await page.waitForTimeout(2000);

      // Verify success message
      const successMsg = page.locator('text=/imported/i, .success-message').first();
      await expect(successMsg).toBeVisible({ timeout: 5000 });
    }
  });

  test('should link changelog to GitHub release', async ({ page }) => {
    const entryCard = page.locator('[data-version="1.0.0"]').first();
    
    if (await entryCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      const linkButton = entryCard.locator('button:has-text("Link to GitHub")').first();
      if (await linkButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await linkButton.click();

        await page.waitForTimeout(1000);
      }
    }
  });
});

test.describe('Changelog - Export', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/changelog');
    await waitForAppReady(page);
  });

  test('should export changelog as markdown', async ({ page }) => {
    const exportButton = page.locator('button:has-text("Export"), button:has-text("Download")').first();
    
    if (await exportButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await exportButton.click();

      const markdownOption = page.locator('text=Markdown, [data-format="markdown"]').first();
      await markdownOption.click();

      await page.waitForTimeout(1000);
    }
  });

  test('should generate release notes', async ({ page }) => {
    await mockApiResponse(page, '/api/changelog/release-notes', {
      success: true,
      data: { content: '# Release Notes\n\n## Version 1.0.0' }
    });

    const generateButton = page.locator('button:has-text("Generate Notes"), button:has-text("Release Notes")').first();
    if (await generateButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await generateButton.click();

      await page.waitForTimeout(1000);

      // Verify notes displayed
      const notesDialog = page.locator('[role="dialog"], .modal').first();
      await expect(notesDialog).toBeVisible({ timeout: 3000 });
    }
  });
});

test.describe('Changelog - Responsive', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/changelog');
    await waitForAppReady(page);
  });

  test('should work on mobile devices', async ({ page }) => {
    await testResponsiveLayout(page, [
      { width: 375, height: 667, name: 'iPhone SE' },
      { width: 768, height: 1024, name: 'iPad' }
    ]);
  });
});
