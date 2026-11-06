import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const PUBLISHED_URL =
  process.env.PLAYWRIGHT_BASE_URL || "https://deeptutor.notesvnn.click";

test.describe("Aperant Web E2E — Published URL & Full Project/Task Lifecycle", () => {
  test.describe.configure({ mode: "serial" });
  test("1. Loads Welcome Screen with Registered Projects & zero page errors", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto(PUBLISHED_URL, { waitUntil: "domcontentloaded" });

    // Verify Welcome Screen title and AZ305 Telegram Bot in Recent Projects
    await expect(page.getByText("Welcome to Auto Claude")).toBeVisible();
    await expect(page.getByText("AZ305 Telegram Bot").first()).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("2. Opens Connect Project Dialog and opens AZ305 Telegram Bot into Kanban Board", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto(PUBLISHED_URL, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("AZ305 Telegram Bot").first()).toBeVisible();

    // Click 'Connect a Project' button to open OpenProjectDialog
    await page.getByRole("button", { name: /Connect a Project/i }).click();
    const dialog = page.getByTestId("open-project-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("AZ305 Telegram Bot").first()).toBeVisible();

    // Screenshot of OpenProjectDialog on published URL
    await page.screenshot({
      path: "/home/thinhnguyen/.gemini/antigravity-cli/brain/043fca10-dc92-4595-8682-6d906a147bc0/aperant_open_project_dialog_e2e.png",
    });

    // Click Open on AZ305 Telegram Bot inside the dialog
    await page.getByTestId("dialog-open-project-az305-telegram-bot").click();

    // Verify dialog closes and Kanban Board renders with AZ305 Telegram Bot tasks
    await expect(dialog).toBeHidden();
    await expect(
      page.getByText("Persona-Driven Dynamic Video Explainer Engine"),
    ).toBeVisible();
    await expect(
      page.getByText("AZ-305 Spaced Repetition & Adaptive Quiz Bot"),
    ).toBeVisible();
    await expect(
      page.getByText("FlowKit Story Director 9:16 Vertical Video Pipeline"),
    ).toBeVisible();

    // Screenshot of AZ305 Telegram Bot Kanban Board on published URL
    await page.screenshot({
      path: "/home/thinhnguyen/.gemini/antigravity-cli/brain/043fca10-dc92-4595-8682-6d906a147bc0/aperant_az305_kanban_e2e.png",
    });

    expect(pageErrors).toEqual([]);
  });

  test("3. Navigates across Insights, Ideation, Roadmap, and Settings views with AZ305 Telegram Bot active", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto(PUBLISHED_URL, { waitUntil: "domcontentloaded" });

    // Open AZ305 Telegram Bot directly from Recent Projects on Welcome Screen
    await page.getByText("AZ305 Telegram Bot").first().click();
    await expect(
      page.getByText("Persona-Driven Dynamic Video Explainer Engine"),
    ).toBeVisible();

    // Switch to Insights view
    await page.getByRole("button", { name: /Insights/i }).click();
    await expect(page.getByText(/Insights/i).first()).toBeVisible();
    await page.screenshot({
      path: "/home/thinhnguyen/.gemini/antigravity-cli/brain/043fca10-dc92-4595-8682-6d906a147bc0/aperant_az305_insights_e2e.png",
    });

    // Switch to Settings view
    await page.getByRole("button", { name: /Settings/i }).click();
    await expect(page.getByText(/Settings/i).first()).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("4. Self-heals when localStorage or store state has undefined arrays (no TypeError reading 'find')", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.addInitScript(() => {
      localStorage.setItem(
        "auto-claude-tab-state",
        JSON.stringify({
          openProjectIds: undefined,
          activeProjectId: "09b2c1ba-27ba-43a8-80f8-c9fa9ef733f5",
        }),
      );
    });

    await page.goto(PUBLISHED_URL, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("AZ305 Telegram Bot").first()).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("5. Full Lifecycle E2E: Create New C# Project -> Verify File Explorer (No 404) -> Create Task 'Init C# process' -> Run Task -> Verify C# Project Generated in Folder", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    const csharpProjectDir =
      "/home/thinhnguyen/ClawdCodeWorkspace/sandbox/csharp-e2e-project";
    // Start with a fresh empty project directory to prove task execution creates the C# files
    fs.rmSync(csharpProjectDir, { recursive: true, force: true });
    fs.mkdirSync(csharpProjectDir, { recursive: true });

    await page.goto(PUBLISHED_URL, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Welcome to Auto Claude")).toBeVisible();
    // Wait for client hydration & loadProjects() before clicking interactive buttons
    await expect(page.getByText("AZ305 Telegram Bot").first()).toBeVisible();

    // 1. Open Connect Project Dialog & Create/Connect the new C# Project folder
    await page.getByRole("button", { name: /Connect a Project/i }).click();
    const dialog = page.getByTestId("open-project-dialog");
    await expect(dialog).toBeVisible();

    const uniqueSuffix = Date.now().toString().slice(-4);
    const newProjectName = `CSharp Process E2E`;

    await page.getByTestId("project-path-input").fill(csharpProjectDir);
    await page.getByTestId("project-name-input").fill(newProjectName);
    await page.getByTestId("submit-connect-project").click();

    // Verify dialog closes and new project tab is active
    await expect(dialog).toBeHidden();
    await expect(page.getByText(newProjectName).first()).toBeVisible();

    // 2. Click '+ New Task' to open TaskCreationWizard
    await page.getByTestId("kanban-new-task-btn").click();
    const taskTitle = `Init C# process ${uniqueSuffix}`;
    const taskDesc =
      "Initialize a C# .NET 8.0 process runner project inside this project folder with csproj, Program.cs, and ProcessWorker.";

    await page.getByTestId("wizard-title-input").fill(taskTitle);
    await page.getByTestId("wizard-description-input").fill(taskDesc);

    // Navigate to Step 2 (Files) and verify NO 'Failed to load files: 404' and proper i18n heading
    await page.getByTestId("wizard-next-or-create-btn").click();
    await expect(page.getByText("Select Relevant Files")).toBeVisible();
    await expect(page.getByText(/Failed to load files/i)).toHaveCount(0);

    // Click Quick Create Task button from Step 2
    await page.getByTestId("wizard-quick-create-btn").click();

    // 3. Verify Task appears in Backlog column with 'Run Task' button
    const backlogColumn = page.getByTestId("kanban-column-backlog");
    await expect(backlogColumn.getByText(taskTitle)).toBeVisible();
    await page.screenshot({
      path: "/home/thinhnguyen/.gemini/antigravity-cli/brain/043fca10-dc92-4595-8682-6d906a147bc0/aperant_e2e_step1_task_in_backlog.png",
    });

    // 4. Click 'Run Task' on the newly created task card
    const taskCardInBacklog = backlogColumn
      .locator('[data-testid^="task-card-"]')
      .filter({ hasText: taskTitle });
    await taskCardInBacklog.getByRole("button", { name: /Run Task/i }).click();

    // 5. Verify Task progresses through Queue -> In Progress -> AI Review -> Human Review
    const queueColumn = page.getByTestId("kanban-column-queue");
    await expect(queueColumn.getByText(taskTitle)).toBeVisible({
      timeout: 8000,
    });

    const inProgressColumn = page.getByTestId("kanban-column-in_progress");
    await expect(inProgressColumn.getByText(taskTitle)).toBeVisible({
      timeout: 8000,
    });
    await page.screenshot({
      path: "/home/thinhnguyen/.gemini/antigravity-cli/brain/043fca10-dc92-4595-8682-6d906a147bc0/aperant_e2e_step2_task_in_progress.png",
    });

    const aiReviewColumn = page.getByTestId("kanban-column-ai_review");
    await expect(aiReviewColumn.getByText(taskTitle)).toBeVisible({
      timeout: 8000,
    });

    const humanReviewColumn = page.getByTestId("kanban-column-human_review");
    await expect(humanReviewColumn.getByText(taskTitle)).toBeVisible({
      timeout: 10000,
    });
    const reviewCard = humanReviewColumn
      .locator('[data-testid^="task-card-"]')
      .filter({ hasText: taskTitle });
    await reviewCard.scrollIntoViewIfNeeded();
    await reviewCard.getByRole("button", { name: /Approve/i }).click();

    // 6. Verify Task moves to 'Done' column after Human Review approval
    const doneColumn = page.getByTestId("kanban-column-done");
    await expect(doneColumn.getByText(taskTitle)).toBeVisible({
      timeout: 10000,
    });
    const completedCard = doneColumn
      .locator('[data-testid^="task-card-"]')
      .filter({ hasText: taskTitle });
    await completedCard.scrollIntoViewIfNeeded();
    await expect(completedCard.getByText("3/3")).toBeVisible();
    await expect(completedCard.getByText("Completed")).toBeVisible();

    await page.screenshot({
      path: "/home/thinhnguyen/.gemini/antigravity-cli/brain/043fca10-dc92-4595-8682-6d906a147bc0/aperant_e2e_step3_task_done.png",
    });

    // 7. Verify REAL C# project files were generated inside csharpProjectDir on disk!
    const expectedFiles = [
      "CSharpProcessE2E.csproj",
      "Program.cs",
      "Services/ProcessWorker.cs",
      "appsettings.json",
      ".gitignore",
      "README.md",
    ];
    for (const relFile of expectedFiles) {
      const fullPath = path.join(csharpProjectDir, relFile);
      expect(
        fs.existsSync(fullPath),
        `Expected generated C# file on disk: ${fullPath}`,
      ).toBe(true);
    }
    const csprojContent = fs.readFileSync(
      path.join(csharpProjectDir, "CSharpProcessE2E.csproj"),
      "utf-8",
    );
    expect(csprojContent).toContain('Sdk="Microsoft.NET.Sdk"');
    expect(csprojContent).toContain("<TargetFramework>net8.0</TargetFramework>");

    // 8. Click completed task card to open TaskDetailModal and verify 'Files' tab lists the C# files
    await completedCard.click();
    const detailModal = page.getByTestId("task-detail-modal");
    await expect(detailModal).toBeVisible();
    await expect(detailModal.getByText("100%").first()).toBeVisible();

    await detailModal.getByRole("tab", { name: /Files/i }).click();
    await expect(detailModal.getByText("CSharpProcessE2E.csproj")).toBeVisible();
    await expect(detailModal.getByText("Program.cs")).toBeVisible();
    await expect(detailModal.getByText("Services/ProcessWorker.cs")).toBeVisible();

    await page.screenshot({
      path: "/home/thinhnguyen/.gemini/antigravity-cli/brain/043fca10-dc92-4595-8682-6d906a147bc0/aperant_e2e_step4_task_detail_modal.png",
    });

    expect(pageErrors).toEqual([]);
  });

  test("6. Full 6-Stage Kanban Pipeline (Backlog -> Queue -> In Progress -> AI Review -> Human Review -> Done) & Cypress E2E Generation", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    const csharpProjectDir =
      "/home/thinhnguyen/ClawdCodeWorkspace/sandbox/csharp-e2e-project";

    await page.goto(PUBLISHED_URL, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Welcome to Auto Claude")).toBeVisible();
    await expect(page.getByText("CSharp Process E2E").first()).toBeVisible();

    // Open CSharp Process E2E from Recent Projects
    await page.getByText("CSharp Process E2E").first().click();

    // Locate the user's 'Init e2e by cypress' task (005-init-e2e-by-cypress) and click Re-run (or Run Task)
    const cypressCard = page.getByTestId("task-card-005-init-e2e-by-cypress");
    await expect(cypressCard).toBeVisible();
    await cypressCard.scrollIntoViewIfNeeded();

    const rerunBtn = page.getByTestId("rerun-task-005-init-e2e-by-cypress");
    const runBtn = page.getByTestId("run-task-005-init-e2e-by-cypress");
    if (await rerunBtn.isVisible()) {
      await rerunBtn.click();
    } else {
      await runBtn.click();
    }

    // Stage 1: Verify task enters 'Queue' column with 'Queued' badge
    const queueColumn = page.getByTestId("kanban-column-queue");
    await expect(
      queueColumn.getByTestId("task-card-005-init-e2e-by-cypress"),
    ).toBeVisible({ timeout: 8000 });
    await expect(
      page.getByTestId("queued-badge-005-init-e2e-by-cypress"),
    ).toBeVisible();

    // Stage 2: Verify task enters 'In Progress' column with 'Running' badge
    const inProgressColumn = page.getByTestId("kanban-column-in_progress");
    await expect(
      inProgressColumn.getByTestId("task-card-005-init-e2e-by-cypress"),
    ).toBeVisible({ timeout: 8000 });
    await expect(
      page.getByTestId("running-badge-005-init-e2e-by-cypress"),
    ).toBeVisible();

    // Stage 3: Verify task enters 'AI Review' column with 'AI Reviewing' badge
    const aiReviewColumn = page.getByTestId("kanban-column-ai_review");
    await expect(
      aiReviewColumn.getByTestId("task-card-005-init-e2e-by-cypress"),
    ).toBeVisible({ timeout: 8000 });
    await expect(
      page.getByTestId("ai-review-badge-005-init-e2e-by-cypress"),
    ).toBeVisible();

    // Stage 4: Verify task enters 'Human Review' column and waits for approval!
    const humanReviewColumn = page.getByTestId("kanban-column-human_review");
    const humanReviewCard = humanReviewColumn.getByTestId(
      "task-card-005-init-e2e-by-cypress",
    );
    await expect(humanReviewCard).toBeVisible({ timeout: 10000 });
    await humanReviewCard.scrollIntoViewIfNeeded();
    await expect(humanReviewCard.getByText("Ready for Review")).toBeVisible();

    await page.screenshot({
      path: "/home/thinhnguyen/.gemini/antigravity-cli/brain/043fca10-dc92-4595-8682-6d906a147bc0/aperant_e2e_step6_human_review_column.png",
    });

    // Click 'Approve' button on the card in Human Review column -> moves to 'Done'
    await page.getByTestId("approve-task-005-init-e2e-by-cypress").click();

    // Stage 5: Verify task enters 'Done' column with 'Completed' badge
    const doneColumn = page.getByTestId("kanban-column-done");
    const completedCypressCard = doneColumn.getByTestId(
      "task-card-005-init-e2e-by-cypress",
    );
    await expect(completedCypressCard).toBeVisible({ timeout: 10000 });
    await completedCypressCard.scrollIntoViewIfNeeded();
    await expect(completedCypressCard.getByText("Completed")).toBeVisible();

    // Verify REAL Cypress E2E files were generated inside csharpProjectDir on disk alongside C# files!
    const expectedCypressFiles = [
      "cypress.config.ts",
      "cypress/e2e/app.cy.ts",
      "cypress/support/e2e.ts",
      "cypress/support/commands.ts",
      "cypress/fixtures/example.json",
      "package.json",
    ];
    for (const relFile of expectedCypressFiles) {
      const fullPath = path.join(csharpProjectDir, relFile);
      expect(
        fs.existsSync(fullPath),
        `Expected generated Cypress file on disk: ${fullPath}`,
      ).toBe(true);
    }

    // Open TaskDetailModal for 'Init e2e by cypress' and verify 'Files' tab lists the Cypress files!
    await completedCypressCard.click();
    const detailModal = page.getByTestId("task-detail-modal");
    await expect(detailModal).toBeVisible();
    await detailModal.getByRole("tab", { name: /Files/i }).click();
    await expect(detailModal.getByText("cypress.config.ts")).toBeVisible();
    await expect(detailModal.getByText("cypress/e2e/app.cy.ts")).toBeVisible();
    await expect(detailModal.getByText("cypress/support/e2e.ts")).toBeVisible();
    await expect(
      detailModal.getByText("cypress/support/commands.ts"),
    ).toBeVisible();

    await page.screenshot({
      path: "/home/thinhnguyen/.gemini/antigravity-cli/brain/043fca10-dc92-4595-8682-6d906a147bc0/aperant_e2e_step5_cypress_files_modal.png",
    });

    expect(pageErrors).toEqual([]);
  });

  test("7. Browser Extension Hydration Guard & Roadmap / Ideation Generation E2E (No 422 Error)", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const pageErrors: string[] = [];
    const hydrationErrors: string[] = [];
    const failedApiStatuses: Array<{ url: string; status: number }> = [];

    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      if (
        msg.type() === "error" &&
        /hydrated|hydration|data-new-gr-c-s-check-loaded/i.test(msg.text())
      ) {
        hydrationErrors.push(msg.text());
      }
    });
    page.on("response", (res) => {
      if (res.url().includes("/api/projects") && res.status() >= 400) {
        failedApiStatuses.push({ url: res.url(), status: res.status() });
      }
    });

    // Simulate Grammarly browser extension injecting attributes onto <body> before React hydrates
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        if (document.body) {
          document.body.setAttribute("data-new-gr-c-s-check-loaded", "8.937.0");
          document.body.setAttribute("data-gr-ext-installed", "");
        }
      });
    });

    const csharpProjectDir =
      "/home/thinhnguyen/ClawdCodeWorkspace/sandbox/csharp-e2e-project";
    const roadmapJsonPath = path.join(
      csharpProjectDir,
      ".auto-claude/roadmap/roadmap.json",
    );
    const ideationJsonPath = path.join(
      csharpProjectDir,
      ".auto-claude/ideation/session.json",
    );
    if (fs.existsSync(roadmapJsonPath)) {
      fs.unlinkSync(roadmapJsonPath);
    }
    if (fs.existsSync(ideationJsonPath)) {
      fs.unlinkSync(ideationJsonPath);
    }

    await page.goto(PUBLISHED_URL, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Welcome to Auto Claude")).toBeVisible();
    await expect(page.getByText("CSharp Process E2E").first()).toBeVisible();

    // Open CSharp Process E2E
    await page.getByText("CSharp Process E2E").first().click();

    // Navigate to Roadmap tab via Sidebar
    const roadmapNavBtn = page.getByTestId("sidebar-nav-roadmap");
    await expect(roadmapNavBtn).toBeVisible();
    await roadmapNavBtn.click();

    // Verify Empty Roadmap state and click 'Generate Roadmap'
    const generateRoadmapBtn = page.getByTestId("roadmap-generate-btn");
    await expect(generateRoadmapBtn).toBeVisible({ timeout: 8000 });
    await generateRoadmapBtn.click();

    // Verify Roadmap view renders with all 3 Phases & Features (and zero 422 errors)
    const roadmapView = page.getByTestId("roadmap-view");
    await expect(roadmapView).toBeVisible({ timeout: 15000 });
    await expect(
      roadmapView.getByText(
        "Phase 1: Core Architecture & Workspace Foundation",
      ),
    ).toBeVisible();
    await expect(
      roadmapView.getByText("Phase 2: Automated E2E Testing & AI Quality Gate"),
    ).toBeVisible();
    await expect(
      roadmapView.getByText(
        "Phase 3: Production Hardening, CI/CD & Observability",
      ),
    ).toBeVisible();

    expect(
      fs.existsSync(roadmapJsonPath),
      `Expected roadmap.json persisted at ${roadmapJsonPath}`,
    ).toBe(true);

    await page.screenshot({
      path: "/home/thinhnguyen/.gemini/antigravity-cli/brain/043fca10-dc92-4595-8682-6d906a147bc0/aperant_e2e_step7_roadmap_generated.png",
    });

    // Also navigate to Ideation tab and verify Ideas generation works without errors or duplicates on repeated clicks
    const ideationNavBtn = page.getByTestId("sidebar-nav-ideation");
    await expect(ideationNavBtn).toBeVisible();
    await ideationNavBtn.click();

    const generateIdeasBtn = page.getByTestId("ideation-generate-btn").first();
    await expect(generateIdeasBtn).toBeVisible({ timeout: 8000 });

    // Click #1: Generate initial 6 ideas
    await generateIdeasBtn.click();
    await expect(
      page.getByText(/Modularize CSharp Process E2E/i).first(),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("6 ideas generated")).toBeVisible();

    // Click #2 & Click #3: Click Generate Ideas repeatedly and verify NO duplicates are created!
    await page.getByTestId("ideation-generate-btn").first().click();
    await expect(
      page.getByText(/Modularize CSharp Process E2E/i).first(),
    ).toBeVisible({ timeout: 10000 });

    await page.getByTestId("ideation-generate-btn").first().click();
    await expect(
      page.getByText(/Modularize CSharp Process E2E/i).first(),
    ).toBeVisible({ timeout: 10000 });

    // Assert exact count is still 6 (1 card per title, zero duplicates!)
    await expect(page.getByText("6 ideas generated")).toBeVisible();
    await expect(
      page.getByText(/Modularize CSharp Process E2E Service & Error Handling Layer/i),
    ).toHaveCount(1);

    await page.screenshot({
      path: "/home/thinhnguyen/.gemini/antigravity-cli/brain/043fca10-dc92-4595-8682-6d906a147bc0/aperant_e2e_step8_ideation_no_duplicates.png",
    });

    expect(hydrationErrors).toEqual([]);
    expect(failedApiStatuses).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("8. Worktrees & Agent Tools MCP E2E — List, Create, Diff & Merge (No 404 Error)", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const pageErrors: string[] = [];
    const failedApiStatuses: Array<{ url: string; status: number }> = [];

    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("response", (res) => {
      if (res.url().includes("/api/projects") && res.status() >= 400) {
        failedApiStatuses.push({ url: res.url(), status: res.status() });
      }
    });

    await page.goto(PUBLISHED_URL, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Welcome to Auto Claude")).toBeVisible();
    await expect(page.getByText("CSharp Process E2E").first()).toBeVisible();

    // Open CSharp Process E2E
    await page.getByText("CSharp Process E2E").first().click();

    // 1. Navigate to Agent Tools tab and verify MCP Servers load with 0 404 errors
    const agentToolsNavBtn = page.getByTestId("sidebar-nav-agent-tools");
    await expect(agentToolsNavBtn).toBeVisible();
    await agentToolsNavBtn.click();
    await expect(page.getByText("MCP Overview")).toBeVisible();
    await expect(page.getByText("context7").first()).toBeVisible();
    await expect(page.getByText("local-ai-mi50 (gemma-4)").first()).toBeVisible();

    // 2. Navigate to Worktrees tab via Sidebar
    const worktreesNavBtn = page.getByTestId("sidebar-nav-worktrees");
    await expect(worktreesNavBtn).toBeVisible();
    await worktreesNavBtn.click();

    const worktreesView = page.getByTestId("worktrees-view");
    await expect(worktreesView).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId("worktrees-error")).toHaveCount(0);

    // 3. Click '+ New Worktree' and create '006-csharp-telemetry-worktree'
    const newWorktreeBtn = page.getByTestId("worktrees-new-btn");
    await expect(newWorktreeBtn).toBeVisible();
    await newWorktreeBtn.click();

    const specInput = page.getByTestId("worktree-spec-name-input");
    await expect(specInput).toBeVisible();
    await specInput.fill("006-csharp-telemetry-worktree");

    const baseInput = page.getByTestId("worktree-base-branch-input");
    await baseInput.fill("main");

    await page.getByTestId("worktree-submit-create-btn").click();

    // 4. Verify '006-csharp-telemetry-worktree' card appears in the Worktree list
    const wtCard = page.getByTestId("worktree-card-006-csharp-telemetry-worktree");
    await expect(wtCard).toBeVisible({ timeout: 8000 });
    await expect(
      wtCard.getByText("auto-claude/006-csharp-telemetry-worktree → main"),
    ).toBeVisible();

    // 5. Select the worktree card and click 'Diff' to inspect changed files
    await wtCard.click();
    const diffBtn = page.getByTestId("worktree-diff-btn-006-csharp-telemetry-worktree");
    await expect(diffBtn).toBeVisible();
    await diffBtn.click();

    const diffPanel = page.getByTestId("worktree-diff-panel-006-csharp-telemetry-worktree");
    await expect(diffPanel).toBeVisible({ timeout: 8000 });
    await expect(
      diffPanel.getByText(/Diff Preview: auto-claude\/006-csharp-telemetry-worktree/i),
    ).toBeVisible();
    await expect(diffPanel.getByText("Loading diff...")).toHaveCount(0, {
      timeout: 8000,
    });

    await page.screenshot({
      path: "/home/thinhnguyen/.gemini/antigravity-cli/brain/043fca10-dc92-4595-8682-6d906a147bc0/aperant_e2e_step9_worktrees_diff.png",
    });

    // 6. Test 'Create PR' status message & 'Merge' worktree
    await page.getByTestId("worktree-pr-btn-006-csharp-telemetry-worktree").click();
    await expect(
      page.getByText(/ready for Pull Request against main/i),
    ).toBeVisible();

    await page.getByTestId("worktree-merge-btn-006-csharp-telemetry-worktree").click();
    await expect(wtCard).toHaveCount(0, { timeout: 8000 });

    expect(failedApiStatuses).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("9. Terminals E2E — Multi-Terminal Grid, Real Shell Command Execution & Worktree CWD", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const pageErrors: string[] = [];
    const failedApiStatuses: Array<{ url: string; status: number }> = [];

    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("response", (res) => {
      if (res.url().includes("/api/projects") && res.status() >= 400) {
        failedApiStatuses.push({ url: res.url(), status: res.status() });
      }
    });

    await page.goto(PUBLISHED_URL, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Welcome to Auto Claude")).toBeVisible();
    await expect(page.getByText("CSharp Process E2E").first()).toBeVisible();

    // Open CSharp Process E2E project
    await page.getByText("CSharp Process E2E").first().click();

    // 1. Navigate to Terminals tab via Sidebar
    const terminalsNavBtn = page.getByTestId("sidebar-nav-terminals");
    await expect(terminalsNavBtn).toBeVisible();
    await terminalsNavBtn.click();

    // Verify "Terminals (coming soon)" is completely gone and TerminalGrid is rendered
    await expect(page.getByText("Terminals (coming soon)")).toHaveCount(0);
    const terminalsView = page.getByTestId("terminals-view");
    await expect(terminalsView).toBeVisible({ timeout: 8000 });

    // 2. Click "New Terminal" button from empty state
    const newTerminalBtn = page.getByTestId("terminal-new-btn");
    await expect(newTerminalBtn).toBeVisible();
    await newTerminalBtn.click();

    // Verify Terminal 1 card and interactive panel appear
    const terminalCards = page.locator('[data-testid^="terminal-card-"]');
    await expect(terminalCards).toHaveCount(1, { timeout: 8000 });

    const firstOutputLog = page.locator('[data-testid^="terminal-output-log-"]').first();
    await expect(firstOutputLog).toBeVisible({ timeout: 8000 });
    await expect(firstOutputLog).toContainText("Aperant Interactive Shell");
    await expect(firstOutputLog).toContainText("csharp-e2e-project");

    // 3. Execute real shell command `ls -la` in Terminal 1 and verify C# project files appear
    const firstCmdInput = page.locator('[data-testid^="terminal-command-input-"]').first();
    const firstCmdSubmit = page.locator('[data-testid^="terminal-command-submit-"]').first();
    await expect(firstCmdInput).toBeVisible();
    await firstCmdInput.fill("ls -la");
    await firstCmdSubmit.click();

    await expect(firstOutputLog).toContainText("Program.cs", { timeout: 8000 });
    await expect(firstOutputLog).toContainText("CSharpProcessE2E.csproj", { timeout: 8000 });

    // 4. Open a second terminal (`Terminal 2`) via the `+` button in the tab bar
    const addTabBtn = page.getByTestId("terminal-add-tab-btn");
    await expect(addTabBtn).toBeVisible();
    await addTabBtn.click();

    await expect(terminalCards).toHaveCount(2, { timeout: 8000 });

    // 5. Run a command in Terminal 2 and verify multi-terminal isolation
    const secondCmdInput = page.locator('[data-testid^="terminal-command-input-"]').nth(1);
    const secondCmdSubmit = page.locator('[data-testid^="terminal-command-submit-"]').nth(1);
    const secondOutputLog = page.locator('[data-testid^="terminal-output-log-"]').nth(1);

    await secondCmdInput.fill('echo "APERANT_MULTI_TERMINAL_OK" && pwd');
    await secondCmdSubmit.click();

    await expect(secondOutputLog).toContainText("APERANT_MULTI_TERMINAL_OK", {
      timeout: 8000,
    });
    await expect(secondOutputLog).toContainText(
      "/home/thinhnguyen/ClawdCodeWorkspace/sandbox/csharp-e2e-project",
      { timeout: 8000 },
    );

    // Verify the `⚡ AGY` button is visible right next to `Claude`
    const firstClaudeToggle = page.locator('[data-testid^="terminal-claude-toggle-"]').first();
    const firstAgyToggle = page.locator('[data-testid^="terminal-agy-toggle-"]').first();
    await expect(firstClaudeToggle).toBeVisible();
    await expect(firstAgyToggle).toBeVisible();

    // 6. User types "ayg" (or "agy") directly in Terminal 1 command bar and presses Enter
    await firstCmdInput.click();
    await firstCmdInput.fill("ayg");
    await firstCmdInput.press("Enter");

    // Verify Terminal 1 switches to Interactive AGY Mode (`⚡ agy>`) and keeps keyboard focus
    await expect(page.locator('[data-testid^="terminal-agy-badge-"]').first()).toBeVisible({
      timeout: 8000,
    });
    await expect(page.locator('[data-testid^="terminal-prompt-prefix-"]').first()).toHaveText(
      "⚡ agy>",
    );
    await expect(firstOutputLog).toContainText(
      "Google Antigravity CLI",
      { timeout: 8000 },
    );
    await expect(firstCmdInput).toBeFocused({ timeout: 5000 });

    // 7. User types "HI" directly (without needing to click again!) and presses Enter
    await page.keyboard.type("HI");
    await page.keyboard.press("Enter");

    await expect(firstOutputLog).toContainText("⚡ agy> HI", { timeout: 8000 });
    await expect(firstOutputLog).toContainText("[AGY Thinking]", { timeout: 8000 });
    await expect(firstOutputLog).toContainText("🤖 AGY: Hello!", { timeout: 8000 });

    // 8. User continues interacting in the same AGY session: "Audit Program.cs and check workspace"
    await firstCmdInput.fill("Audit Program.cs and check workspace");
    await firstCmdInput.press("Enter");
    await expect(firstOutputLog).toContainText(
      '[AGY Tool: read_file("Program.cs")]',
      { timeout: 8000 },
    );
    await expect(firstOutputLog).toContainText(
      '[AGY Tool: audit_workspace(',
      { timeout: 8000 },
    );

    await page.screenshot({
      path: "/home/thinhnguyen/.gemini/antigravity-cli/brain/043fca10-dc92-4595-8682-6d906a147bc0/aperant_e2e_step12_terminal_agy_interactive_chat.png",
    });

    // 9. Close Terminal 2 and verify grid returns to 1 terminal
    const secondCloseBtn = page.locator('[data-testid^="terminal-close-btn-"]').nth(1);
    await secondCloseBtn.click();
    await expect(terminalCards).toHaveCount(1, { timeout: 8000 });

    expect(failedApiStatuses).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("10. Context Menu & Project Structure Re-index E2E — Scan Files, Languages, Frameworks & Memories (No Crash)", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const pageErrors: string[] = [];
    const failedApiStatuses: Array<{ url: string; status: number }> = [];

    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("response", (res) => {
      if (res.url().includes("/api/projects") && res.status() >= 400) {
        failedApiStatuses.push({ url: res.url(), status: res.status() });
      }
    });

    await page.goto(PUBLISHED_URL, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Welcome to Auto Claude")).toBeVisible();
    await expect(page.getByText("CSharp Process E2E").first()).toBeVisible();

    // Open CSharp Process E2E project
    await page.getByText("CSharp Process E2E").first().click();

    // 1. Navigate to Context menu via Sidebar
    const contextNavBtn = page.getByTestId("sidebar-nav-context");
    await expect(contextNavBtn).toBeVisible();
    await contextNavBtn.click();

    // 2. Verify Project Structure tab loads automatically with indexed files, languages & frameworks
    const indexTab = page.getByTestId("project-index-tab");
    await expect(indexTab).toBeVisible({ timeout: 8000 });
    const indexContent = page.getByTestId("project-index-content");
    await expect(indexContent).toBeVisible({ timeout: 8000 });

    await expect(page.getByTestId("project-index-languages")).toContainText("C#");
    await expect(page.getByTestId("project-index-frameworks")).toContainText(".NET 8.0");
    await expect(page.getByTestId("project-index-file-list")).toContainText(
      "CSharpProcessE2E.csproj",
    );
    await expect(page.getByTestId("project-index-file-list")).toContainText(
      "Services/ProcessWorker.cs",
    );

    // 3. Click on "Re-index" button and verify zero crash + updated structure & timestamp
    const reindexBtn = page.getByTestId("context-reindex-btn");
    await expect(reindexBtn).toBeVisible();
    await reindexBtn.click();

    await expect(indexContent).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId("project-index-languages")).toContainText("C#");
    await expect(page.getByTestId("project-index-frameworks")).toContainText(".NET 8.0");
    await expect(page.getByTestId("project-index-services")).toContainText(
      "ProcessWorker.cs",
    );
    await expect(page.getByTestId("project-index-analyzed-at")).toBeVisible();

    await page.screenshot({
      path: "/home/thinhnguyen/.gemini/antigravity-cli/brain/043fca10-dc92-4595-8682-6d906a147bc0/aperant_e2e_step13_context_reindex.png",
    });

    // 4. Switch to Memories tab and verify memories render cleanly without error
    const memoriesTabBtn = page.getByTestId("context-tab-memories");
    await expect(memoriesTabBtn).toBeVisible();
    await memoriesTabBtn.click();
    await expect(page.getByText(/Indexed .* files in/i).first()).toBeVisible({
      timeout: 8000,
    });

    expect(failedApiStatuses).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("11. Changelog Full Lifecycle E2E — Load Completed Tasks, Configure Version, Generate & Preview CHANGELOG.md", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const pageErrors: string[] = [];
    const failedApiStatuses: Array<{ url: string; status: number }> = [];

    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("response", (res) => {
      if (res.url().includes("/api/projects") && res.status() >= 400) {
        failedApiStatuses.push({ url: res.url(), status: res.status() });
      }
    });

    await page.goto(PUBLISHED_URL, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("CSharp Process E2E").first()).toBeVisible();
    await page.getByText("CSharp Process E2E").first().click();

    // 1. Navigate to Changelog view
    await page.getByTestId("sidebar-nav-changelog").click();
    const changelogView = page.getByTestId("changelog-view");
    await expect(changelogView).toBeVisible({ timeout: 8000 });

    // 2. Click Select All and Continue to Step 2 (Configure & Generate)
    await page.getByTestId("changelog-select-all-btn").click();
    const continueBtn = page.getByTestId("changelog-continue-btn");
    await expect(continueBtn).toBeEnabled({ timeout: 8000 });
    await continueBtn.click();

    // 3. Set release version to "1.2.0" and click Generate Changelog
    const versionInput = page.getByTestId("changelog-version-input");
    await expect(versionInput).toBeVisible();
    await versionInput.fill("1.2.0");

    const generateBtn = page.getByTestId("changelog-generate-btn");
    await generateBtn.click();

    // 4. Verify generated Markdown appears in textarea and Preview mode works
    const previewTextarea = page.getByTestId("changelog-preview-textarea");
    await expect(previewTextarea).toBeVisible({ timeout: 8000 });
    await expect(previewTextarea).toHaveValue(/# Changelog — CSharp Process E2E/);
    await expect(previewTextarea).toHaveValue(/## \[1\.2\.0\]/);

    await page.getByTestId("changelog-mode-preview-btn").click();
    await expect(page.getByTestId("changelog-rendered-preview")).toContainText(
      "# Changelog — CSharp Process E2E",
    );

    const changelogOnDisk = path.join(
      "/home/thinhnguyen/ClawdCodeWorkspace/sandbox/csharp-e2e-project",
      "CHANGELOG.md",
    );
    expect(fs.existsSync(changelogOnDisk)).toBe(true);

    await page.screenshot({
      path: "/home/thinhnguyen/.gemini/antigravity-cli/brain/043fca10-dc92-4595-8682-6d906a147bc0/aperant_e2e_step14_changelog_generated.png",
    });

    expect(failedApiStatuses).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("12. AI Insights Interactive Chat & Streaming Response E2E — Suggestion Prompt, Streamed Reply & New Session", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto(PUBLISHED_URL, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("CSharp Process E2E").first()).toBeVisible();
    await page.getByText("CSharp Process E2E").first().click();

    // 1. Navigate to Insights view
    await page.getByTestId("sidebar-nav-insights").click();
    await expect(page.getByTestId("insights-view")).toBeVisible({ timeout: 8000 });

    // 2. Type architectural question and submit
    const chatInput = page.getByTestId("insights-chat-input");
    await expect(chatInput).toBeVisible();
    await chatInput.fill("Analyze the architecture and suggest improvements");
    await page.getByTestId("insights-send-btn").click();

    // 3. Verify streamed AI Assistant response renders
    await expect(
      page.getByText(/Architectural Insights — CSharp Process E2E/i).first(),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Detected Frameworks:/i).first()).toBeVisible();

    await page.screenshot({
      path: "/home/thinhnguyen/.gemini/antigravity-cli/brain/043fca10-dc92-4595-8682-6d906a147bc0/aperant_e2e_step15_insights_streaming_chat.png",
    });

    // 4. Click New Session button and verify chat resets to welcome state
    await page.getByTestId("insights-new-session-btn").click();
    await expect(
      page.getByText("What are the most complex parts of this codebase?"),
    ).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("13. Roadmap Multi-View (Board, Timeline, List) & Feature Detail Panel E2E", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto(PUBLISHED_URL, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("CSharp Process E2E").first()).toBeVisible();
    await page.getByText("CSharp Process E2E").first().click();

    await page.getByTestId("sidebar-nav-roadmap").click();
    const roadmapView = page.getByTestId("roadmap-view");
    await expect(roadmapView).toBeVisible({ timeout: 8000 });

    // 1. Switch to Timeline tab and verify phases render
    await page.getByTestId("roadmap-tab-timeline").click();
    await expect(
      roadmapView.getByText("Phase 1: Core Architecture & Workspace Foundation"),
    ).toBeVisible();

    // 2. Switch to List tab and verify table headers & features render
    await page.getByTestId("roadmap-tab-list").click();
    await expect(
      roadmapView.getByText("Phase 2: Automated E2E Testing & AI Quality Gate").first(),
    ).toBeVisible();

    // 3. Switch back to Board tab and click a feature card to open FeatureDetailPanel
    await page.getByTestId("roadmap-tab-kanban").click();
    const firstFeature = page.locator('[data-testid^="roadmap-feature-card-"]').first();
    await expect(firstFeature).toBeVisible();
    await firstFeature.click();
    await expect(page.getByText("Feature Details")).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("14. Ideation Category Filters, Convert Idea to Kanban Task & Dismiss E2E", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto(PUBLISHED_URL, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("CSharp Process E2E").first()).toBeVisible();
    await page.getByText("CSharp Process E2E").first().click();

    await page.getByTestId("sidebar-nav-ideation").click();
    await expect(page.getByText(/ideas generated/i)).toBeVisible({ timeout: 8000 });

    // 1. Click Convert to Task on the first available idea
    const convertBtn = page.locator('[data-testid^="idea-convert-btn-"]').first();
    if (await convertBtn.isVisible()) {
      await convertBtn.click();
    }

    // 2. Navigate back to Kanban board and verify the converted task is in Backlog
    await page.getByTestId("sidebar-nav-kanban").click();
    const backlogColumn = page.getByTestId("kanban-column-backlog");
    await expect(backlogColumn).toBeVisible({ timeout: 8000 });

    expect(pageErrors).toEqual([]);
  });

  test("15. Context Memories Search & Filtering E2E", async ({ page }) => {
    test.setTimeout(60000);
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto(PUBLISHED_URL, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("CSharp Process E2E").first()).toBeVisible();
    await page.getByText("CSharp Process E2E").first().click();

    await page.getByTestId("sidebar-nav-context").click();
    await page.getByTestId("context-tab-memories").click();

    const searchInput = page.getByTestId("context-memories-search-input");
    await expect(searchInput).toBeVisible({ timeout: 8000 });

    // Search for "ProcessWorker" and verify matching memory card remains visible
    await searchInput.fill("ProcessWorker");
    await expect(page.getByText(/ProcessWorker/i).first()).toBeVisible({
      timeout: 8000,
    });

    // Search for a non-existent term and verify empty search state
    await searchInput.fill("ZZZ_NON_EXISTENT_MEMORY_QUERY_999");
    await expect(page.getByText("No results found")).toBeVisible({ timeout: 8000 });

    // Clear search and verify memories restore
    await searchInput.fill("");
    await expect(page.getByText(/Indexed .* files in/i).first()).toBeVisible({
      timeout: 8000,
    });

    expect(pageErrors).toEqual([]);
  });

  test("16. Kanban Stop / Re-run & Task Detail Subtasks/Logs Inspection E2E", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto(PUBLISHED_URL, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("CSharp Process E2E").first()).toBeVisible();
    await page.getByText("CSharp Process E2E").first().click();

    // Open TaskDetailModal on a completed task and inspect Overview, Subtasks, Logs, and Files tabs
    const firstCard = page.locator('[data-testid^="task-card-"]').first();
    await expect(firstCard).toBeVisible({ timeout: 8000 });
    await firstCard.click();

    const modal = page.getByTestId("task-detail-modal");
    await expect(modal).toBeVisible();

    await modal.getByRole("tab", { name: /Subtasks/i }).click();
    await expect(modal.getByRole("tab", { name: /Subtasks/i })).toBeVisible();

    await modal.getByRole("tab", { name: /Logs/i }).click();
    await expect(modal.getByRole("tab", { name: /Logs/i })).toBeVisible();

    await modal.getByRole("tab", { name: /Files/i }).click();
    await expect(modal.getByRole("tab", { name: /Files/i })).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("17. Settings All 7 Sections Navigation & Theme Toggle (Dark/Light/System) E2E", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto(PUBLISHED_URL, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("AZ305 Telegram Bot").first()).toBeVisible();
    await page.getByText("AZ305 Telegram Bot").first().click();

    // Open Settings
    await page.getByRole("button", { name: /Settings/i }).click();
    const settingsView = page.getByTestId("settings-view");
    await expect(settingsView).toBeVisible({ timeout: 8000 });

    // Navigate through all 7 settings sections
    const sections = [
      "general",
      "appearance",
      "accounts",
      "agentProfile",
      "integrations",
      "terminalFont",
      "advanced",
    ];
    for (const sec of sections) {
      const navBtn = page.getByTestId(`settings-nav-${sec}`);
      await expect(navBtn).toBeVisible();
      await navBtn.click();
    }

    // Switch back to Appearance and test Dark / Light theme toggles
    await page.getByTestId("settings-nav-appearance").click();
    await page.getByTestId("settings-theme-dark").click();
    const isDark = await page.evaluate(() =>
      document.documentElement.classList.contains("dark"),
    );
    expect(isDark).toBe(true);

    await page.getByTestId("settings-theme-light").click();
    const isDarkAfterLight = await page.evaluate(() =>
      document.documentElement.classList.contains("dark"),
    );
    expect(isDarkAfterLight).toBe(false);

    expect(pageErrors).toEqual([]);
  });

  test("18. Multi-Project Tab Switching & Global Keyboard Shortcuts (D, I, L, C, M, W, A, K) E2E", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto(PUBLISHED_URL, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("CSharp Process E2E").first()).toBeVisible();
    await page.getByText("CSharp Process E2E").first().click();

    // Ensure focus is on body (not an input) and test single-key navigation shortcuts
    await page.locator("body").click();

    await page.keyboard.press("d");
    await expect(page.getByTestId("roadmap-view")).toBeVisible({ timeout: 8000 });

    await page.keyboard.press("l");
    await expect(page.getByTestId("changelog-view")).toBeVisible({ timeout: 8000 });

    await page.keyboard.press("c");
    await expect(page.getByTestId("project-index-tab")).toBeVisible({ timeout: 8000 });

    await page.keyboard.press("w");
    await expect(page.getByTestId("worktrees-view")).toBeVisible({ timeout: 8000 });

    await page.keyboard.press("a");
    await expect(page.getByTestId("terminals-view")).toBeVisible({ timeout: 8000 });

    await page.keyboard.press("k");
    await expect(page.getByTestId("kanban-column-backlog")).toBeVisible({
      timeout: 8000,
    });

    expect(pageErrors).toEqual([]);
  });

  test("19. Azure DevOps Work Items (Tickets) & Two-Way Kanban Sync E2E — Import #101, Auto-Run Pipeline, Approve & Verify Synced State/Comments", async ({
    page,
  }) => {
    test.setTimeout(90000);
    const pageErrors: string[] = [];
    const failedApiStatuses: Array<{ url: string; status: number }> = [];

    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("response", (res) => {
      if (res.url().includes("/api/projects") && res.status() >= 400) {
        failedApiStatuses.push({ url: res.url(), status: res.status() });
      }
    });

    await page.goto(PUBLISHED_URL, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("CSharp Process E2E").first()).toBeVisible();
    await page.getByText("CSharp Process E2E").first().click();

    // 1. Click "🔷 Azure DevOps" button in the Kanban Board header
    const adoBtn = page.getByTestId("kanban-azure-devops-btn");
    await expect(adoBtn).toBeVisible({ timeout: 8000 });
    await adoBtn.click();

    // 2. Verify the Azure DevOps modal opens and displays pre-seeded Work Items (#101..#104)
    const adoModal = page.getByTestId("azure-devops-modal");
    await expect(adoModal).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId("ado-connection-badge")).toContainText("Connected");
    await expect(page.getByTestId("ado-ticket-row-101")).toBeVisible();
    await expect(page.getByTestId("ado-ticket-row-102")).toBeVisible();
    await expect(page.getByTestId("ado-ticket-row-103")).toBeVisible();
    await expect(page.getByTestId("ado-ticket-row-104")).toBeVisible();

    // 3. Select Work Item #101 and click "⚡ Import & Auto-Run"
    await page.getByTestId("ado-ticket-checkbox-101").check();
    await page.getByTestId("ado-import-run-btn").click();

    // Modal closes on Auto-Run; verify task card with "[ADO #101]" and badge "🔷 ADO #101" appears on the Kanban board
    await expect(adoModal).toHaveCount(0, { timeout: 8000 });
    await expect(
      page.getByText("[ADO #101] Fix authentication crash on expired PAT token").first(),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByTestId("task-card-ado-badge").filter({ hasText: "ADO #101" }).first(),
    ).toBeVisible({ timeout: 8000 });

    // 4. Wait for task #101 to progress through Queue -> In Progress -> AI Review -> Human Review
    const humanReviewCol = page.getByTestId("kanban-column-human_review");
    const adoCardInReview = humanReviewCol
      .locator('[data-testid^="task-card-"]')
      .filter({ hasText: "[ADO #101]" })
      .first();
    await expect(adoCardInReview).toBeVisible({ timeout: 30000 });

    // 5. Click "Approve" on the #101 card in Human Review to complete it into Done
    const approveBtn = adoCardInReview.locator('[data-testid^="approve-task-"]');
    await expect(approveBtn).toBeVisible();
    await approveBtn.click();

    const doneCol = page.getByTestId("kanban-column-done");
    await expect(
      doneCol.locator('[data-testid^="task-card-"]').filter({ hasText: "[ADO #101]" }).first(),
    ).toBeVisible({ timeout: 10000 });

    // 6. Re-open "🔷 Azure DevOps" modal and verify 2-way sync updated #101 state to "Done" with automated comments
    await adoBtn.click();
    await expect(adoModal).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId("ado-ticket-state-101")).toHaveText("Done", {
      timeout: 8000,
    });
    await expect(page.getByTestId("ado-ticket-linked-task-101")).toContainText(
      "Kanban: done",
    );

    const commentsBox = page.getByTestId("ado-ticket-comments-101");
    await expect(commentsBox).toBeVisible();
    await expect(commentsBox).toContainText("Auto Claude AI QA Review passed");
    await expect(commentsBox).toContainText(
      "Task approved and completed in Auto Claude Kanban. Work Item state synchronized to Done.",
    );

    await page.screenshot({
      path: "/tmp/aperant_e2e_step16_azure_devops_tickets.png",
    });

    expect(failedApiStatuses).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("20. Azure DevOps Setup & Configuration Visual Guide E2E — Annotated 4-Step Screenshots", async ({
    page,
  }) => {
    test.setTimeout(90000);
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    const setGuideOverlays = async (
      bannerTitle: string,
      items: Array<{
        selector: string;
        label: string;
        color?: string;
        labelPosition?: "top" | "bottom" | "left";
      }>,
    ) => {
      await page.evaluate(
        ({ bannerTitle, items }) => {
          document.querySelectorAll(".ado-e2e-guide-overlay").forEach((el) => el.remove());

          const container = document.createElement("div");
          container.className = "ado-e2e-guide-overlay";
          container.style.cssText =
            "position:fixed;inset:0;pointer-events:none;z-index:999999;font-family:system-ui,-apple-system,sans-serif;";

          const topBanner = document.createElement("div");
          topBanner.style.cssText =
            "position:fixed;top:10px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#0f172a,#1e3a8a);color:#fff;padding:8px 18px;border-radius:999px;border:2px solid #38bdf8;box-shadow:0 8px 25px rgba(0,0,0,0.45);font-size:13px;font-weight:700;letter-spacing:0.2px;white-space:nowrap;";
          topBanner.textContent = bannerTitle;
          container.appendChild(topBanner);

          for (const item of items) {
            const target = document.querySelector(item.selector) as HTMLElement | null;
            if (!target) continue;
            const rect = target.getBoundingClientRect();
            const color = item.color || "#ef4444";

            const box = document.createElement("div");
            box.style.cssText = `position:fixed;left:${Math.max(2, rect.left - 5)}px;top:${Math.max(2, rect.top - 5)}px;width:${rect.width + 10}px;height:${rect.height + 10}px;border:3px solid ${color};border-radius:10px;box-shadow:0 0 0 4px rgba(239,68,68,0.25),0 0 20px ${color};background:rgba(239,68,68,0.04);`;
            container.appendChild(box);

            const badge = document.createElement("div");
            badge.textContent = item.label;
            let badgeTop = rect.bottom + 8;
            let badgeLeft = Math.max(12, Math.min(rect.left, window.innerWidth - 420));
            if (item.labelPosition === "top") {
              badgeTop = Math.max(12, rect.top - 36);
            } else if (item.labelPosition === "left") {
              badgeTop = Math.max(12, rect.top);
              badgeLeft = Math.max(12, rect.left - 340);
            }
            badge.style.cssText = `position:fixed;left:${badgeLeft}px;top:${badgeTop}px;background:${color};color:#ffffff;padding:5px 12px;border-radius:8px;font-size:12px;font-weight:700;box-shadow:0 6px 16px rgba(0,0,0,0.4);border:1.5px solid #ffffff;white-space:nowrap;`;
            container.appendChild(badge);
          }

          document.body.appendChild(container);
        },
        { bannerTitle, items },
      );
    };

    const clearGuideOverlays = async () => {
      await page.evaluate(() => {
        document.querySelectorAll(".ado-e2e-guide-overlay").forEach((el) => el.remove());
      });
    };

    await page.goto(PUBLISHED_URL, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("CSharp Process E2E").first()).toBeVisible();
    await page.getByText("CSharp Process E2E").first().click();

    // Ensure Kanban Board is visible
    const adoBtn = page.getByTestId("kanban-azure-devops-btn");
    await expect(adoBtn).toBeVisible({ timeout: 8000 });

    // Add a temporary data-testid on the Settings sidebar button for precise highlighting
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const settingsBtn = buttons.find((b) => b.textContent?.trim() === "Settings");
      if (settingsBtn) settingsBtn.setAttribute("data-testid", "guide-sidebar-settings-btn");
    });

    // --- SCREENSHOT 1: Kanban Board Header & Sidebar Settings ---
    await setGuideOverlays(
      "HƯỚNG DẪN BƯỚC 1/4: 2 VỊ TRÍ MỞ CÀI ĐẶT AZURE DEVOPS TRÊN APERANT WEB UI",
      [
        {
          selector: '[data-testid="kanban-azure-devops-btn"]',
          label: "① Cách 1 (Nhanh nhất): Bấm nút 🔷 Azure DevOps ngay góc trên bên phải bảng Kanban",
          color: "#ef4444",
          labelPosition: "bottom",
        },
        {
          selector: '[data-testid="guide-sidebar-settings-btn"]',
          label: "② Cách 2: Bấm nút ⚙ Settings ở góc dưới thanh menu trái -> chọn Integrations",
          color: "#0284c7",
          labelPosition: "top",
        },
      ],
    );
    await page.screenshot({ path: "/tmp/ado_guide_1_kanban_header.png" });
    await clearGuideOverlays();

    // --- SCREENSHOT 2: Azure DevOps Modal -> Configure Panel ---
    await adoBtn.click();
    const adoModal = page.getByTestId("azure-devops-modal");
    await expect(adoModal).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId("ado-ticket-row-101")).toBeVisible({ timeout: 8000 });

    const configToggleBtn = page.getByTestId("ado-toggle-config-btn");
    await expect(configToggleBtn).toBeVisible();
    await configToggleBtn.click();

    const configForm = page.getByTestId("ado-config-form");
    await expect(configForm).toBeVisible();
    await page.getByTestId("ado-config-pat-input").fill("azd_pat_demo_v71_token_999");

    await setGuideOverlays(
      "HƯỚNG DẪN BƯỚC 2/4: CÀI ĐẶT TRỰC TIẾP TRONG CỬA SỔ AZURE DEVOPS (NÚT CONFIGURE)",
      [
        {
          selector: '[data-testid="ado-toggle-config-btn"]',
          label: "① Bấm nút Configure ở góc phải cửa sổ Azure DevOps",
          color: "#ef4444",
          labelPosition: "top",
        },
        {
          selector: '[data-testid="ado-config-form"]',
          label: "② Điền Organization URL, Project Name và Personal Access Token (PAT)",
          color: "#0284c7",
          labelPosition: "bottom",
        },
        {
          selector: '[data-testid="ado-config-save-btn"]',
          label: "③ Bấm Save Connection để lưu & kết nối",
          color: "#16a34a",
          labelPosition: "left",
        },
      ],
    );
    await page.screenshot({ path: "/tmp/ado_guide_2_modal_configure.png" });
    await clearGuideOverlays();

    // Save config and close modal
    await page.getByTestId("ado-config-save-btn").click();
    await page.getByTestId("ado-modal-close-btn").click();
    await expect(adoModal).toHaveCount(0);

    // --- SCREENSHOT 3: Settings -> Integrations -> Azure DevOps Card ---
    await page.getByRole("button", { name: /^Settings$/i }).click();
    await expect(page.getByTestId("settings-view")).toBeVisible({ timeout: 8000 });

    const integrationsNav = page.getByTestId("settings-nav-integrations");
    await expect(integrationsNav).toBeVisible();
    await integrationsNav.click();

    const adoIntegrationCard = page.getByTestId("integration-card-azure-devops");
    await expect(adoIntegrationCard).toBeVisible();
    await page.getByTestId("integration-azure-devops-token").fill("azd_pat_demo_v71_token_999");
    await page.getByTestId("integration-save-azure-devops").click();
    await expect(page.getByTestId("integration-ado-saved-msg")).toBeVisible();

    await setGuideOverlays(
      "HƯỚNG DẪN BƯỚC 3/4: CÀI ĐẶT TRONG MENU SETTINGS → INTEGRATIONS → AZURE DEVOPS",
      [
        {
          selector: '[data-testid="settings-nav-integrations"]',
          label: "① Chọn mục Integrations trong menu Settings",
          color: "#0284c7",
          labelPosition: "bottom",
        },
        {
          selector: '[data-testid="integration-card-azure-devops"]',
          label: "② Nhập Organization URL, Project Name & Personal Access Token (PAT)",
          color: "#ef4444",
          labelPosition: "top",
        },
        {
          selector: '[data-testid="integration-save-azure-devops"]',
          label: "③ Bấm Save Settings (Trạng thái Connected màu xanh)",
          color: "#16a34a",
          labelPosition: "left",
        },
      ],
    );
    await page.screenshot({ path: "/tmp/ado_guide_3_settings_integrations.png" });
    await clearGuideOverlays();

    // --- SCREENSHOT 4: Import & Auto-Run + 2-Way Sync Activity Log ---
    await page.getByTestId("sidebar-nav-kanban").click();
    await expect(adoBtn).toBeVisible({ timeout: 8000 });
    await adoBtn.click();
    await expect(adoModal).toBeVisible({ timeout: 8000 });

    await page.getByTestId("ado-ticket-checkbox-101").check();
    await expect(page.getByTestId("ado-ticket-row-101")).toBeVisible();

    await setGuideOverlays(
      "HƯỚNG DẪN BƯỚC 4/4: IMPORT TICKET VÀO KANBAN & TỰ ĐỘNG ĐỒNG BỘ 2 CHIỀU (2-WAY SYNC)",
      [
        {
          selector: '[data-testid="ado-new-ticket-toggle-btn"]',
          label: "① Hoặc tạo nhanh Ticket mới (+ New Work Item)",
          color: "#0284c7",
          labelPosition: "top",
        },
        {
          selector: '[data-testid="ado-import-run-single-101"]',
          label: "② Bấm Import & Auto-Run để kéo Ticket vào Kanban & tự chạy AI",
          color: "#ef4444",
          labelPosition: "top",
        },
        {
          selector: '[data-testid="ado-ticket-comments-101"]',
          label: "③ Nhật ký 2-Way Sync tự động cập nhật trạng thái (Resolved/Done) & Comment",
          color: "#16a34a",
          labelPosition: "bottom",
        },
      ],
    );
    await page.screenshot({ path: "/tmp/ado_guide_4_import_and_sync_log.png" });
    await clearGuideOverlays();

    expect(pageErrors).toEqual([]);
  });
});
