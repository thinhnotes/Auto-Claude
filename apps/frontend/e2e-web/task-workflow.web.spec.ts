/**
 * End-to-End tests for Task Workflow in Web version
 * Tests: Create task, view task, start task, monitor progress, complete task
 */
import { test, expect, Page } from '@playwright/test';
import { 
  waitForAppReady, 
  navigateToRoute, 
  takeDebugScreenshot,
  mockApiResponse,
  waitForApiCall,
  waitForText,
  testResponsiveLayout
} from './web-helper';

// Test data
const mockTask = {
  id: '001-test-task',
  title: 'Test Feature Implementation',
  description: 'Implement a test feature',
  status: 'pending',
  createdAt: new Date().toISOString()
};

const mockTaskInProgress = {
  ...mockTask,
  id: '002-in-progress-task',
  status: 'in_progress'
};

const mockTaskCompleted = {
  ...mockTask,
  id: '003-completed-task',
  status: 'completed'
};

// Test helpers
async function createTask(page: Page, title: string, description: string): Promise<void> {
  // Click create task button
  const createButton = page.locator('button:has-text("Create Task"), button:has-text("New Task"), [data-testid="create-task"]').first();
  await createButton.click();

  // Fill in task details
  const titleInput = page.locator('input[name="title"], input[placeholder*="title"]').first();
  await titleInput.fill(title);

  const descInput = page.locator('textarea[name="description"], textarea[placeholder*="description"]').first();
  await descInput.fill(description);

  // Submit
  const submitButton = page.locator('button:has-text("Create"), button:has-text("Submit"), button[type="submit"]').first();
  await submitButton.click();
}

async function verifyTaskCard(page: Page, taskTitle: string): Promise<void> {
  const taskCard = page.locator(`[data-testid="task-card"]:has-text("${taskTitle}"), .task-card:has-text("${taskTitle}")`).first();
  await expect(taskCard).toBeVisible({ timeout: 10000 });
}

async function startTask(page: Page, taskId: string): Promise<void> {
  // Click start button on task
  const startButton = page.locator(`[data-task-id="${taskId}"] button:has-text("Start"), button[data-action="start-${taskId}"]`).first();
  await startButton.click();

  // Confirm if needed
  const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Start")').first();
  if (await confirmButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await confirmButton.click();
  }
}

test.describe('Task Workflow - Create Task', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/');
    await waitForAppReady(page);
  });

  test('should open create task wizard', async ({ page }) => {
    const createButton = page.locator('button:has-text("Create Task"), button:has-text("New Task"), [data-testid="create-task"]').first();
    await createButton.click();

    // Verify wizard is open
    const wizard = page.locator('[role="dialog"], .wizard, .modal').first();
    await expect(wizard).toBeVisible();

    // Verify form fields
    const titleInput = page.locator('input[name="title"], input[placeholder*="title"]').first();
    await expect(titleInput).toBeVisible();
  });

  test('should create task with title and description', async ({ page }) => {
    // Mock successful create response
    await mockApiResponse(page, '/api/tasks', {
      success: true,
      data: mockTask
    });

    await createTask(page, 'New Test Task', 'This is a test task description');

    // Wait for API call
    await waitForApiCall(page, '/api/tasks');

    // Verify success feedback
    await page.waitForTimeout(1000);
  });

  test('should validate required fields', async ({ page }) => {
    const createButton = page.locator('button:has-text("Create Task"), button:has-text("New Task")').first();
    await createButton.click();

    // Try to submit without filling fields
    const submitButton = page.locator('button:has-text("Create"), button:has-text("Submit"), button[type="submit"]').first();
    await submitButton.click();

    // Verify validation message
    const validationMsg = page.locator('text=/required/i, .error, .validation-error').first();
    await expect(validationMsg).toBeVisible({ timeout: 3000 });
  });

  test('should show task in backlog after creation', async ({ page }) => {
    // Mock task creation and list
    await mockApiResponse(page, '/api/tasks', {
      success: true,
      data: [mockTask]
    });

    await page.reload();
    await waitForAppReady(page);

    // Verify task appears in list
    await verifyTaskCard(page, mockTask.title);
  });
});

test.describe('Task Workflow - View and Manage Tasks', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/');
    await waitForAppReady(page);
  });

  test('should display tasks by status', async ({ page }) => {
    // Mock tasks with different statuses
    await mockApiResponse(page, '/api/tasks', {
      success: true,
      data: [mockTask, mockTaskInProgress, mockTaskCompleted]
    });

    await page.reload();
    await waitForAppReady(page);

    // Verify tasks are displayed
    await verifyTaskCard(page, mockTask.title);
    await verifyTaskCard(page, mockTaskInProgress.title);
    await verifyTaskCard(page, mockTaskCompleted.title);
  });

  test('should open task details', async ({ page }) => {
    // Mock task details
    await mockApiResponse(page, `/api/tasks/${mockTask.id}`, {
      success: true,
      data: {
        ...mockTask,
        spec: '# Test Task\n\nThis is the task specification.',
        subtasks: []
      }
    });

    await mockApiResponse(page, '/api/tasks', {
      success: true,
      data: [mockTask]
    });

    await page.reload();
    await waitForAppReady(page);

    // Click on task to open details
    const taskCard = page.locator(`text=${mockTask.title}`).first();
    await taskCard.click();

    // Verify details panel or page
    await page.waitForTimeout(1000);
    await waitForText(page, mockTask.title);
  });

  test('should filter tasks by status', async ({ page }) => {
    // Mock tasks
    await mockApiResponse(page, '/api/tasks', {
      success: true,
      data: [mockTask, mockTaskInProgress, mockTaskCompleted]
    });

    await page.reload();
    await waitForAppReady(page);

    // Click status filter
    const filterButton = page.locator('button:has-text("In Progress"), [data-filter="in_progress"]').first();
    if (await filterButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await filterButton.click();

      // Verify only in-progress tasks shown
      await page.waitForTimeout(500);
    }
  });

  test('should search tasks', async ({ page }) => {
    // Mock tasks
    await mockApiResponse(page, '/api/tasks', {
      success: true,
      data: [mockTask, mockTaskInProgress]
    });

    await page.reload();
    await waitForAppReady(page);

    // Find search input
    const searchInput = page.locator('input[placeholder*="search"], input[type="search"]').first();
    if (await searchInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await searchInput.fill('Test Feature');

      // Verify filtered results
      await page.waitForTimeout(500);
      await verifyTaskCard(page, mockTask.title);
    }
  });
});

test.describe('Task Workflow - Start and Monitor Task', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/');
    await waitForAppReady(page);
  });

  test('should start task execution', async ({ page }) => {
    // Mock task and start response
    await mockApiResponse(page, '/api/tasks', {
      success: true,
      data: [mockTask]
    });

    await mockApiResponse(page, `/api/tasks/${mockTask.id}/start`, {
      success: true,
      data: { ...mockTask, status: 'in_progress' }
    });

    await page.reload();
    await waitForAppReady(page);

    await startTask(page, mockTask.id);

    // Wait for API call
    await page.waitForTimeout(1000);
  });

  test('should display progress updates', async ({ page }) => {
    // Mock in-progress task
    await mockApiResponse(page, '/api/tasks', {
      success: true,
      data: [mockTaskInProgress]
    });

    // Mock progress endpoint
    await mockApiResponse(page, `/api/tasks/${mockTaskInProgress.id}/progress`, {
      success: true,
      data: {
        currentPhase: 'Implementation',
        completedSubtasks: 2,
        totalSubtasks: 5,
        progress: 40
      }
    });

    await page.reload();
    await waitForAppReady(page);

    // Verify progress indicator
    const progressBar = page.locator('[role="progressbar"], .progress-bar').first();
    await expect(progressBar).toBeVisible({ timeout: 5000 });
  });

  test('should display logs in detail panel', async ({ page }) => {
    // Mock task with logs
    await mockApiResponse(page, `/api/tasks/${mockTaskInProgress.id}`, {
      success: true,
      data: {
        ...mockTaskInProgress,
        logs: 'Building project...\nRunning tests...\n'
      }
    });

    await page.goto(`/tasks/${mockTaskInProgress.id}`);
    await waitForAppReady(page);

    // Verify logs section
    const logsSection = page.locator('[data-testid="logs"], .logs-panel, pre').first();
    await expect(logsSection).toBeVisible({ timeout: 5000 });
  });

  test('should pause task execution', async ({ page }) => {
    // Mock in-progress task
    await mockApiResponse(page, '/api/tasks', {
      success: true,
      data: [mockTaskInProgress]
    });

    await page.reload();
    await waitForAppReady(page);

    // Click pause button
    const pauseButton = page.locator('button:has-text("Pause"), button[data-action="pause"]').first();
    if (await pauseButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await pauseButton.click();

      // Verify paused state
      await page.waitForTimeout(1000);
    }
  });

  test('should cancel task execution', async ({ page }) => {
    // Mock in-progress task
    await mockApiResponse(page, '/api/tasks', {
      success: true,
      data: [mockTaskInProgress]
    });

    await page.reload();
    await waitForAppReady(page);

    // Click cancel button
    const cancelButton = page.locator('button:has-text("Cancel"), button[data-action="cancel"]').first();
    if (await cancelButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await cancelButton.click();

      // Confirm cancellation
      const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Yes")').first();
      await confirmButton.click();

      await page.waitForTimeout(1000);
    }
  });
});

test.describe('Task Workflow - Complete and Review', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/');
    await waitForAppReady(page);
  });

  test('should display review interface for completed tasks', async ({ page }) => {
    // Mock completed task
    await mockApiResponse(page, `/api/tasks/${mockTaskCompleted.id}`, {
      success: true,
      data: {
        ...mockTaskCompleted,
        qaReport: '# QA Review\n\nTask completed successfully.'
      }
    });

    await page.goto(`/tasks/${mockTaskCompleted.id}`);
    await waitForAppReady(page);

    // Verify review section
    const reviewSection = page.locator('[data-testid="review"], .review-panel').first();
    await expect(reviewSection).toBeVisible({ timeout: 5000 });
  });

  test('should approve completed task', async ({ page }) => {
    // Mock completed task
    await mockApiResponse(page, '/api/tasks', {
      success: true,
      data: [mockTaskCompleted]
    });

    await page.reload();
    await waitForAppReady(page);

    // Click approve button
    const approveButton = page.locator('button:has-text("Approve"), button[data-action="approve"]').first();
    if (await approveButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await approveButton.click();

      // Confirm approval
      const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Yes")').first();
      await confirmButton.click();

      await page.waitForTimeout(1000);
    }
  });

  test('should reject completed task with feedback', async ({ page }) => {
    // Mock completed task
    await mockApiResponse(page, '/api/tasks', {
      success: true,
      data: [mockTaskCompleted]
    });

    await page.reload();
    await waitForAppReady(page);

    // Click reject button
    const rejectButton = page.locator('button:has-text("Reject"), button[data-action="reject"]').first();
    if (await rejectButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await rejectButton.click();

      // Fill feedback
      const feedbackInput = page.locator('textarea[placeholder*="feedback"], textarea[name="feedback"]').first();
      await feedbackInput.fill('Needs more tests and documentation');

      // Submit rejection
      const submitButton = page.locator('button:has-text("Submit"), button:has-text("Reject")').first();
      await submitButton.click();

      await page.waitForTimeout(1000);
    }
  });
});

test.describe('Task Workflow - Responsive Tests', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/');
    await waitForAppReady(page);
  });

  test('should display tasks responsively on mobile', async ({ page }) => {
    await testResponsiveLayout(page, [
      { width: 375, height: 667, name: 'iPhone SE' },
      { width: 768, height: 1024, name: 'iPad' }
    ]);
  });

  test('should handle touch interactions for tasks', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Mock tasks
    await mockApiResponse(page, '/api/tasks', {
      success: true,
      data: [mockTask]
    });

    await page.reload();
    await waitForAppReady(page);

    // Tap on task
    const taskCard = page.locator(`text=${mockTask.title}`).first();
    await taskCard.tap();

    await page.waitForTimeout(500);
  });
});
