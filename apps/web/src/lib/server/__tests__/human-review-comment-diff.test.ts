import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createOrUpdateProject,
  createTaskForProject,
  startTaskExecution,
  approveTaskForProject,
  rejectTaskForProject,
  updateTaskForProject,
  generateRoadmapForProject,
  updateRoadmapFeatureForProject,
  getTaskFilesDiffForProject,
  computeUnifiedDiff,
  buildTask,
  resolveSpecsDir,
  getStageDwellTime,
  setTaskEngineDwellTimes,
  listWorktreesForProject,
  mergeWorktreeForProject,
  getWorktreeDiffForProject,
  ensureTaskSourceTreeForProject,
  MAX_VERIFY_FIX_ITERATIONS,
} from "../task-engine";

describe("Human Review Comment & AI Fix + File Diff Engine", () => {
  let tempProjectDir: string;
  let project: any;
  const originalStoreDir = process.env.AUTO_CLAUDE_STORE_DIR;

  beforeEach(() => {
    vi.useFakeTimers();
    tempProjectDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "aperant-review-diff-test-"),
    );
    process.env.AUTO_CLAUDE_STORE_DIR = path.join(tempProjectDir, ".store");
    project = createOrUpdateProject(
      tempProjectDir,
      "Human Review Diff Test Project",
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input: any) => {
        const url = String(input);
        if (url.includes("/chat/completions")) {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      summary:
                        "Implemented initial module and verified E2E checks",
                      files: [
                        {
                          path: "src/payment-service.ts",
                          content:
                            "export function processPayment(amount: number) {\n  return { success: true, amount };\n}\n",
                        },
                      ],
                    }),
                  },
                },
              ],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return new Response("Not found", { status: 404 });
      }),
    );
  });

  afterEach(() => {
    setTaskEngineDwellTimes(null);
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (originalStoreDir !== undefined) {
      process.env.AUTO_CLAUDE_STORE_DIR = originalStoreDir;
    } else {
      delete process.env.AUTO_CLAUDE_STORE_DIR;
    }
    try {
      fs.rmSync(tempProjectDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it("computeUnifiedDiff generates clean unified diffs for created and modified files", () => {
    const createdDiff = computeUnifiedDiff(
      "src/app.ts",
      "",
      "const a = 1;\nconst b = 2;\n",
    );
    expect(createdDiff.additions).toBe(2);
    expect(createdDiff.deletions).toBe(0);
    expect(createdDiff.unifiedDiff).toContain("--- /dev/null");
    expect(createdDiff.unifiedDiff).toContain("+++ b/src/app.ts");
    expect(createdDiff.unifiedDiff).toContain("+const a = 1;");

    const modifiedDiff = computeUnifiedDiff(
      "src/app.ts",
      "const a = 1;\nconst b = 2;\n",
      "const a = 1;\nconst b = 3;\nconst c = 4;\n",
    );
    expect(modifiedDiff.additions).toBe(2);
    expect(modifiedDiff.deletions).toBe(1);
    expect(modifiedDiff.unifiedDiff).toContain("--- a/src/app.ts");
    expect(modifiedDiff.unifiedDiff).toContain("+++ b/src/app.ts");
    expect(modifiedDiff.unifiedDiff).toContain("-const b = 2;");
    expect(modifiedDiff.unifiedDiff).toContain("+const b = 3;");
    expect(modifiedDiff.unifiedDiff).toContain("+const c = 4;");
  });

  it("populates fileDiffs on initial task completion and updates code + diff when rejected with a human review comment", async () => {
    const created = createTaskForProject(project.id, {
      title: "Build Payment Service",
      description: "Implement payment processing module",
    });

    startTaskExecution(project.id, created.id);

    // Advance to human_review
    await vi.advanceTimersByTimeAsync(
      getStageDwellTime("queue") +
        getStageDwellTime("in_progress") +
        getStageDwellTime("ai_review") +
        150,
    );

    const specsPath = resolveSpecsDir(project);
    const specFolder = path.join(specsPath, created.id);
    let task = buildTask(specFolder, project.id);

    expect(task.status).toBe("human_review");
    expect(Array.isArray(task.fileDiffs)).toBe(true);
    expect(task.fileDiffs.length).toBeGreaterThanOrEqual(1);

    const initialDiff = task.fileDiffs.find(
      (f: any) => f.path === "src/payment-service.ts",
    );
    expect(initialDiff).toBeDefined();
    expect(initialDiff.status).toBe("created");
    expect(initialDiff.newContent).toContain("processPayment");

    // Now submit a Human Review comment targeting a specific file & line
    const rejected = rejectTaskForProject(
      project.id,
      created.id,
      "[File: src/payment-service.ts:L2] Please add negative amount validation and retry guard",
    );

    expect(rejected.status).toBe("queue");
    expect(rejected.reviewComments).toHaveLength(1);
    expect(rejected.reviewComments[0].comment).toBe(
      "Please add negative amount validation and retry guard",
    );
    expect(rejected.reviewComments[0].filePath).toBe("src/payment-service.ts");
    expect(rejected.reviewComments[0].lineNumber).toBe(2);
    expect(rejected.reviewComments[0].status).toBe("fixing");

    // Verify QA_FIX_REQUEST.md was written
    const qaFixPath = path.join(specFolder, "QA_FIX_REQUEST.md");
    expect(fs.existsSync(qaFixPath)).toBe(true);
    expect(fs.readFileSync(qaFixPath, "utf-8")).toContain(
      "Please add negative amount validation and retry guard",
    );

    // Advance through the AI Check & Fix pipeline back to human_review
    await vi.advanceTimersByTimeAsync(
      getStageDwellTime("queue") +
        getStageDwellTime("in_progress") +
        getStageDwellTime("ai_review") +
        150,
    );

    task = buildTask(specFolder, project.id);
    expect(task.status).toBe("human_review");
    expect(task.reviewComments).toHaveLength(1);
    expect(task.reviewComments[0].status).toBe("addressed");
    expect(task.reviewComments[0].aiResponse).toContain(
      "src/payment-service.ts",
    );
    expect(task.reviewComments[0].modifiedFiles).toContain(
      "src/payment-service.ts",
    );

    // Verify the file on disk and in fileDiffs was genuinely modified with before/after diff
    const diffs = getTaskFilesDiffForProject(project.id, created.id);
    const updatedDiff = diffs.find(
      (f: any) => f.path === "src/payment-service.ts",
    );
    expect(updatedDiff).toBeDefined();
    expect(updatedDiff.status).toBe("modified");
    expect(updatedDiff.oldContent).not.toEqual(updatedDiff.newContent);
    expect(updatedDiff.newContent).toContain(
      "Please add negative amount validation and retry guard",
    );
    expect(updatedDiff.unifiedDiff).toContain("+++ b/src/payment-service.ts");
    expect(updatedDiff.additions).toBeGreaterThan(0);
  });

  it("updates ALL files in the feature when rejected with [Scope: Entire Feature] whole-feature AI fix", async () => {
    const created = createTaskForProject(project.id, {
      title: "Build Payment Service",
      description: "Implement payment processing module and test suite",
    });

    startTaskExecution(project.id, created.id);
    await vi.advanceTimersByTimeAsync(
      getStageDwellTime("queue") +
        getStageDwellTime("in_progress") +
        getStageDwellTime("ai_review") +
        150,
    );

    const specsPath = resolveSpecsDir(project);
    const specFolder = path.join(specsPath, created.id);
    let task = buildTask(specFolder, project.id);
    expect(task.status).toBe("human_review");
    expect(task.fileDiffs.length).toBeGreaterThanOrEqual(2);

    // Submit a Whole-Feature AI fix request
    const rejected = rejectTaskForProject(
      project.id,
      created.id,
      "[Scope: Entire Feature] Add structured audit logging and retry policy across all feature files",
    );
    expect(rejected.status).toBe("queue");
    expect(rejected.reviewComments).toHaveLength(1);
    expect(rejected.reviewComments[0].filePath).toBeUndefined();
    expect(rejected.reviewComments[0].comment).toBe(
      "Add structured audit logging and retry policy across all feature files",
    );

    await vi.advanceTimersByTimeAsync(
      getStageDwellTime("queue") +
        getStageDwellTime("in_progress") +
        getStageDwellTime("ai_review") +
        150,
    );

    task = buildTask(specFolder, project.id);
    expect(task.status).toBe("human_review");
    expect(task.reviewComments[0].status).toBe("addressed");
    expect(task.reviewComments[0].modifiedFiles.length).toBeGreaterThanOrEqual(2);

    // Every file in the feature should be marked modified and contain the whole-feature revision
    const diffs = getTaskFilesDiffForProject(project.id, created.id);
    expect(diffs.length).toBeGreaterThanOrEqual(2);
    for (const diff of diffs) {
      expect(diff.status).toBe("modified");
      expect(diff.additions).toBeGreaterThan(0);
      expect(diff.newContent).toContain(
        "Add structured audit logging and retry policy across all feature files",
      );
    }
  });

  it("updateTaskForProject updates feature specification and optionally triggers whole-feature AI fix", async () => {
    const created = createTaskForProject(project.id, {
      title: "Initial Auth Feature",
      description: "Basic login flow",
    });

    // 1. Save feature without AI fix
    const saved = updateTaskForProject(project.id, created.id, {
      title: "Enterprise OAuth2 & MFA Feature",
      description: "Support OIDC, PKCE, and TOTP verification across all modules",
      triggerAiFix: false,
    });
    expect(saved.title).toBe("Enterprise OAuth2 & MFA Feature");
    expect(saved.description).toBe(
      "Support OIDC, PKCE, and TOTP verification across all modules",
    );

    // 2. Save & AI Fix Entire Feature
    const triggered = updateTaskForProject(project.id, created.id, {
      title: "Enterprise OAuth2 & MFA Feature v2",
      description: "Support OIDC, PKCE, TOTP, and session rotation",
      instructions: "Enforce strict token expiry validation across all files",
      triggerAiFix: true,
    });
    expect(triggered.status).toBe("queue");
    expect(triggered.reviewComments).toHaveLength(1);
    expect(triggered.reviewComments[0].comment).toContain(
      "Enforce strict token expiry validation across all files",
    );

    await vi.advanceTimersByTimeAsync(
      getStageDwellTime("queue") +
        getStageDwellTime("in_progress") +
        getStageDwellTime("ai_review") +
        150,
    );

    const specsPath = resolveSpecsDir(project);
    const finalTask = buildTask(path.join(specsPath, created.id), project.id);
    expect(finalTask.status).toBe("human_review");
    expect(finalTask.title).toBe("Enterprise OAuth2 & MFA Feature v2");
    expect(finalTask.reviewComments[0].status).toBe("addressed");
    expect(
      finalTask.reviewComments[0].modifiedFiles.length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("updateRoadmapFeatureForProject edits roadmap feature and triggers Kanban AI build/fix", async () => {
    const generated = await generateRoadmapForProject(project.id);
    const firstFeature = generated.roadmap.features[0];
    expect(firstFeature).toBeDefined();

    const updatedRes = updateRoadmapFeatureForProject(
      project.id,
      firstFeature.id,
      {
        title: "Edited Roadmap Feature — Distributed Cache",
        description: "Redis cluster caching with automatic failover",
        priority: "must",
        status: "in_progress",
        triggerAiBuild: true,
      },
    );

    expect(updatedRes.success).toBe(true);
    expect(updatedRes.feature.title).toBe(
      "Edited Roadmap Feature — Distributed Cache",
    );
    expect(updatedRes.feature.priority).toBe(1);
    expect(updatedRes.feature.linkedSpecId).toBeDefined();
    expect(updatedRes.task).toBeDefined();
  });

  it("documentation task ('Add Architecture Diagrams & Quickstart Runbook') updates README.md and docs/architecture.md without creating src/*.ts or tests/*.test.ts", async () => {
    fs.writeFileSync(
      path.join(tempProjectDir, "README.md"),
      "# HR Linked\n\nExisting project overview.\n",
      "utf-8",
    );
    fs.mkdirSync(path.join(tempProjectDir, "docs"), { recursive: true });
    fs.writeFileSync(
      path.join(tempProjectDir, "docs", "architecture.md"),
      "# System Architecture\n\nExisting architecture overview.\n",
      "utf-8",
    );

    const created = createTaskForProject(project.id, {
      title: "Add Architecture Diagrams & Quickstart Runbook",
      description:
        "Document end-to-end build, test, and deployment workflows in HR linked/README.md with examples.",
      metadata: {
        sourceType: "ideation",
        category: "documentation_gaps",
      },
    });

    startTaskExecution(project.id, created.id);
    await vi.advanceTimersByTimeAsync(
      getStageDwellTime("queue") +
        getStageDwellTime("in_progress") +
        getStageDwellTime("ai_review") +
        150,
    );

    const specsPath = resolveSpecsDir(project);
    const specFolder = path.join(specsPath, created.id);
    const task = buildTask(specFolder, project.id);

    expect(task.status).toBe("human_review");
    const diffPaths = task.fileDiffs.map((d: any) => d.path);
    expect(diffPaths).toContain("README.md");
    expect(diffPaths).toContain("docs/architecture.md");
    expect(diffPaths.some((p: string) => p.endsWith(".ts"))).toBe(false);

    expect(
      fs.existsSync(
        path.join(
          tempProjectDir,
          "src",
          "add-architecture-diagrams-quickstart-runbook.ts",
        ),
      ),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(
          tempProjectDir,
          "tests",
          "add-architecture-diagrams-quickstart-runbook.test.ts",
        ),
      ),
    ).toBe(false);

    const readmeContent = fs.readFileSync(
      path.join(tempProjectDir, "README.md"),
      "utf-8",
    );
    expect(readmeContent).toContain("Existing project overview.");
    expect(readmeContent).toContain("```mermaid");
    expect(readmeContent).toContain("End-to-End Quickstart Runbook");
  });

  it("cleans up stale src/*.ts and tests/*.test.ts files and applies clean Markdown review notes when rejected with 'add document not add the code'", async () => {
    const created = createTaskForProject(project.id, {
      title: "Add Architecture Diagrams & Quickstart Runbook",
      description:
        "Document end-to-end build, test, and deployment workflows in README.md.",
      metadata: {
        sourceType: "ideation",
        category: "documentation_gaps",
      },
    });

    // Simulate stale bogus TypeScript files left over from an old buggy run
    const bogusSrc = path.join(
      tempProjectDir,
      "src",
      "add-architecture-diagrams-quickstart-runbook.ts",
    );
    const bogusTest = path.join(
      tempProjectDir,
      "tests",
      "add-architecture-diagrams-quickstart-runbook.test.ts",
    );
    fs.mkdirSync(path.dirname(bogusSrc), { recursive: true });
    fs.mkdirSync(path.dirname(bogusTest), { recursive: true });
    fs.writeFileSync(bogusSrc, "export function executeTask() {}", "utf-8");
    fs.writeFileSync(bogusTest, "export const test = true;", "utf-8");

    const specsPath = resolveSpecsDir(project);
    const specFolder = path.join(specsPath, created.id);
    const planPath = path.join(specFolder, "implementation_plan.json");
    const plan = JSON.parse(fs.readFileSync(planPath, "utf-8"));
    plan.fileDiffs = [
      {
        path: "src/add-architecture-diagrams-quickstart-runbook.ts",
        status: "created",
        oldContent: "",
        newContent: "export function executeTask() {}",
      },
      {
        path: "tests/add-architecture-diagrams-quickstart-runbook.test.ts",
        status: "created",
        oldContent: "",
        newContent: "export const test = true;",
      },
    ];
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), "utf-8");

    // Reject with user feedback demanding documentation instead of code
    rejectTaskForProject(
      project.id,
      created.id,
      "add document not add the code, add the document and quick start run book",
    );

    await vi.advanceTimersByTimeAsync(
      getStageDwellTime("queue") +
        getStageDwellTime("in_progress") +
        getStageDwellTime("ai_review") +
        150,
    );

    // Stale .ts files must be removed from disk and from fileDiffs
    expect(fs.existsSync(bogusSrc)).toBe(false);
    expect(fs.existsSync(bogusTest)).toBe(false);

    const diffs = getTaskFilesDiffForProject(project.id, created.id);
    const diffPaths = diffs.map((d: any) => d.path);
    expect(diffPaths).toContain("README.md");
    expect(diffPaths).toContain("docs/architecture.md");
    expect(diffPaths.some((p: string) => p.endsWith(".ts"))).toBe(false);

    const readmeDiff = diffs.find((d: any) => d.path === "README.md");
    expect(readmeDiff.newContent).toContain(
      "### Review Feedback Addressed (Revision #1)",
    );
    expect(readmeDiff.newContent).not.toContain("aiReviewFixRevision_");
  });

  it("generates executable shell scripts (scripts/run-local-test.sh & run-local.sh), cleans up stale Python/TS stubs, and sets shell-script plan subtasks", async () => {
    fs.writeFileSync(
      path.join(tempProjectDir, "main.py"),
      'if __name__ == "__main__":\n    print("starting")\n',
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tempProjectDir, "requirements.txt"),
      "aiohttp>=3.9.0\n",
      "utf-8",
    );

    const created = createTaskForProject(project.id, {
      title: "Script to run environment on the localhost to testing",
      description:
        "add script to can run the develpoment on the localhost to testing",
    });

    // Simulate pre-existing bogus .py files created before the fix
    const bogusPySrc = path.join(
      tempProjectDir,
      "src",
      "script_to_run_environment_on_the_localhost_to_testing.py",
    );
    const bogusPyTest = path.join(
      tempProjectDir,
      "tests",
      "test_script_to_run_environment_on_the_localhost_to_testing.py",
    );
    fs.mkdirSync(path.dirname(bogusPySrc), { recursive: true });
    fs.mkdirSync(path.dirname(bogusPyTest), { recursive: true });
    fs.writeFileSync(bogusPySrc, "def execute_task(): pass\n", "utf-8");
    fs.writeFileSync(bogusPyTest, "def test_execute_task(): pass\n", "utf-8");

    const specsPath = resolveSpecsDir(project);
    const specFolder = path.join(specsPath, created.id);
    const planPath = path.join(specFolder, "implementation_plan.json");
    const plan = JSON.parse(fs.readFileSync(planPath, "utf-8"));
    plan.fileDiffs = [
      {
        path: "src/script_to_run_environment_on_the_localhost_to_testing.py",
        status: "created",
        oldContent: "",
        newContent: "def execute_task(): pass\n",
      },
      {
        path: "tests/test_script_to_run_environment_on_the_localhost_to_testing.py",
        status: "created",
        oldContent: "",
        newContent: "def test_execute_task(): pass\n",
      },
    ];
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), "utf-8");

    rejectTaskForProject(
      project.id,
      created.id,
      "i mean the shell script for that to run up the local environment",
    );

    await vi.advanceTimersByTimeAsync(
      getStageDwellTime("queue") +
        getStageDwellTime("in_progress") +
        getStageDwellTime("ai_review") +
        150,
    );

    expect(fs.existsSync(bogusPySrc)).toBe(false);
    expect(fs.existsSync(bogusPyTest)).toBe(false);

    const scriptPath = path.join(tempProjectDir, "scripts", "run-local-test.sh");
    const wrapperPath = path.join(tempProjectDir, "run-local.sh");
    expect(fs.existsSync(scriptPath)).toBe(true);
    expect(fs.existsSync(wrapperPath)).toBe(true);

    const scriptContent = fs.readFileSync(scriptPath, "utf-8");
    expect(scriptContent).toContain("#!/usr/bin/env bash");
    expect(scriptContent).toContain("--check");
    expect(scriptContent).toContain(
      "i mean the shell script for that to run up the local environment",
    );
    expect(scriptContent).not.toContain("aiReviewFixRevision_");

    const finalTask = buildTask(specFolder, project.id);
    expect(finalTask.status).toBe("human_review");
    expect(finalTask.subtasks).toHaveLength(3);
    expect(finalTask.subtasks[1].title).toContain(
      "Create executable localhost environment shell scripts",
    );
    expect(finalTask.subtasks[1].files).toContain("scripts/run-local-test.sh");
    expect(finalTask.subtasks[1].files).toContain("run-local.sh");

    const diffPaths = finalTask.fileDiffs.map((d: any) => d.path);
    expect(diffPaths).toContain("scripts/run-local-test.sh");
    expect(diffPaths).toContain("run-local.sh");
    expect(diffPaths.some((p: string) => p.endsWith(".py"))).toBe(false);
  });

  it("uses AI-generated subtasks and files directly on Python repos without injecting dummy execute_task() files", async () => {
    fs.writeFileSync(
      path.join(tempProjectDir, "main.py"),
      'if __name__ == "__main__":\n    print("app")\n',
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tempProjectDir, "requirements.txt"),
      "aiohttp>=3.9.0\n",
      "utf-8",
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: `<think>Planning error boundary refactor...</think>\n\`\`\`json\n${JSON.stringify(
                    {
                      summary:
                        "Extracted retry and error handling boundary into src/utils/error_boundary.py",
                      subtasks: [
                        {
                          id: "st-1",
                          title: "Audit service exception handling in src/core and src/web",
                          description: "Identify transient errors and timeout boundaries",
                        },
                        {
                          id: "st-2",
                          title: "Implement structured retry & error boundary module",
                          description: "Create src/utils/error_boundary.py and unit tests",
                          files: [
                            "src/utils/error_boundary.py",
                            "tests/unit/test_error_boundary.py",
                          ],
                        },
                        {
                          id: "st-3",
                          title: "Run unit test suite for retry & error boundary",
                          description: "Verify exponential backoff and structured error responses",
                        },
                      ],
                      files: [
                        {
                          path: "src/utils/error_boundary.py",
                          content:
                            "def with_error_boundary(fn):\n    return fn\n",
                        },
                        {
                          path: "tests/unit/test_error_boundary.py",
                          content:
                            "from src.utils.error_boundary import with_error_boundary\n\ndef test_boundary():\n    assert callable(with_error_boundary)\n",
                        },
                      ],
                    },
                  )}\n\`\`\``,
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const created = createTaskForProject(project.id, {
      title: "Modularize HR linked Service & Error Handling Layer",
      description: "Extract reusable retry and error boundaries",
    });

    startTaskExecution(project.id, created.id);
    await vi.advanceTimersByTimeAsync(
      getStageDwellTime("queue") +
        getStageDwellTime("in_progress") +
        getStageDwellTime("ai_review") +
        150,
    );

    const specsPath = resolveSpecsDir(project);
    const specFolder = path.join(specsPath, created.id);
    const finalTask = buildTask(specFolder, project.id);

    expect(finalTask.status).toBe("human_review");
    expect(finalTask.subtasks[0].title).toBe(
      "Audit service exception handling in src/core and src/web",
    );
    expect(finalTask.subtasks[1].title).toBe(
      "Implement structured retry & error boundary module",
    );
    const diffPaths = finalTask.fileDiffs.map((d: any) => d.path);
    expect(diffPaths).toEqual([
      "src/utils/error_boundary.py",
      "tests/unit/test_error_boundary.py",
    ]);
  });

  it("computes accurate worktree file diffs and excludes unchanged base repo files in getWorktreeDiffForProject", async () => {
    fs.writeFileSync(
      path.join(tempProjectDir, "main.py"),
      'if __name__ == "__main__":\n    print("app")\n',
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tempProjectDir, "requirements.txt"),
      "fastapi>=0.110.0\nuvicorn>=0.29.0\n",
      "utf-8",
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        throw new Error("Local AI offline");
      }),
    );

    const created = createTaskForProject(project.id, {
      title: "Script to run environment on the localhost to test",
      description: "Create executable localhost environment runner script",
    });

    startTaskExecution(project.id, created.id);
    await vi.advanceTimersByTimeAsync(
      getStageDwellTime("queue") +
        getStageDwellTime("in_progress") +
        getStageDwellTime("ai_review") +
        150,
    );

    // Sync worktree source tree (copies main.py and requirements.txt + task scripts)
    const synced = ensureTaskSourceTreeForProject(project.id, created.id);
    expect(synced.success).toBe(true);

    // Also simulate a live edit to main.py inside the isolated worktree directory
    fs.writeFileSync(
      path.join(synced.worktreePath, "main.py"),
      'if __name__ == "__main__":\n    print("app-worktree-edited")\n',
      "utf-8",
    );

    const wtList = listWorktreesForProject(project.id);
    const wtItem = wtList.worktrees.find(
      (w: any) => w.specName === created.id,
    );
    expect(wtItem).toBeDefined();
    expect(wtItem.filesChanged).toBe(2);

    const diffRes = getWorktreeDiffForProject(project.id, created.id);
    expect(diffRes.success).toBe(true);
    const diffFilePaths = diffRes.files.map((f: any) => f.file);

    // Should include the 2 created shell scripts AND the modified main.py,
    // while excluding unchanged requirements.txt and TASK_SOURCE_TREE.md!
    expect(diffFilePaths).toContain("scripts/run-local-test.sh");
    expect(diffFilePaths).toContain("run-local.sh");
    expect(diffFilePaths).toContain("main.py");
    expect(diffFilePaths).not.toContain("requirements.txt");
    expect(diffFilePaths).not.toContain("TASK_SOURCE_TREE.md");

    const mainDiff = diffRes.files.find((f: any) => f.file === "main.py");
    expect(mainDiff.status).toBe("modified");
    expect(mainDiff.oldContent).toContain('print("app")');
    expect(mainDiff.newContent).toContain('print("app-worktree-edited")');
    expect(mainDiff.unifiedDiff).toContain('-    print("app")');
    expect(mainDiff.unifiedDiff).toContain('+    print("app-worktree-edited")');
  });

  it("initializes portable Agent Skills (.github/skills/hrlinked-agent/SKILL.md & .agents/skills/hrlinked-agent/SKILL.md) with YAML frontmatter and cleans up bogus src/agent.py", async () => {
    fs.mkdirSync(path.join(tempProjectDir, "src", "browser"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tempProjectDir, "src", "browser", "browser_agent.py"),
      "class BrowserAgent:\n    pass\n",
      "utf-8",
    );

    const created = createTaskForProject(project.id, {
      title: "Add skill for agent",
      description: "int skill for agent",
    });

    // Simulate stale bogus src/agent.py created before the fix
    const bogusAgentPy = path.join(tempProjectDir, "src", "agent.py");
    fs.writeFileSync(
      bogusAgentPy,
      "class Agent:\n    def __init__(self, name: str, skill: int = 0):\n        self.name = name\n        self.skill = skill\n",
      "utf-8",
    );

    const specsPath = resolveSpecsDir(project);
    const specFolder = path.join(specsPath, created.id);
    const planPath = path.join(specFolder, "implementation_plan.json");
    const plan = JSON.parse(fs.readFileSync(planPath, "utf-8"));
    plan.fileDiffs = [
      {
        path: "src/agent.py",
        status: "created",
        oldContent: "",
        newContent: "class Agent:\n    pass\n",
      },
    ];
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), "utf-8");

    rejectTaskForProject(
      project.id,
      created.id,
      "hiện tại đang sai luôn mình muốn init dạng skill agent như trang này https://docs.github.com/en/copilot/concepts/customizations/agent-skills",
    );

    await vi.advanceTimersByTimeAsync(
      getStageDwellTime("queue") +
        getStageDwellTime("in_progress") +
        getStageDwellTime("ai_review") +
        150,
    );

    expect(fs.existsSync(bogusAgentPy)).toBe(false);

    const ghSkillPath = path.join(
      tempProjectDir,
      ".github",
      "skills",
      "hrlinked-agent",
      "SKILL.md",
    );
    const agySkillPath = path.join(
      tempProjectDir,
      ".agents",
      "skills",
      "hrlinked-agent",
      "SKILL.md",
    );
    expect(fs.existsSync(ghSkillPath)).toBe(true);
    expect(fs.existsSync(agySkillPath)).toBe(true);

    const skillContent = fs.readFileSync(ghSkillPath, "utf-8");
    expect(skillContent).toMatch(/^---\nname: hrlinked-agent\ndescription:/);
    expect(skillContent).toContain("bash scripts/run-local-test.sh --check");
    expect(skillContent).toContain(
      "https://docs.github.com/en/copilot/concepts/customizations/agent-skills",
    );
    expect(skillContent).not.toContain("verify_review_fix_");

    const finalTask = buildTask(specFolder, project.id);
    expect(finalTask.status).toBe("human_review");
    const diffPaths = finalTask.fileDiffs.map((d: any) => d.path);
    expect(diffPaths).toContain(".github/skills/hrlinked-agent/SKILL.md");
    expect(diffPaths).toContain(".agents/skills/hrlinked-agent/SKILL.md");
    expect(diffPaths).not.toContain("src/agent.py");
  });

  it("preserves AI-rewritten file content (fromAi) when rejected with a review comment instead of reverting to prevContent and appending verify_review_fix_N", async () => {
    fs.writeFileSync(
      path.join(tempProjectDir, "main.py"),
      'if __name__ == "__main__":\n    print("app")\n',
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tempProjectDir, "requirements.txt"),
      "aiohttp>=3.9.0\n",
      "utf-8",
    );

    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        callCount += 1;
        const codeContent =
          callCount === 1
            ? "class RetryPolicy:\n    def __init__(self, retries: int = 1):\n        self.retries = retries\n"
            : "class RetryPolicy:\n    def __init__(self, retries: int = 3, backoff_factor: float = 0.5):\n        self.retries = retries\n        self.backoff_factor = backoff_factor\n";
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary:
                      callCount === 1
                        ? "Created RetryPolicy class"
                        : "Updated RetryPolicy with exponential backoff_factor",
                    files: [
                      {
                        path: "src/utils/retry_policy.py",
                        content: codeContent,
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const created = createTaskForProject(project.id, {
      title: "Add Retry Policy Utility",
      description: "Implement configurable retry policy in src/utils/retry_policy.py",
    });

    startTaskExecution(project.id, created.id);
    await vi.advanceTimersByTimeAsync(
      getStageDwellTime("queue") +
        getStageDwellTime("in_progress") +
        getStageDwellTime("ai_review") +
        150,
    );

    rejectTaskForProject(
      project.id,
      created.id,
      "Please add backoff_factor parameter with default 0.5 to RetryPolicy",
    );

    await vi.advanceTimersByTimeAsync(
      getStageDwellTime("queue") +
        getStageDwellTime("in_progress") +
        getStageDwellTime("ai_review") +
        150,
    );

    const updatedDiskContent = fs.readFileSync(
      path.join(tempProjectDir, "src", "utils", "retry_policy.py"),
      "utf-8",
    );
    expect(updatedDiskContent).toContain("backoff_factor: float = 0.5");
    expect(updatedDiskContent).not.toContain("verify_review_fix_1");
  });

  it("mergeWorktreeForProject syncs modified/new worktree files to project.path, creates a real Git commit on main, and exposes mergedWorktrees + gitLog", async () => {
    fs.writeFileSync(
      path.join(tempProjectDir, "main.py"),
      'if __name__ == "__main__":\n    print("v1")\n',
      "utf-8",
    );

    const created = createTaskForProject(project.id, {
      title: "Add skill for agent",
      description: "init skill for agent",
    });

    startTaskExecution(project.id, created.id);
    await vi.advanceTimersByTimeAsync(
      getStageDwellTime("queue") +
        getStageDwellTime("in_progress") +
        getStageDwellTime("ai_review") +
        150,
    );

    const synced = ensureTaskSourceTreeForProject(project.id, created.id);
    expect(synced.success).toBe(true);

    // Edit main.py inside the isolated worktree folder
    fs.writeFileSync(
      path.join(synced.worktreePath, "main.py"),
      'if __name__ == "__main__":\n    print("v2-merged-from-worktree")\n',
      "utf-8",
    );

    const mergeRes = mergeWorktreeForProject(project.id, created.id);
    expect(mergeRes.success).toBe(true);
    expect(mergeRes.merged).toBe(true);
    expect(mergeRes.mergeCommitSha).toBeTruthy();
    expect(mergeRes.mergeCommitMessage).toContain(
      `Merge branch 'auto-claude/${created.id}' into main`,
    );

    // Verify worktree edit was copied back to project.path
    const mainPyOnRoot = fs.readFileSync(
      path.join(tempProjectDir, "main.py"),
      "utf-8",
    );
    expect(mainPyOnRoot).toContain('print("v2-merged-from-worktree")');

    // Verify listWorktreesForProject returns mergedWorktrees and gitLog
    const wtList = listWorktreesForProject(project.id);
    expect(
      wtList.worktrees.some((w: any) => w.specName === created.id),
    ).toBe(false);
    expect(Array.isArray(wtList.mergedWorktrees)).toBe(true);
    const mergedEntry = wtList.mergedWorktrees.find(
      (w: any) => w.specName === created.id,
    );
    expect(mergedEntry).toBeDefined();
    expect(mergedEntry.status).toBe("merged");
    expect(mergedEntry.mergeCommitSha).toBe(mergeRes.mergeCommitSha);

    expect(Array.isArray(wtList.gitLog)).toBe(true);
    expect(wtList.gitLog.length).toBeGreaterThanOrEqual(1);
    expect(wtList.gitLog[0].shortSha).toBe(mergeRes.mergeCommitSha);
    expect(wtList.gitLog[0].message).toContain(
      `Merge branch 'auto-claude/${created.id}' into main`,
    );

    // Verify Check Diff still works for the merged worktree
    const postMergeDiff = getWorktreeDiffForProject(project.id, created.id);
    expect(postMergeDiff.success).toBe(true);
    expect(postMergeDiff.files.length).toBeGreaterThanOrEqual(1);
  });

  it("scans recursive directory tree + existing SKILL.md files and generates Agent Skill Evaluation suite for 'tạo eval cho skill', cleaning up stale t_o_eval_cho_skill.py stubs", async () => {
    fs.mkdirSync(path.join(tempProjectDir, ".agents", "skills", "ticket-planner"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tempProjectDir, ".agents", "skills", "ticket-planner", "SKILL.md"),
      "---\nname: ticket-planner\ndescription: Decomposes tickets into structured subtasks.\n---\n# Skill Instructions\n## Purpose\nDecompose tickets.\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tempProjectDir, "main.py"),
      'if __name__ == "__main__":\n    print("hrlinked")\n',
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tempProjectDir, "requirements.txt"),
      "pytest>=8.0.0\n",
      "utf-8",
    );

    let capturedPrompt = "";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_input: any, init?: any) => {
        if (init?.body) {
          const parsedBody = JSON.parse(String(init.body));
          capturedPrompt = parsedBody?.messages?.[1]?.content || "";
        }
        // Simulate Local AI timeout / empty files fallback
        return new Response("Timeout", { status: 504 });
      }),
    );

    const created = createTaskForProject(project.id, {
      title: "tạo eval cho skill",
      description: "tạo eval cho skill",
    });

    // Simulate legacy bogus stub files from prior broken run
    const bogusPy = path.join(tempProjectDir, "src", "t_o_eval_cho_skill.py");
    const bogusTestPy = path.join(
      tempProjectDir,
      "tests",
      "test_t_o_eval_cho_skill.py",
    );
    fs.mkdirSync(path.dirname(bogusPy), { recursive: true });
    fs.mkdirSync(path.dirname(bogusTestPy), { recursive: true });
    fs.writeFileSync(
      bogusPy,
      'from typing import Any, Dict\n\ndef execute_task() -> Dict[str, Any]:\n    return {"status": "completed"}\n',
      "utf-8",
    );
    fs.writeFileSync(
      bogusTestPy,
      'from src.t_o_eval_cho_skill import execute_task\n\ndef test_execute_task():\n    assert execute_task()["status"] == "completed"\n',
      "utf-8",
    );

    const specsPath = resolveSpecsDir(project);
    const specFolder = path.join(specsPath, created.id);
    const planPath = path.join(specFolder, "implementation_plan.json");
    const plan = JSON.parse(fs.readFileSync(planPath, "utf-8"));
    plan.fileDiffs = [
      {
        path: "src/t_o_eval_cho_skill.py",
        status: "created",
        oldContent: "",
        newContent: fs.readFileSync(bogusPy, "utf-8"),
      },
      {
        path: "tests/test_t_o_eval_cho_skill.py",
        status: "created",
        oldContent: "",
        newContent: fs.readFileSync(bogusTestPy, "utf-8"),
      },
    ];
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), "utf-8");

    rejectTaskForProject(
      project.id,
      created.id,
      "i want to create eval to testing skill of agent on this projects",
    );

    await vi.advanceTimersByTimeAsync(
      getStageDwellTime("queue") +
        getStageDwellTime("in_progress") +
        getStageDwellTime("ai_review") +
        150,
    );

    // 1. Prompt sent to AI must include recursive directory tree and existing SKILL.md content
    expect(capturedPrompt).toContain(".agents/skills/ticket-planner/SKILL.md");
    expect(capturedPrompt).toContain("Decomposes tickets into structured subtasks.");

    // 2. Old bogus stub files must be deleted from disk and fileDiffs
    expect(fs.existsSync(bogusPy)).toBe(false);
    expect(fs.existsSync(bogusTestPy)).toBe(false);

    // 3. Only .agents/skills/evals/skill_evals.json is generated (no unwanted .py files)
    const evalJsonPath = path.join(
      tempProjectDir,
      ".agents",
      "skills",
      "evals",
      "skill_evals.json",
    );
    const evaluatorPyPath = path.join(
      tempProjectDir,
      "src",
      "core",
      "skill_evaluator.py",
    );
    const testEvalPyPath = path.join(
      tempProjectDir,
      "tests",
      "unit",
      "test_skill_evals.py",
    );

    expect(fs.existsSync(evalJsonPath)).toBe(true);
    expect(fs.existsSync(evaluatorPyPath)).toBe(false);
    expect(fs.existsSync(testEvalPyPath)).toBe(false);

    const evalSpec = JSON.parse(fs.readFileSync(evalJsonPath, "utf-8"));
    expect(evalSpec.skills_evaluated).toContain("ticket-planner");

    const finalTask = buildTask(specFolder, project.id);
    const diffPaths = finalTask.fileDiffs.map((d: any) => d.path);
    expect(diffPaths).toEqual([".agents/skills/evals/skill_evals.json"]);
  });

  it("deletes unwanted files from disk and fileDiffs when user comments 'not need this file'", async () => {
    const created = createTaskForProject(project.id, {
      title: "Build Payment Service",
      description: "Implement payment processing module",
    });

    startTaskExecution(project.id, created.id);
    await vi.advanceTimersByTimeAsync(
      getStageDwellTime("queue") +
        getStageDwellTime("in_progress") +
        getStageDwellTime("ai_review") +
        150,
    );

    const specsPath = resolveSpecsDir(project);
    const specFolder = path.join(specsPath, created.id);
    let task = buildTask(specFolder, project.id);
    expect(task.fileDiffs.length).toBe(2);

    const unwantedTestFile = "tests/build-payment-service.test.ts";
    expect(fs.existsSync(path.join(tempProjectDir, unwantedTestFile))).toBe(true);

    rejectTaskForProject(
      project.id,
      created.id,
      `[File: ${unwantedTestFile}] not need this file`,
    );

    await vi.advanceTimersByTimeAsync(
      getStageDwellTime("queue") +
        getStageDwellTime("in_progress") +
        getStageDwellTime("ai_review") +
        150,
    );

    expect(fs.existsSync(path.join(tempProjectDir, unwantedTestFile))).toBe(false);
    task = buildTask(specFolder, project.id);
    const remainingPaths = task.fileDiffs.map((d: any) => d.path);
    expect(remainingPaths).not.toContain(unwantedTestFile);
    expect(remainingPaths).toContain("src/payment-service.ts");
  });

  it("generates verified init-dev.sh for multi-submodule .NET Aspire + Angular (:wc) + integrate-web projects, rejects hallucinated AI paths, and cleans up stale Python scripts", async () => {
    fs.writeFileSync(
      path.join(tempProjectDir, ".gitmodules"),
      `[submodule "backend"]
	path = backend
	url = https://dev.azure.com/org/proj/_git/integrale-resource-apis
	branch = main
[submodule "frontend"]
	path = frontend
	url = https://dev.azure.com/org/proj/_git/integrale-resource-portal-remote
	branch = main
[submodule "e2e"]
	path = e2e
	url = https://dev.azure.com/org/proj/_git/integrale-resource-e2e
	branch = develop
[submodule "integrale-web"]
	path = integrale-web
	url = https://dev.azure.com/org/proj/_git/IntegraleWebPortal
	branch = master
`,
      "utf-8",
    );

    const aspireDir = path.join(
      tempProjectDir,
      "backend",
      "aspire",
      "Integrale.Resource.AppHost",
    );
    fs.mkdirSync(aspireDir, { recursive: true });
    fs.writeFileSync(
      path.join(aspireDir, "Integrale.Resource.AppHost.csproj"),
      "<Project Sdk=\"Microsoft.NET.Sdk\"></Project>\n",
      "utf-8",
    );

    const frontendDir = path.join(tempProjectDir, "frontend");
    fs.mkdirSync(frontendDir, { recursive: true });
    fs.writeFileSync(
      path.join(frontendDir, "package.json"),
      JSON.stringify(
        {
          name: "resource-portal",
          scripts: {
            start: "ng serve",
            "start:wc": "ng run resource-portal:serve-wc:development --port 4400",
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const integrateWebDir = path.join(tempProjectDir, "integrale-web");
    fs.mkdirSync(integrateWebDir, { recursive: true });
    fs.writeFileSync(
      path.join(integrateWebDir, "package.json"),
      JSON.stringify(
        {
          name: "integrale-portal",
          scripts: {
            start: "npx nx serve integraleWebPortal",
            "build:shared": "npx nx run-many --target=build",
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const docsDir = path.join(tempProjectDir, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(
      path.join(docsDir, "TESTING_GUIDE.md"),
      `# Testing Guide\n| Username | Password |\n|---|---|\n| \`Nashtec_User_1\` | \`Iam@User\` |\n`,
      "utf-8",
    );

    // Pre-create a bogus Python scripts/run-local-test.sh from an old buggy run
    const bogusScriptDir = path.join(tempProjectDir, "scripts");
    fs.mkdirSync(bogusScriptDir, { recursive: true });
    const bogusRunnerPath = path.join(bogusScriptDir, "run-local-test.sh");
    fs.writeFileSync(
      bogusRunnerPath,
      '#!/usr/bin/env bash\nexec python3 "$PROJECT_ROOT/main.py"\n',
      "utf-8",
    );

    // Simulate Local AI returning hallucinated directories (`cd web-controls`, `cd integrated-web`, `# wc init-dev.sh`)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "Generated init-dev.sh script",
                  files: [
                    {
                      path: "init-dev.sh",
                      content:
                        "#!/usr/bin/env bash\n# wc init-dev.sh\ndotnet run --project aspire/Worldline.AppHost &\ncd web-controls && npm run start &\ncd integrated-web && npm run start &\n",
                    },
                  ],
                }),
              },
            },
          ],
        }),
      }),
    );

    const created = createTaskForProject(project.id, {
      title:
        "create the script init submodule to run all system on the local environemnt to development",
      description: `create the script following the step:
1. init all the submodules
2. dotnet run backend by .net aspire
3. npm run frontend folder with the web controls
4. npm run with the integrate web
5. run testing on https://localhost:4200 to check the system is working by using browser-use to login with the account in the test guide document.`,
    });

    rejectTaskForProject(
      project.id,
      created.id,
      "[File: init-dev.sh] it should start with the scrip is :wc",
    );

    await vi.advanceTimersByTimeAsync(
      getStageDwellTime("queue") +
        getStageDwellTime("in_progress") +
        getStageDwellTime("ai_review") +
        150,
    );

    // Stale Python runner must be removed
    expect(fs.existsSync(bogusRunnerPath)).toBe(false);

    const initDevPath = path.join(tempProjectDir, "init-dev.sh");
    expect(fs.existsSync(initDevPath)).toBe(true);
    const initDevContent = fs.readFileSync(initDevPath, "utf-8");

    // Must use real discovered workspace paths, NOT hallucinated AI paths
    expect(initDevContent).toContain(
      "backend/aspire/Integrale.Resource.AppHost/Integrale.Resource.AppHost.csproj",
    );
    expect(initDevContent).toContain('FRONTEND_WC_SCRIPT="start:wc"');
    expect(initDevContent).toContain('INTEGRATE_WEB_DIR="integrale-web"');
    expect(initDevContent).toContain("Nashtec_User_1");
    expect(initDevContent).not.toContain("cd web-controls");
    expect(initDevContent).not.toContain("cd integrated-web");
    expect(initDevContent).not.toContain("# wc init-dev.sh");

    const specsPath = resolveSpecsDir(project);
    const specFolder = path.join(specsPath, created.id);
    const finalTask = buildTask(specFolder, project.id);
    expect(finalTask.status).toBe("human_review");
    expect(finalTask.qaReport.status).toBe("passed");
  });

  it("loops back from AI_REVIEW to Development (in_progress) when verification fails, fixes issues, and stops once verification passes", async () => {
    const created = createTaskForProject(project.id, {
      title: "Build Payment Service",
      description: "Implement payment processing module",
    });

    const verifyAttemptsSeen: number[] = [];
    startTaskExecution(project.id, created.id, "in_progress", {
      runVerifyInTest: true,
      customVerifyRunner: (attempt) => {
        verifyAttemptsSeen.push(attempt);
        if (attempt < 3) {
          return {
            status: "failed",
            issues: [
              {
                severity: "error",
                title: `init-dev.sh --check failed on attempt ${attempt}: missing start:wc script check`,
                file: "init-dev.sh",
              },
            ],
            summaryNote: `Attempt ${attempt} failed`,
          };
        }
        return {
          status: "passed",
          issues: [],
          summaryNote: `Attempt ${attempt} passed all checks`,
        };
      },
    });

    // Advance enough time for 3 Development + AI_REVIEW iterations
    await vi.advanceTimersByTimeAsync(
      (getStageDwellTime("in_progress") + getStageDwellTime("ai_review")) * 4 +
        1000,
    );

    expect(verifyAttemptsSeen).toEqual([1, 2, 3]);

    const specsPath = resolveSpecsDir(project);
    const specFolder = path.join(specsPath, created.id);
    const finalTask = buildTask(specFolder, project.id);
    expect(finalTask.status).toBe("human_review");
    expect(finalTask.reviewReason).toBe("completed");
    expect(finalTask.qaReport.status).toBe("passed");
    expect(finalTask.qaReport.iterations).toBe(3);
    expect(finalTask.qaReport.maxIterations).toBe(MAX_VERIFY_FIX_ITERATIONS);

    const progressLog = fs.readFileSync(
      path.join(specFolder, "build-progress.txt"),
      "utf-8",
    );
    expect(progressLog).toContain(
      "[AI_REVIEW] Verification FAILED on attempt 1/10 (1 issue(s)). Looping back to Development/Fix...",
    );
    expect(progressLog).toContain(
      "[IN_PROGRESS] Auto-Fix Attempt 2/10: Looping back from AI Review to Development/Fix",
    );
    expect(progressLog).toContain(
      "[AI_REVIEW] Attempt 3: Verification PASSED",
    );
  });

  it("caps the Development <-> AI_REVIEW verification loop at MAX_VERIFY_FIX_ITERATIONS (10) to prevent infinite loops", async () => {
    expect(MAX_VERIFY_FIX_ITERATIONS).toBe(10);

    const created = createTaskForProject(project.id, {
      title: "Build Unfixable Service",
      description: "Simulate persistent verification failure",
    });

    let totalVerifyCalls = 0;
    startTaskExecution(project.id, created.id, "in_progress", {
      runVerifyInTest: true,
      customVerifyRunner: (attempt) => {
        totalVerifyCalls = attempt;
        return {
          status: "failed",
          issues: [
            {
              severity: "error",
              title: `Persistent syntax/runtime error on attempt ${attempt}`,
              file: "init-dev.sh",
            },
          ],
          summaryNote: `Attempt ${attempt} failed`,
        };
      },
    });

    // Advance enough time for 12 iterations to ensure it stops strictly at 10
    await vi.advanceTimersByTimeAsync(
      (getStageDwellTime("in_progress") + getStageDwellTime("ai_review")) * 12 +
        3000,
    );

    expect(totalVerifyCalls).toBe(10);

    const specsPath = resolveSpecsDir(project);
    const specFolder = path.join(specsPath, created.id);
    const finalTask = buildTask(specFolder, project.id);
    expect(finalTask.status).toBe("human_review");
    expect(finalTask.reviewReason).toBe("errors");
    expect(finalTask.qaReport.status).toBe("failed");
    expect(finalTask.qaReport.iterations).toBe(10);
    expect(finalTask.qaReport.maxIterations).toBe(10);

    const progressLog = fs.readFileSync(
      path.join(specFolder, "build-progress.txt"),
      "utf-8",
    );
    expect(progressLog).toContain(
      "[AI_REVIEW] Reached max auto-fix iterations (10/10) with 1 remaining issue(s). Stopping retry loop.",
    );
  });
});
