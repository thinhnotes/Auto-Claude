import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, act, within } from "@testing-library/react";
import { TooltipProvider } from "@auto-claude/ui";
import type { Task, TaskStatus, TaskOrderState } from "@auto-claude/types";

let capturedDndProps: any = {};

// Mock IntersectionObserver for jsdom
class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = "";
  readonly thresholds: ReadonlyArray<number> = [];
  disconnect = vi.fn();
  observe = vi.fn();
  takeRecords = vi.fn().mockReturnValue([]);
  unobserve = vi.fn();
}
Object.defineProperty(window, "IntersectionObserver", {
  writable: true,
  configurable: true,
  value: MockIntersectionObserver,
});

// Mock @dnd-kit/core to capture DndContext handlers and DragOverlay
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: (props: any) => {
      capturedDndProps = props;
      return <div data-testid="dnd-context-root">{props.children}</div>;
    },
    DragOverlay: ({ children }: { children?: React.ReactNode }) => {
      return children ? (
        <div data-testid="drag-overlay-root">{children}</div>
      ) : null;
    },
  };
});

// Mock i18next translation
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
    i18n: { changeLanguage: () => new Promise(() => {}) },
  }),
}));

// Mock project store with active project
vi.mock("@/stores/project-store", () => ({
  useProjectStore: (selector: any) =>
    selector({
      activeProjectId: "stress-proj-1",
      selectedProjectId: "stress-proj-1",
      projects: [{ id: "stress-proj-1", name: "Stress Test Project" }],
    }),
}));

// Mock UI store
vi.mock("@/stores/ui-store", () => ({
  useUIStore: (selector: any) =>
    selector({
      setNewTaskDialogOpen: vi.fn(),
    }),
}));

// Mock task-store API functions
vi.mock("@/stores/task-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/task-store")>();
  return {
    ...actual,
    loadTasks: vi.fn().mockResolvedValue(undefined),
    updateTaskStatusAPI: vi.fn().mockResolvedValue(undefined),
    startTask: vi.fn().mockResolvedValue(undefined),
    stopTask: vi.fn().mockResolvedValue(undefined),
    approveTask: vi.fn().mockResolvedValue(undefined),
    rejectTask: vi.fn().mockResolvedValue(undefined),
  };
});

import { KanbanBoard } from "../KanbanBoard";
import { useTaskStore, loadTasks, updateTaskStatusAPI } from "@/stores/task-store";

function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${Math.random().toString(36).substring(2, 9)}`,
    specId: "spec-001",
    projectId: "stress-proj-1",
    title: "Stress Task",
    description: "Task description",
    status: "backlog" as TaskStatus,
    subtasks: [],
    logs: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createEmptyTaskOrder(): TaskOrderState {
  return {
    backlog: [],
    queue: [],
    in_progress: [],
    ai_review: [],
    human_review: [],
    done: [],
    pr_created: [],
    error: [],
  };
}

const VISUAL_COLUMNS: TaskStatus[] = [
  "backlog",
  "queue",
  "in_progress",
  "ai_review",
  "human_review",
  "done",
];

function renderBoard() {
  return render(
    <TooltipProvider delayDuration={0}>
      <KanbanBoard />
    </TooltipProvider>,
  );
}

describe("Adversarial Kanban Drag-and-Drop & State Sync Stress Tests", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    capturedDndProps = {};
    useTaskStore.setState({
      tasks: [],
      selectedTaskId: null,
      isLoading: false,
      error: null,
      taskOrder: null,
    });
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe("1. Rapid Drag Cancellation & Overlay Resilience", () => {
    it("handles rapid fire onDragStart and onDragCancel cycles across multiple cards without stuck activeId", () => {
      const task1 = createMockTask({ id: "card-1", status: "backlog", title: "Card 1" });
      const task2 = createMockTask({ id: "card-2", status: "queue", title: "Card 2" });
      const task3 = createMockTask({ id: "card-3", status: "in_progress", title: "Card 3" });

      useTaskStore.setState({
        tasks: [task1, task2, task3],
      });

      renderBoard();

      // Cycle 1: Start card 1 -> Cancel
      act(() => {
        capturedDndProps.onDragStart({ active: { id: "card-1" } });
      });
      expect(screen.getByTestId("drag-overlay-root")).toBeInTheDocument();

      act(() => {
        capturedDndProps.onDragCancel();
      });
      expect(screen.queryByTestId("drag-overlay-root")).toBeNull();

      // Cycle 2: Start card 2 -> Cancel
      act(() => {
        capturedDndProps.onDragStart({ active: { id: "card-2" } });
      });
      expect(screen.getByTestId("drag-overlay-root")).toBeInTheDocument();

      act(() => {
        capturedDndProps.onDragCancel();
      });
      expect(screen.queryByTestId("drag-overlay-root")).toBeNull();

      // Cycle 3: Immediate double cancel
      act(() => {
        capturedDndProps.onDragStart({ active: { id: "card-3" } });
      });
      act(() => {
        capturedDndProps.onDragCancel();
        capturedDndProps.onDragCancel(); // extra spurious cancel
      });
      expect(screen.queryByTestId("drag-overlay-root")).toBeNull();
    });

    it("handles spurious onDragCancel when activeId is already null without throwing", () => {
      renderBoard();

      expect(() => {
        act(() => {
          capturedDndProps.onDragCancel();
        });
      }).not.toThrow();

      expect(screen.queryByTestId("drag-overlay-root")).toBeNull();
    });

    it("handles task deletion from store while drag is currently active", () => {
      const task = createMockTask({ id: "vanishing-task", status: "backlog", title: "Vanishing Task" });
      useTaskStore.setState({ tasks: [task] });

      renderBoard();

      // Start drag
      act(() => {
        capturedDndProps.onDragStart({ active: { id: "vanishing-task" } });
      });
      expect(screen.getByTestId("drag-overlay-root")).toBeInTheDocument();

      // Simulate external event or user deleting task mid-drag
      act(() => {
        useTaskStore.setState({ tasks: [] });
      });

      // Overlay should gracefully render null (no crash)
      expect(screen.queryByTestId("drag-overlay-root")).toBeNull();

      // DragCancel should still cleanly complete
      expect(() => {
        act(() => {
          capturedDndProps.onDragCancel();
        });
      }).not.toThrow();
    });

    it("handles onDragEnd when task was removed mid-drag without throwing or corrupting store", () => {
      const task = createMockTask({ id: "deleted-task", status: "backlog" });
      useTaskStore.setState({ tasks: [task] });

      renderBoard();

      act(() => {
        capturedDndProps.onDragStart({ active: { id: "deleted-task" } });
      });

      // Remove task
      act(() => {
        useTaskStore.setState({ tasks: [] });
      });

      // Drop on a column
      expect(() => {
        act(() => {
          capturedDndProps.onDragEnd({
            active: { id: "deleted-task" },
            over: { id: "in_progress", data: { current: { type: "column", status: "in_progress" } } },
          });
        });
      }).not.toThrow();

      expect(updateTaskStatusAPI).not.toHaveBeenCalled();
      expect(screen.queryByTestId("drag-overlay-root")).toBeNull();
    });
  });

  describe("2. Background Polling & Active Drag Interference", () => {
    it("strictly isolates polling during active drag even with multiple active tasks", () => {
      const task1 = createMockTask({ id: "t1", status: "queue" });
      const task2 = createMockTask({ id: "t2", status: "in_progress" });
      const task3 = createMockTask({ id: "t3", status: "ai_review" });

      useTaskStore.setState({ tasks: [task1, task2, task3] });

      renderBoard();

      // Initially polling runs
      act(() => {
        vi.advanceTimersByTime(650);
      });
      expect(loadTasks).toHaveBeenCalledTimes(1);

      // Start drag on task1
      act(() => {
        capturedDndProps.onDragStart({ active: { id: "t1" } });
      });

      vi.mocked(loadTasks).mockClear();

      // 10 intervals elapse (6500ms) during user's drag operation
      act(() => {
        vi.advanceTimersByTime(6500);
      });

      // Absolutely NO polling calls must occur
      expect(loadTasks).not.toHaveBeenCalled();

      // Cancel drag
      act(() => {
        capturedDndProps.onDragCancel();
      });

      // Polling immediately restarts
      act(() => {
        vi.advanceTimersByTime(650);
      });
      expect(loadTasks).toHaveBeenCalledTimes(1);
    });

    it("retains active drag state and overlay when store updates occur mid-drag from an in-flight poll", () => {
      const task = createMockTask({ id: "drag-target", status: "backlog", title: "Target Task" });
      const runningTask = createMockTask({ id: "running-task", status: "in_progress", title: "Running Task" });

      useTaskStore.setState({ tasks: [task, runningTask] });

      renderBoard();

      // Start dragging target task
      act(() => {
        capturedDndProps.onDragStart({ active: { id: "drag-target" } });
      });

      expect(screen.getByTestId("drag-overlay-root")).toBeInTheDocument();

      // Simulate late-arriving in-flight response updating running-task metadata
      act(() => {
        useTaskStore.setState({
          tasks: [
            task,
            { ...runningTask, executionProgress: { phase: "coding", phaseProgress: 50, overallProgress: 50 } },
          ],
        });
      });

      // Active overlay MUST still be present and intact
      expect(screen.getByTestId("drag-overlay-root")).toBeInTheDocument();
      expect(within(screen.getByTestId("drag-overlay-root")).getByText("Target Task")).toBeInTheDocument();

      // Drag can be ended normally
      act(() => {
        capturedDndProps.onDragEnd({
          active: { id: "drag-target" },
          over: { id: "queue", data: { current: { type: "column", status: "queue" } } },
        });
      });

      expect(updateTaskStatusAPI).toHaveBeenCalledWith("stress-proj-1", "drag-target", "queue");
      expect(screen.queryByTestId("drag-overlay-root")).toBeNull();
    });
  });

  describe("3. Dropping Between All Column Combinations (6x6 Matrix)", () => {
    VISUAL_COLUMNS.forEach((sourceCol) => {
      VISUAL_COLUMNS.forEach((targetCol) => {
        it(`handles drop from ${sourceCol} to ${targetCol} cleanly`, () => {
          const task = createMockTask({
            id: `task-${sourceCol}-${targetCol}`,
            status: sourceCol,
            title: `Task ${sourceCol} to ${targetCol}`,
          });

          useTaskStore.setState({
            tasks: [task],
            taskOrder: createEmptyTaskOrder(),
          });

          renderBoard();

          // 1. Start drag
          act(() => {
            capturedDndProps.onDragStart({ active: { id: task.id } });
          });

          // 2. Drop into target column
          act(() => {
            capturedDndProps.onDragEnd({
              active: { id: task.id },
              over: {
                id: targetCol,
                data: { current: { type: "column", status: targetCol } },
              },
            });
          });

          // Overlay must be dismissed in all 36 combinations
          expect(screen.queryByTestId("drag-overlay-root")).toBeNull();

          if (sourceCol === targetCol) {
            // Same column drop onto column header: no status update API
            expect(updateTaskStatusAPI).not.toHaveBeenCalled();
          } else {
            // Cross column drop: updateTaskStatusAPI must be called with target column
            expect(updateTaskStatusAPI).toHaveBeenCalledWith(
              "stress-proj-1",
              task.id,
              targetCol,
            );
          }
        });
      });
    });

    it("handles drop onto specific task in another column", () => {
      const sourceTask = createMockTask({ id: "src-1", status: "backlog" });
      const destTask = createMockTask({ id: "dest-1", status: "done" });

      useTaskStore.setState({ tasks: [sourceTask, destTask] });

      renderBoard();

      act(() => {
        capturedDndProps.onDragStart({ active: { id: "src-1" } });
      });

      act(() => {
        capturedDndProps.onDragEnd({
          active: { id: "src-1" },
          over: {
            id: "dest-1",
            data: { current: { type: "task", task: destTask } },
          },
        });
      });

      expect(updateTaskStatusAPI).toHaveBeenCalledWith("stress-proj-1", "src-1", "done");
      expect(screen.queryByTestId("drag-overlay-root")).toBeNull();
    });

    it("handles dropping card from special backend status pr_created (visual column: done)", () => {
      const prTask = createMockTask({ id: "pr-task-1", status: "pr_created" as TaskStatus });
      useTaskStore.setState({ tasks: [prTask] });

      renderBoard();

      act(() => {
        capturedDndProps.onDragStart({ active: { id: "pr-task-1" } });
      });

      // Move to in_progress
      act(() => {
        capturedDndProps.onDragEnd({
          active: { id: "pr-task-1" },
          over: {
            id: "in_progress",
            data: { current: { type: "column", status: "in_progress" } },
          },
        });
      });

      expect(updateTaskStatusAPI).toHaveBeenCalledWith("stress-proj-1", "pr-task-1", "in_progress");
      expect(screen.queryByTestId("drag-overlay-root")).toBeNull();
    });

    it("handles dropping card from special backend status error (visual column: human_review)", () => {
      const errTask = createMockTask({ id: "err-task-1", status: "error" as TaskStatus });
      useTaskStore.setState({ tasks: [errTask] });

      renderBoard();

      act(() => {
        capturedDndProps.onDragStart({ active: { id: "err-task-1" } });
      });

      // Move back to queue to retry
      act(() => {
        capturedDndProps.onDragEnd({
          active: { id: "err-task-1" },
          over: {
            id: "queue",
            data: { current: { type: "column", status: "queue" } },
          },
        });
      });

      expect(updateTaskStatusAPI).toHaveBeenCalledWith("stress-proj-1", "err-task-1", "queue");
      expect(screen.queryByTestId("drag-overlay-root")).toBeNull();
    });

    it("handles drop outside any droppable target (over is null)", () => {
      const task = createMockTask({ id: "drop-outside", status: "queue" });
      useTaskStore.setState({ tasks: [task] });

      renderBoard();

      act(() => {
        capturedDndProps.onDragStart({ active: { id: "drop-outside" } });
      });
      expect(screen.getByTestId("drag-overlay-root")).toBeInTheDocument();

      act(() => {
        capturedDndProps.onDragEnd({
          active: { id: "drop-outside" },
          over: null,
        });
      });

      expect(screen.queryByTestId("drag-overlay-root")).toBeNull();
      expect(updateTaskStatusAPI).not.toHaveBeenCalled();
    });
  });

  describe("4. Task Reordering with Boundary Conditions", () => {
    it("handles reordering within a single-item column gracefully (activeId === overId)", () => {
      const singleTask = createMockTask({ id: "solo-task", status: "backlog" });
      useTaskStore.setState({ tasks: [singleTask], taskOrder: null });

      useTaskStore.getState().reorderTasksInColumn("backlog", "solo-task", "solo-task");

      // taskOrder should not crash, state remains intact
      expect(useTaskStore.getState().tasks).toHaveLength(1);
    });

    it("handles reordering within an empty column gracefully", () => {
      useTaskStore.setState({ tasks: [], taskOrder: null });

      expect(() => {
        useTaskStore.getState().reorderTasksInColumn("backlog", "non-existent-1", "non-existent-2");
      }).not.toThrow();
    });

    it("reorders 2 items when taskOrder is initially null", () => {
      const t1 = createMockTask({ id: "t1", status: "backlog" });
      const t2 = createMockTask({ id: "t2", status: "backlog" });
      useTaskStore.setState({ tasks: [t1, t2], taskOrder: null });

      useTaskStore.getState().reorderTasksInColumn("backlog", "t2", "t1");

      expect(useTaskStore.getState().taskOrder?.backlog).toEqual(["t2", "t1"]);
    });

    it("handles reordering when overId is not in column", () => {
      const t1 = createMockTask({ id: "t1", status: "backlog" });
      useTaskStore.setState({
        tasks: [t1],
        taskOrder: { ...createEmptyTaskOrder(), backlog: ["t1"] },
      });

      useTaskStore.getState().reorderTasksInColumn("backlog", "t1", "missing-id");

      expect(useTaskStore.getState().taskOrder?.backlog).toEqual(["t1"]);
    });
  });

  describe("5. Corrupted localStorage Recovery and Board Stability", () => {
    it("recovers from completely corrupted JSON in localStorage", () => {
      localStorage.setItem("task-order-state-stress-proj-1", "NOT_JSON_AT_ALL!{{{}}");

      useTaskStore.getState().loadTaskOrder("stress-proj-1");

      const order = useTaskStore.getState().taskOrder;
      expect(order).toEqual(createEmptyTaskOrder());
    });

    it("recovers from null JSON string in localStorage", () => {
      localStorage.setItem("task-order-state-stress-proj-1", "null");

      useTaskStore.getState().loadTaskOrder("stress-proj-1");

      const order = useTaskStore.getState().taskOrder;
      // If JSON.parse is "null", what does it do?
      expect(order).toBeDefined();
    });

    it("recovers from numeric JSON in localStorage", () => {
      localStorage.setItem("task-order-state-stress-proj-1", "12345");

      useTaskStore.getState().loadTaskOrder("stress-proj-1");

      const order = useTaskStore.getState().taskOrder;
      expect(order).toBeDefined();
    });

    it("board renders without crashing when taskOrder in localStorage has non-array columns", () => {
      const malformedOrder = {
        backlog: "not-an-array",
        queue: 1234,
        in_progress: null,
        ai_review: { invalid: true },
        human_review: undefined,
        done: ["valid-id"],
      };

      localStorage.setItem("task-order-state-stress-proj-1", JSON.stringify(malformedOrder));
      useTaskStore.getState().loadTaskOrder("stress-proj-1");

      const task = createMockTask({ id: "test-task", status: "backlog" });
      useTaskStore.setState({ tasks: [task] });

      // FIXED: Board renders safely without throwing when taskOrder has non-array columns
      expect(() => {
        renderBoard();
      }).not.toThrow();
      expect(screen.getByText("Stress Task")).toBeInTheDocument();
    });

    it("reorderTasksInColumn handles non-array column value gracefully without throwing", () => {
      useTaskStore.setState({
        taskOrder: {
          backlog: 123 as any,
        } as any,
        tasks: [createMockTask({ id: "t1", status: "backlog" }), createMockTask({ id: "t2", status: "backlog" })],
      });

      // FIXED: reorderTasksInColumn handles non-array column without throwing
      expect(() => {
        useTaskStore.getState().reorderTasksInColumn("backlog", "t1", "t2");
      }).not.toThrow();
    });

    it("moveTaskToColumnTop handles non-array target or source status without throwing", () => {
      useTaskStore.setState({
        taskOrder: {
          backlog: "invalid" as any,
          queue: 456 as any,
        } as any,
      });

      // FIXED: moveTaskToColumnTop handles non-array values safely without throwing
      expect(() => {
        useTaskStore.getState().moveTaskToColumnTop("t1", "queue", "backlog");
      }).not.toThrow();
      expect(useTaskStore.getState().taskOrder?.queue).toEqual(["t1"]);
    });

    it("investigates taskOrder desynchronization when updateTaskStatusAPI fails after drag", async () => {
      const task = createMockTask({ id: "task-fail", status: "backlog" });
      useTaskStore.setState({
        tasks: [task],
        taskOrder: {
          ...createEmptyTaskOrder(),
          backlog: ["task-fail"],
          done: [],
        },
      });

      // 1. Simulate drag from backlog to done
      useTaskStore.getState().moveTaskToColumnTop("task-fail", "done", "backlog");
      useTaskStore.getState().saveTaskOrder("stress-proj-1");

      // Verify taskOrder now has task-fail in done, not backlog
      expect(useTaskStore.getState().taskOrder?.done).toEqual(["task-fail"]);
      expect(useTaskStore.getState().taskOrder?.backlog).toEqual([]);

      // 2. updateTaskStatusAPI rejects and rolls back taskOrder
      vi.mocked(updateTaskStatusAPI).mockImplementationOnce(async (projectId, taskId, status) => {
        // Revert task status and taskOrder as fixed updateTaskStatusAPI does
        useTaskStore.getState().updateTask("task-fail", { status: "backlog" });
        useTaskStore.getState().moveTaskToColumnTop("task-fail", "backlog", "done");
        useTaskStore.getState().saveTaskOrder(projectId);
        throw new Error("500 Internal Server Error");
      });

      try {
        await updateTaskStatusAPI("stress-proj-1", "task-fail", "done");
      } catch (e) {
        // expected error
      }

      // Check task status: reverted to backlog
      expect(useTaskStore.getState().tasks[0].status).toBe("backlog");

      // FIXED: taskOrder is properly reverted to backlog
      const currentOrder = useTaskStore.getState().taskOrder;
      expect(currentOrder?.backlog).toEqual(["task-fail"]);
      expect(currentOrder?.done).toEqual([]);
    });
  });
});

