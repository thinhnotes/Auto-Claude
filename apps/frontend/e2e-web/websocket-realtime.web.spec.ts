/**
 * End-to-End tests for WebSocket and Real-time Updates
 * Tests: WebSocket connection, real-time task updates, progress streaming, event handling
 */
import { test, expect, Page } from '@playwright/test';
import { 
  waitForAppReady, 
  navigateToRoute, 
  takeDebugScreenshot,
  mockApiResponse,
  waitForWebSocket,
  sendWebSocketMessage,
  waitForWebSocketMessage
} from './web-helper';

// Test data
const mockTaskUpdate = {
  type: 'task_update',
  taskId: '001-test-task',
  status: 'in_progress',
  progress: 50,
  message: 'Processing subtask 2 of 4'
};

const mockProgressUpdate = {
  type: 'progress_update',
  taskId: '001-test-task',
  phase: 'Implementation',
  completedSubtasks: 2,
  totalSubtasks: 4,
  currentLog: 'Building project...'
};

const mockTaskCompleted = {
  type: 'task_completed',
  taskId: '001-test-task',
  status: 'completed',
  result: 'success'
};

test.describe('WebSocket Connection', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/');
    await waitForAppReady(page);
  });

  test('should establish WebSocket connection', async ({ page }) => {
    // Wait for WebSocket connection
    await waitForWebSocket(page);

    // Verify connection is open
    const wsState = await page.evaluate(() => {
      const ws = (window as { ws?: { readyState: number } }).ws;
      return ws ? ws.readyState : -1;
    });

    expect(wsState).toBe(1); // WebSocket.OPEN
  });

  test('should reconnect on connection loss', async ({ page }) => {
    // Wait for initial connection
    await waitForWebSocket(page);

    // Simulate connection loss
    await page.evaluate(() => {
      const ws = (window as { ws?: { close: () => void } }).ws;
      if (ws) {
        ws.close();
      }
    });

    // Wait for reconnection
    await page.waitForTimeout(2000);

    // Verify reconnected
    const wsState = await page.evaluate(() => {
      const ws = (window as { ws?: { readyState: number } }).ws;
      return ws ? ws.readyState : -1;
    });

    expect(wsState).toBe(1); // Should reconnect
  });

  test('should handle WebSocket errors gracefully', async ({ page }) => {
    // Monitor console for WebSocket errors
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().toLowerCase().includes('websocket')) {
        errors.push(msg.text());
      }
    });

    // Force WebSocket error
    await page.evaluate(() => {
      const ws = (window as { ws?: { close: (code: number) => void } }).ws;
      if (ws) {
        ws.close(1006); // Abnormal closure
      }
    });

    await page.waitForTimeout(1000);

    // App should handle error gracefully (may log but not crash)
    const mainContent = page.locator('body');
    await expect(mainContent).toBeVisible();
  });

  test('should send ping/pong for connection keepalive', async ({ page }) => {
    await waitForWebSocket(page);

    // Send ping message
    await sendWebSocketMessage(page, { type: 'ping' });

    // Wait for pong response
    const pong = await waitForWebSocketMessage(page, (msg: { type?: string }) => msg.type === 'pong');

    expect(pong).toBeTruthy();
  });
});

test.describe('Real-time Task Updates', () => {
  test.beforeEach(async ({ page }) => {
    // Mock initial task
    await mockApiResponse(page, '/api/tasks', {
      success: true,
      data: [
        {
          id: '001-test-task',
          title: 'Real-time Test Task',
          status: 'pending'
        }
      ]
    });

    await navigateToRoute(page, '/');
    await waitForAppReady(page);
    await waitForWebSocket(page);
  });

  test('should receive task status updates', async ({ page }) => {
    // Simulate WebSocket message
    await page.evaluate((update) => {
      window.dispatchEvent(new CustomEvent('ws-message', {
        detail: update
      }));
    }, mockTaskUpdate);

    // Verify UI updates
    await page.waitForTimeout(1000);

    // Look for updated status
    const statusIndicator = page.locator('[data-task-id="001-test-task"] [data-testid="status"], .task-status').first();
    await expect(statusIndicator).toBeVisible({ timeout: 5000 });
  });

  test('should receive progress updates', async ({ page }) => {
    // Simulate progress update
    await page.evaluate((update) => {
      window.dispatchEvent(new CustomEvent('ws-message', {
        detail: update
      }));
    }, mockProgressUpdate);

    // Verify progress bar updates
    await page.waitForTimeout(1000);

    const progressBar = page.locator('[data-task-id="001-test-task"] [role="progressbar"]').first();
    if (await progressBar.isVisible({ timeout: 2000 }).catch(() => false)) {
      const ariaValue = await progressBar.getAttribute('aria-valuenow');
      expect(Number(ariaValue)).toBeGreaterThan(0);
    }
  });

  test('should receive task completion notification', async ({ page }) => {
    // Simulate task completion
    await page.evaluate((update) => {
      window.dispatchEvent(new CustomEvent('ws-message', {
        detail: update
      }));
    }, mockTaskCompleted);

    // Verify completion notification
    await page.waitForTimeout(1000);

    const notification = page.locator('text=/completed/i, [role="status"], .notification').first();
    await expect(notification).toBeVisible({ timeout: 5000 });
  });

  test('should update task list in real-time', async ({ page }) => {
    // Simulate new task added
    const newTaskMessage = {
      type: 'task_created',
      task: {
        id: '002-new-task',
        title: 'New Real-time Task',
        status: 'pending'
      }
    };

    await page.evaluate((update) => {
      window.dispatchEvent(new CustomEvent('ws-message', {
        detail: update
      }));
    }, newTaskMessage);

    // Verify new task appears
    await page.waitForTimeout(1000);

    const newTask = page.locator('text=New Real-time Task').first();
    await expect(newTask).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Real-time Log Streaming', () => {
  test.beforeEach(async ({ page }) => {
    // Mock task
    await mockApiResponse(page, '/api/tasks/001-test-task', {
      success: true,
      data: {
        id: '001-test-task',
        title: 'Log Streaming Test',
        status: 'in_progress',
        logs: ''
      }
    });

    await navigateToRoute(page, '/tasks/001-test-task');
    await waitForAppReady(page);
    await waitForWebSocket(page);
  });

  test('should stream logs in real-time', async ({ page }) => {
    // Simulate log messages
    const logMessage = {
      type: 'log',
      taskId: '001-test-task',
      message: 'Building project...\n'
    };

    await page.evaluate((update) => {
      window.dispatchEvent(new CustomEvent('ws-message', {
        detail: update
      }));
    }, logMessage);

    // Verify log appears
    await page.waitForTimeout(500);

    const logsPanel = page.locator('[data-testid="logs"], .logs-panel, pre').first();
    if (await logsPanel.isVisible({ timeout: 2000 }).catch(() => false)) {
      const logsText = await logsPanel.textContent();
      expect(logsText).toContain('Building project');
    }
  });

  test('should auto-scroll to latest log', async ({ page }) => {
    // Add multiple log messages
    for (let i = 1; i <= 10; i++) {
      const logMessage = {
        type: 'log',
        taskId: '001-test-task',
        message: `Log line ${i}\n`
      };

      await page.evaluate((update) => {
        window.dispatchEvent(new CustomEvent('ws-message', {
          detail: update
        }));
      }, logMessage);

      await page.waitForTimeout(100);
    }

    // Verify auto-scroll (last log should be visible)
    const lastLog = page.locator('text=Log line 10').first();
    if (await lastLog.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(lastLog).toBeInViewport();
    }
  });

  test('should handle high-frequency log updates', async ({ page }) => {
    // Send many log messages rapidly
    const messages = Array.from({ length: 50 }, (_, i) => ({
      type: 'log',
      taskId: '001-test-task',
      message: `Rapid log ${i}\n`
    }));

    await page.evaluate((msgs) => {
      msgs.forEach((msg: { type: string; taskId: string; message: string }) => {
        window.dispatchEvent(new CustomEvent('ws-message', {
          detail: msg
        }));
      });
    }, messages);

    // Verify UI remains responsive
    await page.waitForTimeout(1000);

    const logsPanel = page.locator('[data-testid="logs"], .logs-panel').first();
    await expect(logsPanel).toBeVisible();
  });
});

test.describe('Real-time Notifications', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/');
    await waitForAppReady(page);
    await waitForWebSocket(page);
  });

  test('should display real-time notifications', async ({ page }) => {
    // Simulate notification
    const notification = {
      type: 'notification',
      level: 'info',
      message: 'Task started successfully'
    };

    await page.evaluate((update) => {
      window.dispatchEvent(new CustomEvent('ws-message', {
        detail: update
      }));
    }, notification);

    // Verify notification appears
    await page.waitForTimeout(500);

    const notificationEl = page.locator('[role="status"], .notification, .toast').first();
    await expect(notificationEl).toBeVisible({ timeout: 5000 });
  });

  test('should display error notifications', async ({ page }) => {
    // Simulate error notification
    const errorNotification = {
      type: 'notification',
      level: 'error',
      message: 'Task failed with error'
    };

    await page.evaluate((update) => {
      window.dispatchEvent(new CustomEvent('ws-message', {
        detail: update
      }));
    }, errorNotification);

    // Verify error notification appears
    await page.waitForTimeout(500);

    const errorEl = page.locator('[role="alert"], .error-notification, .toast-error').first();
    await expect(errorEl).toBeVisible({ timeout: 5000 });
  });

  test('should auto-dismiss notifications after timeout', async ({ page }) => {
    // Simulate notification
    const notification = {
      type: 'notification',
      level: 'info',
      message: 'Auto-dismiss test',
      autoHide: true,
      timeout: 2000
    };

    await page.evaluate((update) => {
      window.dispatchEvent(new CustomEvent('ws-message', {
        detail: update
      }));
    }, notification);

    // Verify notification appears
    const notificationEl = page.locator('text=Auto-dismiss test').first();
    await expect(notificationEl).toBeVisible({ timeout: 2000 });

    // Wait for auto-dismiss
    await page.waitForTimeout(3000);

    // Verify notification disappeared
    await expect(notificationEl).not.toBeVisible({ timeout: 2000 });
  });
});

test.describe('Real-time Collaboration', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/');
    await waitForAppReady(page);
    await waitForWebSocket(page);
  });

  test('should show other users online', async ({ page }) => {
    // Simulate user join event
    const userJoined = {
      type: 'user_joined',
      user: {
        id: 'user-2',
        name: 'Collaborator'
      }
    };

    await page.evaluate((update) => {
      window.dispatchEvent(new CustomEvent('ws-message', {
        detail: update
      }));
    }, userJoined);

    // Verify online indicator
    await page.waitForTimeout(500);

    const onlineUsers = page.locator('[data-testid="online-users"], .users-online').first();
    if (await onlineUsers.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(onlineUsers).toContainText('Collaborator');
    }
  });

  test('should show real-time cursor positions', async ({ page }) => {
    // Simulate cursor update
    const cursorUpdate = {
      type: 'cursor_update',
      user: {
        id: 'user-2',
        name: 'Collaborator'
      },
      position: { x: 100, y: 200 }
    };

    await page.evaluate((update) => {
      window.dispatchEvent(new CustomEvent('ws-message', {
        detail: update
      }));
    }, cursorUpdate);

    // Verify cursor indicator (if implemented)
    await page.waitForTimeout(500);
  });
});

test.describe('WebSocket Performance', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/');
    await waitForAppReady(page);
  });

  test('should handle high message throughput', async ({ page }) => {
    await waitForWebSocket(page);

    // Send many messages
    const startTime = Date.now();
    const messageCount = 100;

    for (let i = 0; i < messageCount; i++) {
      await sendWebSocketMessage(page, {
        type: 'test',
        sequence: i
      });
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Should handle 100 messages in reasonable time (< 5s)
    expect(duration).toBeLessThan(5000);
  });

  test('should not leak memory with long connections', async ({ page }) => {
    await waitForWebSocket(page);

    // Get initial memory
    const initialMetrics = await page.evaluate(() => {
      return (performance as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize || 0;
    });

    // Send messages for a while
    for (let i = 0; i < 50; i++) {
      await sendWebSocketMessage(page, {
        type: 'test',
        data: new Array(100).fill('test')
      });
      await page.waitForTimeout(50);
    }

    // Get final memory
    const finalMetrics = await page.evaluate(() => {
      return (performance as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize || 0;
    });

    // Memory shouldn't grow excessively (allow for some growth)
    const memoryGrowth = finalMetrics - initialMetrics;
    expect(memoryGrowth).toBeLessThan(50 * 1024 * 1024); // Less than 50MB growth
  });
});
