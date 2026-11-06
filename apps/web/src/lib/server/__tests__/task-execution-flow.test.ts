import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  loadStore,
  saveStore,
  createOrUpdateProject,
  createTaskForProject,
  listTasksForProject,
  startTaskExecution,
  stopTaskExecution,
  buildTask,
  updateTaskStatusForProject,
  resolveSpecsDir,
  getStageDwellTime,
  setTaskEngineDwellTimes,
} from "../task-engine";

describe("Sequential Ticket Execution Flow Engine (Milestone 1)", () => {
  let tempProjectDir: string;
  let project: any;
  const originalStoreDir = process.env.AUTO_CLAUDE_STORE_DIR;

  beforeEach(() => {
    vi.useFakeTimers();
    tempProjectDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "aperant-flow-test-"),
    );
    process.env.AUTO_CLAUDE_STORE_DIR = path.join(tempProjectDir, ".store");
    project = createOrUpdateProject(
      tempProjectDir,
      "Task Execution Flow Test Project",
    );

    // Mock local AI completions endpoint to resolve immediately
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
                        "Automated local AI code generation and verification",
                      files: [
                        {
                          path: "src/generated-solution.ts",
                          content: "export const solution = true;",
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

  it("transitions immediately to 'queue' status with 'planning' phase (sequence 1) upon calling startTaskExecution", () => {
    const created = createTaskForProject(project.id, {
      title: "Implement sequential lifecycle pipeline",
      description: "Ensure ticket transitions strictly through intermediate states",
    });
    expect(created.status).toBe("backlog");

    const started = startTaskExecution(project.id, created.id);

    // Immediate state assertions (Stage 1: Queue)
    expect(started.status).toBe("queue");
    expect(started.executionProgress).toBeDefined();
    expect(started.executionProgress.phase).toBe("planning");
    expect(started.executionProgress.phaseProgress).toBeGreaterThanOrEqual(15);
    expect(started.executionProgress.overallProgress).toBeGreaterThanOrEqual(15);
    expect(started.executionProgress.sequenceNumber).toBe(1);
    expect(started.executionProgress.currentSubtask).toBe("st-1");

    // Invariant: MUST NOT prematurely jump to approve/human_review or done
    expect(started.status).not.toBe("human_review");
    expect(started.status).not.toBe("done");
    expect(started.status).not.toBe("in_progress");
    expect(started.reviewReason).toBeUndefined();

    // Stage 1 contract requirements: subtask 1 is in_progress, others are pending
    expect(started.subtasks).toHaveLength(3);
    expect(started.subtasks[0].status).toBe("in_progress");
    expect(started.subtasks[1].status).toBe("pending");
    expect(started.subtasks[2].status).toBe("pending");
  });

  it("advances to 'in_progress' with 'coding' phase (sequence 2) after stage 1 delay and marks subtask 1 completed", async () => {
    const created = createTaskForProject(project.id, {
      title: "Build auth token refresh flow",
      description: "Handle expired token refresh with exponential backoff",
    });

    startTaskExecution(project.id, created.id);

    // Advance past Stage 1 delay
    await vi.advanceTimersByTimeAsync(getStageDwellTime("queue") + 50);

    const specsPath = resolveSpecsDir(project);
    const specFolder = path.join(specsPath, created.id);
    const task = buildTask(specFolder, project.id);

    // Stage 2: IN_PROGRESS assertions
    expect(task.status).toBe("in_progress");
    expect(task.executionProgress.phase).toBe("coding");
    expect(task.executionProgress.phaseProgress).toBe(55);
    expect(task.executionProgress.overallProgress).toBe(50);
    expect(task.executionProgress.sequenceNumber).toBe(2);
    expect(task.executionProgress.currentSubtask).toBe("st-2");

    // Subtask progress: Subtask 1 completed, Subtask 2 active
    expect(task.subtasks[0].status).toBe("completed");
    expect(task.subtasks[1].status).toBe("in_progress");
    expect(task.subtasks[2].status).toBe("pending");
  });

  it("advances to 'ai_review' with 'qa_review' phase (sequence 3) after stage 2 delay and generates qaReport", async () => {
    const created = createTaskForProject(project.id, {
      title: "Build automated test runner",
      description: "Execute Vitest test suites in isolated sandbox",
    });

    startTaskExecution(project.id, created.id);

    // Advance through Stage 1 + Stage 2
    await vi.advanceTimersByTimeAsync(
      getStageDwellTime("queue") + getStageDwellTime("in_progress") + 100,
    );

    const specsPath = resolveSpecsDir(project);
    const specFolder = path.join(specsPath, created.id);
    const task = buildTask(specFolder, project.id);

    // Stage 3: AI_REVIEW assertions
    expect(task.status).toBe("ai_review");
    expect(task.executionProgress.phase).toBe("qa_review");
    expect(task.executionProgress.phaseProgress).toBe(85);
    expect(task.executionProgress.overallProgress).toBe(85);
    expect(task.executionProgress.sequenceNumber).toBe(3);
    expect(task.executionProgress.currentSubtask).toBe("st-3");

    // Subtasks: Subtask 1 & 2 completed, Subtask 3 in_progress
    expect(task.subtasks[0].status).toBe("completed");
    expect(task.subtasks[1].status).toBe("completed");
    expect(task.subtasks[2].status).toBe("in_progress");

    // QA report passed
    expect(task.qaReport).toBeDefined();
    expect(task.qaReport.status).toBe("passed");
    expect(task.qaReport.issues).toEqual([]);
  });

  it("reaches 'human_review' (sequence 4) with reviewReason 'completed' only after all intermediate stages finish", async () => {
    const created = createTaskForProject(project.id, {
      title: "Deliver end-to-end payment gateway",
      description: "Stripe and PayPal integration with webhook listener",
    });

    startTaskExecution(project.id, created.id);

    // Advance through all stages
    await vi.advanceTimersByTimeAsync(
      getStageDwellTime("queue") +
        getStageDwellTime("in_progress") +
        getStageDwellTime("ai_review") +
        150,
    );

    const specsPath = resolveSpecsDir(project);
    const specFolder = path.join(specsPath, created.id);
    const task = buildTask(specFolder, project.id);

    // Stage 4: HUMAN_REVIEW assertions
    expect(task.status).toBe("human_review");
    expect(task.reviewReason).toBe("completed");
    expect(task.executionProgress.phase).toBe("complete");
    expect(task.executionProgress.sequenceNumber).toBe(4);
    expect(task.executionProgress.phaseProgress).toBe(100);
    expect(task.executionProgress.overallProgress).toBe(100);

    // All 3 subtasks MUST be completed
    expect(task.subtasks[0].status).toBe("completed");
    expect(task.subtasks[1].status).toBe("completed");
    expect(task.subtasks[2].status).toBe("completed");
    expect(task.progress).toBe("3/3");
  });

  it("strictly enforces full sequential progression: queue -> in_progress -> ai_review -> human_review without skipping", async () => {
    const created = createTaskForProject(project.id, {
      title: "Step-by-step pipeline progression verification",
      description: "Asserting every single state transition in order",
    });

    const recordedStatuses: string[] = [];
    const recordedPhases: string[] = [];
    const recordedSequences: number[] = [];

    const specsPath = resolveSpecsDir(project);
    const specFolder = path.join(specsPath, created.id);

    // Start
    const started = startTaskExecution(project.id, created.id);
    recordedStatuses.push(started.status);
    recordedPhases.push(started.executionProgress.phase);
    recordedSequences.push(started.executionProgress.sequenceNumber);

    // Advance to Stage 2
    await vi.advanceTimersByTimeAsync(getStageDwellTime("queue") + 50);
    let t = buildTask(specFolder, project.id);
    recordedStatuses.push(t.status);
    recordedPhases.push(t.executionProgress.phase);
    recordedSequences.push(t.executionProgress.sequenceNumber);

    // Advance to Stage 3
    await vi.advanceTimersByTimeAsync(getStageDwellTime("in_progress") + 50);
    t = buildTask(specFolder, project.id);
    recordedStatuses.push(t.status);
    recordedPhases.push(t.executionProgress.phase);
    recordedSequences.push(t.executionProgress.sequenceNumber);

    // Advance to Stage 4
    await vi.advanceTimersByTimeAsync(getStageDwellTime("ai_review") + 50);
    t = buildTask(specFolder, project.id);
    recordedStatuses.push(t.status);
    recordedPhases.push(t.executionProgress.phase);
    recordedSequences.push(t.executionProgress.sequenceNumber);

    // Strict sequential transitions verification
    expect(recordedStatuses).toEqual([
      "queue",
      "in_progress",
      "ai_review",
      "human_review",
    ]);

    expect(recordedSequences).toEqual([1, 2, 3, 4]);

    // intermediate steps MUST NOT be skipped
    expect(recordedStatuses).not.toContain("done");
    expect(recordedStatuses[0]).toBe("queue");
    expect(recordedStatuses[1]).toBe("in_progress");
    expect(recordedStatuses[2]).toBe("ai_review");
    expect(recordedStatuses[3]).toBe("human_review");
  });

  it("triggers sequential execution starting from Stage 1 Queue when moved via updateTaskStatusForProject", async () => {
    const task = createTaskForProject(project.id, {
      title: "Feature: Real-time Notifications",
      description: "WebSocket push notifications for order status",
    });
    expect(task.status).toBe("backlog");

    // Moving ticket to "queue" via Kanban drag-and-drop triggers execution
    const updated = updateTaskStatusForProject(project.id, task.id, "queue");
    expect(updated.status).toBe("queue");
    expect(updated.executionProgress.phase).toBe("planning");
    expect(updated.executionProgress.sequenceNumber).toBe(1);
    expect(updated.subtasks[0].status).toBe("in_progress");

    // Must advance through pipeline to human_review
    await vi.advanceTimersByTimeAsync(
      getStageDwellTime("queue") +
        getStageDwellTime("in_progress") +
        getStageDwellTime("ai_review") +
        150,
    );
    const finalState = buildTask(
      path.join(resolveSpecsDir(project), task.id),
      project.id,
    );
    expect(finalState.status).toBe("human_review");
    expect(finalState.reviewReason).toBe("completed");
  });

  it("triggers execution starting from Stage 2 In Progress when moved directly to in_progress", async () => {
    const task = createTaskForProject(project.id, {
      title: "Feature: Analytics Dashboard",
      description: "Visual charts for active user growth",
    });
    expect(task.status).toBe("backlog");

    // Moving ticket directly to "in_progress" via drag-and-drop starts at Stage 2
    const updated = updateTaskStatusForProject(
      project.id,
      task.id,
      "in_progress",
    );
    expect(updated.status).toBe("in_progress");
    expect(updated.executionProgress.phase).toBe("coding");
    expect(updated.executionProgress.sequenceNumber).toBe(2);
    expect(updated.subtasks[0].status).toBe("completed");
    expect(updated.subtasks[1].status).toBe("in_progress");

    // Continues through AI Review to Human Review
    await vi.advanceTimersByTimeAsync(
      getStageDwellTime("in_progress") + getStageDwellTime("ai_review") + 150,
    );
    const finalState = buildTask(
      path.join(resolveSpecsDir(project), task.id),
      project.id,
    );
    expect(finalState.status).toBe("human_review");
    expect(finalState.progress).toBe("3/3");
  });

  it("aborts execution runner cleanly when stopTaskExecution is invoked mid-pipeline", async () => {
    const created = createTaskForProject(project.id, {
      title: "Long running worker task",
      description: "Should be cancellable midway through coding phase",
    });

    startTaskExecution(project.id, created.id);

    // Advance to Stage 2 (in_progress)
    await vi.advanceTimersByTimeAsync(getStageDwellTime("queue") + 50);
    const specsPath = resolveSpecsDir(project);
    const specFolder = path.join(specsPath, created.id);
    let task = buildTask(specFolder, project.id);
    expect(task.status).toBe("in_progress");

    // Stop execution
    const stopped = stopTaskExecution(project.id, created.id);
    expect(stopped.status).toBe("backlog");
    expect(stopped.executionProgress.phase).toBe("idle");
    expect(stopped.executionProgress.overallProgress).toBe(0);

    // Advance timers way beyond normal pipeline duration
    await vi.advanceTimersByTimeAsync(20000);

    // Invariant: Task must remain in backlog and NOT progress to ai_review or human_review
    task = buildTask(specFolder, project.id);
    expect(task.status).toBe("backlog");
    expect(task.executionProgress.phase).toBe("idle");
  });

  it("aborts active background runner when task is moved to backlog via updateTaskStatusForProject", async () => {
    const task = createTaskForProject(project.id, {
      title: "Feature: Export to CSV",
      description: "Generate monthly transactional CSV reports",
    });

    startTaskExecution(project.id, task.id);

    // Immediately cancel / move back to backlog
    const cancelled = updateTaskStatusForProject(
      project.id,
      task.id,
      "backlog",
    );
    expect(cancelled.status).toBe("backlog");
    expect(cancelled.executionProgress.phase).toBe("idle");

    // Wait past total execution dwell
    await vi.advanceTimersByTimeAsync(20000);

    // Must remain in backlog, not overwritten by background timers
    const checkState = buildTask(
      path.join(resolveSpecsDir(project), task.id),
      project.id,
    );
    expect(checkState.status).toBe("backlog");
    expect(checkState.status).not.toBe("human_review");
    expect(checkState.status).not.toBe("ai_review");
  });

  it("resets subtask statuses and restarts sequence from 1 when restarted via startTaskExecution", async () => {
    const created = createTaskForProject(project.id, {
      title: "Re-executable task",
      description: "Subtasks should reset on startTaskExecution",
    });

    // Run to completion (human_review)
    startTaskExecution(project.id, created.id);
    await vi.advanceTimersByTimeAsync(
      getStageDwellTime("queue") +
        getStageDwellTime("in_progress") +
        getStageDwellTime("ai_review") +
        200,
    );

    const specsPath = resolveSpecsDir(project);
    const specFolder = path.join(specsPath, created.id);
    let task = buildTask(specFolder, project.id);
    expect(task.status).toBe("human_review");

    // Re-start execution: subtasks reset and enters queue (Stage 1)
    const restarted = startTaskExecution(project.id, created.id);
    expect(restarted.status).toBe("queue");
    expect(restarted.executionProgress.sequenceNumber).toBe(1);
    expect(restarted.executionProgress.phase).toBe("planning");
    expect(restarted.subtasks[0].status).toBe("in_progress");
    expect(restarted.subtasks[1].status).toBe("pending");
    expect(restarted.subtasks[2].status).toBe("pending");
  });

  it("supports dynamic N subtasks (e.g. 5 subtasks from AI) and progresses sequentially through each subtask", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: "Built 5-step Agent Skill Evaluation harness",
                    subtasks: [
                      {
                        id: "st-1",
                        title: "Define evaluation schema & rubric",
                        description: "Create JSON schema for skill eval cases",
                      },
                      {
                        id: "st-2",
                        title: "Implement dataset loader for skill prompts",
                        description: "Load benchmark test cases from tests/evals",
                      },
                      {
                        id: "st-3",
                        title: "Build LLM-as-a-Judge & deterministic scorers",
                        description: "Score tool invocation accuracy and output format",
                      },
                      {
                        id: "st-4",
                        title: "Create CLI evaluation runner & report generator",
                        description: "Output Markdown and JSON evaluation metrics",
                      },
                      {
                        id: "st-5",
                        title: "Run end-to-end skill evaluation test suite",
                        description: "Verify all eval cases pass threshold",
                      },
                    ],
                    files: [
                      {
                        path: "src/eval_runner.py",
                        content: "def run_eval():\n    return {'passed': True}\n",
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
      title: "Create evaluation framework for agent skills",
      description: "Build benchmark harness and metrics for testing skills",
    });

    startTaskExecution(project.id, created.id);
    const specsPath = resolveSpecsDir(project);
    const specFolder = path.join(specsPath, created.id);

    // Advance past Queue into In Progress (3 coding subtasks: st-2, st-3, st-4)
    const inProgressDwell = getStageDwellTime("in_progress");
    const stepDwell = Math.floor(inProgressDwell / 3);

    await vi.advanceTimersByTimeAsync(getStageDwellTime("queue") + 50);
    let task = buildTask(specFolder, project.id);
    expect(task.status).toBe("in_progress");
    expect(task.subtasks).toHaveLength(5);
    expect(task.subtasks[0].status).toBe("completed");
    expect(task.subtasks[1].status).toBe("in_progress");
    expect(task.subtasks[2].status).toBe("pending");
    expect(task.executionProgress.currentSubtask).toBe("st-2");

    // Advance one coding subtask step -> st-3 is in_progress
    await vi.advanceTimersByTimeAsync(stepDwell);
    task = buildTask(specFolder, project.id);
    expect(task.subtasks[1].status).toBe("completed");
    expect(task.subtasks[2].status).toBe("in_progress");
    expect(task.executionProgress.currentSubtask).toBe("st-3");

    // Advance second coding subtask step -> st-4 is in_progress
    await vi.advanceTimersByTimeAsync(stepDwell);
    task = buildTask(specFolder, project.id);
    expect(task.subtasks[2].status).toBe("completed");
    expect(task.subtasks[3].status).toBe("in_progress");
    expect(task.executionProgress.currentSubtask).toBe("st-4");

    // Advance into AI Review -> st-5 is in_progress
    await vi.advanceTimersByTimeAsync(stepDwell + 100);
    task = buildTask(specFolder, project.id);
    expect(task.status).toBe("ai_review");
    expect(task.subtasks[3].status).toBe("completed");
    expect(task.subtasks[4].status).toBe("in_progress");
    expect(task.executionProgress.currentSubtask).toBe("st-5");

    // Advance to Human Review -> all 5/5 completed
    await vi.advanceTimersByTimeAsync(getStageDwellTime("ai_review") + 100);
    task = buildTask(specFolder, project.id);
    expect(task.status).toBe("human_review");
    expect(task.subtasks).toHaveLength(5);
    expect(task.progress).toBe("5/5");
  });

  it("decomposes bullet-point task descriptions into dynamic subtasks immediately upon task creation", () => {
    const created = createTaskForProject(project.id, {
      title: "Multi-step Feature Implementation",
      description: [
        "- Design database schema for skill evaluation logs",
        "- Implement REST API endpoint POST /api/evals/run",
        "- Add Playwright E2E test for evaluation dashboard",
        "- Document CLI flags in README.md",
      ].join("\n"),
    });

    // 1 analysis subtask + 4 bullet subtasks + 1 final verification subtask = 6 subtasks
    expect(created.subtasks).toHaveLength(6);
    expect(created.subtasks[1].title).toContain(
      "Design database schema for skill evaluation logs",
    );
    expect(created.subtasks[4].title).toContain(
      "Document CLI flags in README.md",
    );
  });

  it("keeps task in the 'remove' column while cleaning up worktree and created project files when moved to 'remove' status", async () => {
    const created = createTaskForProject(project.id, {
      title: "Temporary spike task",
      description: "Experimental feature that is no longer needed",
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
    expect(fs.existsSync(specFolder)).toBe(true);

    const executedTask = buildTask(specFolder, project.id);
    const createdFiles = (executedTask.fileDiffs || []).map((d: any) => d.path);
    expect(createdFiles.length).toBeGreaterThan(0);
    const firstFileInProject = path.join(project.path, createdFiles[0]);
    expect(fs.existsSync(firstFileInProject)).toBe(true);

    // Move task status to "remove"
    const removedRes = updateTaskStatusForProject(project.id, created.id, "remove");
    expect(removedRes.status).toBe("remove");
    expect(removedRes.fileDiffs).toEqual([]);

    // Task-created files in project.path should be removed, while specFolder stays for the Remove column list
    expect(fs.existsSync(firstFileInProject)).toBe(false);
    expect(fs.existsSync(specFolder)).toBe(true);

    // Task should still appear in listTasksForProject under status "remove"
    const tasks = listTasksForProject(project.id);
    const listedTask = tasks.find((t: any) => t.id === created.id);
    expect(listedTask).toBeDefined();
    expect(listedTask.status).toBe("remove");
    expect(listedTask.fileDiffs).toEqual([]);
  });
});
