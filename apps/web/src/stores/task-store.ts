import { create } from "zustand";
import type {
  Task,
  TaskStatus,
  TaskOrderState,
  ImplementationPlan,
  ExecutionProgress,
  ReviewReason,
} from "@auto-claude/types";
import { apiClient } from "@/lib/data";

/** Default max parallel tasks when no project setting is configured */
export const DEFAULT_MAX_PARALLEL_TASKS = 3;

export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  backlog: ["queue", "in_progress", "ai_review", "human_review", "done", "remove"],
  queue: ["in_progress", "backlog", "ai_review", "human_review", "done", "remove"],
  in_progress: ["ai_review", "human_review", "error", "backlog", "queue", "done", "remove"],
  ai_review: ["in_progress", "done", "human_review", "error", "queue", "backlog", "remove"],
  human_review: ["in_progress", "done", "backlog", "queue", "ai_review", "remove"],
  done: ["backlog", "queue", "in_progress", "human_review", "ai_review", "remove"],
  pr_created: ["done", "backlog", "queue", "in_progress", "human_review", "ai_review", "remove"],
  error: ["in_progress", "human_review", "backlog", "queue", "done", "ai_review", "remove"],
  remove: ["backlog", "queue", "in_progress", "ai_review", "human_review", "done"],
};

// localStorage key prefix for task order persistence
const TASK_ORDER_KEY_PREFIX = "task-order-state";

function getTaskOrderKey(projectId: string): string {
  return `${TASK_ORDER_KEY_PREFIX}-${projectId}`;
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
    remove: [],
  };
}

function getVisualColumn(status: TaskStatus): TaskStatus {
  if (status === "pr_created") return "done";
  if (status === "error") return "human_review";
  return status;
}

/**
 * Find task index by id or specId.
 */
function findTaskIndex(tasks: Task[], taskId: string): number {
  return tasks.findIndex((t) => t.id === taskId || t.specId === taskId);
}

/**
 * Task status change listeners for queue auto-promotion.
 * Stored outside the store to avoid triggering re-renders.
 */
const taskStatusChangeListeners = new Set<
  (taskId: string, oldStatus: TaskStatus | undefined, newStatus: TaskStatus) => void
>();

function notifyTaskStatusChange(
  taskId: string,
  oldStatus: TaskStatus | undefined,
  newStatus: TaskStatus,
): void {
  for (const listener of taskStatusChangeListeners) {
    try {
      listener(taskId, oldStatus, newStatus);
    } catch (error) {
      console.error("[TaskStore] Error in task status change listener:", error);
    }
  }
}

interface TaskState {
  tasks: Task[];
  selectedTaskId: string | null;
  isLoading: boolean;
  error: string | null;
  taskOrder: TaskOrderState | null;

  // Actions
  setTasks: (tasks: Task[]) => void;
  addTask: (task: Task) => void;
  updateTask: (taskId: string, updates: Partial<Task>) => void;
  updateTaskStatus: (
    taskId: string,
    status: TaskStatus,
    reviewReason?: ReviewReason,
  ) => void;
  updateTaskFromPlan: (taskId: string, plan: ImplementationPlan) => void;
  updateExecutionProgress: (
    taskId: string,
    progress: Partial<ExecutionProgress>,
  ) => void;
  appendLog: (taskId: string, log: string) => void;
  batchAppendLogs: (taskId: string, logs: string[]) => void;
  selectTask: (taskId: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearTasks: () => void;

  // Task order actions for kanban drag-and-drop reordering
  setTaskOrder: (order: TaskOrderState) => void;
  reorderTasksInColumn: (
    status: TaskStatus,
    activeId: string,
    overId: string,
  ) => void;
  moveTaskToColumnTop: (
    taskId: string,
    targetStatus: TaskStatus,
    sourceStatus?: TaskStatus,
  ) => void;
  loadTaskOrder: (projectId: string) => void;
  saveTaskOrder: (projectId: string) => boolean;
  clearTaskOrder: (projectId: string) => void;

  // Task status change listeners
  registerTaskStatusChangeListener: (
    listener: (
      taskId: string,
      oldStatus: TaskStatus | undefined,
      newStatus: TaskStatus,
    ) => void,
  ) => () => void;

  // Selectors
  getSelectedTask: () => Task | undefined;
  getTasksByStatus: (status: TaskStatus) => Task[];
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  selectedTaskId: null,
  isLoading: false,
  error: null,
  taskOrder: null,

  setTasks: (tasks) => set({ tasks }),

  addTask: (task) =>
    set((state) => ({ tasks: [...state.tasks, task] })),

  updateTask: (taskId, updates) =>
    set((state) => {
      const index = findTaskIndex(state.tasks, taskId);
      if (index === -1) return state;

      const oldTask = state.tasks[index];
      const newTask = { ...oldTask, ...updates };

      // Notify listeners if status changed
      if (updates.status && updates.status !== oldTask.status) {
        notifyTaskStatusChange(taskId, oldTask.status, updates.status);
      }

      const newTasks = [...state.tasks];
      newTasks[index] = newTask;
      return { tasks: newTasks };
    }),

  updateTaskStatus: (taskId, status, reviewReason) => {
    const state = get();
    const index = findTaskIndex(state.tasks, taskId);
    if (index === -1) return;

    const oldTask = state.tasks[index];
    const oldStatus = oldTask.status;

    // Validate transition
    if (!VALID_TRANSITIONS[oldStatus]?.includes(status)) {
      console.warn(
        `[TaskStore] Invalid transition: ${oldStatus} -> ${status}`,
      );
      return;
    }

    const updates: Partial<Task> = { status };
    if (status === "remove") {
      updates.fileDiffs = [];
    }
    if (reviewReason && status === "human_review") {
      updates.reviewReason = reviewReason;
    }
    if (status !== "human_review") {
      updates.reviewReason = undefined;
    }

    get().updateTask(taskId, updates);
  },

  updateTaskFromPlan: (taskId, plan) => {
    const state = get();
    const index = findTaskIndex(state.tasks, taskId);
    if (index === -1) return;

    const subtasks =
      plan.phases?.flatMap((phase) =>
        phase.subtasks.map((s) => ({
          id: s.id,
          title: s.description,
          description: s.description,
          status: s.status,
          files: [],
          verification: s.verification
            ? {
                type: s.verification.type as "command" | "browser",
                run: s.verification.run,
                scenario: s.verification.scenario,
              }
            : undefined,
        })),
      ) ?? [];

    get().updateTask(taskId, { subtasks });
  },

  updateExecutionProgress: (taskId, progress) =>
    set((state) => {
      const index = findTaskIndex(state.tasks, taskId);
      if (index === -1) return state;

      const task = state.tasks[index];
      const currentProgress = task.executionProgress ?? {
        phase: "idle" as const,
        phaseProgress: 0,
        overallProgress: 0,
      };

      // Sequence number check: reject stale updates
      if (
        progress.sequenceNumber !== undefined &&
        currentProgress.sequenceNumber !== undefined &&
        progress.sequenceNumber < currentProgress.sequenceNumber
      ) {
        return state;
      }

      const newTasks = [...state.tasks];
      newTasks[index] = {
        ...task,
        executionProgress: { ...currentProgress, ...progress },
      };
      return { tasks: newTasks };
    }),

  appendLog: (taskId, log) =>
    set((state) => {
      const index = findTaskIndex(state.tasks, taskId);
      if (index === -1) return state;

      const task = state.tasks[index];
      const newTasks = [...state.tasks];
      newTasks[index] = { ...task, logs: [...task.logs, log] };
      return { tasks: newTasks };
    }),

  batchAppendLogs: (taskId, logs) =>
    set((state) => {
      const index = findTaskIndex(state.tasks, taskId);
      if (index === -1) return state;

      const task = state.tasks[index];
      const newTasks = [...state.tasks];
      newTasks[index] = { ...task, logs: [...task.logs, ...logs] };
      return { tasks: newTasks };
    }),

  selectTask: (taskId) => set({ selectedTaskId: taskId }),

  setLoading: (loading) => set({ isLoading: loading }),

  setError: (error) => set({ error }),

  clearTasks: () => set({ tasks: [], selectedTaskId: null }),

  // Task order actions
  setTaskOrder: (order) => set({ taskOrder: order }),

  reorderTasksInColumn: (status, activeId, overId) =>
    set((state) => {
      if (activeId === overId) return state;
      const baseOrder = state.taskOrder ?? createEmptyTaskOrder();
      let column = Array.isArray(baseOrder[status])
        ? [...baseOrder[status]]
        : [];

      if (column.length === 0) {
        column = state.tasks
          .filter((t) => getVisualColumn(t.status) === status)
          .map((t) => t.id);
      } else {
        for (const id of [activeId, overId]) {
          if (!column.includes(id)) {
            const taskInCol = state.tasks.find(
              (t) => t.id === id && getVisualColumn(t.status) === status,
            );
            if (taskInCol) {
              column.push(id);
            }
          }
        }
      }

      const activeIndex = column.indexOf(activeId);
      const overIndex = column.indexOf(overId);
      if (activeIndex === -1 || overIndex === -1) return state;

      // Swap positions
      column.splice(activeIndex, 1);
      column.splice(overIndex, 0, activeId);

      return {
        taskOrder: { ...baseOrder, [status]: column },
      };
    }),

  moveTaskToColumnTop: (taskId, targetStatus, sourceStatus) =>
    set((state) => {
      const baseOrder = state.taskOrder ?? createEmptyTaskOrder();
      const newOrder: TaskOrderState = {
        ...createEmptyTaskOrder(),
        ...baseOrder,
      };

      // Remove from source column
      if (sourceStatus) {
        const srcCol = Array.isArray(newOrder[sourceStatus])
          ? newOrder[sourceStatus]
          : [];
        newOrder[sourceStatus] = srcCol.filter((id) => id !== taskId);
      }

      // Add to top of target column
      const tgtCol = Array.isArray(newOrder[targetStatus])
        ? newOrder[targetStatus]
        : [];
      newOrder[targetStatus] = [
        taskId,
        ...tgtCol.filter((id) => id !== taskId),
      ];

      return { taskOrder: newOrder };
    }),

  loadTaskOrder: (projectId) => {
    try {
      const raw = localStorage.getItem(getTaskOrderKey(projectId));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const empty = createEmptyTaskOrder();
          const sanitized: TaskOrderState = { ...empty };
          for (const key of Object.keys(empty) as (keyof TaskOrderState)[]) {
            if (Array.isArray(parsed[key])) {
              sanitized[key] = parsed[key].filter(
                (id: unknown): id is string => typeof id === "string",
              );
            }
          }
          set({ taskOrder: sanitized });
          return;
        }
      }
    } catch {
      // Fallback on corrupt JSON or storage error
    }
    set({ taskOrder: createEmptyTaskOrder() });
  },

  saveTaskOrder: (projectId) => {
    const { taskOrder } = get();
    if (!taskOrder) return false;
    try {
      localStorage.setItem(getTaskOrderKey(projectId), JSON.stringify(taskOrder));
      return true;
    } catch {
      return false;
    }
  },

  clearTaskOrder: (projectId) => {
    try {
      localStorage.removeItem(getTaskOrderKey(projectId));
    } catch {
      // Ignore
    }
    set({ taskOrder: createEmptyTaskOrder() });
  },

  registerTaskStatusChangeListener: (listener) => {
    taskStatusChangeListeners.add(listener);
    return () => {
      taskStatusChangeListeners.delete(listener);
    };
  },

  getSelectedTask: () => {
    const state = get();
    return state.tasks.find(
      (t) =>
        t.id === state.selectedTaskId || t.specId === state.selectedTaskId,
    );
  },

  getTasksByStatus: (status) => {
    return get().tasks.filter((t) => t.status === status);
  },
}));

/** Load tasks for a project from API */
export async function loadTasks(projectId: string) {
  // Only show full loading spinner on initial load when tasks array is empty
  if (useTaskStore.getState().tasks.length === 0) {
    useTaskStore.setState({ isLoading: true, error: null });
  }

  try {
    const result = await apiClient.getTasks(projectId);
    const rawTasks = (result as unknown as { tasks?: Task[]; data?: Task[] }).tasks
      ?? (result as unknown as { data?: Task[] }).data
      ?? [];
    const normalizedTasks = (Array.isArray(rawTasks) ? rawTasks : []).map((t) => ({
      ...t,
      subtasks: Array.isArray(t.subtasks) ? t.subtasks : [],
      logs: Array.isArray(t.logs) ? t.logs : [],
    }));
    useTaskStore.setState({
      tasks: normalizedTasks,
      isLoading: false,
    });

    // Only load task order from localStorage on initial load if not already populated in memory
    if (!useTaskStore.getState().taskOrder) {
      useTaskStore.getState().loadTaskOrder(projectId);
    }
  } catch (err) {
    // Network errors (backend not running) and timeouts → silent empty state.
    const isNetworkError =
      err instanceof TypeError ||
      (err instanceof Error && err.name === "AbortError");
    const currentTasks = useTaskStore.getState().tasks;
    useTaskStore.setState({
      // Do not clear already-loaded tasks on transient background polling failure
      tasks: currentTasks.length > 0 ? currentTasks : [],
      isLoading: false,
      error: isNetworkError
        ? null
        : err instanceof Error
          ? err.message
          : "Failed to load tasks",
    });
  }
}

/** Update task status via API with validation */
export async function updateTaskStatusAPI(
  projectId: string,
  taskId: string,
  status: TaskStatus,
  reviewReason?: ReviewReason,
) {
  const currentTask = useTaskStore
    .getState()
    .tasks.find((t) => t.id === taskId || t.specId === taskId);
  if (
    currentTask &&
    !VALID_TRANSITIONS[currentTask.status]?.includes(status)
  ) {
    console.warn(
      `[TaskStore] Invalid transition: ${currentTask.status} -> ${status}`,
    );
    return;
  }

  const previousStatus = currentTask?.status;

  // Optimistic update
  useTaskStore.getState().updateTaskStatus(taskId, status, reviewReason);

  try {
    await apiClient.updateTaskStatus(projectId, taskId, status);
  } catch (error) {
    // Revert on failure
    if (currentTask && previousStatus) {
      if (status === "remove") {
        useTaskStore.getState().addTask(currentTask);
      } else {
        useTaskStore
          .getState()
          .updateTask(taskId, { status: previousStatus });
      }

      // Rollback taskOrder on failure
      const sourceCol = getVisualColumn(previousStatus);
      const targetCol = getVisualColumn(status);

      if (sourceCol !== targetCol) {
        useTaskStore
          .getState()
          .moveTaskToColumnTop(taskId, sourceCol, targetCol);
        useTaskStore.getState().saveTaskOrder(projectId);
      }
    }
    console.error("[TaskStore] Failed to update task status:", error);
  }
}

/** Delete a task via API */
export async function deleteTask(projectId: string, taskId: string) {
  try {
    await apiClient.deleteTask(projectId, taskId);
    useTaskStore.setState((state) => ({
      tasks: state.tasks.filter((t) => t.id !== taskId && t.specId !== taskId),
      selectedTaskId:
        state.selectedTaskId === taskId ? null : state.selectedTaskId,
    }));
  } catch (error) {
    console.error("[TaskStore] Failed to delete task:", error);
  }
}

/** Start a task via API (transitions Backlog -> Queue -> In Progress -> AI Review -> Human Review) */
export async function startTask(
  projectId: string,
  taskId: string,
  options?: Record<string, unknown>,
) {
  // Optimistic transition to queue
  useTaskStore.getState().updateTask(taskId, {
    status: "queue",
    reviewReason: undefined,
    executionProgress: {
      phase: "planning",
      phaseProgress: 15,
      overallProgress: 15,
      message: "Queued — allocating Local AI agent worker...",
    },
  });
  try {
    const res = await apiClient.startTask(projectId, taskId, options);
    const updated =
      (res as unknown as { task?: Task; data?: Task })?.task ??
      (res as unknown as { data?: Task })?.data;
    if (updated && updated.id) {
      useTaskStore.getState().updateTask(taskId, {
        ...updated,
        subtasks: Array.isArray(updated.subtasks) ? updated.subtasks : [],
        logs: Array.isArray(updated.logs) ? updated.logs : [],
      });
    }
  } catch (error) {
    console.error("[TaskStore] Failed to start task:", error);
    throw error;
  }
}

/** Approve a task in Human Review -> moves to Done */
export async function approveTask(
  projectId: string,
  taskId: string,
  feedback?: string,
) {
  useTaskStore.getState().updateTask(taskId, {
    status: "done",
    reviewReason: undefined,
    executionProgress: {
      phase: "complete",
      phaseProgress: 100,
      overallProgress: 100,
      message: "Approved in Human Review — task completed.",
    },
  });
  try {
    const res = await apiClient.approveTask(projectId, taskId, feedback);
    const updated =
      (res as unknown as { task?: Task; data?: Task })?.task ??
      (res as unknown as { data?: Task })?.data;
    if (updated && updated.id) {
      useTaskStore.getState().updateTask(taskId, {
        ...updated,
        subtasks: Array.isArray(updated.subtasks) ? updated.subtasks : [],
        logs: Array.isArray(updated.logs) ? updated.logs : [],
      });
    }
  } catch (error) {
    console.error("[TaskStore] Failed to approve task:", error);
    throw error;
  }
}

/** Reject a task in Human Review -> restarts pipeline with feedback */
export async function rejectTask(
  projectId: string,
  taskId: string,
  feedback: string,
) {
  useTaskStore.getState().updateTask(taskId, {
    status: "queue",
    reviewReason: undefined,
    executionProgress: {
      phase: "planning",
      phaseProgress: 15,
      overallProgress: 15,
      message: "Re-queued with review feedback...",
    },
  });
  try {
    const res = await apiClient.rejectTask(projectId, taskId, feedback);
    const updated =
      (res as unknown as { task?: Task; data?: Task })?.task ??
      (res as unknown as { data?: Task })?.data;
    if (updated && updated.id) {
      useTaskStore.getState().updateTask(taskId, {
        ...updated,
        subtasks: Array.isArray(updated.subtasks) ? updated.subtasks : [],
        logs: Array.isArray(updated.logs) ? updated.logs : [],
      });
    }
  } catch (error) {
    console.error("[TaskStore] Failed to reject task:", error);
    throw error;
  }
}

/** Stop a task via API */
export async function stopTask(projectId: string, taskId: string) {
  useTaskStore.getState().updateTask(taskId, {
    status: "backlog",
    executionProgress: {
      phase: "idle",
      phaseProgress: 0,
      overallProgress: 0,
    },
  });
  try {
    await apiClient.stopTask(projectId, taskId);
  } catch (error) {
    console.error("[TaskStore] Failed to stop task:", error);
    throw error;
  }
}

/** Update entire feature/task details and optionally trigger a whole-feature AI check & fix */
export async function updateTaskDetails(
  projectId: string,
  taskId: string,
  updates: {
    title?: string;
    description?: string;
    status?: TaskStatus;
    instructions?: string;
    triggerAiFix?: boolean;
  },
): Promise<Task | undefined> {
  const optimisticUpdates: Partial<Task> = {};
  if (typeof updates.title === "string" && updates.title.trim()) {
    optimisticUpdates.title = updates.title.trim();
  }
  if (typeof updates.description === "string") {
    optimisticUpdates.description = updates.description;
  }
  if (updates.triggerAiFix) {
    optimisticUpdates.status = "queue";
    optimisticUpdates.reviewReason = undefined;
    optimisticUpdates.executionProgress = {
      phase: "planning",
      phaseProgress: 15,
      overallProgress: 15,
      message: "Queued — AI checking & fixing entire feature...",
    };
  }
  useTaskStore.getState().updateTask(taskId, optimisticUpdates);

  try {
    const res = await apiClient.updateTask(projectId, taskId, updates);
    const updated =
      (res as unknown as { task?: Task; data?: Task })?.task ??
      (res as unknown as { data?: Task })?.data;
    if (updated && updated.id) {
      const normalized: Task = {
        ...updated,
        subtasks: Array.isArray(updated.subtasks) ? updated.subtasks : [],
        logs: Array.isArray(updated.logs) ? updated.logs : [],
      };
      useTaskStore.getState().updateTask(taskId, normalized);
      return normalized;
    }
    return undefined;
  } catch (error) {
    console.error("[TaskStore] Failed to update task details:", error);
    throw error;
  }
}
