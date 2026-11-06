"use client";

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Play,
  Square,
  Archive,
  GitPullRequest,
  MoreVertical,
  RotateCcw,
  Terminal,
  ExternalLink,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Button,
} from "@auto-claude/ui";
import type { Task, TaskStatus } from "@auto-claude/types";

interface TaskActionsProps {
  task: Task;
  onStatusChange?: (taskId: string, newStatus: TaskStatus) => void;
  onStart?: (taskId: string) => void;
  onStop?: (taskId: string) => void;
  onArchive?: (taskId: string) => void;
  onCreatePR?: (taskId: string) => void;
  onRecover?: (taskId: string) => void;
  onOpenTerminal?: (task: Task, mode?: "modal" | "view") => void;
}

export function TaskActions({
  task,
  onStatusChange,
  onStart,
  onStop,
  onArchive,
  onCreatePR,
  onRecover,
  onOpenTerminal,
}: TaskActionsProps) {
  const { t } = useTranslation("kanban");

  const isRunning = task.status === "in_progress";
  const canStart = task.status === "backlog" || task.status === "queue";
  const canStop = isRunning;
  const canArchive = task.status === "done" || task.status === "error";
  const canCreatePR = task.status === "done" && !task.metadata?.prUrl;
  const isError = task.status === "error";

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
    },
    [],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={handleClick}>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={handleClick}>
        {onOpenTerminal && (
          <>
            <DropdownMenuItem
              data-testid={`menu-open-terminal-${task.id}`}
              onClick={() => onOpenTerminal(task, "modal")}
            >
              <Terminal className="mr-2 h-3.5 w-3.5 text-emerald-500" />
              {t("card.openTerminal", "Open Terminal")}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid={`menu-open-terminal-view-${task.id}`}
              onClick={() => onOpenTerminal(task, "view")}
            >
              <ExternalLink className="mr-2 h-3.5 w-3.5 text-emerald-500" />
              {t("card.openInTerminalsView", "Open in Terminals View")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {canStart && onStart && (
          <DropdownMenuItem onClick={() => onStart(task.id)}>
            <Play className="mr-2 h-3.5 w-3.5" />
            {t("actions.start", "Start")}
          </DropdownMenuItem>
        )}
        {canStop && onStop && (
          <DropdownMenuItem onClick={() => onStop(task.id)}>
            <Square className="mr-2 h-3.5 w-3.5" />
            {t("actions.stop", "Stop")}
          </DropdownMenuItem>
        )}
        {isError && onRecover && (
          <DropdownMenuItem onClick={() => onRecover(task.id)}>
            <RotateCcw className="mr-2 h-3.5 w-3.5" />
            {t("actions.recover", "Recover")}
          </DropdownMenuItem>
        )}
        {canCreatePR && onCreatePR && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onCreatePR(task.id)}>
              <GitPullRequest className="mr-2 h-3.5 w-3.5" />
              {t("actions.createPR", "Create PR")}
            </DropdownMenuItem>
          </>
        )}
        {canArchive && onArchive && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onArchive(task.id)}>
              <Archive className="mr-2 h-3.5 w-3.5" />
              {t("actions.archive", "Archive")}
            </DropdownMenuItem>
          </>
        )}
        {/* Status change options */}
        {onStatusChange && (
          <>
            <DropdownMenuSeparator />
            {task.status !== "backlog" && (
              <DropdownMenuItem onClick={() => onStatusChange(task.id, "backlog")}>
                {t("actions.moveToBacklog", "Move to Backlog")}
              </DropdownMenuItem>
            )}
            {task.status === "backlog" && (
              <DropdownMenuItem onClick={() => onStatusChange(task.id, "queue")}>
                {t("actions.moveToQueue", "Move to Queue")}
              </DropdownMenuItem>
            )}
            {(task.status === "human_review" || task.status === "ai_review") && (
              <DropdownMenuItem onClick={() => onStatusChange(task.id, "done")}>
                {t("actions.markDone", "Mark as Done")}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid={`menu-remove-task-${task.id}`}
              className="text-red-500 focus:text-red-500"
              onClick={() => onStatusChange(task.id, "remove")}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              {t("actions.removeTask", "Move to Remove")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
