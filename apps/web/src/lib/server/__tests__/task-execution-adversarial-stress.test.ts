import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createOrUpdateProject,
  createTaskForProject,
  startTaskExecution,
  stopTaskExecution,
  approveTaskForProject,
  buildTask,
  updateTaskStatusForProject,
  resolveSpecsDir,
  getStageDwellTime,
  setTaskEngineDwellTimes,
} from "../task-engine";

describe("Adversarial Stress Test: Ticket Execution Lifecycle", () => {
  let tempProjectDir: string;
  let project: any;
  const originalStoreDir = process.env.AUTO_CLAUDE_STORE_DIR;

  beforeEach(() => {
    vi.useFakeTimers();
    tempProjectDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "aperant-adversarial-test-"),
    );
    process.env.AUTO_CLAUDE_STORE_DIR = path.join(tempProjectDir, ".store");
    project = createOrUpdateProject(
      tempProjectDir,
      "Adversarial Stress Test Project",
    );

    // Mock local AI completions endpoint to resolve immediately with valid payload
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
                      summary: "Stress test AI generation",
                      files: [
                        {
                          path: "src/stress-solution.ts",
                          content: "export const stressPassed = true;",
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

  // -------------------------------------------------------------------------
  // 1. Simultaneous and Repeated startTaskExecution
  // -------------------------------------------------------------------------
  it("Stress 1.1: Double simultaneous startTaskExecution does not skip intermediate steps", async () => {
    const created = createTaskForProject(project.id, {
      title: "Concurrent start test",
      description: "Calling startTaskExecution twice simultaneously",
    });
    const specsPath = resolveSpecsDir(project);
    const specFolder = path.join(specsPath, created.id);

    // Call startTaskExecution twice simultaneously
    const res1 = startTaskExecution(project.id, created.id);
    const res2 = startTaskExecution(project.id, created.id);

    expect(res1.status).toBe("queue");
    expect(res2.status).toBe("queue");
    expect(res2.executionProgress.sequenceNumber).toBe(1);

    const recordedStatuses: string[] = [res2.status];
    const recordedSequences: number[] = [res2.executionProgress.sequenceNumber];

    // Stage 1 -> Stage 2
    await vi.advanceTimersByTimeAsync(getStageDwellTime("queue") + 50);
    let t = buildTask(specFolder, project.id);
    recordedStatuses.push(t.status);
    recordedSequences.push(t.executionProgress.sequenceNumber);

    // Stage 2 -> Stage 3
    await vi.advanceTimersByTimeAsync(getStageDwellTime("in_progress") + 50);
    t = buildTask(specFolder, project.id);
    recordedStatuses.push(t.status);
    recordedSequences.push(t.executionProgress.sequenceNumber);

    // Stage 3 -> Stage 4
    await vi.advanceTimersByTimeAsync(getStageDwellTime("ai_review") + 50);
    t = buildTask(specFolder, project.id);
    recordedStatuses.push(t.status);
    recordedSequences.push(t.executionProgress.sequenceNumber);

    // Must strictly follow queue -> in_progress -> ai_review -> human_review
    expect(recordedStatuses).toEqual([
      "queue",
      "in_progress",
      "ai_review",
      "human_review",
    ]);
    expect(recordedSequences).toEqual([1, 2, 3, 4]);
  });

  it("Stress 1.2: ActiveRunners orphan race condition when startTaskExecution called twice with delay", async () => {
    const created = createTaskForProject(project.id, {
      title: "Runner orphan test",
      description: "Verify if runner 2 remains cancellable after runner 1 finally block",
    });
    const specsPath = resolveSpecsDir(project);
    const specFolder = path.join(specsPath, created.id);

    // Call 1 at t=0
    startTaskExecution(project.id, created.id);

    // Small delay (e.g. 500ms into 2500ms queue dwell)
    await vi.advanceTimersByTimeAsync(500);

    // Call 2 at t=500ms
    startTaskExecution(project.id, created.id);

    // Advance to t=2550ms (Runner 1 queue timer finishes and enters finally block)
    await vi.advanceTimersByTimeAsync(2050);

    // Now user stops execution or moves back to backlog at t=2550ms
    const stopped = stopTaskExecution(project.id, created.id);
    expect(stopped.status).toBe("backlog");
    expect(stopped.executionProgress.phase).toBe("idle");

    // Advance timers way beyond normal pipeline duration
    await vi.advanceTimersByTimeAsync(25000);

    // Invariant: The task MUST NOT be resurrected into human_review or in_progress by an orphaned Runner 2!
    const finalTask = buildTask(specFolder, project.id);
    expect(finalTask.status).toBe("backlog");
    expect(finalTask.executionProgress.phase).toBe("idle");
    expect(finalTask.status).not.toBe("human_review");
    expect(finalTask.status).not.toBe("in_progress");
  });

  it("Stress 1.3: Burst of 10 rapid startTaskExecution calls maintains bounded sequential states", async () => {
    const created = createTaskForProject(project.id, {
      title: "Burst start test",
      description: "10 rapid consecutive startTaskExecution invocations",
    });
    const specsPath = resolveSpecsDir(project);
    const specFolder = path.join(specsPath, created.id);

    // Rapid burst
    for (let i = 0; i < 10; i++) {
      startTaskExecution(project.id, created.id);
    }

    const initial = buildTask(specFolder, project.id);
    expect(initial.status).toBe("queue");
    expect(initial.executionProgress.sequenceNumber).toBe(1);

    // Advance through the pipeline
    await vi.advanceTimersByTimeAsync(
      getStageDwellTime("queue") +
        getStageDwellTime("in_progress") +
        getStageDwellTime("ai_review") +
        200,
    );

    const finalState = buildTask(specFolder, project.id);
    expect(finalState.status).toBe("human_review");
    expect(finalState.executionProgress.sequenceNumber).toBe(4);
    expect(finalState.progress).toBe("3/3");
  });

  // -------------------------------------------------------------------------
  // 2. Mid-Execution Cancellation & Column Changes
  // -------------------------------------------------------------------------
  it("Stress 2.1: Cancellation during Stage 1 (Queue) prevents transition to Stage 2", async () => {
    const created = createTaskForProject(project.id, {
      title: "Cancel during Queue",
      description: "Move to backlog during queue dwell",
    });
    const specsPath = resolveSpecsDir(project);
    const specFolder = path.join(specsPath, created.id);

    startTaskExecution(project.id, created.id);

    // Wait half of queue dwell time
    await vi.advanceTimersByTimeAsync(getStageDwellTime("queue") / 2);

    // Cancel to backlog
    updateTaskStatusForProject(project.id, created.id, "backlog");

    // Advance timers well beyond pipeline
    await vi.advanceTimersByTimeAsync(20000);

    const task = buildTask(specFolder, project.id);
    expect(task.status).toBe("backlog");
    expect(task.executionProgress.phase).toBe("idle");
    expect(task.status).not.toBe("in_progress");
    expect(task.status).not.toBe("human_review");
  });

  it("Stress 2.2: Cancellation during Stage 2 (In Progress) prevents transition to AI Review", async () => {
    const created = createTaskForProject(project.id, {
      title: "Cancel during In Progress",
      description: "Move to backlog during in_progress dwell",
    });
    const specsPath = resolveSpecsDir(project);
    const specFolder = path.join(specsPath, created.id);

    startTaskExecution(project.id, created.id);

    // Advance to Stage 2
    await vi.advanceTimersByTimeAsync(getStageDwellTime("queue") + 50);
    let task = buildTask(specFolder, project.id);
    expect(task.status).toBe("in_progress");

    // Wait 1 second into in_progress dwell
    await vi.advanceTimersByTimeAsync(1000);

    // Cancel to backlog
    updateTaskStatusForProject(project.id, created.id, "backlog");

    // Advance timers well beyond pipeline
    await vi.advanceTimersByTimeAsync(20000);

    task = buildTask(specFolder, project.id);
    expect(task.status).toBe("backlog");
    expect(task.executionProgress.phase).toBe("idle");
    expect(task.status).not.toBe("ai_review");
    expect(task.status).not.toBe("human_review");
  });

  it("Stress 2.3: Cancellation during Stage 3 (AI Review) prevents transition to Human Review", async () => {
    const created = createTaskForProject(project.id, {
      title: "Cancel during AI Review",
      description: "Move to backlog during ai_review dwell",
    });
    const specsPath = resolveSpecsDir(project);
    const specFolder = path.join(specsPath, created.id);

    startTaskExecution(project.id, created.id);

    // Advance to Stage 3
    await vi.advanceTimersByTimeAsync(
      getStageDwellTime("queue") + getStageDwellTime("in_progress") + 50,
    );
    let task = buildTask(specFolder, project.id);
    expect(task.status).toBe("ai_review");

    // Cancel to backlog
    updateTaskStatusForProject(project.id, created.id, "backlog");

    // Advance timers well beyond pipeline
    await vi.advanceTimersByTimeAsync(20000);

    task = buildTask(specFolder, project.id);
    expect(task.status).toBe("backlog");
    expect(task.executionProgress.phase).toBe("idle");
    expect(task.status).not.toBe("human_review");
  });

  it("Stress 2.4: Rapid start-cancel-restart cycling converges cleanly to human_review", async () => {
    const created = createTaskForProject(project.id, {
      title: "Rapid cycle test",
      description: "Oscillating start, cancel, start, cancel, start",
    });
    const specsPath = resolveSpecsDir(project);
    const specFolder = path.join(specsPath, created.id);

    // Cycle 1
    startTaskExecution(project.id, created.id);
    await vi.advanceTimersByTimeAsync(500);
    updateTaskStatusForProject(project.id, created.id, "backlog");

    // Cycle 2
    startTaskExecution(project.id, created.id);
    await vi.advanceTimersByTimeAsync(1000);
    updateTaskStatusForProject(project.id, created.id, "backlog");

    // Cycle 3: Let it run to completion
    startTaskExecution(project.id, created.id);
    await vi.advanceTimersByTimeAsync(
      getStageDwellTime("queue") +
        getStageDwellTime("in_progress") +
        getStageDwellTime("ai_review") +
        200,
    );

    const finalState = buildTask(specFolder, project.id);
    expect(finalState.status).toBe("human_review");
    expect(finalState.executionProgress.sequenceNumber).toBe(4);
    expect(finalState.progress).toBe("3/3");
  });

  it("Stress 2.5: Calling approveTaskForProject mid-execution aborts background runner and does not revert to human_review", async () => {
    const created = createTaskForProject(project.id, {
      title: "Approve mid-execution test",
      description: "Approve while task is in queue or in_progress",
    });
    const specsPath = resolveSpecsDir(project);
    const specFolder = path.join(specsPath, created.id);

    startTaskExecution(project.id, created.id);

    // Advance 500ms into execution
    await vi.advanceTimersByTimeAsync(500);

    // User approves task early
    const approved = approveTaskForProject(project.id, created.id);
    expect(approved.status).toBe("done");

    // Advance timers well beyond entire pipeline duration
    await vi.advanceTimersByTimeAsync(25000);

    // Invariant: Task must remain done, must NOT be overwritten back to human_review or in_progress!
    const finalState = buildTask(specFolder, project.id);
    expect(finalState.status).toBe("done");
  });

  // -------------------------------------------------------------------------
  // 3. Monotonic Subtask Progressions
  // -------------------------------------------------------------------------
  it("Stress 3.1: Subtask completions are monotonically non-decreasing over time", async () => {
    const created = createTaskForProject(project.id, {
      title: "Subtask monotonicity test",
      description: "Sampling subtask status every 100ms across total duration",
    });
    const specsPath = resolveSpecsDir(project);
    const specFolder = path.join(specsPath, created.id);

    startTaskExecution(project.id, created.id);

    const totalDuration =
      getStageDwellTime("queue") +
      getStageDwellTime("in_progress") +
      getStageDwellTime("ai_review") +
      200;

    let previousCompletedCount = 0;
    const intervalMs = 100;

    for (let elapsed = 0; elapsed <= totalDuration; elapsed += intervalMs) {
      const task = buildTask(specFolder, project.id);
      const completedCount = task.subtasks.filter(
        (st: any) => st.status === "completed",
      ).length;

      // Invariant: completedCount must NEVER decrease
      expect(completedCount).toBeGreaterThanOrEqual(previousCompletedCount);
      previousCompletedCount = completedCount;

      // Invariant: At most one subtask can be in_progress at any time
      const inProgressCount = task.subtasks.filter(
        (st: any) => st.status === "in_progress",
      ).length;
      expect(inProgressCount).toBeLessThanOrEqual(1);

      await vi.advanceTimersByTimeAsync(intervalMs);
    }

    // Final state: all 3 completed
    expect(previousCompletedCount).toBe(3);
  });

  it("Stress 3.2: Subtask lifecycle strictly advances pending -> in_progress -> completed", async () => {
    const created = createTaskForProject(project.id, {
      title: "Subtask lifecycle order test",
      description: "Verify subtask individual state transition order",
    });
    const specsPath = resolveSpecsDir(project);
    const specFolder = path.join(specsPath, created.id);

    startTaskExecution(project.id, created.id);

    // Initial: subtask 0 is in_progress, 1 & 2 are pending
    let t = buildTask(specFolder, project.id);
    expect(t.subtasks[0].status).toBe("in_progress");
    expect(t.subtasks[1].status).toBe("pending");
    expect(t.subtasks[2].status).toBe("pending");

    // Stage 2: subtask 0 completed, 1 in_progress, 2 pending
    await vi.advanceTimersByTimeAsync(getStageDwellTime("queue") + 50);
    t = buildTask(specFolder, project.id);
    expect(t.subtasks[0].status).toBe("completed");
    expect(t.subtasks[1].status).toBe("in_progress");
    expect(t.subtasks[2].status).toBe("pending");

    // Stage 3: subtask 0 & 1 completed, 2 in_progress
    await vi.advanceTimersByTimeAsync(getStageDwellTime("in_progress") + 50);
    t = buildTask(specFolder, project.id);
    expect(t.subtasks[0].status).toBe("completed");
    expect(t.subtasks[1].status).toBe("completed");
    expect(t.subtasks[2].status).toBe("in_progress");

    // Stage 4: all completed
    await vi.advanceTimersByTimeAsync(getStageDwellTime("ai_review") + 50);
    t = buildTask(specFolder, project.id);
    expect(t.subtasks[0].status).toBe("completed");
    expect(t.subtasks[1].status).toBe("completed");
    expect(t.subtasks[2].status).toBe("completed");
  });

  // -------------------------------------------------------------------------
  // 4. Strictly Bounded and Sequential Phase Progress
  // -------------------------------------------------------------------------
  it("Stress 4.1: Phase and overall progress are bounded within [0, 100] and strictly sequential", async () => {
    const created = createTaskForProject(project.id, {
      title: "Phase bounding and sequence test",
      description: "Checking bounds [0, 100] and phase sequence order",
    });
    const specsPath = resolveSpecsDir(project);
    const specFolder = path.join(specsPath, created.id);

    startTaskExecution(project.id, created.id);

    const observedPhases: string[] = [];
    const observedSequences: number[] = [];
    const observedOverallProgress: number[] = [];
    const observedPhaseProgress: number[] = [];

    const sample = () => {
      const task = buildTask(specFolder, project.id);
      observedPhases.push(task.executionProgress.phase);
      observedSequences.push(task.executionProgress.sequenceNumber);
      observedOverallProgress.push(task.executionProgress.overallProgress);
      observedPhaseProgress.push(task.executionProgress.phaseProgress);

      // Bounds assertion
      expect(task.executionProgress.phaseProgress).toBeGreaterThanOrEqual(0);
      expect(task.executionProgress.phaseProgress).toBeLessThanOrEqual(100);
      expect(task.executionProgress.overallProgress).toBeGreaterThanOrEqual(0);
      expect(task.executionProgress.overallProgress).toBeLessThanOrEqual(100);
    };

    // Stage 1
    sample();

    // Stage 2
    await vi.advanceTimersByTimeAsync(getStageDwellTime("queue") + 50);
    sample();

    // Stage 3
    await vi.advanceTimersByTimeAsync(getStageDwellTime("in_progress") + 50);
    sample();

    // Stage 4
    await vi.advanceTimersByTimeAsync(getStageDwellTime("ai_review") + 50);
    sample();

    // Verify sequences
    expect(observedPhases).toEqual([
      "planning",
      "coding",
      "qa_review",
      "complete",
    ]);
    expect(observedSequences).toEqual([1, 2, 3, 4]);

    // Verify overall progress is monotonically increasing
    for (let i = 1; i < observedOverallProgress.length; i++) {
      expect(observedOverallProgress[i]).toBeGreaterThan(
        observedOverallProgress[i - 1],
      );
    }
    expect(observedOverallProgress).toEqual([15, 50, 85, 100]);
  });
});
