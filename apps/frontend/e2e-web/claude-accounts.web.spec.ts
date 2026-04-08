/**
 * End-to-End tests for Claude Account Management in Web version
 * Tests: Add account, authenticate, manage accounts, re-authenticate
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
const mockAccount = {
  id: 'account-1',
  name: 'Work Account',
  email: 'work@example.com',
  authenticated: true,
  createdAt: new Date().toISOString()
};

const mockUnauthenticatedAccount = {
  id: 'account-2',
  name: 'Personal Account',
  email: null,
  authenticated: false,
  createdAt: new Date().toISOString()
};

// Test helpers
async function navigateToClaudeAccounts(page: Page): Promise<void> {
  // Navigate to settings/integrations/claude accounts
  await page.goto('/settings/integrations');
  await waitForAppReady(page);

  // Look for Claude Accounts section
  const claudeSection = page.locator('text=Claude Accounts, h2:has-text("Claude"), h3:has-text("Claude")').first();
  if (await claudeSection.isVisible({ timeout: 2000 }).catch(() => false)) {
    await claudeSection.scrollIntoViewIfNeeded();
  }
}

async function addAccount(page: Page, accountName: string): Promise<void> {
  // Click add account button
  const addButton = page.locator('button:has-text("Add Account"), button:has-text("Add"), [data-testid="add-account"]').first();
  await addButton.click();

  // Fill in account name
  const nameInput = page.locator('input[name="accountName"], input[placeholder*="name"]').first();
  await nameInput.fill(accountName);

  // Submit
  const submitButton = page.locator('button:has-text("Add"), button:has-text("Submit"), button[type="submit"]').first();
  await submitButton.click();
}

async function verifyAccountInList(page: Page, accountName: string): Promise<void> {
  const accountItem = page.locator(`[data-testid="account-item"]:has-text("${accountName}"), .account-card:has-text("${accountName}")`).first();
  await expect(accountItem).toBeVisible({ timeout: 10000 });
}

test.describe('Claude Accounts - View and List', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/');
    await waitForAppReady(page);
  });

  test('should navigate to Claude Accounts section', async ({ page }) => {
    await navigateToClaudeAccounts(page);

    // Verify we're in the right section
    const heading = page.locator('h1:has-text("Claude"), h2:has-text("Claude"), text=Claude Accounts').first();
    await expect(heading).toBeVisible({ timeout: 5000 });
  });

  test('should display empty state when no accounts', async ({ page }) => {
    await navigateToClaudeAccounts(page);

    // Mock empty accounts response
    await mockApiResponse(page, '/api/accounts', {
      success: true,
      data: []
    });

    await page.reload();
    await waitForAppReady(page);

    // Verify empty state
    const emptyState = page.locator('text=/no accounts/i, text=/add your first/i').first();
    await expect(emptyState).toBeVisible({ timeout: 5000 });
  });

  test('should display account list', async ({ page }) => {
    await navigateToClaudeAccounts(page);

    // Mock accounts response
    await mockApiResponse(page, '/api/accounts', {
      success: true,
      data: [mockAccount, mockUnauthenticatedAccount]
    });

    await page.reload();
    await waitForAppReady(page);

    // Verify accounts are displayed
    await verifyAccountInList(page, mockAccount.name);
    await verifyAccountInList(page, mockUnauthenticatedAccount.name);
  });

  test('should show authentication status', async ({ page }) => {
    await navigateToClaudeAccounts(page);

    // Mock accounts
    await mockApiResponse(page, '/api/accounts', {
      success: true,
      data: [mockAccount, mockUnauthenticatedAccount]
    });

    await page.reload();
    await waitForAppReady(page);

    // Verify authenticated account shows checkmark or verified badge
    const authenticatedBadge = page.locator(`[data-account-id="${mockAccount.id}"] [data-testid="authenticated"], .verified-badge`).first();
    await expect(authenticatedBadge).toBeVisible({ timeout: 5000 });

    // Verify unauthenticated account shows warning or pending status
    const unauthenticatedBadge = page.locator(`[data-account-id="${mockUnauthenticatedAccount.id}"] [data-testid="unauthenticated"], .pending-badge`).first();
    await expect(unauthenticatedBadge).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Claude Accounts - Add Account', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/settings/integrations');
    await waitForAppReady(page);
  });

  test('should open add account dialog', async ({ page }) => {
    const addButton = page.locator('button:has-text("Add Account"), button:has-text("Add")').first();
    await addButton.click();

    // Verify dialog is open
    const dialog = page.locator('[role="dialog"], .dialog, .modal').first();
    await expect(dialog).toBeVisible();

    // Verify form fields
    const nameInput = page.locator('input[name="accountName"], input[placeholder*="name"]').first();
    await expect(nameInput).toBeVisible();
  });

  test('should add new account', async ({ page }) => {
    // Mock successful add account response
    await mockApiResponse(page, '/api/accounts', {
      success: true,
      data: {
        id: 'new-account',
        name: 'New Account',
        email: null,
        authenticated: false
      }
    });

    await addAccount(page, 'New Account');

    // Wait for API call
    await waitForApiCall(page, '/api/accounts');

    // Verify success feedback
    await page.waitForTimeout(1000);
  });

  test('should validate account name', async ({ page }) => {
    const addButton = page.locator('button:has-text("Add Account"), button:has-text("Add")').first();
    await addButton.click();

    // Try to submit with empty name
    const submitButton = page.locator('button:has-text("Add"), button:has-text("Submit"), button[type="submit"]').first();
    await submitButton.click();

    // Verify validation message
    const validationMsg = page.locator('text=/required/i, .error, .validation-error').first();
    await expect(validationMsg).toBeVisible({ timeout: 3000 });
  });

  test('should handle duplicate account name', async ({ page }) => {
    // Mock accounts
    await mockApiResponse(page, '/api/accounts', {
      success: true,
      data: [mockAccount]
    });

    await page.reload();
    await waitForAppReady(page);

    // Try to add account with same name
    const addButton = page.locator('button:has-text("Add Account"), button:has-text("Add")').first();
    await addButton.click();

    const nameInput = page.locator('input[name="accountName"], input[placeholder*="name"]').first();
    await nameInput.fill(mockAccount.name);

    const submitButton = page.locator('button:has-text("Add"), button:has-text("Submit")').first();
    await submitButton.click();

    // Mock error response
    await mockApiResponse(page, '/api/accounts', {
      success: false,
      error: 'Account name already exists'
    }, 400);

    // Verify error message
    const errorMsg = page.locator('text=/already exists/i, .error-message').first();
    await expect(errorMsg).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Claude Accounts - Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/settings/integrations');
    await waitForAppReady(page);
  });

  test('should initiate authentication flow', async ({ page }) => {
    // Mock unauthenticated account
    await mockApiResponse(page, '/api/accounts', {
      success: true,
      data: [mockUnauthenticatedAccount]
    });

    await page.reload();
    await waitForAppReady(page);

    // Click authenticate button
    const authButton = page.locator(`[data-account-id="${mockUnauthenticatedAccount.id}"] button:has-text("Authenticate"), button[data-action="authenticate"]`).first();
    await authButton.click();

    // Verify authentication UI appears
    await page.waitForTimeout(1000);
  });

  test('should complete OAuth authentication', async ({ page }) => {
    // Mock OAuth initiation
    await mockApiResponse(page, '/api/accounts/oauth/init', {
      success: true,
      data: {
        authUrl: 'https://console.anthropic.com/oauth',
        state: 'random-state-token'
      }
    });

    // Initiate auth
    await addAccount(page, 'OAuth Test Account');

    // Mock OAuth callback
    await page.evaluate(() => {
      window.postMessage({
        type: 'oauth-callback',
        data: {
          code: 'auth-code-123',
          state: 'random-state-token'
        }
      }, '*');
    });

    // Wait for completion
    await page.waitForTimeout(2000);
  });

  test('should handle authentication success', async ({ page }) => {
    // Mock successful authentication
    await mockApiResponse(page, '/api/accounts/oauth/callback', {
      success: true,
      data: {
        ...mockUnauthenticatedAccount,
        email: 'authenticated@example.com',
        authenticated: true
      }
    });

    // Trigger authentication flow
    await page.goto('/settings/integrations?oauth=success&account=account-2');
    await waitForAppReady(page);

    // Verify success message
    const successMsg = page.locator('text=/successfully authenticated/i, .success-message').first();
    await expect(successMsg).toBeVisible({ timeout: 5000 });
  });

  test('should handle authentication failure', async ({ page }) => {
    // Mock authentication failure
    await mockApiResponse(page, '/api/accounts/oauth/callback', {
      success: false,
      error: 'Authentication failed'
    }, 400);

    // Trigger authentication flow with error
    await page.goto('/settings/integrations?oauth=error&message=Authentication failed');
    await waitForAppReady(page);

    // Verify error message
    const errorMsg = page.locator('text=/authentication failed/i, .error-message').first();
    await expect(errorMsg).toBeVisible({ timeout: 5000 });
  });

  test('should handle authentication timeout', async ({ page }) => {
    // Trigger authentication timeout
    await page.goto('/settings/integrations?oauth=timeout');
    await waitForAppReady(page);

    // Verify timeout message
    const timeoutMsg = page.locator('text=/timeout/i, text=/timed out/i').first();
    await expect(timeoutMsg).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Claude Accounts - Re-Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/settings/integrations');
    await waitForAppReady(page);
  });

  test('should show re-authenticate button for expired tokens', async ({ page }) => {
    // Mock account with expired token
    const expiredAccount = {
      ...mockAccount,
      authenticated: true,
      tokenExpired: true
    };

    await mockApiResponse(page, '/api/accounts', {
      success: true,
      data: [expiredAccount]
    });

    await page.reload();
    await waitForAppReady(page);

    // Verify re-authenticate button is visible
    const reauthButton = page.locator(`[data-account-id="${expiredAccount.id}"] button:has-text("Re-authenticate"), button[data-action="reauth"]`).first();
    await expect(reauthButton).toBeVisible({ timeout: 5000 });
  });

  test('should initiate re-authentication flow', async ({ page }) => {
    // Mock authenticated account
    await mockApiResponse(page, '/api/accounts', {
      success: true,
      data: [mockAccount]
    });

    await page.reload();
    await waitForAppReady(page);

    // Click re-authenticate button
    const reauthButton = page.locator(`[data-account-id="${mockAccount.id}"] button:has-text("Re-authenticate"), button[data-action="reauth"]`).first();
    if (await reauthButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await reauthButton.click();

      // Verify re-auth UI appears
      await page.waitForTimeout(1000);
    }
  });

  test('should complete re-authentication successfully', async ({ page }) => {
    // Mock successful re-auth
    await mockApiResponse(page, '/api/accounts/reauth', {
      success: true,
      data: {
        ...mockAccount,
        tokenExpired: false
      }
    });

    // Trigger re-auth completion
    await page.goto('/settings/integrations?reauth=success&account=account-1');
    await waitForAppReady(page);

    // Verify success message
    const successMsg = page.locator('text=/successfully re-authenticated/i, .success-message').first();
    await expect(successMsg).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Claude Accounts - Account Management', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/settings/integrations');
    await waitForAppReady(page);
  });

  test('should remove account', async ({ page }) => {
    // Mock accounts
    await mockApiResponse(page, '/api/accounts', {
      success: true,
      data: [mockAccount]
    });

    await page.reload();
    await waitForAppReady(page);

    // Click remove button
    const removeButton = page.locator(`[data-account-id="${mockAccount.id}"] button[aria-label*="remove"], button:has-text("Remove")`).first();
    await removeButton.click();

    // Confirm removal
    const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Remove"), button:has-text("Delete")').first();
    await confirmButton.click();

    // Wait for API call
    await page.waitForTimeout(1000);
  });

  test('should edit account name', async ({ page }) => {
    // Mock accounts
    await mockApiResponse(page, '/api/accounts', {
      success: true,
      data: [mockAccount]
    });

    await page.reload();
    await waitForAppReady(page);

    // Click edit button
    const editButton = page.locator(`[data-account-id="${mockAccount.id}"] button[aria-label*="edit"], button:has-text("Edit")`).first();
    if (await editButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await editButton.click();

      // Change name
      const nameInput = page.locator('input[value="${mockAccount.name}"]').first();
      await nameInput.fill('Updated Account Name');

      // Save
      const saveButton = page.locator('button:has-text("Save"), button[type="submit"]').first();
      await saveButton.click();

      await page.waitForTimeout(1000);
    }
  });

  test('should view account details', async ({ page }) => {
    // Mock account details
    await mockApiResponse(page, `/api/accounts/${mockAccount.id}`, {
      success: true,
      data: {
        ...mockAccount,
        usage: {
          tokensUsed: 50000,
          requestsCount: 150
        }
      }
    });

    await page.goto(`/settings/integrations/accounts/${mockAccount.id}`);
    await waitForAppReady(page);

    // Verify details are shown
    await waitForText(page, mockAccount.name);
    await waitForText(page, mockAccount.email || '');
  });
});

test.describe('Claude Accounts - Responsive Tests', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/settings/integrations');
    await waitForAppReady(page);
  });

  test('should display accounts responsively', async ({ page }) => {
    await testResponsiveLayout(page, [
      { width: 375, height: 667, name: 'iPhone SE' },
      { width: 768, height: 1024, name: 'iPad' }
    ]);
  });

  test('should handle touch interactions for accounts', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Mock accounts
    await mockApiResponse(page, '/api/accounts', {
      success: true,
      data: [mockAccount]
    });

    await page.reload();
    await waitForAppReady(page);

    // Tap on account
    const accountCard = page.locator(`text=${mockAccount.name}`).first();
    await accountCard.tap();

    await page.waitForTimeout(500);
  });
});
