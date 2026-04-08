# Web E2E Test Suite

Comprehensive end-to-end test suite for the web version of Auto Claude using Playwright.

## Overview

This test suite covers:
- **Project Management**: Add, list, select, and manage projects
- **Project Initialization**: Create projects, initialize directories, manage directory structure
- **Task Workflows**: Create, start, monitor, and complete tasks
- **Advanced Task Management**: Create tasks with details, move tasks, task organization, board views
- **Claude Accounts**: Add, authenticate, and manage Claude accounts
- **Ideation**: Create and manage ideas, AI idea generation, idea approval workflow
- **Roadmap**: View roadmap, manage features, phases, and milestones
- **Changelog**: View changelog, create entries, filter by version, GitHub integration
- **Context**: Project context, memories, PR reviews, project indexing
- **Onboarding Wizard**: Initial setup, authentication, configuration steps
- **Azure DevOps**: Azure boards, work items, sprints, backlog integration
- **WebSocket & Real-time**: Live updates, progress streaming, notifications
- **Cross-browser**: Chrome, Firefox, Safari compatibility
- **Mobile Responsive**: Touch interactions, responsive layouts, mobile navigation

## Directory Structure

```
e2e-web/
├── playwright.config.web.ts            # Web-specific Playwright config
├── playwright.config.docker.ts         # Docker-based testing config
├── docker-setup.ts                     # Docker container setup
├── docker-teardown.ts                  # Docker container cleanup
├── web-helper.ts                       # Shared test utilities
├── project-management.web.spec.ts      # Project management tests
├── project-initialization.web.spec.ts  # Project init & directory management
├── task-workflow.web.spec.ts           # Task workflow tests
├── task-advanced.web.spec.ts           # Advanced task management tests
├── claude-accounts.web.spec.ts         # Claude accounts tests
├── ideation.web.spec.ts                # Ideation/ideas tests
├── roadmap.web.spec.ts                 # Roadmap features tests
├── changelog.web.spec.ts               # Changelog management tests
├── context.web.spec.ts                 # Context & memories tests
├── onboarding.web.spec.ts              # Onboarding wizard tests
├── azure-devops.web.spec.ts            # Azure DevOps integration tests
├── websocket-realtime.web.spec.ts      # WebSocket and real-time tests
└── mobile-responsive.web.spec.ts       # Mobile responsive tests
```

## Running Tests

### Prerequisites

```bash
# Install dependencies
npm install

# Install Playwright browsers
npx playwright install
```

### Local Development Testing

```bash
# Run all web E2E tests (starts dev server automatically)
npm run test:e2e:web

# Run in headed mode (see browser)
npm run test:e2e:web:headed

# Run with UI mode (interactive debugging)
npm run test:e2e:web:ui

# Run in debug mode
npm run test:e2e:web:debug
```

### Cross-browser Testing

```bash
# Run on Chromium only
npm run test:e2e:web:chromium

# Run on Firefox only
npm run test:e2e:web:firefox

# Run on WebKit (Safari) only
npm run test:e2e:web:webkit

# Run on all browsers
npm run test:e2e:web:all
```

### Mobile Testing

```bash
# Run mobile-specific tests
npm run test:e2e:web:mobile

# Run responsive design tests
npx playwright test mobile-responsive.web.spec.ts --config=e2e-web/playwright.config.web.ts
```

### Docker-based Testing

```bash
# Run tests against Docker containers
npm run test:e2e:web:docker

# The docker config will:
# 1. Start Docker Compose services
# 2. Wait for health checks
# 3. Run tests
# 4. Cleanup containers
```

### Specific Test Files

```bash
# Run only project management tests
npx playwright test project-management.web.spec.ts --config=e2e-web/playwright.config.web.ts

# Run only task workflow tests
npx playwright test task-workflow.web.spec.ts --config=e2e-web/playwright.config.web.ts

# Run only WebSocket tests
npx playwright test websocket-realtime.web.spec.ts --config=e2e-web/playwright.config.web.ts
```

## Test Reports

```bash
# View HTML test report
npm run test:e2e:web:report

# Or directly:
npx playwright show-report playwright-report-web
```

## Configuration

### Environment Variables

```bash
# Web base URL (default: http://localhost:5173)
WEB_BASE_URL=http://localhost:5173

# Docker web URL (default: http://localhost:3001)
DOCKER_WEB_URL=http://localhost:3001

# CI mode (enables stricter settings)
CI=true
```

### Playwright Config

- **Web config** (`playwright.config.web.ts`): For local development testing
  - Auto-starts dev server
  - Parallel execution
  - Multiple browser projects
  - Mobile device emulation

- **Docker config** (`playwright.config.docker.ts`): For containerized testing
  - Sequential execution
  - Docker setup/teardown
  - Extended timeouts
  - JUnit reporting for CI

## Writing Tests

### Using Test Helpers

```typescript
import { 
  waitForAppReady, 
  navigateToRoute, 
  mockApiResponse,
  testResponsiveLayout 
} from './web-helper';

test('my test', async ({ page }) => {
  // Navigate to route
  await navigateToRoute(page, '/projects');
  
  // Wait for app to be ready
  await waitForAppReady(page);
  
  // Mock API responses
  await mockApiResponse(page, '/api/projects', {
    success: true,
    data: []
  });
  
  // Test responsive layout
  await testResponsiveLayout(page, [
    { width: 375, height: 667, name: 'iPhone SE' }
  ]);
});
```

### WebSocket Testing

```typescript
import { 
  waitForWebSocket, 
  sendWebSocketMessage,
  waitForWebSocketMessage 
} from './web-helper';

test('websocket test', async ({ page }) => {
  // Wait for WebSocket connection
  await waitForWebSocket(page);
  
  // Send message
  await sendWebSocketMessage(page, { type: 'ping' });
  
  // Wait for response
  const pong = await waitForWebSocketMessage(page, 
    (msg) => msg.type === 'pong'
  );
});
```

## CI Integration

### GitHub Actions Example

```yaml
name: Web E2E Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '24'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Install Playwright
        run: npx playwright install --with-deps
      
      - name: Run E2E tests
        run: npm run test:e2e:web:all
      
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-report
          path: apps/frontend/playwright-report-web/
```

### Docker CI Example

```yaml
- name: Start Docker services
  run: docker-compose -f docker-compose.web.yml up -d

- name: Run Docker E2E tests
  run: npm run test:e2e:web:docker

- name: Stop Docker services
  if: always()
  run: docker-compose -f docker-compose.web.yml down
```

## Troubleshooting

### Tests Timeout

- Increase timeouts in playwright config
- Check if dev server started correctly
- Verify network connectivity

### WebSocket Tests Fail

- Ensure WebSocket server is running
- Check WebSocket URL configuration
- Verify CORS settings

### Mobile Tests Fail

- Clear browser data between tests
- Verify viewport sizes
- Check touch event handling

### Docker Tests Fail

- Ensure Docker is running
- Check container health status
- Verify port mappings (3001 for frontend, 8000 for backend)
- Review container logs: `docker-compose -f docker-compose.web.yml logs`

## Best Practices

1. **Use test helpers** - Leverage shared utilities for consistency
2. **Mock API responses** - Use mocks for predictable tests
3. **Wait for elements** - Always wait for elements before interacting
4. **Test responsively** - Check multiple viewport sizes
5. **Clean up** - Clear storage and state between tests
6. **Use data attributes** - Add `data-testid` to key elements
7. **Handle async** - Properly await all async operations
8. **Screenshot on failure** - Capture screenshots for debugging

## Related Documentation

- [Playwright Documentation](https://playwright.dev/)
- [Electron E2E Tests](../e2e/README.md)
- [Web Development Guide](../../guides/WEB_DEVELOPMENT.md)
- [Docker Compose Configuration](../../docker-compose.web.yml)
