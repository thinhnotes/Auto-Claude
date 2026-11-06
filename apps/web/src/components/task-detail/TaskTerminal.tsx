"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslation } from "react-i18next";
import {
  FolderGit2,
  GitBranch,
  RefreshCw,
  Copy,
  Check,
  ExternalLink,
  TerminalSquare,
} from "lucide-react";
import { Button, Badge } from "@auto-claude/ui";
import type { Task } from "@auto-claude/types";
import { useTerminalStore } from "@/stores/terminal-store";
import { useProjectStore } from "@/stores/project-store";
import { apiClient } from "@/lib/data/api-client";

const TerminalPanel = dynamic(
  () =>
    import("@/components/terminal/TerminalPanel").then((m) => m.TerminalPanel),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[380px] w-full items-center justify-center bg-[#0B0B0F] font-mono text-xs text-zinc-400">
        Initializing task source tree terminal...
      </div>
    ),
  },
);

export interface TaskTerminalProps {
  task: Task;
  onOpenInTerminalsView?: (task: Task) => void;
}

export function TaskTerminal({
  task,
  onOpenInTerminalsView,
}: TaskTerminalProps) {
  const { t } = useTranslation(["kanban", "common"]);
  const projects = useProjectStore((s) => s.projects);
  const activeProject = Array.isArray(projects)
    ? projects.find((p) => p && p.id === task.projectId)
    : undefined;

  const sessionId = `term-task-${task.id}`;
  const taskTerminal = useTerminalStore((s) =>
    s.terminals.find((t) => t.id === sessionId),
  );
  const defaultWorktreePath =
    task.worktreePath || `.auto-claude/worktrees/${task.specId || task.id}`;
  const defaultBranch =
    task.worktreeBranch || `auto-claude/${task.specId || task.id}`;

  const [worktreePath, setWorktreePath] = useState<string>(defaultWorktreePath);
  const [branch, setBranch] = useState<string>(defaultBranch);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [syncedCount, setSyncedCount] = useState<number | null>(null);

  useEffect(() => {
    const nextPath =
      task.worktreePath || `.auto-claude/worktrees/${task.specId || task.id}`;
    const nextBranch =
      task.worktreeBranch || `auto-claude/${task.specId || task.id}`;
    setWorktreePath(nextPath);
    setBranch(nextBranch);

    useTerminalStore
      .getState()
      .openOrCreateTaskTerminal(
        {
          id: task.id,
          title: task.title,
          projectId: task.projectId,
          worktreePath: nextPath,
        },
        activeProject?.path,
      );

    if (task.projectId) {
      let cancelled = false;
      apiClient
        .openTaskTerminal(task.projectId, task.id, {
          sessionId,
          title: `Task: ${task.title}`,
        })
        .then((res) => {
          if (cancelled || !res) return;
          const serverAgy = Boolean((res as any)?.session?.isAgyMode);
          if (res.worktreePath) {
            setWorktreePath(res.worktreePath);
            useTerminalStore.getState().updateTerminal(sessionId, {
              cwd: res.worktreePath,
              worktreePath: res.worktreePath,
              associatedTaskId: task.id,
              ...(serverAgy
                ? { isAgyMode: true, status: "agy-active" }
                : { status: "running" }),
            });
          } else if (serverAgy) {
            useTerminalStore.getState().setAgyMode(sessionId, true);
            useTerminalStore
              .getState()
              .setTerminalStatus(sessionId, "agy-active");
          }
          if (res.branch) {
            setBranch(res.branch);
          }
          if (Array.isArray(res.filesSynced)) {
            setSyncedCount(res.filesSynced.length);
          }
        })
        .catch(() => {
          // Ignore network error in offline/mocked unit test environments
        });
      return () => {
        cancelled = true;
      };
    }
  }, [
    task.id,
    task.specId,
    task.title,
    task.projectId,
    task.worktreePath,
    task.worktreeBranch,
    activeProject?.path,
    sessionId,
  ]);

  const handleSyncSourceTree = useCallback(async () => {
    if (!task.projectId || isSyncing) return;
    setIsSyncing(true);
    try {
      const res = await apiClient.syncTaskSourceTree(task.projectId, task.id);
      if (res?.worktreePath) {
        setWorktreePath(res.worktreePath);
        useTerminalStore.getState().updateTerminal(sessionId, {
          cwd: res.worktreePath,
          worktreePath: res.worktreePath,
        });
      }
      if (res?.branch) {
        setBranch(res.branch);
      }
      if (Array.isArray(res?.filesSynced)) {
        setSyncedCount(res.filesSynced.length);
      }
    } catch {
      // Ignore error in test environments
    } finally {
      setIsSyncing(false);
    }
  }, [task.projectId, task.id, isSyncing, sessionId]);

  const handleCopyPath = useCallback(() => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(worktreePath).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [worktreePath]);

  const handleOpenInTerminalsView = useCallback(() => {
    useTerminalStore.getState().openOrCreateTaskTerminal(
      {
        id: task.id,
        title: task.title,
        projectId: task.projectId,
        worktreePath,
      },
      activeProject?.path,
    );
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("auto-claude:open-task-terminal-view", {
          detail: { task: { ...task, worktreePath, worktreeBranch: branch } },
        }),
      );
    }
    onOpenInTerminalsView?.({
      ...task,
      worktreePath,
      worktreeBranch: branch,
    });
  }, [task, worktreePath, branch, activeProject?.path, onOpenInTerminalsView]);

  return (
    <div
      data-testid="task-terminal-view"
      className="flex flex-col rounded-lg border border-border bg-card overflow-hidden"
    >
      {/* Task Source Tree Toolbar */}
      <div
        data-testid="task-terminal-toolbar"
        className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2"
      >
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <TerminalSquare className="h-3.5 w-3.5 text-emerald-500" />
            <span>
              {t("kanban:detail.sourceTreePath", "Task Source Tree")}:
            </span>
          </span>

          <Badge
            variant="outline"
            data-testid="task-terminal-cwd-badge"
            className="font-mono text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 max-w-[360px] truncate"
            title={worktreePath}
          >
            <FolderGit2 className="h-3 w-3 mr-1 shrink-0" />
            <span className="truncate">{worktreePath}</span>
          </Badge>

          <Badge
            variant="secondary"
            data-testid="task-terminal-branch-badge"
            className="font-mono text-xs gap-1"
          >
            <GitBranch className="h-2.5 w-2.5" />
            <span>{branch}</span>
          </Badge>

          {syncedCount !== null && (
            <span className="text-xs text-muted-foreground">
              ({syncedCount} files synced)
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="task-terminal-copy-path-btn"
            className="h-7 gap-1 px-2 text-xs"
            onClick={handleCopyPath}
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-green-500" />
                <span>{t("kanban:detail.copiedPath", "Copied")}</span>
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                <span>{t("kanban:detail.copyPath", "Copy Path")}</span>
              </>
            )}
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="task-terminal-sync-btn"
            disabled={isSyncing}
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => void handleSyncSourceTree()}
          >
            <RefreshCw
              className={`h-3 w-3 ${isSyncing ? "animate-spin" : ""}`}
            />
            <span>
              {isSyncing
                ? t("kanban:detail.syncingSourceTree", "Syncing...")
                : t("kanban:detail.syncSourceTree", "Sync Files")}
            </span>
          </Button>

          <Button
            type="button"
            variant="default"
            size="sm"
            data-testid="task-terminal-open-view-btn"
            className="h-7 gap-1 px-2.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={handleOpenInTerminalsView}
          >
            <ExternalLink className="h-3 w-3" />
            <span>
              {t(
                "kanban:detail.openInTerminalsView",
                "Open in Terminals View",
              )}
            </span>
          </Button>
        </div>
      </div>

      {/* Embedded Interactive Terminal Scoped to Task Source Tree */}
      <div
        data-testid="task-terminal-panel-container"
        className="min-h-[380px] h-[420px] flex-1 flex flex-col bg-[#0B0B0F]"
      >
        <TerminalPanel
          sessionId={sessionId}
          projectId={task.projectId}
          cwd={worktreePath}
          isAgyMode={Boolean(taskTerminal?.isAgyMode)}
        />
      </div>
    </div>
  );
}
