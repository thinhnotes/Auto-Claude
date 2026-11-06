"use client";

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import {
  Plus,
  Loader2,
  RefreshCw,
  Archive,
} from "lucide-react";
import { cn, Button, Tooltip, TooltipContent, TooltipTrigger } from "@auto-claude/ui";
import type { Task, TaskStatus } from "@auto-claude/types";
import {
  useTaskStore,
  loadTasks,
  updateTaskStatusAPI,
  deleteTask,
  startTask,
  stopTask,
  approveTask,
  rejectTask,
} from "@/stores/task-store";
import { useProjectStore } from "@/stores/project-store";
import { useUIStore } from "@/stores/ui-store";
import { useTerminalStore } from "@/stores/terminal-store";
import { apiClient } from "@/lib/data/api-client";
import {
  useKanbanSettingsStore,
  DEFAULT_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
} from "@/stores/kanban-settings-store";
import { KanbanColumn } from "./KanbanColumn";
import { TaskCard } from "./TaskCard";
import { TaskDetailModal } from "./TaskDetailModal";
import { AzureDevOpsModal } from "./AzureDevOpsModal";

const TASK_STATUS_COLUMNS: TaskStatus[] = [
  "backlog",
  "queue",
  "in_progress",
  "ai_review",
  "human_review",
  "done",
  "remove",
];

/**
 * Get the visual column for a task status.
 * pr_created → done, error → human_review
 */
function getVisualColumn(status: TaskStatus): TaskStatus {
  if (status === "pr_created") return "done";
  if (status === "error") return "human_review";
  return status;
}

/** Valid drop transitions */
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
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

export function KanbanBoard() {
  const { t } = useTranslation("kanban");
  const rawTasks = useTaskStore((s) => s.tasks);
  const tasks = Array.isArray(rawTasks) ? rawTasks : [];
  const isLoading = useTaskStore((s) => s.isLoading);
  const taskOrder = useTaskStore((s) => s.taskOrder);
  const reorderTasksInColumn = useTaskStore((s) => s.reorderTasksInColumn);
  const moveTaskToColumnTop = useTaskStore((s) => s.moveTaskToColumnTop);
  const saveTaskOrder = useTaskStore((s) => s.saveTaskOrder);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const selectedProjectId = useProjectStore((s) => s.selectedProjectId);
  const setNewTaskDialogOpen = useUIStore((s) => s.setNewTaskDialogOpen);

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [initialModalTab, setInitialModalTab] = useState<string>("overview");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isAzureDevOpsOpen, setIsAzureDevOpsOpen] = useState(false);

  // Resize state
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(DEFAULT_COLUMN_WIDTH);

  const currentProjectId = activeProjectId || selectedProjectId;

  // Kanban settings
  const columnPreferences = useKanbanSettingsStore((s) => s.columnPreferences);
  const setColumnWidth = useKanbanSettingsStore((s) => s.setColumnWidth);
  const toggleColumnCollapsed = useKanbanSettingsStore((s) => s.toggleColumnCollapsed);
  const initializePreferences = useKanbanSettingsStore((s) => s.initializePreferences);

  useEffect(() => {
    initializePreferences();
  }, [initializePreferences]);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Group tasks by visual column and sort according to taskOrder
  const tasksByStatus = useMemo(() => {
    const grouped: Record<string, Task[]> = {};
    for (const status of TASK_STATUS_COLUMNS) {
      grouped[status] = [];
    }
    for (const task of tasks) {
      if (!showArchived && task.metadata?.archivedAt) continue;
      const displayStatus = getVisualColumn(task.status);
      if (grouped[displayStatus]) {
        grouped[displayStatus].push(task);
      }
    }

    // Sort tasks within each column according to taskOrder
    for (const status of TASK_STATUS_COLUMNS) {
      const columnTasks = grouped[status] || [];
      const columnOrder = taskOrder?.[status];

      if (Array.isArray(columnOrder) && columnOrder.length > 0) {
        const currentTaskIds = new Set(columnTasks.map((t) => t.id));
        const validOrder = columnOrder.filter((id) => typeof id === "string" && currentTaskIds.has(id));
        const validOrderSet = new Set(validOrder);

        // Tasks recorded in taskOrder: sort by their index in validOrder
        const indexMap = new Map(validOrder.map((id, idx) => [id, idx]));
        const orderedTasks = columnTasks
          .filter((t) => validOrderSet.has(t.id))
          .sort(
            (a, b) =>
              (indexMap.get(a.id) ?? 0) - (indexMap.get(b.id) ?? 0),
          );

        // Tasks not yet recorded in taskOrder: append at bottom, newest first
        const unorderedTasks = columnTasks.filter((t) => !validOrderSet.has(t.id));
        unorderedTasks.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );

        grouped[status] = [...orderedTasks, ...unorderedTasks];
      } else {
        // Fallback: sort by createdAt descending (newest first)
        grouped[status].sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
      }
    }

    return grouped;
  }, [tasks, showArchived, taskOrder]);

  // Count archived tasks
  const archivedCount = useMemo(
    () => tasks.filter((t) => t.metadata?.archivedAt).length,
    [tasks],
  );

  // Active drag task
  const activeTask = useMemo(
    () => (activeId ? tasks.find((t) => t.id === activeId) : null),
    [activeId, tasks],
  );

  const handleRefresh = useCallback(async () => {
    if (!currentProjectId) return;
    setIsRefreshing(true);
    try {
      await loadTasks(currentProjectId);
    } finally {
      setIsRefreshing(false);
    }
  }, [currentProjectId]);

  // Drag handlers
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragOver = useCallback((_event: DragOverEvent) => {
    // Could highlight target column - handled by isOver in KanbanColumn
  }, []);

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over || !currentProjectId) return;

      const activeTaskId = active.id as string;
      const task = tasks.find((t) => t.id === activeTaskId);
      if (!task) return;

      const overData = over.data.current;
      const overId = over.id as string;

      // Determine target column
      let targetColumn: TaskStatus | null = null;

      if (overData?.type === "column") {
        targetColumn = overData.status as TaskStatus;
      } else if (overData?.type === "task") {
        // Dropped on a task - find which column it's in
        const overTask = tasks.find((t) => t.id === overId);
        if (overTask) {
          targetColumn = getVisualColumn(overTask.status);
        }
      } else {
        // overId might be a column id directly
        if (TASK_STATUS_COLUMNS.includes(overId as TaskStatus)) {
          targetColumn = overId as TaskStatus;
        }
      }

      if (!targetColumn) return;

      const sourceColumn = getVisualColumn(task.status);

      if (sourceColumn === targetColumn) {
        // Reorder within column
        if (overData?.type === "task" && overId !== activeTaskId) {
          reorderTasksInColumn(targetColumn, activeTaskId, overId);
          saveTaskOrder(currentProjectId);
        }
      } else {
        // Move to different column - validate transition using raw status or visual source column
        const validDestinations =
          VALID_TRANSITIONS[task.status] ??
          VALID_TRANSITIONS[sourceColumn] ??
          [];
        if (validDestinations.includes(targetColumn)) {
          moveTaskToColumnTop(activeTaskId, targetColumn, sourceColumn);
          saveTaskOrder(currentProjectId);
          updateTaskStatusAPI(currentProjectId, activeTaskId, targetColumn);
        }
      }
    },
    [tasks, currentProjectId, reorderTasksInColumn, moveTaskToColumnTop, saveTaskOrder],
  );

  // Status change handler
  const handleStatusChange = useCallback(
    (taskId: string, newStatus: TaskStatus) => {
      if (!currentProjectId) return;
      updateTaskStatusAPI(currentProjectId, taskId, newStatus);
    },
    [currentProjectId],
  );

  const handleStartTask = useCallback(
    (taskId: string) => {
      if (!currentProjectId) return;
      startTask(currentProjectId, taskId);
    },
    [currentProjectId],
  );

  const handleStopTask = useCallback(
    (taskId: string) => {
      if (!currentProjectId) return;
      stopTask(currentProjectId, taskId);
    },
    [currentProjectId],
  );

  const handleApproveTask = useCallback(
    (taskId: string, feedback?: string) => {
      if (!currentProjectId) return;
      void approveTask(currentProjectId, taskId, feedback);
    },
    [currentProjectId],
  );

  const handleRejectTask = useCallback(
    (taskId: string, feedback: string) => {
      if (!currentProjectId) return;
      void rejectTask(currentProjectId, taskId, feedback);
    },
    [currentProjectId],
  );

  const handleTaskClick = useCallback((task: Task) => {
    setInitialModalTab("overview");
    setSelectedTask(task);
  }, []);

  const handleOpenTaskTerminal = useCallback(
    (task: Task, mode: "modal" | "view" = "modal") => {
      const projId = currentProjectId || task.projectId;
      useTerminalStore.getState().openOrCreateTaskTerminal({
        id: task.id,
        title: task.title,
        projectId: projId,
        worktreePath: task.worktreePath,
      });
      if (projId) {
        apiClient
          .openTaskTerminal(projId, task.id, {
            sessionId: `term-task-${task.id}`,
            title: `Task: ${task.title}`,
          })
          .then((res) => {
            if (res?.worktreePath) {
              useTerminalStore
                .getState()
                .updateTerminal(`term-task-${task.id}`, {
                  cwd: res.worktreePath,
                  worktreePath: res.worktreePath,
                  associatedTaskId: task.id,
                  status: "running",
                });
            }
          })
          .catch(() => {});
      }

      if (mode === "view") {
        setSelectedTask(null);
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("auto-claude:open-task-terminal-view", {
              detail: { task },
            }),
          );
        }
        useUIStore.getState().setActiveView("terminals");
      } else {
        setInitialModalTab("terminal");
        setSelectedTask(task);
      }
    },
    [currentProjectId],
  );

  // Auto-poll tasks when any task is actively moving through the pipeline (queue, in_progress, ai_review)
  const hasRunningTask = useMemo(
    () =>
      tasks.some(
        (t) =>
          t.status === "queue" ||
          t.status === "in_progress" ||
          t.status === "ai_review",
      ),
    [tasks],
  );

  useEffect(() => {
    if (!currentProjectId || !hasRunningTask || activeId !== null) return;
    const interval = setInterval(() => {
      void loadTasks(currentProjectId);
    }, 650);
    return () => clearInterval(interval);
  }, [currentProjectId, hasRunningTask, activeId]);

  // Keep selectedTask synchronized with latest store updates
  const liveSelectedTask = useMemo(() => {
    if (!selectedTask) return null;
    return tasks.find((t) => t.id === selectedTask.id) ?? selectedTask;
  }, [selectedTask, tasks]);

  // Column resize handlers
  const handleResizeStart = useCallback(
    (column: string) => (startX: number) => {
      setResizingColumn(column);
      resizeStartX.current = startX;
      const pref = columnPreferences?.[column as keyof typeof columnPreferences];
      resizeStartWidth.current = pref?.width ?? DEFAULT_COLUMN_WIDTH;
    },
    [columnPreferences],
  );

  useEffect(() => {
    if (!resizingColumn) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartX.current;
      const newWidth = Math.max(
        MIN_COLUMN_WIDTH,
        Math.min(MAX_COLUMN_WIDTH, resizeStartWidth.current + delta),
      );
      setColumnWidth(resizingColumn as any, newWidth);
    };

    const handleMouseUp = () => {
      setResizingColumn(null);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizingColumn, setColumnWidth]);

  if (isLoading && tasks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <h1 className="text-lg font-semibold">{t("board.title")}</h1>
        <div className="flex items-center gap-2">
          {archivedCount > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors",
                    showArchived && "bg-accent text-foreground",
                  )}
                  onClick={() => setShowArchived(!showArchived)}
                >
                  <Archive className="h-3.5 w-3.5" />
                  {t("board.archived", "Archived")} ({archivedCount})
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {showArchived
                  ? t("board.hideArchived", "Hide archived")
                  : t("board.showArchived", "Show archived")}
              </TooltipContent>
            </Tooltip>
          )}
          <button
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")}
            />
            {t("board.refresh")}
          </button>
          <button
            data-testid="kanban-azure-devops-btn"
            className="flex items-center gap-1.5 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-sm font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-500/20 transition-colors"
            onClick={() => setIsAzureDevOpsOpen(true)}
          >
            <span>🔷</span>
            <span>Azure DevOps</span>
          </button>
          <button
            data-testid="kanban-new-task-btn"
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 transition-colors"
            onClick={() => setNewTaskDialogOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("board.newTask")}
          </button>
        </div>
      </div>

      {/* Columns with DnD */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex flex-1 overflow-x-auto p-4 gap-4">
          {TASK_STATUS_COLUMNS.map((status) => {
            const columnTasks = tasksByStatus[status] || [];
            const pref = columnPreferences?.[status as keyof typeof columnPreferences];

            return (
              <KanbanColumn
                key={status}
                status={status}
                tasks={columnTasks}
                onTaskClick={handleTaskClick}
                onStatusChange={handleStatusChange}
                onStart={handleStartTask}
                onStop={handleStopTask}
                onApprove={handleApproveTask}
                onReject={handleRejectTask}
                onOpenTerminal={handleOpenTaskTerminal}
                isOver={false}
                columnWidth={pref?.width ?? DEFAULT_COLUMN_WIDTH}
                isCollapsed={pref?.isCollapsed ?? false}
                onToggleCollapsed={() => toggleColumnCollapsed(status as any)}
                showArchived={showArchived}
                archivedCount={status === "done" ? archivedCount : 0}
                onToggleArchived={() => setShowArchived(!showArchived)}
                onResizeStart={handleResizeStart(status)}
              />
            );
          })}
        </div>

        {/* Drag overlay */}
        <DragOverlay>
          {activeTask ? (
            <div className="w-[280px] opacity-90 rotate-2 pointer-events-none select-none">
              <TaskCard
                task={activeTask}
                onClick={() => {}}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Task Detail Modal */}
      {liveSelectedTask && (
        <TaskDetailModal
          task={liveSelectedTask}
          initialTab={initialModalTab}
          onClose={() => {
            setSelectedTask(null);
            setInitialModalTab("overview");
          }}
          onStart={handleStartTask}
          onStop={handleStopTask}
          onApprove={handleApproveTask}
          onReject={handleRejectTask}
          onDelete={(taskId) => {
            if (currentProjectId) {
              void deleteTask(currentProjectId, taskId);
            }
          }}
          onOpenInTerminalsView={(t) => handleOpenTaskTerminal(t, "view")}
        />
      )}

      {/* Azure DevOps Work Items Modal */}
      {isAzureDevOpsOpen && currentProjectId && (
        <AzureDevOpsModal
          projectId={currentProjectId}
          onClose={() => setIsAzureDevOpsOpen(false)}
          onImported={() => {
            if (currentProjectId) {
              void loadTasks(currentProjectId);
            }
          }}
        />
      )}
    </div>
  );
}
