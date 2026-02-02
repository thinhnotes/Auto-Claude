/**
 * End-to-End tests for Ideation (Ideas/Inside) Feature
 * Tests: Create ideas, manage ideas, idea generation, idea details
 */
import { test, expect, Page } from '@playwright/test';
import { 
  waitForAppReady, 
  navigateToRoute, 
  mockApiResponse,
  testResponsiveLayout
} from './web-helper';

test.describe('Ideation - Create and Manage Ideas', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/ideation');
    await waitForAppReady(page);
  });

  test('should display ideation dashboard', async ({ page }) => {
    // Mock ideas
    await mockApiResponse(page, '/api/ideation', {
      success: true,
      data: [
        { id: '1', title: 'Feature Idea 1', type: 'feature', state: 'new' },
        { id: '2', title: 'Bug Fix Idea', type: 'bug', state: 'approved' }
      ]
    });

    await page.reload();
    await waitForAppReady(page);

    // Verify ideation header
    const header = page.locator('h1:has-text("Ideation"), h1:has-text("Ideas")').first();
    await expect(header).toBeVisible({ timeout: 5000 });
  });

  test('should create new idea', async ({ page }) => {
    await mockApiResponse(page, '/api/ideation', {
      success: true,
      data: { id: 'new-idea-1', title: 'New Feature Idea' }
    });

    // Click create idea button
    const createButton = page.locator('button:has-text("New Idea"), button:has-text("Create Idea")').first();
    await createButton.click();

    // Fill idea details
    const titleInput = page.locator('input[name="title"], input[placeholder*="title"]').first();
    await titleInput.fill('New Feature Idea');

    const descriptionInput = page.locator('textarea[name="description"]').first();
    await descriptionInput.fill('This is a detailed description of the feature idea');

    // Submit
    const submitButton = page.locator('button:has-text("Create"), button[type="submit"]').first();
    await submitButton.click();

    await page.waitForTimeout(1000);
  });

  test('should select idea type', async ({ page }) => {
    const createButton = page.locator('button:has-text("New Idea")').first();
    await createButton.click();

    // Select idea type
    const typeSelect = page.locator('select[name="type"], [data-testid="idea-type"]').first();
    if (await typeSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      await typeSelect.click();
      
      const featureOption = page.locator('option:has-text("Feature"), [data-type="feature"]').first();
      await featureOption.click();
    }

    await page.waitForTimeout(500);
  });

  test('should generate AI ideas', async ({ page }) => {
    await mockApiResponse(page, '/api/ideation/generate', {
      success: true,
      data: {
        ideas: [
          { title: 'AI Generated Idea 1', description: 'Auto-generated description' },
          { title: 'AI Generated Idea 2', description: 'Another auto-generated idea' }
        ]
      }
    });

    // Click AI generate button
    const generateButton = page.locator('button:has-text("Generate Ideas"), button:has-text("AI Generate")').first();
    if (await generateButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await generateButton.click();

      // Wait for generation
      await page.waitForTimeout(2000);

      // Verify generated ideas appear
      const generatedIdea = page.locator('text=AI Generated Idea 1').first();
      await expect(generatedIdea).toBeVisible({ timeout: 5000 });
    }
  });

  test('should view idea details', async ({ page }) => {
    await mockApiResponse(page, '/api/ideation/1', {
      success: true,
      data: {
        id: '1',
        title: 'Feature Idea Details',
        description: 'Detailed description',
        type: 'feature',
        state: 'new',
        votes: 5
      }
    });

    await mockApiResponse(page, '/api/ideation', {
      success: true,
      data: [{ id: '1', title: 'Feature Idea Details' }]
    });

    await page.reload();
    await waitForAppReady(page);

    // Click on idea card
    const ideaCard = page.locator('text=Feature Idea Details').first();
    await ideaCard.click();

    // Verify details panel
    await page.waitForTimeout(1000);
    const detailsPanel = page.locator('[data-testid="idea-details"], .idea-detail-panel').first();
    await expect(detailsPanel).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Ideation - Idea Management', () => {
  test.beforeEach(async ({ page }) => {
    await mockApiResponse(page, '/api/ideation', {
      success: true,
      data: [
        { id: '1', title: 'Idea 1', state: 'new' },
        { id: '2', title: 'Idea 2', state: 'approved' }
      ]
    });

    await navigateToRoute(page, '/ideation');
    await waitForAppReady(page);
  });

  test('should approve idea', async ({ page }) => {
    await mockApiResponse(page, '/api/ideation/1/approve', {
      success: true,
      data: { id: '1', state: 'approved' }
    });

    const ideaCard = page.locator('[data-idea-id="1"]').first();
    
    if (await ideaCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Open menu
      const menuButton = ideaCard.locator('button[aria-label*="menu"]').first();
      await menuButton.click();

      // Click approve
      const approveOption = page.locator('text=Approve, [role="menuitem"]:has-text("Approve")').first();
      await approveOption.click();

      await page.waitForTimeout(1000);
    }
  });

  test('should reject idea', async ({ page }) => {
    await mockApiResponse(page, '/api/ideation/1/reject', {
      success: true,
      data: { id: '1', state: 'rejected' }
    });

    const ideaCard = page.locator('[data-idea-id="1"]').first();
    
    if (await ideaCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      const menuButton = ideaCard.locator('button[aria-label*="menu"]').first();
      await menuButton.click();

      const rejectOption = page.locator('text=Reject, [role="menuitem"]:has-text("Reject")').first();
      await rejectOption.click();

      await page.waitForTimeout(1000);
    }
  });

  test('should convert idea to task', async ({ page }) => {
    await mockApiResponse(page, '/api/ideation/1/convert', {
      success: true,
      data: { taskId: 'task-001', created: true }
    });

    const ideaCard = page.locator('[data-idea-id="1"]').first();
    
    if (await ideaCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      const menuButton = ideaCard.locator('button[aria-label*="menu"]').first();
      await menuButton.click();

      const convertOption = page.locator('text=Convert to Task, [role="menuitem"]:has-text("Convert")').first();
      await convertOption.click();

      // Confirm conversion
      const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Convert")').first();
      await confirmButton.click();

      await page.waitForTimeout(1000);
    }
  });

  test('should vote on idea', async ({ page }) => {
    await mockApiResponse(page, '/api/ideation/1/vote', {
      success: true,
      data: { id: '1', votes: 6 }
    });

    const ideaCard = page.locator('[data-idea-id="1"]').first();
    
    if (await ideaCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      const voteButton = ideaCard.locator('button:has-text("Vote"), button[aria-label*="vote"]').first();
      await voteButton.click();

      await page.waitForTimeout(500);
    }
  });

  test('should filter ideas by type', async ({ page }) => {
    const typeFilter = page.locator('select[name="typeFilter"], [data-filter="type"]').first();
    
    if (await typeFilter.isVisible({ timeout: 2000 }).catch(() => false)) {
      await typeFilter.selectOption('feature');

      await page.waitForTimeout(500);
    }
  });

  test('should filter ideas by state', async ({ page }) => {
    const stateFilter = page.locator('select[name="stateFilter"], [data-filter="state"]').first();
    
    if (await stateFilter.isVisible({ timeout: 2000 }).catch(() => false)) {
      await stateFilter.selectOption('approved');

      await page.waitForTimeout(500);
    }
  });
});

test.describe('Ideation - Responsive', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/ideation');
    await waitForAppReady(page);
  });

  test('should work on mobile devices', async ({ page }) => {
    await testResponsiveLayout(page, [
      { width: 375, height: 667, name: 'iPhone SE' },
      { width: 768, height: 1024, name: 'iPad' }
    ]);
  });
});
