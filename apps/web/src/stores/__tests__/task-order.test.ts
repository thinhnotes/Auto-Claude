import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useTaskStore, loadTasks, VALID_TRANSITIONS } from "../task-store";
import { apiClient } from "@/lib/data";
import type { Task, TaskStatus, TaskOrderState } from "@auto-claude/types";

function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${Math.random().toString(36).substring(2, 9)}`,
    specId: "spec-001",
    projectId: "project-test-1",
    title: "Sample Task",
    description: "Sample Description",
    status: "backlog",
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

describe("Task Order Store & Persistence (Milestone 1)", () => {
  beforeEach(() => {
    // Reset Zustand store state before each test
    useTaskStore.setState({
      tasks: [],
      selectedTaskId: null,
      isLoading: false,
      error: null,
      taskOrder: null,
    });
    localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe("reorderTasksInColumn with empty initial order and populated orders", () => {
    it("initializes column order gracefully and reorders when taskOrder is initially empty/null", () => {
      const task1 = createMockTask({ id: "task-1", status: "backlog" });
      const task2 = createMockTask({ id: "task-2", status: "backlog" });
      const task3 = createMockTask({ id: "task-3", status: "backlog" });

      // Store has tasks in backlog, but taskOrder is null
      useTaskStore.setState({
        tasks: [task1, task2, task3],
        taskOrder: null,
      });

      // Reordering task-1 to position of task-3 should initialize column order and reorder
      useTaskStore
        .getState()
        .reorderTasksInColumn("backlog", "task-1", "task-3");

      const order = useTaskStore.getState().taskOrder;
      expect(order).not.toBeNull();
      // task-1 moved to position of task-3: ['task-2', 'task-3', 'task-1']
      expect(order?.backlog).toEqual(["task-2", "task-3", "task-1"]);
    });

    it("initializes column order gracefully when taskOrder column array is empty", () => {
      const taskA = createMockTask({ id: "task-a", status: "queue" });
      const taskB = createMockTask({ id: "task-b", status: "queue" });

      // taskOrder exists but queue is empty []
      useTaskStore.setState({
        tasks: [taskA, taskB],
        taskOrder: {
          ...createEmptyTaskOrder(),
          queue: [],
        },
      });

      // Move task-b before task-a
      useTaskStore.getState().reorderTasksInColumn("queue", "task-b", "task-a");

      const order = useTaskStore.getState().taskOrder;
      expect(order?.queue).toEqual(["task-b", "task-a"]);
    });

    it("reorders tasks within a column when taskOrder is already populated", () => {
      useTaskStore.setState({
        taskOrder: {
          ...createEmptyTaskOrder(),
          backlog: ["task-1", "task-2", "task-3", "task-4"],
        },
      });

      // Move task-1 to position of task-3
      useTaskStore
        .getState()
        .reorderTasksInColumn("backlog", "task-1", "task-3");

      expect(useTaskStore.getState().taskOrder?.backlog).toEqual([
        "task-2",
        "task-3",
        "task-1",
        "task-4",
      ]);
    });

    it("moves task from later position to earlier position within column", () => {
      useTaskStore.setState({
        taskOrder: {
          ...createEmptyTaskOrder(),
          in_progress: ["task-1", "task-2", "task-3", "task-4"],
        },
      });

      // Move task-4 to position of task-2
      useTaskStore
        .getState()
        .reorderTasksInColumn("in_progress", "task-4", "task-2");

      expect(useTaskStore.getState().taskOrder?.in_progress).toEqual([
        "task-1",
        "task-4",
        "task-2",
        "task-3",
      ]);
    });

    it("does nothing if activeId or overId are not present in column", () => {
      const initialBacklog = ["task-1", "task-2", "task-3"];
      useTaskStore.setState({
        taskOrder: {
          ...createEmptyTaskOrder(),
          backlog: initialBacklog,
        },
      });

      useTaskStore
        .getState()
        .reorderTasksInColumn("backlog", "non-existent-id", "task-2");

      expect(useTaskStore.getState().taskOrder?.backlog).toEqual(initialBacklog);

      useTaskStore
        .getState()
        .reorderTasksInColumn("backlog", "task-1", "non-existent-id");

      expect(useTaskStore.getState().taskOrder?.backlog).toEqual(initialBacklog);
    });

    it("does nothing when activeId equals overId", () => {
      const initialBacklog = ["task-1", "task-2", "task-3"];
      useTaskStore.setState({
        taskOrder: {
          ...createEmptyTaskOrder(),
          backlog: initialBacklog,
        },
      });

      useTaskStore
        .getState()
        .reorderTasksInColumn("backlog", "task-2", "task-2");

      expect(useTaskStore.getState().taskOrder?.backlog).toEqual(initialBacklog);
    });
  });

  describe("moveTaskToColumnTop", () => {
    it("moves task from source column to the top of target column", () => {
      useTaskStore.setState({
        taskOrder: {
          ...createEmptyTaskOrder(),
          backlog: ["task-1", "task-2", "task-3"],
          in_progress: ["task-4", "task-5"],
        },
      });

      useTaskStore
        .getState()
        .moveTaskToColumnTop("task-2", "in_progress", "backlog");

      const order = useTaskStore.getState().taskOrder;
      // task-2 removed from backlog
      expect(order?.backlog).toEqual(["task-1", "task-3"]);
      // task-2 prepended to the top of in_progress
      expect(order?.in_progress).toEqual(["task-2", "task-4", "task-5"]);
    });

    it("moves task to top when source and target column are identical", () => {
      useTaskStore.setState({
        taskOrder: {
          ...createEmptyTaskOrder(),
          backlog: ["task-1", "task-2", "task-3"],
        },
      });

      // Move task-3 to top of backlog
      useTaskStore
        .getState()
        .moveTaskToColumnTop("task-3", "backlog", "backlog");

      expect(useTaskStore.getState().taskOrder?.backlog).toEqual([
        "task-3",
        "task-1",
        "task-2",
      ]);
    });

    it("handles moveTaskToColumnTop when sourceStatus is omitted", () => {
      useTaskStore.setState({
        taskOrder: {
          ...createEmptyTaskOrder(),
          queue: ["task-10", "task-20"],
        },
      });

      // Add new task to top of queue without sourceStatus
      useTaskStore.getState().moveTaskToColumnTop("task-new", "queue");

      expect(useTaskStore.getState().taskOrder?.queue).toEqual([
        "task-new",
        "task-10",
        "task-20",
      ]);
    });

    it("leaves other columns completely untouched during column-to-column moves", () => {
      useTaskStore.setState({
        taskOrder: {
          ...createEmptyTaskOrder(),
          backlog: ["b1", "b2"],
          queue: ["q1"],
          in_progress: ["ip1"],
          done: ["d1", "d2"],
        },
      });

      useTaskStore.getState().moveTaskToColumnTop("b2", "queue", "backlog");

      const order = useTaskStore.getState().taskOrder;
      expect(order?.backlog).toEqual(["b1"]);
      expect(order?.queue).toEqual(["b2", "q1"]);
      expect(order?.in_progress).toEqual(["ip1"]);
      expect(order?.done).toEqual(["d1", "d2"]);
    });
  });

  describe("Task Order Persistence and Retrieval", () => {
    it("saves task order to localStorage under project-scoped key and returns true", () => {
      const order: TaskOrderState = {
        ...createEmptyTaskOrder(),
        backlog: ["task-100", "task-200"],
        done: ["task-300"],
      };

      useTaskStore.setState({ taskOrder: order });

      const saved = useTaskStore.getState().saveTaskOrder("proj-xyz");
      expect(saved).toBe(true);

      const raw = localStorage.getItem("task-order-state-proj-xyz");
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw!)).toEqual(order);
    });

    it("returns false and does not write to localStorage when taskOrder is null", () => {
      useTaskStore.setState({ taskOrder: null });

      const saved = useTaskStore.getState().saveTaskOrder("proj-null");
      expect(saved).toBe(false);

      expect(localStorage.getItem("task-order-state-proj-null")).toBeNull();
    });

    it("loads task order from localStorage for specific project", () => {
      const storedOrder: TaskOrderState = {
        ...createEmptyTaskOrder(),
        in_progress: ["task-active-1", "task-active-2"],
      };

      localStorage.setItem(
        "task-order-state-proj-abc",
        JSON.stringify(storedOrder),
      );

      useTaskStore.getState().loadTaskOrder("proj-abc");

      expect(useTaskStore.getState().taskOrder).toEqual(storedOrder);
    });

    it("initializes empty task order when no prior order exists in localStorage", () => {
      useTaskStore.getState().loadTaskOrder("brand-new-project");

      expect(useTaskStore.getState().taskOrder).toEqual(createEmptyTaskOrder());
    });

    it("handles corrupted JSON in localStorage gracefully without throwing", () => {
      localStorage.setItem("task-order-state-corrupt-proj", "{invalid:json;,,");

      expect(() => {
        useTaskStore.getState().loadTaskOrder("corrupt-proj");
      }).not.toThrow();

      // Gracefully falls back to empty task order
      expect(useTaskStore.getState().taskOrder).toEqual(createEmptyTaskOrder());
    });

    it("isolates task orders between different projects", () => {
      const orderProj1: TaskOrderState = {
        ...createEmptyTaskOrder(),
        backlog: ["p1-task1"],
      };
      const orderProj2: TaskOrderState = {
        ...createEmptyTaskOrder(),
        backlog: ["p2-task9"],
      };

      localStorage.setItem(
        "task-order-state-proj-1",
        JSON.stringify(orderProj1),
      );
      localStorage.setItem(
        "task-order-state-proj-2",
        JSON.stringify(orderProj2),
      );

      useTaskStore.getState().loadTaskOrder("proj-1");
      expect(useTaskStore.getState().taskOrder?.backlog).toEqual(["p1-task1"]);

      useTaskStore.getState().loadTaskOrder("proj-2");
      expect(useTaskStore.getState().taskOrder?.backlog).toEqual(["p2-task9"]);
    });

    it("clears task order from localStorage and resets store state", () => {
      const order: TaskOrderState = {
        ...createEmptyTaskOrder(),
        backlog: ["t1", "t2"],
      };

      localStorage.setItem("task-order-state-proj-del", JSON.stringify(order));
      useTaskStore.setState({ taskOrder: order });

      useTaskStore.getState().clearTaskOrder("proj-del");

      expect(localStorage.getItem("task-order-state-proj-del")).toBeNull();
      expect(useTaskStore.getState().taskOrder).toEqual(createEmptyTaskOrder());
    });

    it("handles storage write errors gracefully when quota is exceeded", () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const originalSetItem = localStorage.setItem;

      localStorage.setItem = vi.fn(() => {
        throw new Error("QuotaExceededError");
      });

      useTaskStore.setState({
        taskOrder: createEmptyTaskOrder(),
      });

      // Must not throw exception
      let result = false;
      expect(() => {
        result = useTaskStore.getState().saveTaskOrder("proj-quota");
      }).not.toThrow();

      expect(result).toBe(false);

      localStorage.setItem = originalSetItem;
      consoleErrorSpy.mockRestore();
    });
  });

  describe("loadTasks background polling non-destructive loading", () => {
    it("sets isLoading: true on initial load when tasks array is empty", async () => {
      useTaskStore.setState({ tasks: [], isLoading: false });
      const getTasksSpy = vi.spyOn(apiClient, "getTasks").mockResolvedValueOnce({
        tasks: [createMockTask({ id: "t-init" })],
      } as any);

      const promise = loadTasks("proj-init");
      // Initially isLoading should be set to true
      expect(useTaskStore.getState().isLoading).toBe(true);

      await promise;
      expect(useTaskStore.getState().isLoading).toBe(false);
      expect(useTaskStore.getState().tasks).toHaveLength(1);
      getTasksSpy.mockRestore();
    });

    it("does NOT set isLoading: true during background polling when tasks array already has items", async () => {
      const existingTask = createMockTask({ id: "t-exist" });
      useTaskStore.setState({ tasks: [existingTask], isLoading: false });

      let isLoadingDuringCall = false;
      const getTasksSpy = vi.spyOn(apiClient, "getTasks").mockImplementation(async () => {
        isLoadingDuringCall = useTaskStore.getState().isLoading;
        return { tasks: [existingTask] } as any;
      });

      await loadTasks("proj-poll");
      expect(isLoadingDuringCall).toBe(false);
      expect(useTaskStore.getState().isLoading).toBe(false);
      getTasksSpy.mockRestore();
    });

    it("preserves current tasks on network error during background polling", async () => {
      const existingTask = createMockTask({ id: "t-preserve" });
      useTaskStore.setState({ tasks: [existingTask], isLoading: false });

      const getTasksSpy = vi.spyOn(apiClient, "getTasks").mockRejectedValueOnce(new TypeError("Failed to fetch"));

      await loadTasks("proj-err");
      expect(useTaskStore.getState().tasks).toEqual([existingTask]);
      expect(useTaskStore.getState().isLoading).toBe(false);
      getTasksSpy.mockRestore();
    });
  });

  describe("VALID_TRANSITIONS transition matrix", () => {
    it("allows pr_created to transition to all canonical columns", () => {
      expect(VALID_TRANSITIONS.pr_created).toContain("done");
      expect(VALID_TRANSITIONS.pr_created).toContain("backlog");
      expect(VALID_TRANSITIONS.pr_created).toContain("queue");
      expect(VALID_TRANSITIONS.pr_created).toContain("in_progress");
      expect(VALID_TRANSITIONS.pr_created).toContain("human_review");
      expect(VALID_TRANSITIONS.pr_created).toContain("ai_review");
    });

    it("allows error to transition to active and review columns", () => {
      expect(VALID_TRANSITIONS.error).toContain("in_progress");
      expect(VALID_TRANSITIONS.error).toContain("human_review");
      expect(VALID_TRANSITIONS.error).toContain("done");
      expect(VALID_TRANSITIONS.error).toContain("ai_review");
    });

    it("allows done to transition to ai_review and backlog", () => {
      expect(VALID_TRANSITIONS.done).toContain("ai_review");
      expect(VALID_TRANSITIONS.done).toContain("backlog");
    });
  });
});
