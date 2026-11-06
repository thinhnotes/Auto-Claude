import { describe, it, expect, vi } from "vitest";
import React from "react";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { render, screen, fireEvent } from "@testing-library/react";
import { TooltipProvider } from "@auto-claude/ui";
import type { Task } from "@auto-claude/types";
import { TaskDetailModal } from "../TaskDetailModal";
import { TaskCard } from "../TaskCard";
import { TaskFiles } from "@/components/task-detail/TaskFiles";
import { FeatureDetailPanel } from "@/components/roadmap/FeatureDetailPanel";
import { WorktreeList } from "@/components/worktrees/WorktreeList";
import { WorktreesView } from "@/components/worktrees/WorktreesView";
import { apiClient } from "@/lib/data/api-client";
import { useTerminalStore } from "@/stores/terminal-store";
import {
  createOrUpdateProject,
  createTaskForProject,
  ensureTaskSourceTreeForProject,
  openTaskTerminalForProject,
  execTerminalCommandForProject,
  loadStore,
  saveStore,
} from "@/lib/server/task-engine";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
    i18n: { changeLanguage: () => new Promise(() => {}) },
  }),
}));

function makeReviewTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "001-review-task",
    specId: "001-review-task",
    projectId: "proj-1",
    title: "Implement Payment Gateway",
    description: "Build Stripe & PayPal handler",
    status: "human_review",
    reviewReason: "completed",
    subtasks: [
      {
        id: "st-1",
        title: "Analyze requirements",
        description: "Analyze requirements",
        status: "completed",
        files: [],
      },
      {
        id: "st-2",
        title: "Implement core solution",
        description: "Implement core solution",
        status: "completed",
        files: ["src/payment.ts"],
      },
    ],
    fileDiffs: [
      {
        path: "src/payment.ts",
        status: "modified",
        additions: 4,
        deletions: 1,
        oldContent: "export const pay = () => false;\n",
        newContent:
          "export const pay = () => true;\n// AI Review Fix\nexport const validated = true;\n",
        unifiedDiff:
          "--- a/src/payment.ts\n+++ b/src/payment.ts\n@@ -1,1 +1,3 @@\n-export const pay = () => false;\n+export const pay = () => true;\n+// AI Review Fix\n+export const validated = true;",
      },
    ],
    reviewComments: [
      {
        id: "rc-1",
        comment: "Ensure pay() returns true and add validation flag",
        filePath: "src/payment.ts",
        lineNumber: 1,
        createdAt: new Date().toISOString(),
        status: "addressed",
        aiResponse:
          "AI checked src/payment.ts and applied fixes for validation flag.",
        modifiedFiles: ["src/payment.ts"],
      },
    ],
    logs: ["[HUMAN_REVIEW] Ready for review"],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("Human Review Comment & Expandable Diff Modal UI", () => {
  it("toggles TaskDetailModal between Compact and Expanded size when clicking modal-expand-toggle-btn", () => {
    const task = makeReviewTask();
    render(
      <TooltipProvider delayDuration={0}>
        <TaskDetailModal task={task} onClose={vi.fn()} />
      </TooltipProvider>,
    );

    const container = screen.getByTestId("task-detail-modal-container");
    expect(container.getAttribute("data-expanded")).toBe("false");
    expect(container.className).toContain("max-w-3xl");

    const toggleBtn = screen.getByTestId("modal-expand-toggle-btn");
    expect(toggleBtn.textContent).toContain("Expand");
    fireEvent.click(toggleBtn);

    expect(container.getAttribute("data-expanded")).toBe("true");
    expect(container.className).toContain("w-[95vw]");
    expect(toggleBtn.textContent).toContain("Compact");

    fireEvent.click(toggleBtn);
    expect(container.getAttribute("data-expanded")).toBe("false");
    expect(toggleBtn.textContent).toContain("Expand");
  });

  it("renders Human Review comment box directly in TaskDetailModal Overview and calls onReject with feedback", () => {
    const task = makeReviewTask();
    const onReject = vi.fn();
    render(
      <TooltipProvider delayDuration={0}>
        <TaskDetailModal
          task={task}
          onClose={vi.fn()}
          onReject={onReject}
          onApprove={vi.fn()}
        />
      </TooltipProvider>,
    );

    // Previous AI fix history is visible
    expect(screen.getAllByTestId("review-comments-history").length).toBeGreaterThan(0);

    // Type new feedback in Overview's review textarea
    const textareas = screen.getAllByTestId("review-feedback-textarea");
    fireEvent.change(textareas[0], {
      target: { value: "Please add currency code parameter check" },
    });

    const rejectBtns = screen.getAllByTestId("submit-review-reject-btn");
    fireEvent.click(rejectBtns[0]);

    expect(onReject).toHaveBeenCalledWith(
      "001-review-task",
      "Please add currency code parameter check",
    );
  });

  it("renders TaskFiles Code Diff workbench with Unified/Split/Full modes and submits per-file AI fix comment", () => {
    const task = makeReviewTask();
    const onRequestChanges = vi.fn();

    render(
      <TooltipProvider delayDuration={0}>
        <TaskFiles task={task} onRequestChanges={onRequestChanges} />
      </TooltipProvider>,
    );

    expect(screen.getByTestId("selected-diff-file-path").textContent).toBe(
      "src/payment.ts",
    );
    expect(screen.getByTestId("ai-fixed-badge-src/payment.ts")).toBeDefined();

    // Switch to Split Diff mode
    fireEvent.click(screen.getByTestId("diff-mode-split"));
    expect(screen.getByTestId("diff-split-grid")).toBeDefined();

    // Switch to Full Code mode
    fireEvent.click(screen.getByTestId("diff-mode-full"));
    expect(screen.getByTestId("diff-full-code-view")).toBeDefined();

    // Submit inline file comment
    const commentInput = screen.getByTestId("file-diff-comment-input");
    fireEvent.change(commentInput, {
      target: { value: "Add try/catch around payment call" },
    });
    fireEvent.click(screen.getByTestId("file-diff-submit-fix-btn"));

    expect(onRequestChanges).toHaveBeenCalledWith(
      "[File: src/payment.ts] Add try/catch around payment call",
    );
  });

  it("allows quick comment & AI fix directly from the Kanban TaskCard in human_review", () => {
    const task = makeReviewTask();
    const onReject = vi.fn();

    render(
      <TooltipProvider delayDuration={0}>
        <TaskCard
          task={task}
          onClick={vi.fn()}
          onApprove={vi.fn()}
          onReject={onReject}
        />
      </TooltipProvider>,
    );

    const commentBtn = screen.getByTestId(
      `request-changes-task-${task.id}`,
    );
    fireEvent.click(commentBtn);

    const input = screen.getByTestId(`quick-comment-input-${task.id}`);
    fireEvent.change(input, {
      target: { value: "Fix timeout handling in payment.ts" },
    });

    const submitBtn = screen.getByTestId(`quick-comment-submit-${task.id}`);
    fireEvent.click(submitBtn);

    expect(onReject).toHaveBeenCalledWith(
      task.id,
      "Fix timeout handling in payment.ts",
    );
  });

  it("supports Fix Entire Feature button and Scope Toggle (Current File vs Entire Feature) in TaskFiles", () => {
    const task = makeReviewTask({
      fileDiffs: [
        {
          path: "src/payment.ts",
          status: "modified",
          additions: 4,
          deletions: 1,
          oldContent: "export const pay = () => false;\n",
          newContent: "export const pay = () => true;\n",
          unifiedDiff:
            "--- a/src/payment.ts\n+++ b/src/payment.ts\n@@ -1,1 +1,1 @@\n-export const pay = () => false;\n+export const pay = () => true;",
        },
        {
          path: "tests/payment.test.ts",
          status: "created",
          additions: 3,
          deletions: 0,
          oldContent: "",
          newContent: "export const testPay = () => true;\n",
          unifiedDiff:
            "--- /dev/null\n+++ b/tests/payment.test.ts\n@@ -0,0 +1,1 @@\n+export const testPay = () => true;",
        },
      ],
    });
    const onRequestChanges = vi.fn();

    render(
      <TooltipProvider delayDuration={0}>
        <TaskFiles task={task} onRequestChanges={onRequestChanges} />
      </TooltipProvider>,
    );

    // Click Fix Entire Feature button in toolbar
    const fixFeatureBtn = screen.getByTestId("fix-entire-feature-btn");
    fireEvent.click(fixFeatureBtn);

    const commentInput = screen.getByTestId("file-diff-comment-input");
    fireEvent.change(commentInput, {
      target: { value: "Add idempotency keys across payment service and tests" },
    });
    fireEvent.click(screen.getByTestId("file-diff-submit-fix-btn"));

    expect(onRequestChanges).toHaveBeenCalledWith(
      "[Scope: Entire Feature] Add idempotency keys across payment service and tests",
    );

    // Toggle back to Current File scope via fix-scope-file
    fireEvent.click(screen.getByTestId("fix-scope-file"));
    fireEvent.change(commentInput, {
      target: { value: "Single file fix on payment.ts" },
    });
    fireEvent.click(screen.getByTestId("file-diff-submit-fix-btn"));

    expect(onRequestChanges).toHaveBeenLastCalledWith(
      "[File: src/payment.ts] Single file fix on payment.ts",
    );
  });

  it("opens Edit Entire Feature panel in TaskDetailModal and triggers Save & AI Fix Entire Feature", () => {
    const task = makeReviewTask();
    const onReject = vi.fn();
    const onUpdateTask = vi.fn();

    render(
      <TooltipProvider delayDuration={0}>
        <TaskDetailModal
          task={task}
          onClose={vi.fn()}
          onReject={onReject}
          onUpdateTask={onUpdateTask}
        />
      </TooltipProvider>,
    );

    const editBtn = screen.getByTestId("edit-feature-toggle-btn");
    fireEvent.click(editBtn);

    expect(screen.getByTestId("task-edit-feature-panel")).toBeDefined();

    const titleInput = screen.getByTestId("edit-feature-title-input");
    const descInput = screen.getByTestId("edit-feature-description-input");
    const instrInput = screen.getByTestId("edit-feature-instructions-input");

    fireEvent.change(titleInput, {
      target: { value: "Implement Multi-Currency Payment Gateway" },
    });
    fireEvent.change(descInput, {
      target: { value: "Support USD, EUR, VND with automatic FX conversion" },
    });
    fireEvent.change(instrInput, {
      target: { value: "Update all modules to validate ISO currency codes" },
    });

    fireEvent.click(screen.getByTestId("save-and-ai-fix-feature-btn"));

    expect(onUpdateTask).toHaveBeenCalledWith("001-review-task", {
      title: "Implement Multi-Currency Payment Gateway",
      description: "Support USD, EUR, VND with automatic FX conversion",
      instructions: "Update all modules to validate ISO currency codes",
      triggerAiFix: true,
    });
    expect(onReject).toHaveBeenCalledWith(
      "001-review-task",
      "[Scope: Entire Feature] Update all modules to validate ISO currency codes",
    );
  });

  it("allows editing a Roadmap feature and triggering Save & AI Fix / Build Feature in FeatureDetailPanel", () => {
    const onUpdateFeature = vi.fn();
    render(
      <FeatureDetailPanel
        feature={{
          id: "feat-1",
          title: "Core Worker Pipeline",
          description: "Initial worker description",
          status: "planned",
          phaseId: "phase-1",
          priority: 2,
        }}
        onClose={vi.fn()}
        onUpdateFeature={onUpdateFeature}
      />,
    );

    fireEvent.click(screen.getByTestId("roadmap-edit-feature-btn"));
    expect(screen.getByTestId("roadmap-edit-feature-form")).toBeDefined();

    fireEvent.change(screen.getByTestId("roadmap-feature-title-input"), {
      target: { value: "Resilient Worker Pipeline v2" },
    });
    fireEvent.change(screen.getByTestId("roadmap-feature-description-input"), {
      target: { value: "Add dead-letter queue and exponential backoff" },
    });

    fireEvent.click(screen.getByTestId("roadmap-save-and-build-btn"));

    expect(onUpdateFeature).toHaveBeenCalledWith("feat-1", {
      title: "Resilient Worker Pipeline v2",
      description: "Add dead-letter queue and exponential backoff",
      priority: 2,
      status: "planned",
      triggerAiBuild: true,
    });
  });

  it("materializes a dedicated per-task source tree folder and binds terminal execution to that folder", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aperant-task-wt-"));
    let createdProjectId: string | null = null;
    try {
      fs.writeFileSync(
        path.join(tmpDir, "README.md"),
        "# Sample Project\n",
        "utf-8",
      );
      const project = createOrUpdateProject(tmpDir, "TaskSourceTreeProject");
      createdProjectId = project.id;
      const createdTask = createTaskForProject(project.id, {
        title: "Add Isolation Worker",
        description: "Verify per-task source tree folder and terminal binding",
      });

      expect(createdTask.worktreePath).toBeTruthy();
      expect(createdTask.worktreeBranch).toBe(`auto-claude/${createdTask.id}`);
      expect(fs.existsSync(createdTask.worktreePath)).toBe(true);

      const synced = ensureTaskSourceTreeForProject(project.id, createdTask.id);
      expect(synced.success).toBe(true);
      expect(synced.worktreePath).toBe(createdTask.worktreePath);
      expect(
        fs.existsSync(path.join(synced.worktreePath, "TASK_SOURCE_TREE.md")),
      ).toBe(true);
      expect(fs.existsSync(path.join(synced.worktreePath, "README.md"))).toBe(
        true,
      );

      const opened = openTaskTerminalForProject(project.id, createdTask.id);
      expect(opened.success).toBe(true);
      expect(opened.session.cwd).toBe(createdTask.worktreePath);
      expect(opened.session.worktreePath).toBe(createdTask.worktreePath);
      expect(opened.session.associatedTaskId).toBe(createdTask.id);

      const pwdRes = execTerminalCommandForProject(
        project.id,
        opened.session.id,
        "pwd",
      );
      expect(pwdRes.exitCode).toBe(0);
      expect(pwdRes.output.trim()).toBe(createdTask.worktreePath);
    } finally {
      if (createdProjectId) {
        const store = loadStore();
        store.projects = store.projects.filter(
          (p) => p.id !== createdProjectId && p.name !== "TaskSourceTreeProject",
        );
        saveStore(store);
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("renders Source Tree Folder badge and Terminal button on TaskCard and triggers onOpenTerminal", () => {
    const task = makeReviewTask({
      worktreePath: "/tmp/project/.auto-claude/worktrees/001-review-task",
      worktreeBranch: "auto-claude/001-review-task",
    });
    const onOpenTerminal = vi.fn();

    render(
      <TooltipProvider delayDuration={0}>
        <TaskCard
          task={task}
          onClick={vi.fn()}
          onOpenTerminal={onOpenTerminal}
        />
      </TooltipProvider>,
    );

    const folderBadge = screen.getByTestId(`task-source-folder-${task.id}`);
    expect(folderBadge.textContent).toContain("worktrees/001-review-task");

    const termBtn = screen.getByTestId(`open-task-terminal-${task.id}`);
    fireEvent.click(termBtn);
    expect(onOpenTerminal).toHaveBeenCalledWith(task, "modal");
  });

  it("opens TaskTerminal inside TaskDetailModal and registers task terminal in useTerminalStore", () => {
    useTerminalStore.getState().clearAllTerminals();
    const task = makeReviewTask({
      worktreePath: "/tmp/project/.auto-claude/worktrees/001-review-task",
      worktreeBranch: "auto-claude/001-review-task",
    });
    const onOpenInTerminalsView = vi.fn();

    render(
      <TooltipProvider delayDuration={0}>
        <TaskDetailModal
          task={task}
          initialTab="terminal"
          onClose={vi.fn()}
          onOpenInTerminalsView={onOpenInTerminalsView}
        />
      </TooltipProvider>,
    );

    expect(screen.getByTestId("task-header-terminal-btn")).toBeDefined();
    expect(
      screen.getByTestId("task-header-worktree-path").textContent,
    ).toContain("/tmp/project/.auto-claude/worktrees/001-review-task");

    expect(screen.getByTestId("task-terminal-toolbar")).toBeDefined();
    expect(screen.getByTestId("task-terminal-cwd-badge").textContent).toContain(
      "/tmp/project/.auto-claude/worktrees/001-review-task",
    );
    expect(
      screen.getByTestId("task-terminal-branch-badge").textContent,
    ).toContain("auto-claude/001-review-task");
    expect(screen.getByTestId("task-terminal-sync-btn")).toBeDefined();
    expect(screen.getByTestId("task-terminal-copy-path-btn")).toBeDefined();

    const storeTerm = useTerminalStore
      .getState()
      .getTerminal(`term-task-${task.id}`);
    expect(storeTerm).toBeDefined();
    expect(storeTerm?.associatedTaskId).toBe(task.id);
    expect(storeTerm?.cwd).toBe(
      "/tmp/project/.auto-claude/worktrees/001-review-task",
    );

    fireEvent.click(screen.getByTestId("task-terminal-open-view-btn"));
    expect(onOpenInTerminalsView).toHaveBeenCalled();
  });

  it("renders 1-click Check Diff button on WorktreeCard and opens the 2-pane Unified / Split / Full Diff Workbench", async () => {
    const specName = "009-script-to-run-environment-on-the-localhost-to-test";
    const diffSpy = vi
      .spyOn(apiClient, "getWorktreeDiff")
      .mockResolvedValue({
        success: true,
        specName,
        branch: `auto-claude/${specName}`,
        baseBranch: "main",
        filesChanged: 2,
        totalAdditions: 12,
        totalDeletions: 1,
        files: [
          {
            file: "scripts/run-local-test.sh",
            path: "scripts/run-local-test.sh",
            status: "created",
            additions: 10,
            deletions: 0,
            oldContent: "",
            newContent: "#!/usr/bin/env bash\necho 'Running local test suite'\n",
            unifiedDiff:
              "--- /dev/null\n+++ b/scripts/run-local-test.sh\n@@ -0,0 +1,2 @@\n+#!/usr/bin/env bash\n+echo 'Running local test suite'",
            snippet: "+#!/usr/bin/env bash\n+echo 'Running local test suite'",
          },
          {
            file: "main.py",
            path: "main.py",
            status: "modified",
            additions: 2,
            deletions: 1,
            oldContent: "PORT = 8000\n",
            newContent: "PORT = 8080\nDEBUG = True\n",
            unifiedDiff:
              "--- a/main.py\n+++ b/main.py\n@@ -1,1 +1,2 @@\n-PORT = 8000\n+PORT = 8080\n+DEBUG = True",
            snippet: "-PORT = 8000\n+PORT = 8080\n+DEBUG = True",
          },
        ],
      });

    const onSelect = vi.fn();
    render(
      <WorktreeList
        worktrees={[
          {
            specName,
            path: `/tmp/.auto-claude/worktrees/${specName}`,
            branch: `auto-claude/${specName}`,
            baseBranch: "main",
            commitCount: 1,
            filesChanged: 2,
            additions: 12,
            deletions: 1,
            isOrphaned: false,
          },
        ]}
        isLoading={false}
        error={null}
        projectId="proj-1"
        selectedSpecName={null}
        onSelect={onSelect}
        onRefresh={vi.fn()}
      />,
    );

    const checkDiffBtn = screen.getByTestId(
      `worktree-card-check-diff-btn-${specName}`,
    );
    expect(checkDiffBtn).toBeDefined();

    fireEvent.click(checkDiffBtn);
    expect(onSelect).toHaveBeenCalledWith(specName);
    expect(diffSpy).toHaveBeenCalledWith("proj-1", specName);

    const diffPanel = await screen.findByTestId(
      `worktree-diff-panel-${specName}`,
    );
    expect(diffPanel.textContent).toContain(
      `Diff Preview: auto-claude/${specName}`,
    );

    // Verify changed files list in left pane
    const scriptFileBtn = await screen.findByTestId(
      `worktree-diff-file-${specName}-scripts/run-local-test.sh`,
    );
    const mainFileBtn = await screen.findByTestId(
      `worktree-diff-file-${specName}-main.py`,
    );
    expect(scriptFileBtn).toBeDefined();
    expect(mainFileBtn).toBeDefined();

    // Switch to main.py and verify Unified, Split, and Full Code modes
    fireEvent.click(mainFileBtn);
    expect(
      screen.getByTestId(`worktree-selected-file-${specName}`).textContent,
    ).toBe("main.py");
    expect(
      screen.getByTestId(`worktree-diff-viewer-body-${specName}`).textContent,
    ).toContain("PORT = 8080");

    fireEvent.click(screen.getByTestId(`worktree-diff-mode-split-${specName}`));
    expect(
      screen.getByTestId(`worktree-diff-split-grid-${specName}`).textContent,
    ).toContain("PORT = 8000");

    fireEvent.click(screen.getByTestId(`worktree-diff-mode-full-${specName}`));
    expect(
      screen.getByTestId(`worktree-diff-full-code-${specName}`).textContent,
    ).toContain("DEBUG = True");

    diffSpy.mockRestore();
  });

  it("renders merged worktrees, main git log timeline, and merge confirmation banner in WorktreesView", async () => {
    const activeSpec = "010-add-skill-for-agent";
    const mergedSpec = "009-script-to-run-environment-on-the-localhost-to-test";

    const listSpy = vi
      .spyOn(apiClient, "listWorktrees")
      .mockResolvedValue({
        worktrees: [
          {
            specName: activeSpec,
            path: `/tmp/.auto-claude/worktrees/${activeSpec}`,
            branch: `auto-claude/${activeSpec}`,
            baseBranch: "main",
            commitCount: 1,
            filesChanged: 2,
            additions: 124,
            deletions: 0,
            isOrphaned: false,
            status: "active",
          },
        ],
        mergedWorktrees: [
          {
            specName: mergedSpec,
            path: `/tmp/.auto-claude/worktrees/${mergedSpec}`,
            branch: `auto-claude/${mergedSpec}`,
            baseBranch: "main",
            commitCount: 1,
            filesChanged: 2,
            additions: 92,
            deletions: 0,
            isOrphaned: false,
            status: "merged",
            mergedAt: "2026-04-11T07:00:00.000Z",
            mergeCommitSha: "a1b2c3d",
            mergeCommitMessage: `Merge branch 'auto-claude/${mergedSpec}' into main`,
          },
        ],
        gitLog: [
          {
            sha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
            shortSha: "a1b2c3d",
            message: `Merge branch 'auto-claude/${mergedSpec}' into main`,
            author: "Auto Claude",
            date: "2026-04-11T07:00:00Z",
          },
        ],
      });

    const mergeSpy = vi
      .spyOn(apiClient, "mergeWorktree")
      .mockResolvedValue({
        success: true,
        specName: activeSpec,
        merged: true,
        mergeCommitSha: "f9e8d7c",
        mergeCommitMessage: `Merge branch 'auto-claude/${activeSpec}' into main`,
      });

    render(<WorktreesView projectId="proj-1" />);

    const mergedHistorySection = await screen.findByTestId(
      "worktrees-merged-history-section",
    );
    expect(mergedHistorySection.textContent).toContain(mergedSpec);
    expect(
      screen.getByTestId(`worktree-merged-badge-${mergedSpec}`).textContent,
    ).toContain("Merged into main");
    expect(
      screen.getByTestId(`worktree-merge-sha-${mergedSpec}`).textContent,
    ).toContain("commit #a1b2c3d");
    expect(screen.getByTestId("git-log-commit-a1b2c3d").textContent).toContain(
      `Merge branch 'auto-claude/${mergedSpec}' into main`,
    );

    // Select active worktree and click Merge
    fireEvent.click(screen.getByTestId(`worktree-card-${activeSpec}`));
    const mergeBtn = await screen.findByTestId(
      `worktree-merge-btn-${activeSpec}`,
    );
    fireEvent.click(mergeBtn);

    const banner = await screen.findByTestId("worktree-merged-banner");
    expect(banner.textContent).toContain(`auto-claude/${activeSpec}`);
    expect(banner.textContent).toContain("commit #f9e8d7c");

    // Switch to Merged & main Git Log tab
    fireEvent.click(screen.getByTestId("worktrees-tab-merged"));
    expect(screen.getByTestId("worktrees-merged-tab-panel")).toBeDefined();

    listSpy.mockRestore();
    mergeSpy.mockRestore();
  });
});
