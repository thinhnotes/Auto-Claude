"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  Pencil,
  AlertTriangle,
  Maximize2,
  Minimize2,
  Terminal,
  FolderGit2,
} from "lucide-react";
import {
  cn,
  Button,
  Badge,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@auto-claude/ui";
import type { Task } from "@auto-claude/types";

interface TaskHeaderProps {
  task: Task;
  isStuck: boolean;
  isIncomplete: boolean;
  taskProgress: { completed: number; total: number };
  isRunning: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  onOpenTerminal?: () => void;
  onClose: () => void;
  onEdit: () => void;
}

export function TaskHeader({
  task,
  isStuck,
  isIncomplete,
  taskProgress,
  isRunning,
  isExpanded = false,
  onToggleExpand,
  onOpenTerminal,
  onClose,
  onEdit,
}: TaskHeaderProps) {
  const { t } = useTranslation(["kanban", "common"]);

  const displayTitle = useMemo(() => task.title, [task.title]);
  const worktreePath =
    task.worktreePath || `.auto-claude/worktrees/${task.specId || task.id}`;

  return (
    <div className="flex items-start justify-between p-4 pb-3">
      <div className="flex-1 min-w-0 pr-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <h2 className="font-semibold text-lg text-foreground line-clamp-2 leading-snug cursor-default">
              {displayTitle}
            </h2>
          </TooltipTrigger>
          {displayTitle.length > 40 && (
            <TooltipContent side="bottom" className="max-w-xs">
              <p className="text-sm">{displayTitle}</p>
            </TooltipContent>
          )}
        </Tooltip>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs font-mono">
            {task.specId}
          </Badge>
          {isStuck ? (
            <Badge
              variant="destructive"
              className="text-xs flex items-center gap-1 animate-pulse"
            >
              <AlertTriangle className="h-3 w-3" />
              {t("kanban:card.stuck")}
            </Badge>
          ) : isIncomplete ? (
            <>
              <Badge
                variant="destructive"
                className="text-xs flex items-center gap-1"
              >
                <AlertTriangle className="h-3 w-3" />
                {t("kanban:detail.incomplete", "Incomplete")}
              </Badge>
              <Badge variant="outline" className="text-xs text-orange-400">
                {taskProgress.completed}/{taskProgress.total} subtasks
              </Badge>
            </>
          ) : (
            <Badge
              variant={
                task.status === "done"
                  ? "default"
                  : task.status === "human_review"
                    ? "secondary"
                    : task.status === "in_progress"
                      ? "default"
                      : "outline"
              }
              className={cn(
                "text-xs",
                task.status === "done" && "bg-green-500/10 text-green-600",
                task.status === "in_progress" &&
                  "bg-yellow-500/10 text-yellow-600",
                task.status === "human_review" &&
                  "bg-purple-500/10 text-purple-600",
                task.status === "error" && "bg-red-500/10 text-red-600",
              )}
            >
              {t(`kanban:columns.${task.status}`, task.status)}
            </Badge>
          )}
          {task.status === "human_review" && task.reviewReason && (
            <Badge
              variant="outline"
              className={cn(
                "text-xs",
                task.reviewReason === "completed" && "text-green-600",
                task.reviewReason === "errors" && "text-red-600",
              )}
            >
              {t(`kanban:card.review.${task.reviewReason}`, task.reviewReason)}
            </Badge>
          )}
          <button
            type="button"
            data-testid="task-header-worktree-path"
            title={worktreePath}
            onClick={() => onOpenTerminal?.()}
            className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-xs text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors max-w-[320px] truncate"
          >
            <FolderGit2 className="h-3 w-3 shrink-0" />
            <span className="truncate">{worktreePath}</span>
          </button>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0 -mr-1 -mt-1">
        {onOpenTerminal && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="task-header-terminal-btn"
                className="h-8 gap-1.5 px-2.5 text-xs border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                onClick={onOpenTerminal}
              >
                <Terminal className="h-3.5 w-3.5" />
                <span>{t("kanban:detail.openTerminal", "Terminal")}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t(
                "kanban:detail.openTerminalTooltip",
                "Open terminal in this task's source tree folder",
              )}
            </TooltipContent>
          </Tooltip>
        )}
        {onToggleExpand && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="modal-expand-toggle-btn"
                className="h-8 gap-1.5 px-2.5 text-xs hover:bg-primary/10 hover:text-primary transition-colors"
                onClick={onToggleExpand}
              >
                {isExpanded ? (
                  <>
                    <Minimize2 className="h-3.5 w-3.5" />
                    <span>{t("kanban:detail.collapseModal", "Compact")}</span>
                  </>
                ) : (
                  <>
                    <Maximize2 className="h-3.5 w-3.5" />
                    <span>{t("kanban:detail.expandModal", "Expand")}</span>
                  </>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {isExpanded
                ? t("kanban:detail.collapseModalTooltip", "Switch to compact view")
                : t(
                    "kanban:detail.expandModalTooltip",
                    "Expand modal for code & diff review (Wide view)",
                  )}
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                data-testid="edit-feature-toggle-btn"
                title={t("kanban:detail.editFeature", "Edit Feature")}
                className="hover:bg-primary/10 hover:text-primary transition-colors"
                onClick={onEdit}
                disabled={isRunning && !isStuck}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {isRunning && !isStuck
              ? t(
                  "kanban:detail.cannotEditWhileRunning",
                  "Cannot edit while running",
                )
              : t("kanban:detail.editFeature", "Edit Feature")}
          </TooltipContent>
        </Tooltip>
        <Button
          variant="ghost"
          size="icon"
          className="hover:bg-destructive/10 hover:text-destructive transition-colors"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
