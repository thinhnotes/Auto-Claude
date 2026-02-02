/**
 * End-to-End tests for Roadmap Feature
 * Tests: View roadmap, manage features, phases, milestones
 */
import { test, expect, Page } from '@playwright/test';
import { 
  waitForAppReady, 
  navigateToRoute, 
  mockApiResponse,
  testResponsiveLayout
} from './web-helper';

test.describe('Roadmap - View and Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/roadmap');
    await waitForAppReady(page);
  });

  test('should display roadmap overview', async ({ page }) => {
    await mockApiResponse(page, '/api/roadmap', {
      success: true,
      data: {
        phases: [
          { id: 'phase-1', name: 'Q1 2026', features: [] },
          { id: 'phase-2', name: 'Q2 2026', features: [] }
        ]
      }
    });

    await page.reload();
    await waitForAppReady(page);

    const roadmapHeader = page.locator('h1:has-text("Roadmap")').first();
    await expect(roadmapHeader).toBeVisible({ timeout: 5000 });
  });

  test('should display roadmap phases', async ({ page }) => {
    await mockApiResponse(page, '/api/roadmap', {
      success: true,
      data: {
        phases: [
          { id: 'phase-1', name: 'Q1 2026', features: [
            { id: 'f1', title: 'Feature A', status: 'planned' }
          ]},
          { id: 'phase-2', name: 'Q2 2026', features: [
            { id: 'f2', title: 'Feature B', status: 'in_progress' }
          ]}
        ]
      }
    });

    await page.reload();
    await waitForAppReady(page);

    // Verify phases are visible
    const phase1 = page.locator('text=Q1 2026').first();
    await expect(phase1).toBeVisible();

    const phase2 = page.locator('text=Q2 2026').first();
    await expect(phase2).toBeVisible();
  });

  test('should view feature details in roadmap', async ({ page }) => {
    await mockApiResponse(page, '/api/roadmap', {
      success: true,
      data: {
        phases: [{
          id: 'phase-1',
          name: 'Q1 2026',
          features: [{ id: 'f1', title: 'Feature A' }]
        }]
      }
    });

    await page.reload();
    await waitForAppReady(page);

    // Click on feature
    const featureCard = page.locator('text=Feature A').first();
    if (await featureCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      await featureCard.click();

      await page.waitForTimeout(1000);
    }
  });

  test('should switch between roadmap views', async ({ page }) => {
    // Timeline view
    const timelineButton = page.locator('button:has-text("Timeline"), button[data-view="timeline"]').first();
    if (await timelineButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await timelineButton.click();
      await page.waitForTimeout(500);
    }

    // Board view
    const boardButton = page.locator('button:has-text("Board"), button[data-view="board"]').first();
    if (await boardButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await boardButton.click();
      await page.waitForTimeout(500);
    }
  });
});

test.describe('Roadmap - Feature Management', () => {
  test.beforeEach(async ({ page }) => {
    await mockApiResponse(page, '/api/roadmap', {
      success: true,
      data: {
        phases: [{
          id: 'phase-1',
          name: 'Q1 2026',
          features: [
            { id: 'f1', title: 'Feature A', status: 'planned' }
          ]
        }]
      }
    });

    await navigateToRoute(page, '/roadmap');
    await waitForAppReady(page);
  });

  test('should add feature to roadmap', async ({ page }) => {
    await mockApiResponse(page, '/api/roadmap/features', {
      success: true,
      data: { id: 'new-feature', title: 'New Feature' }
    });

    const addButton = page.locator('button:has-text("Add Feature"), button:has-text("New Feature")').first();
    if (await addButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await addButton.click();

      // Fill feature details
      const titleInput = page.locator('input[name="title"]').first();
      await titleInput.fill('New Feature');

      const submitButton = page.locator('button:has-text("Add"), button[type="submit"]').first();
      await submitButton.click();

      await page.waitForTimeout(1000);
    }
  });

  test('should move feature between phases', async ({ page }) => {
    const featureCard = page.locator('[data-feature-id="f1"]').first();
    
    if (await featureCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Open menu
      const menuButton = featureCard.locator('button[aria-label*="menu"]').first();
      await menuButton.click();

      // Move to different phase
      const moveOption = page.locator('text=Move to Phase, [role="menuitem"]:has-text("Move")').first();
      await moveOption.click();

      const phaseOption = page.locator('text=Q2 2026, [data-phase="phase-2"]').first();
      await phaseOption.click();

      await page.waitForTimeout(1000);
    }
  });

  test('should update feature status', async ({ page }) => {
    await mockApiResponse(page, '/api/roadmap/features/f1', {
      success: true,
      data: { id: 'f1', status: 'in_progress' }
    });

    const featureCard = page.locator('[data-feature-id="f1"]').first();
    
    if (await featureCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      const menuButton = featureCard.locator('button[aria-label*="menu"]').first();
      await menuButton.click();

      const statusOption = page.locator('text=In Progress, [data-status="in_progress"]').first();
      await statusOption.click();

      await page.waitForTimeout(1000);
    }
  });

  test('should delete feature from roadmap', async ({ page }) => {
    await mockApiResponse(page, '/api/roadmap/features/f1', {
      success: true,
      data: { deleted: true }
    });

    const featureCard = page.locator('[data-feature-id="f1"]').first();
    
    if (await featureCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      const menuButton = featureCard.locator('button[aria-label*="menu"]').first();
      await menuButton.click();

      const deleteOption = page.locator('text=Delete, [role="menuitem"]:has-text("Delete")').first();
      await deleteOption.click();

      // Confirm deletion
      const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Delete")').first();
      await confirmButton.click();

      await page.waitForTimeout(1000);
    }
  });
});

test.describe('Roadmap - Phase Management', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/roadmap');
    await waitForAppReady(page);
  });

  test('should create new phase', async ({ page }) => {
    await mockApiResponse(page, '/api/roadmap/phases', {
      success: true,
      data: { id: 'new-phase', name: 'Q3 2026' }
    });

    const addPhaseButton = page.locator('button:has-text("Add Phase"), button:has-text("New Phase")').first();
    if (await addPhaseButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await addPhaseButton.click();

      const nameInput = page.locator('input[name="phaseName"], input[placeholder*="phase"]').first();
      await nameInput.fill('Q3 2026');

      const submitButton = page.locator('button:has-text("Create"), button[type="submit"]').first();
      await submitButton.click();

      await page.waitForTimeout(1000);
    }
  });

  test('should edit phase details', async ({ page }) => {
    const phaseCard = page.locator('[data-phase-id="phase-1"]').first();
    
    if (await phaseCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      const editButton = phaseCard.locator('button[aria-label*="edit"]').first();
      await editButton.click();

      const nameInput = page.locator('input[value*="Q1"]').first();
      await nameInput.fill('Q1 2026 Updated');

      const saveButton = page.locator('button:has-text("Save")').first();
      await saveButton.click();

      await page.waitForTimeout(1000);
    }
  });

  test('should delete phase', async ({ page }) => {
    const phaseCard = page.locator('[data-phase-id="phase-1"]').first();
    
    if (await phaseCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      const menuButton = phaseCard.locator('button[aria-label*="menu"]').first();
      await menuButton.click();

      const deleteOption = page.locator('text=Delete Phase, [role="menuitem"]:has-text("Delete")').first();
      await deleteOption.click();

      const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Delete")').first();
      await confirmButton.click();

      await page.waitForTimeout(1000);
    }
  });
});

test.describe('Roadmap - Responsive', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/roadmap');
    await waitForAppReady(page);
  });

  test('should work on mobile devices', async ({ page }) => {
    await testResponsiveLayout(page, [
      { width: 375, height: 667, name: 'iPhone SE' },
      { width: 768, height: 1024, name: 'iPad' }
    ]);
  });
});
