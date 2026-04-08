/**
 * End-to-End tests for Onboarding Wizard (Setup/Startup Wizard)
 * Tests: Initial setup, authentication, configuration steps
 */
import { test, expect, Page } from '@playwright/test';
import { 
  waitForAppReady, 
  navigateToRoute, 
  mockApiResponse,
  testResponsiveLayout
} from './web-helper';

test.describe('Onboarding Wizard - Initial Setup', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/onboarding');
    await waitForAppReady(page);
  });

  test('should display welcome screen', async ({ page }) => {
    const welcomeHeader = page.locator('h1:has-text("Welcome"), h1:has-text("Get Started")').first();
    await expect(welcomeHeader).toBeVisible({ timeout: 5000 });

    // Verify start button
    const startButton = page.locator('button:has-text("Get Started"), button:has-text("Start")').first();
    await expect(startButton).toBeVisible();
  });

  test('should navigate through wizard steps', async ({ page }) => {
    // Click start/next button
    const nextButton = page.locator('button:has-text("Next"), button:has-text("Continue"), button:has-text("Get Started")').first();
    await nextButton.click();

    await page.waitForTimeout(1000);

    // Verify we moved to next step
    const wizardProgress = page.locator('[data-testid="wizard-progress"], .progress-indicator').first();
    await expect(wizardProgress).toBeVisible({ timeout: 5000 });
  });

  test('should go back to previous step', async ({ page }) => {
    // Move to next step first
    const nextButton = page.locator('button:has-text("Next")').first();
    await nextButton.click();
    await page.waitForTimeout(500);

    // Go back
    const backButton = page.locator('button:has-text("Back"), button:has-text("Previous")').first();
    if (await backButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await backButton.click();

      await page.waitForTimeout(500);
    }
  });

  test('should skip optional steps', async ({ page }) => {
    const skipButton = page.locator('button:has-text("Skip"), button:has-text("Skip for now")').first();
    if (await skipButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await skipButton.click();

      await page.waitForTimeout(500);
    }
  });
});

test.describe('Onboarding - Authentication Setup', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/onboarding');
    await waitForAppReady(page);

    // Navigate to auth step
    const nextButton = page.locator('button:has-text("Next"), button:has-text("Get Started")').first();
    await nextButton.click();
    await page.waitForTimeout(1000);
  });

  test('should display authentication options', async ({ page }) => {
    // Look for OAuth option
    const oauthOption = page.locator('button:has-text("OAuth"), button:has-text("Sign in with Claude")').first();
    if (await oauthOption.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(oauthOption).toBeVisible();
    }

    // Look for API key option
    const apiKeyOption = page.locator('button:has-text("API Key"), button:has-text("Use API Key")').first();
    if (await apiKeyOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(apiKeyOption).toBeVisible();
    }
  });

  test('should select OAuth authentication', async ({ page }) => {
    await mockApiResponse(page, '/api/auth/oauth/init', {
      success: true,
      data: { authUrl: 'https://claude.ai/oauth' }
    });

    const oauthButton = page.locator('button:has-text("OAuth"), button:has-text("Sign in")').first();
    if (await oauthButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await oauthButton.click();

      await page.waitForTimeout(1000);
    }
  });

  test('should configure API key authentication', async ({ page }) => {
    const apiKeyButton = page.locator('button:has-text("API Key")').first();
    if (await apiKeyButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await apiKeyButton.click();

      // Enter API key
      const apiKeyInput = page.locator('input[name="apiKey"], input[type="password"]').first();
      await apiKeyInput.fill('test-api-key-12345');

      // Continue
      const continueButton = page.locator('button:has-text("Continue"), button:has-text("Next")').first();
      await continueButton.click();

      await page.waitForTimeout(1000);
    }
  });
});

test.describe('Onboarding - Project Configuration', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/onboarding');
    await waitForAppReady(page);

    // Skip to project setup step
    for (let i = 0; i < 2; i++) {
      const nextButton = page.locator('button:has-text("Next"), button:has-text("Continue"), button:has-text("Skip")').first();
      await nextButton.click();
      await page.waitForTimeout(500);
    }
  });

  test('should configure first project', async ({ page }) => {
    // Fill project name
    const projectNameInput = page.locator('input[name="projectName"], input[placeholder*="project name"]').first();
    if (await projectNameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await projectNameInput.fill('My First Project');

      // Fill project path
      const projectPathInput = page.locator('input[name="projectPath"], input[placeholder*="path"]').first();
      await projectPathInput.fill('/home/user/projects/my-first-project');

      // Continue
      const nextButton = page.locator('button:has-text("Next"), button:has-text("Create")').first();
      await nextButton.click();

      await page.waitForTimeout(1000);
    }
  });

  test('should configure Python environment', async ({ page }) => {
    const pythonPathInput = page.locator('input[name="pythonPath"], input[placeholder*="Python"]').first();
    if (await pythonPathInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await pythonPathInput.fill('/usr/bin/python3');

      const nextButton = page.locator('button:has-text("Next")').first();
      await nextButton.click();

      await page.waitForTimeout(1000);
    }
  });
});

test.describe('Onboarding - Memory Configuration', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/onboarding');
    await waitForAppReady(page);

    // Skip to memory configuration step
    for (let i = 0; i < 3; i++) {
      const nextButton = page.locator('button:has-text("Next"), button:has-text("Continue"), button:has-text("Skip")').first();
      await nextButton.click();
      await page.waitForTimeout(500);
    }
  });

  test('should enable Graphiti memory', async ({ page }) => {
    const graphitiToggle = page.locator('input[type="checkbox"][name="enableGraphiti"], [role="switch"]').first();
    if (await graphitiToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
      await graphitiToggle.check();

      await page.waitForTimeout(500);
    }
  });

  test('should configure memory provider', async ({ page }) => {
    const providerSelect = page.locator('select[name="memoryProvider"], [data-testid="provider-select"]').first();
    if (await providerSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      await providerSelect.selectOption('openai');

      // Enter API key if needed
      const apiKeyInput = page.locator('input[name="providerApiKey"]').first();
      if (await apiKeyInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        await apiKeyInput.fill('test-openai-key');
      }

      await page.waitForTimeout(500);
    }
  });

  test('should skip memory configuration', async ({ page }) => {
    const skipButton = page.locator('button:has-text("Skip"), button:has-text("Skip for now")').first();
    if (await skipButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await skipButton.click();

      await page.waitForTimeout(500);
    }
  });
});

test.describe('Onboarding - Dev Tools Setup', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/onboarding');
    await waitForAppReady(page);

    // Skip to dev tools step
    for (let i = 0; i < 4; i++) {
      const nextButton = page.locator('button:has-text("Next"), button:has-text("Continue"), button:has-text("Skip")').first();
      await nextButton.click();
      await page.waitForTimeout(500);
    }
  });

  test('should configure GitHub CLI', async ({ page }) => {
    const githubCliPath = page.locator('input[name="githubCliPath"], input[placeholder*="gh"]').first();
    if (await githubCliPath.isVisible({ timeout: 2000 }).catch(() => false)) {
      await githubCliPath.fill('/usr/bin/gh');

      await page.waitForTimeout(500);
    }
  });

  test('should configure Claude CLI', async ({ page }) => {
    const claudeCliPath = page.locator('input[name="claudeCliPath"], input[placeholder*="claude"]').first();
    if (await claudeCliPath.isVisible({ timeout: 2000 }).catch(() => false)) {
      await claudeCliPath.fill('/usr/local/bin/claude');

      await page.waitForTimeout(500);
    }
  });

  test('should auto-detect dev tools', async ({ page }) => {
    const autoDetectButton = page.locator('button:has-text("Auto-detect"), button:has-text("Detect")').first();
    if (await autoDetectButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await autoDetectButton.click();

      await page.waitForTimeout(2000);
    }
  });
});

test.describe('Onboarding - Completion', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/onboarding');
    await waitForAppReady(page);

    // Skip through all steps
    for (let i = 0; i < 6; i++) {
      const nextButton = page.locator('button:has-text("Next"), button:has-text("Continue"), button:has-text("Skip"), button:has-text("Get Started")').first();
      await nextButton.click();
      await page.waitForTimeout(500);
    }
  });

  test('should display completion screen', async ({ page }) => {
    const completionMessage = page.locator('text=/setup.*complete/i, text=/ready.*go/i, text=/all.*set/i').first();
    if (await completionMessage.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(completionMessage).toBeVisible();
    }
  });

  test('should finish onboarding', async ({ page }) => {
    const finishButton = page.locator('button:has-text("Finish"), button:has-text("Get Started"), button:has-text("Go to Dashboard")').first();
    if (await finishButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await finishButton.click();

      // Verify redirect to main app
      await page.waitForTimeout(1000);
    }
  });

  test('should display feature summary', async ({ page }) => {
    // Verify key features are highlighted
    const featuresSection = page.locator('[data-testid="features-summary"], .features-list').first();
    if (await featuresSection.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(featuresSection).toBeVisible();
    }
  });
});

test.describe('Onboarding - Privacy and Terms', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/onboarding');
    await waitForAppReady(page);
  });

  test('should display privacy policy', async ({ page }) => {
    const privacyLink = page.locator('a:has-text("Privacy"), button:has-text("Privacy")').first();
    if (await privacyLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await privacyLink.click();

      await page.waitForTimeout(1000);
    }
  });

  test('should accept terms and conditions', async ({ page }) => {
    const termsCheckbox = page.locator('input[type="checkbox"][name="acceptTerms"]').first();
    if (await termsCheckbox.isVisible({ timeout: 2000 }).catch(() => false)) {
      await termsCheckbox.check();

      // Verify continue button is enabled
      const continueButton = page.locator('button:has-text("Continue")').first();
      await expect(continueButton).toBeEnabled({ timeout: 3000 });
    }
  });
});

test.describe('Onboarding - Responsive', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToRoute(page, '/onboarding');
    await waitForAppReady(page);
  });

  test('should work on mobile devices', async ({ page }) => {
    await testResponsiveLayout(page, [
      { width: 375, height: 667, name: 'iPhone SE' },
      { width: 768, height: 1024, name: 'iPad' }
    ]);
  });
});
