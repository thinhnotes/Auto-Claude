"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, TerminalSquare } from "lucide-react";
import type { Task } from "@auto-claude/types";
import { cn, Button } from "@auto-claude/ui";
import { useTerminalStore, type Terminal } from "@/stores/terminal-store";
import { useUIStore } from "@/stores/ui-store";
import { apiClient } from "@/lib/data/api-client";
import { TerminalHeader } from "./TerminalHeader";
import { VSCodeWebPanel } from "./VSCodeWebPanel";
import type { WorktreeConfig } from "./WorktreeSelector";

// Dynamic import of TerminalPanel — requires browser APIs (xterm, WebGL)
const TerminalPanel = dynamic(
  () =>
    import("@/components/terminal/TerminalPanel").then((m) => m.TerminalPanel),
  { ssr: false, loading: () => <div className="h-full w-full bg-[#0B0B0F]" /> },
);

// ---------------------------------------------------------------------------
// SortableTerminalWrapper
// ---------------------------------------------------------------------------

interface SortableTerminalWrapperProps {
  terminal: Terminal;
  tasks: Task[];
  projectId?: string;
  projectPath?: string;
  terminalCount: number;
  worktrees: WorktreeConfig[];
  worktreeConfig?: WorktreeConfig;
  onSelectWorktree: (terminalId: string, config: WorktreeConfig | undefined) => void;
  onCreateWorktree: (terminalId: string) => void;
  isExpanded: boolean;
  isHidden: boolean;
  onClose: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onNewTaskClick?: () => void;
}

function SortableTerminalWrapper({
  terminal,
  tasks,
  projectId,
  projectPath,
  terminalCount,
  worktrees,
  worktreeConfig,
  onSelectWorktree,
  onCreateWorktree,
  isExpanded,
  isHidden,
  onClose,
  onToggleExpand,
  onNewTaskClick,
}: SortableTerminalWrapperProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: terminal.id });

  const updateTerminal = useTerminalStore((s) => s.updateTerminal);
  const setAssociatedTask = useTerminalStore((s) => s.setAssociatedTask);
  const setActiveTerminal = useTerminalStore((s) => s.setActiveTerminal);
  const setClaudeMode = useTerminalStore((s) => s.setClaudeMode);
  const setAgyMode = useTerminalStore((s) => s.setAgyMode);
  const setVSCodeMode = useTerminalStore((s) => s.setVSCodeMode);
  const setTerminalStatus = useTerminalStore((s) => s.setTerminalStatus);

  const associatedTask = useMemo(
    () => tasks.find((t) => t.id === terminal.associatedTaskId),
    [tasks, terminal.associatedTaskId],
  );

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const effectiveCwd =
    (terminal.cwd && terminal.cwd !== "~" ? terminal.cwd : undefined) ||
    worktreeConfig?.path ||
    terminal.worktreePath ||
    associatedTask?.worktreePath ||
    projectPath;

  const resolvedWorktreeConfig: WorktreeConfig | undefined = useMemo(() => {
    if (worktreeConfig) return worktreeConfig;
    const wtPath = terminal.worktreePath || associatedTask?.worktreePath;
    if (wtPath) {
      const specName =
        associatedTask?.specId ||
        associatedTask?.id ||
        wtPath.split("/").filter(Boolean).pop() ||
        "worktree";
      return {
        name: specName,
        path: wtPath,
        branch: associatedTask?.worktreeBranch || `auto-claude/${specName}`,
      };
    }
    return undefined;
  }, [worktreeConfig, terminal.worktreePath, associatedTask]);

  const handleSelectTaskForTerminal = useCallback(
    (taskId: string) => {
      const selected = tasks.find((t) => t.id === taskId);
      const specName = selected?.specId || taskId;
      const fallbackWtPath = projectPath
        ? `${projectPath}/.auto-claude/worktrees/${specName}`
        : `.auto-claude/worktrees/${specName}`;
      const targetWtPath = selected?.worktreePath || fallbackWtPath;
      const targetBranch =
        selected?.worktreeBranch || `auto-claude/${specName}`;

      updateTerminal(terminal.id, {
        associatedTaskId: taskId,
        title: selected ? `Task: ${selected.title}` : terminal.title,
        cwd: targetWtPath,
        worktreePath: targetWtPath,
      });
      onSelectWorktree(terminal.id, {
        name: specName,
        path: targetWtPath,
        branch: targetBranch,
      });

      if (projectId) {
        apiClient
          .openTaskTerminal(projectId, taskId, {
            sessionId: terminal.id,
            title: selected ? `Task: ${selected.title}` : undefined,
          })
          .then((res) => {
            if (res?.worktreePath) {
              updateTerminal(terminal.id, {
                cwd: res.worktreePath,
                worktreePath: res.worktreePath,
                associatedTaskId: taskId,
              });
              onSelectWorktree(terminal.id, {
                name: res.specName || specName,
                path: res.worktreePath,
                branch: res.branch || targetBranch,
              });
            }
          })
          .catch(() => {});
      }
    },
    [
      tasks,
      projectPath,
      projectId,
      terminal.id,
      terminal.title,
      updateTerminal,
      onSelectWorktree,
    ],
  );

  const handleToggleClaudeMode = useCallback(() => {
    const next = !terminal.isClaudeMode;
    setClaudeMode(terminal.id, next);
    if (next && terminal.isAgyMode) {
      setAgyMode(terminal.id, false);
    }
    setTerminalStatus(
      terminal.id,
      next ? "claude-active" : terminal.isAgyMode ? "agy-active" : "running",
    );
  }, [
    terminal.id,
    terminal.isClaudeMode,
    terminal.isAgyMode,
    setClaudeMode,
    setAgyMode,
    setTerminalStatus,
  ]);

  const handleToggleAgyMode = useCallback(() => {
    const next = !terminal.isAgyMode;
    setAgyMode(terminal.id, next);
    if (next && terminal.isClaudeMode) {
      setClaudeMode(terminal.id, false);
    }
    setTerminalStatus(
      terminal.id,
      next ? "agy-active" : terminal.isClaudeMode ? "claude-active" : "running",
    );
  }, [
    terminal.id,
    terminal.isAgyMode,
    terminal.isClaudeMode,
    setAgyMode,
    setClaudeMode,
    setTerminalStatus,
  ]);

  const handleToggleVSCodeMode = useCallback(() => {
    const next = !terminal.isVSCodeMode;
    setVSCodeMode(terminal.id, next);
    if (next && !isExpanded && terminalCount > 1) {
      onToggleExpand(terminal.id);
    }
  }, [
    terminal.id,
    terminal.isVSCodeMode,
    isExpanded,
    terminalCount,
    setVSCodeMode,
    onToggleExpand,
  ]);

  const handleOpenVSCodeWebFromCwd = useCallback(
    (targetCwd: string) => {
      if (targetCwd && targetCwd !== "~") {
        updateTerminal(terminal.id, { cwd: targetCwd });
      }
      setVSCodeMode(terminal.id, true);
      if (!isExpanded && terminalCount > 1) {
        onToggleExpand(terminal.id);
      }
    },
    [
      terminal.id,
      isExpanded,
      terminalCount,
      updateTerminal,
      setVSCodeMode,
      onToggleExpand,
    ],
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`terminal-card-${terminal.id}`}
      className={cn(
        "flex flex-col rounded-lg border border-border/50 bg-card/20 overflow-hidden",
        "min-h-[260px]",
        isDragging && "opacity-50 z-50",
        isHidden && "hidden",
        isExpanded && "col-span-full row-span-full",
      )}
      onClick={() => setActiveTerminal(terminal.id)}
      {...attributes}
    >
      <TerminalHeader
        terminalId={terminal.id}
        title={terminal.title}
        status={terminal.status}
        isClaudeMode={terminal.isClaudeMode}
        isAgyMode={Boolean(terminal.isAgyMode)}
        isVSCodeMode={Boolean(terminal.isVSCodeMode)}
        vscodeUrl={terminal.vscodeUrl}
        tasks={tasks}
        associatedTask={associatedTask}
        onClose={() => onClose(terminal.id)}
        onTitleChange={(newTitle) =>
          updateTerminal(terminal.id, { title: newTitle })
        }
        onTaskSelect={handleSelectTaskForTerminal}
        onClearTask={() => {
          setAssociatedTask(terminal.id, undefined);
          updateTerminal(terminal.id, {
            associatedTaskId: undefined,
            worktreePath: undefined,
            cwd: projectPath || "~",
          });
          onSelectWorktree(terminal.id, undefined);
        }}
        onNewTaskClick={onNewTaskClick}
        onToggleClaudeMode={handleToggleClaudeMode}
        onToggleAgyMode={handleToggleAgyMode}
        onToggleVSCodeMode={handleToggleVSCodeMode}
        terminalCount={terminalCount}
        worktreeConfig={resolvedWorktreeConfig}
        worktrees={worktrees}
        projectPath={projectPath}
        onCreateWorktree={() => onCreateWorktree(terminal.id)}
        onSelectWorktree={(wt) => onSelectWorktree(terminal.id, wt)}
        dragHandleListeners={listeners}
        isExpanded={isExpanded}
        onToggleExpand={() => onToggleExpand(terminal.id)}
      />
      <div className={cn("flex-1 min-h-0", terminal.isVSCodeMode && "hidden")}>
        <TerminalPanel
          sessionId={terminal.id}
          projectId={projectId}
          cwd={effectiveCwd}
          isAgyMode={Boolean(terminal.isAgyMode)}
          onOpenVSCodeWeb={handleOpenVSCodeWebFromCwd}
        />
      </div>
      {terminal.isVSCodeMode && (
        <div className="flex-1 min-h-0">
          <VSCodeWebPanel
            sessionId={terminal.id}
            projectId={projectId}
            cwd={effectiveCwd}
            onBackToTerminal={() => setVSCodeMode(terminal.id, false)}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TerminalGrid
// ---------------------------------------------------------------------------

interface TerminalGridProps {
  projectId?: string;
  projectPath?: string;
  tasks?: Task[];
  onNewTaskClick?: () => void;
}

export function TerminalGrid({
  projectId,
  projectPath,
  tasks = [],
  onNewTaskClick,
}: TerminalGridProps) {
  const allTerminals = useTerminalStore((s) => s.terminals);
  const activeTerminalId = useTerminalStore((s) => s.activeTerminalId);
  const addTerminal = useTerminalStore((s) => s.addTerminal);
  const removeTerminal = useTerminalStore((s) => s.removeTerminal);
  const updateTerminal = useTerminalStore((s) => s.updateTerminal);
  const setTerminalStatus = useTerminalStore((s) => s.setTerminalStatus);
  const canAddTerminal = useTerminalStore((s) => s.canAddTerminal);
  const reorderTerminals = useTerminalStore((s) => s.reorderTerminals);

  const [expandedTerminalId, setExpandedTerminalId] = useState<string | null>(
    null,
  );
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [worktrees, setWorktrees] = useState<WorktreeConfig[]>([]);
  const [terminalWorktrees, setTerminalWorktrees] = useState<
    Record<string, WorktreeConfig | undefined>
  >({});

  // Load worktrees for WorktreeSelector
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    apiClient
      .listWorktrees(projectId)
      .then((res) => {
        if (cancelled) return;
        const rawList = Array.isArray((res as any)?.worktrees)
          ? (res as any).worktrees
          : Array.isArray((res as any)?.data)
            ? (res as any).data
            : [];
        const mapped: WorktreeConfig[] = rawList.map((w: any) => ({
          name: w.specName || w.name || "worktree",
          path: w.path,
          branch: w.branch || `auto-claude/${w.specName || "worktree"}`,
        }));
        setWorktrees(mapped);
      })
      .catch(() => {
        // Ignore worktree load errors
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Filter terminals for the current project
  const terminals = useMemo(
    () =>
      projectPath
        ? allTerminals.filter(
            (t) =>
              t.projectPath === projectPath ||
              (!t.projectPath && t.status !== "exited"),
          )
        : allTerminals.filter((t) => t.status !== "exited"),
    [allTerminals, projectPath],
  );

  const terminalIds = useMemo(() => terminals.map((t) => t.id), [terminals]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleAddTerminal = useCallback(() => {
    if (!canAddTerminal(projectPath)) return;
    const terminal = addTerminal(projectPath, projectPath);
    if (terminal) {
      setTerminalStatus(terminal.id, "running");
      if (projectId) {
        apiClient
          .createTerminalSession(projectId, {
            sessionId: terminal.id,
            title: terminal.title,
            cwd: projectPath,
          })
          .catch(() => {});
      }
      import("@/lib/websocket-client").then(({ terminalSocket }) => {
        terminalSocket.emit("create", {
          sessionId: terminal.id,
          cwd: projectPath,
        });
      });
    }
  }, [addTerminal, canAddTerminal, projectId, projectPath, setTerminalStatus]);

  const handleClose = useCallback(
    (id: string) => {
      if (projectId) {
        apiClient.closeTerminalSession(projectId, id).catch(() => {});
      }
      import("@/lib/websocket-client").then(({ terminalSocket }) => {
        terminalSocket.emit("kill", { sessionId: id });
      });
      removeTerminal(id);
      if (expandedTerminalId === id) {
        setExpandedTerminalId(null);
      }
    },
    [removeTerminal, expandedTerminalId, projectId],
  );

  const handleSelectWorktree = useCallback(
    (terminalId: string, wt: WorktreeConfig | undefined) => {
      setTerminalWorktrees((prev) => ({ ...prev, [terminalId]: wt }));
      updateTerminal(terminalId, {
        cwd: wt?.path || projectPath || "~",
      });
    },
    [projectPath, updateTerminal],
  );

  const handleCreateWorktree = useCallback(
    (terminalId: string) => {
      if (!projectId) {
        useUIStore.getState().setActiveView("worktrees");
        return;
      }
      const specName = `term-wt-${Date.now().toString(36).slice(-4)}`;
      apiClient
        .createWorktree(projectId, specName, "main")
        .then((res: any) => {
          const created = res?.worktree || res?.data;
          if (created?.path) {
            const cfg: WorktreeConfig = {
              name: created.specName || specName,
              path: created.path,
              branch: created.branch || `auto-claude/${specName}`,
            };
            setWorktrees((prev) => [cfg, ...prev]);
            handleSelectWorktree(terminalId, cfg);
          }
        })
        .catch(() => {
          useUIStore.getState().setActiveView("worktrees");
        });
    },
    [projectId, handleSelectWorktree],
  );

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedTerminalId((prev) => (prev === id ? null : id));
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragId(null);
      const { active, over } = event;
      if (over && active.id !== over.id) {
        reorderTerminals(active.id as string, over.id as string);
      }
    },
    [reorderTerminals],
  );

  // Compute grid columns based on terminal count
  const gridCols = useMemo(() => {
    const count = terminals.length;
    if (count <= 1) return "grid-cols-1";
    if (count <= 2) return "grid-cols-1 lg:grid-cols-2";
    if (count <= 4) return "grid-cols-1 lg:grid-cols-2";
    if (count <= 6) return "grid-cols-1 md:grid-cols-2 xl:grid-cols-3";
    return "grid-cols-1 md:grid-cols-2 xl:grid-cols-4";
  }, [terminals.length]);

  if (terminals.length === 0) {
    return (
      <div
        className="flex h-full items-center justify-center"
        data-testid="terminals-view"
      >
        <div className="flex flex-col items-center gap-4 text-muted-foreground">
          <TerminalSquare className="h-12 w-12 opacity-30" />
          <p className="text-sm">No terminals open</p>
          <Button
            variant="outline"
            size="sm"
            data-testid="terminal-new-btn"
            onClick={handleAddTerminal}
          >
            <Plus className="h-4 w-4 mr-2" />
            New Terminal
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col gap-2 p-2"
      data-testid="terminals-view"
    >
      {/* Tab bar */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 flex-1 overflow-x-auto">
          {terminals.map((terminal) => (
            <button
              key={terminal.id}
              type="button"
              data-testid={`terminal-tab-${terminal.id}`}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors",
                "hover:bg-muted",
                terminal.id === activeTerminalId
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground",
              )}
              onClick={() =>
                useTerminalStore.getState().setActiveTerminal(terminal.id)
              }
            >
              <TerminalSquare className="h-3 w-3" />
              <span className="truncate max-w-28">{terminal.title}</span>
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="icon"
          data-testid="terminal-add-tab-btn"
          className="h-7 w-7 flex-shrink-0"
          onClick={handleAddTerminal}
          disabled={!canAddTerminal(projectPath)}
          title="Add Terminal"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Terminal grid */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={terminalIds} strategy={rectSortingStrategy}>
          <div
            className={cn(
              "grid flex-1 gap-2 auto-rows-fr overflow-y-auto",
              expandedTerminalId ? "grid-cols-1" : gridCols,
            )}
          >
            {terminals.map((terminal) => (
              <SortableTerminalWrapper
                key={terminal.id}
                terminal={terminal}
                tasks={tasks}
                projectId={projectId}
                projectPath={projectPath}
                terminalCount={terminals.length}
                worktrees={worktrees}
                worktreeConfig={terminalWorktrees[terminal.id]}
                onSelectWorktree={handleSelectWorktree}
                onCreateWorktree={handleCreateWorktree}
                isExpanded={expandedTerminalId === terminal.id}
                isHidden={
                  expandedTerminalId !== null &&
                  expandedTerminalId !== terminal.id
                }
                onClose={handleClose}
                onToggleExpand={handleToggleExpand}
                onNewTaskClick={onNewTaskClick}
              />
            ))}
          </div>
        </SortableContext>
        <DragOverlay>
          {activeDragId ? (
            <div className="rounded-lg border border-primary/50 bg-card/80 p-4 opacity-80 shadow-lg">
              <span className="text-xs text-muted-foreground">
                Moving terminal...
              </span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
