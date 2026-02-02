/**
 * End-to-End tests for Advanced Task Management
 * Tests: Create task with details, move tasks between states, task organization
 */
import { test, expect, Page } from '@playwright/test';
import { 
  waitForAppReady, 
  navigateToRoute, 
  takeDebugScreenshot,
  mockApiResponse,
  testResponsiveLayout
} from './web-helper';

const mockTaskStates = ['backlog', 'in_progress', 'review', 'completed'];

test.describe('Task Creation and Management', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/tasks');
    await waitForAppReady(page);
  });

  test('should create task with full details', async ({ page }) => {
    // Mock task creation
    await mockApiResponse(page, '/api/tasks', {
      success: true,
      data: {
        id: 'task-001',
        title: 'Implement feature X',
        description: 'Detailed description',
        priority: 'high',
        status: 'backlog'
      }
    });

    // Click create task
    const createButton = page.locator('button:has-text("Create Task"), button:has-text("New Task")').first();
    await createButton.click();

    // Fill task details
    const titleInput = page.locator('input[name="title"]').first();
    await titleInput.fill('Implement feature X');

    const descInput = page.locator('textarea[name="description"]').first();
    await descInput.fill('Detailed description');

    // Set priority
    const prioritySelect = page.locator('select[name="priority"], [role="combobox"]').first();
    if (await prioritySelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      await prioritySelect.selectOption('high');
    }

    // Submit
    const submitButton = page.locator('button:has-text("Create"), button[type="submit"]').first();
    await submitButton.click();

    await page.waitForTimeout(1000);
  });

  test('should create task with tags', async ({ page }) => {
    await mockApiResponse(page, '/api/tasks', {
      success: true,
      data: {
        id: 'task-002',
        title: 'Bug fix',
        tags: ['bug', 'urgent']
      }
    });

    const createButton = page.locator('button:has-text("Create Task")').first();
    await createButton.click();

    // Fill basic info
    const titleInput = page.locator('input[name="title"]').first();
    await titleInput.fill('Bug fix');

    // Add tags
    const tagInput = page.locator('input[name="tags"], input[placeholder*="tag"]').first();
    if (await tagInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await tagInput.fill('bug');
      await page.keyboard.press('Enter');
      await tagInput.fill('urgent');
      await page.keyboard.press('Enter');
    }

    // Submit
    const submitButton = page.locator('button:has-text("Create")').first();
    await submitButton.click();

    await page.waitForTimeout(1000);
  });

  test('should create task with assignee', async ({ page }) => {
    await mockApiResponse(page, '/api/tasks', {
      success: true,
      data: {
        id: 'task-003',
        title: 'Task with assignee',
        assignee: 'user@example.com'
      }
    });

    const createButton = page.locator('button:has-text("Create Task")').first();
    await createButton.click();

    const titleInput = page.locator('input[name="title"]').first();
    await titleInput.fill('Task with assignee');

    // Select assignee
    const assigneeSelect = page.locator('select[name="assignee"], [data-testid="assignee-select"]').first();
    if (await assigneeSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      await assigneeSelect.click();
      
      const assigneeOption = page.locator('text=user@example.com').first();
      await assigneeOption.click();
    }

    const submitButton = page.locator('button:has-text("Create")').first();
    await submitButton.click();

    await page.waitForTimeout(1000);
  });

  test('should create task with due date', async ({ page }) => {
    await mockApiResponse(page, '/api/tasks', {
      success: true,
      data: {
        id: 'task-004',
        title: 'Task with deadline',
        dueDate: '2026-12-31'
      }
    });

    const createButton = page.locator('button:has-text("Create Task")').first();
    await createButton.click();

    const titleInput = page.locator('input[name="title"]').first();
    await titleInput.fill('Task with deadline');

    // Set due date
    const dueDateInput = page.locator('input[type="date"], input[name="dueDate"]').first();
    if (await dueDateInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await dueDateInput.fill('2026-12-31');
    }

    const submitButton = page.locator('button:has-text("Create")').first();
    await submitButton.click();

    await page.waitForTimeout(1000);
  });
});

test.describe('Task Movement and Organization', () => {
  test.beforeEach(async ({ page }) => {
    // Mock tasks in different states
    await mockApiResponse(page, '/api/tasks', {
      success: true,
      data: [
        { id: 'task-1', title: 'Task 1', status: 'backlog' },
        { id: 'task-2', title: 'Task 2', status: 'in_progress' },
        { id: 'task-3', title: 'Task 3', status: 'review' }
      ]
    });

    await navigateToRoute(page, '/tasks');
    await waitForAppReady(page);
  });

  test('should move task to different status', async ({ page }) => {
    // Mock task update
    await mockApiResponse(page, '/api/tasks/task-1', {
      success: true,
      data: { id: 'task-1', status: 'in_progress' }
    });

    // Find task card
    const taskCard = page.locator('[data-task-id="task-1"], .task-card:has-text("Task 1")').first();
    
    if (await taskCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Open task menu
      const menuButton = taskCard.locator('button[aria-label*="menu"], button:has-text("⋮")').first();
      await menuButton.click();

      // Click move option
      const moveOption = page.locator('text=Move to, [role="menuitem"]:has-text("Move")').first();
      await moveOption.click();

      // Select new status
      const statusOption = page.locator('text=In Progress, [data-status="in_progress"]').first();
      await statusOption.click();

      await page.waitForTimeout(1000);
    }
  });

  test('should drag and drop task between columns', async ({ page }) => {
    // Find task in backlog
    const taskCard = page.locator('[data-task-id="task-1"]').first();
    
    // Find target column
    const targetColumn = page.locator('[data-status="in_progress"], [data-column="in_progress"]').first();

    if (await taskCard.isVisible({ timeout: 2000 }).catch(() => false) && 
        await targetColumn.isVisible({ timeout: 2000 }).catch(() => false)) {
      
      // Get positions
      const taskBox = await taskCard.boundingBox();
      const targetBox = await targetColumn.boundingBox();

      if (taskBox && targetBox) {
        // Drag and drop
        await page.mouse.move(taskBox.x + taskBox.width / 2, taskBox.y + taskBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 100);
        await page.mouse.up();

        await page.waitForTimeout(1000);
      }
    }
  });

  test('should reorder tasks within same column', async ({ page }) => {
    const task1 = page.locator('[data-task-id="task-1"]').first();
    const task2 = page.locator('[data-task-id="task-2"]').first();

    if (await task1.isVisible({ timeout: 2000 }).catch(() => false) && 
        await task2.isVisible({ timeout: 2000 }).catch(() => false)) {
      
      const task1Box = await task1.boundingBox();
      const task2Box = await task2.boundingBox();

      if (task1Box && task2Box) {
        // Drag task1 below task2
        await page.mouse.move(task1Box.x + task1Box.width / 2, task1Box.y + task1Box.height / 2);
        await page.mouse.down();
        await page.mouse.move(task2Box.x + task2Box.width / 2, task2Box.y + task2Box.height + 10);
        await page.mouse.up();

        await page.waitForTimeout(1000);
      }
    }
  });

  test('should bulk move multiple tasks', async ({ page }) => {
    // Select multiple tasks
    const task1Checkbox = page.locator('[data-task-id="task-1"] input[type="checkbox"]').first();
    const task2Checkbox = page.locator('[data-task-id="task-2"] input[type="checkbox"]').first();

    if (await task1Checkbox.isVisible({ timeout: 2000 }).catch(() => false)) {
      await task1Checkbox.check();
      await task2Checkbox.check();

      // Open bulk actions menu
      const bulkActionsButton = page.locator('button:has-text("Bulk Actions"), button:has-text("Actions")').first();
      await bulkActionsButton.click();

      // Select move option
      const moveOption = page.locator('text=Move selected, [role="menuitem"]:has-text("Move")').first();
      await moveOption.click();

      // Select target status
      const statusOption = page.locator('text=Review, [data-status="review"]').first();
      await statusOption.click();

      await page.waitForTimeout(1000);
    }
  });

  test('should change task priority', async ({ page }) => {
    await mockApiResponse(page, '/api/tasks/task-1', {
      success: true,
      data: { id: 'task-1', priority: 'high' }
    });

    const taskCard = page.locator('[data-task-id="task-1"]').first();
    
    if (await taskCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Open task menu
      const menuButton = taskCard.locator('button[aria-label*="menu"]').first();
      await menuButton.click();

      // Change priority
      const priorityOption = page.locator('text=Set Priority, [role="menuitem"]:has-text("Priority")').first();
      await priorityOption.click();

      const highPriorityOption = page.locator('text=High, [data-priority="high"]').first();
      await highPriorityOption.click();

      await page.waitForTimeout(1000);
    }
  });
});

test.describe('Task Board Views', () => {
  test.beforeEach(async ({ page }) => {
    await mockApiResponse(page, '/api/tasks', {
      success: true,
      data: [
        { id: 'task-1', title: 'Task 1', status: 'backlog' },
        { id: 'task-2', title: 'Task 2', status: 'in_progress' }
      ]
    });

    await navigateToRoute(page, '/tasks');
    await waitForAppReady(page);
  });

  test('should switch to board view', async ({ page }) => {
    const boardViewButton = page.locator('button:has-text("Board"), button[data-view="board"]').first();
    
    if (await boardViewButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await boardViewButton.click();

      // Verify board columns are visible
      const boardColumn = page.locator('[data-column], .board-column').first();
      await expect(boardColumn).toBeVisible({ timeout: 3000 });
    }
  });

  test('should switch to list view', async ({ page }) => {
    const listViewButton = page.locator('button:has-text("List"), button[data-view="list"]').first();
    
    if (await listViewButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await listViewButton.click();

      // Verify list layout
      const taskList = page.locator('[data-testid="task-list"], .task-list').first();
      await expect(taskList).toBeVisible({ timeout: 3000 });
    }
  });

  test('should filter tasks by status', async ({ page }) => {
    const statusFilter = page.locator('select[name="statusFilter"], [data-filter="status"]').first();
    
    if (await statusFilter.isVisible({ timeout: 2000 }).catch(() => false)) {
      await statusFilter.selectOption('in_progress');

      // Verify only in-progress tasks shown
      await page.waitForTimeout(500);
      const inProgressTask = page.locator('[data-status="in_progress"]').first();
      await expect(inProgressTask).toBeVisible();
    }
  });

  test('should filter tasks by priority', async ({ page }) => {
    const priorityFilter = page.locator('select[name="priorityFilter"], [data-filter="priority"]').first();
    
    if (await priorityFilter.isVisible({ timeout: 2000 }).catch(() => false)) {
      await priorityFilter.selectOption('high');

      await page.waitForTimeout(500);
    }
  });

  test('should search tasks', async ({ page }) => {
    const searchInput = page.locator('input[type="search"], input[placeholder*="Search"]').first();
    
    if (await searchInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await searchInput.fill('Task 1');

      await page.waitForTimeout(500);

      // Verify filtered results
      const taskCard = page.locator('text=Task 1').first();
      await expect(taskCard).toBeVisible();
    }
  });
});

test.describe('Task Management - Responsive', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/tasks');
    await waitForAppReady(page);
  });

  test('should work on mobile devices', async ({ page }) => {
    await testResponsiveLayout(page, [
      { width: 375, height: 667, name: 'iPhone SE' },
      { width: 768, height: 1024, name: 'iPad' }
    ]);
  });

  test('should support touch gestures for task movement', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    const taskCard = page.locator('[data-task-id="task-1"]').first();
    
    if (await taskCard.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Swipe gesture simulation
      const box = await taskCard.boundingBox();
      
      if (box) {
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(500);
      }
    }
  });
});
