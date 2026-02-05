/**
 * Web E2E Tests
 * =============
 * 
 * Uses shared test suites for platform-agnostic testing.
 * 
 * Prerequisites:
 * - Backend running on localhost:8000
 * - Frontend running on localhost:5173
 * 
 * Run: npx playwright test --config=e2e/playwright.web.config.ts
 */
import {
  appLoadingTests,
  navigationTests,
  errorHandlingTests,
  performanceTests
} from './shared-tests';

// Run all shared test suites
appLoadingTests();
navigationTests();
errorHandlingTests();
performanceTests();
