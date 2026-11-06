"use client";

import { memo, useMemo, useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  GitPullRequest,
  AlertTriangle,
  Target,
  Bug,
  Wrench,
  FileCode,
  Shield,
  Gauge,
  Palette,
  Play,
  Square,
  Loader2,
  MessageSquarePlus,
  Bot,
  Sparkles,
  Terminal,
  FolderGit2,
} from "lucide-react";
import { cn } from "@auto-claude/ui";
import type { Task, TaskStatus } from "@auto-claude/types";
import { TaskActions } from "./TaskActions";
import { PhaseProgressIndicator } from "@/components/common/PhaseProgressIndicator";

/** Stuck detection interval (ms) — last-resort safety net */
const STUCK_CHECK_INTERVAL_MS = 60_000;

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "border-l-red-500",
  high: "border-l-orange-500",
  medium: "border-l-yellow-500",
  low: "border-l-blue-500",
};

const COMPLEXITY_VARIANTS: Record<string, string> = {
  trivial: "bg-green-500/15 text-green-800 dark:text-green-300",
  small: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  medium: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  large: "bg-orange-500/15 text-orange-800 dark:text-orange-300",
  complex: "bg-red-500/15 text-red-700 dark:text-red-300",
};

const IMPACT_VARIANTS: Record<string, string> = {
  low: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  medium: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  high: "bg-orange-500/15 text-orange-800 dark:text-orange-300",
  critical: "bg-red-500/15 text-red-700 dark:text-red-300",
};

/** Category icon mapping */
const CategoryIcon: Record<string, React.ElementType> = {
  feature: Target,
  bug_fix: Bug,
  refactoring: Wrench,
  documentation: FileCode,
  security: Shield,
  performance: Gauge,
  ui_ux: Palette,
  infrastructure: Wrench,
  testing: FileCode,
};

/** Format execution time from seconds */
function formatExecutionTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

interface TaskCardProps {
  task: Task;
  onClick: () => void;
  onStatusChange?: (taskId: string, newStatus: TaskStatus) => void;
  onStart?: (taskId: string) => void;
  onStop?: (taskId: string) => void;
  onApprove?: (taskId: string, feedback?: string) => void;
  onReject?: (taskId: string, feedback: string) => void;
  onArchive?: (taskId: string) => void;
  onCreatePR?: (taskId: string) => void;
  onOpenTerminal?: (task: Task, mode?: "modal" | "view") => void;
}

export const TaskCard = memo(function TaskCard({
  task,
  onClick,
  onStatusChange,
  onStart,
  onStop,
  onApprove,
  onReject,
  onArchive,
  onCreatePR,
  onOpenTerminal,
}: TaskCardProps) {
  const { t } = useTranslation("kanban");
  const [isStuck, setIsStuck] = useState(false);
  const [showQuickComment, setShowQuickComment] = useState(false);
  const [quickComment, setQuickComment] = useState("");
  const stuckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const priority = task.metadata?.priority;
  const category = task.metadata?.category;
  const complexity = task.metadata?.complexity;
  const impact = task.metadata?.impact;
  const isRunning = task.status === "in_progress";
  const executionPhase = task.executionProgress?.phase;
  const hasActiveExecution = executionPhase && executionPhase !== "idle" && executionPhase !== "complete" && executionPhase !== "failed";

  // Subtask progress
  const totalSubtasks = task.subtasks?.length || 0;
  const completedSubtasks = task.subtasks?.filter((s) => s.status === "completed").length || 0;

  // Execution time display — use task timestamps
  const executionTime = useMemo(() => {
    if (!isRunning && !hasActiveExecution) return null;
    const start = task.createdAt ? new Date(task.createdAt).getTime() : 0;
    if (!start) return null;
    const end = task.updatedAt ? new Date(task.updatedAt).getTime() : Date.now();
    const seconds = Math.floor((end - start) / 1000);
    return seconds > 0 ? formatExecutionTime(seconds) : null;
  }, [task.createdAt, task.updatedAt, isRunning, hasActiveExecution]);

  // Stuck detection for running tasks
  useEffect(() => {
    if (!isRunning) {
      setIsStuck(false);
      if (stuckIntervalRef.current) {
        clearInterval(stuckIntervalRef.current);
        stuckIntervalRef.current = null;
      }
      return;
    }

    stuckIntervalRef.current = setInterval(() => {
      const lastUpdate = task.updatedAt ? new Date(task.updatedAt).getTime() : 0;
      const elapsed = Date.now() - lastUpdate;
      setIsStuck(elapsed > STUCK_CHECK_INTERVAL_MS);
    }, STUCK_CHECK_INTERVAL_MS);

    return () => {
      if (stuckIntervalRef.current) {
        clearInterval(stuckIntervalRef.current);
      }
    };
  }, [isRunning, task.updatedAt]);

  return (
    <div
      data-testid={`task-card-${task.id}`}
      className={cn(
        "rounded-lg border border-border bg-card p-3 cursor-pointer transition-all hover:shadow-md hover:border-border/80 group",
        "border-l-2",
        priority ? PRIORITY_COLORS[priority] || "border-l-transparent" : "border-l-transparent",
        isStuck && "ring-1 ring-warning/50",
      )}
      onClick={onClick}
    >
      {/* Title row with actions */}
      <div className="flex items-start gap-1.5">
        <h3 className="flex-1 text-sm font-medium leading-tight line-clamp-2">
          {task.title}
        </h3>
        <div className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <TaskActions
            task={task}
            onStatusChange={onStatusChange}
            onStart={onStart}
            onStop={onStop}
            onArchive={onArchive}
            onCreatePR={onCreatePR}
            onOpenTerminal={onOpenTerminal}
          />
        </div>
      </div>

      {/* Description preview */}
      {task.description && (
        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
          {task.description}
        </p>
      )}

      {/* Badges row: Azure DevOps ticket, category, complexity, priority, impact */}
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        {task.metadata?.azureDevOpsId && (
          <span
            data-testid="task-card-ado-badge"
            className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/15 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-300"
          >
            🔷 ADO #{task.metadata.azureDevOpsId}
          </span>
        )}

        {category && (
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {CategoryIcon[category] &&
              (() => {
                const CatIcon = CategoryIcon[category];
                return <CatIcon className="h-2.5 w-2.5" />;
              })()}
            {t(`card.category.${category}`, category)}
          </span>
        )}

        {complexity && (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              COMPLEXITY_VARIANTS[complexity] || "bg-secondary text-muted-foreground",
            )}
          >
            {t(`card.complexity.${complexity}`, complexity)}
          </span>
        )}

        {priority && (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {t(`card.priority.${priority}`, priority)}
          </span>
        )}

        {impact && (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              IMPACT_VARIANTS[impact] || "bg-secondary text-muted-foreground",
            )}
          >
            {t(`card.impact.${impact}`, impact)}
          </span>
        )}

        {/* Subtask progress */}
        {totalSubtasks > 0 && (
          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3 w-3" />
            {completedSubtasks}/{totalSubtasks}
          </span>
        )}
      </div>

      {/* Dedicated Source Tree Folder Badge */}
      <div className="mt-1.5 flex items-center gap-1.5">
        <span
          data-testid={`task-source-folder-${task.id}`}
          title={
            task.worktreePath ||
            `.auto-claude/worktrees/${task.specId || task.id}`
          }
          className="inline-flex items-center gap-1 rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-xs text-emerald-800 dark:text-emerald-300 truncate max-w-full"
        >
          <FolderGit2 className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate">
            worktrees/{task.specId || task.id}
          </span>
        </span>
      </div>

      {/* Phase progress indicator for active executions */}
      {hasActiveExecution && (
        <div className="mt-2">
          <PhaseProgressIndicator
            phase={executionPhase}
            subtasks={task.subtasks || []}
            phaseProgress={task.executionProgress?.phaseProgress}
            isStuck={isStuck}
            isRunning={isRunning}
          />
        </div>
      )}

      {/* Execution time, Terminal quick-launch, and stuck indicator */}
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          data-testid={`open-task-terminal-${task.id}`}
          title={t(
            "card.openTerminal",
            "Open Terminal in Task Source Tree Folder",
          )}
          className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:text-emerald-300 hover:bg-emerald-600 hover:text-white transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            if (onOpenTerminal) {
              onOpenTerminal(task, "modal");
            } else {
              onClick();
            }
          }}
        >
          <Terminal className="h-2.5 w-2.5" />
          <span>{t("card.openTerminal", "Terminal")}</span>
        </button>
        {executionTime && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {executionTime}
          </span>
        )}
        {isStuck && (
          <span className="flex items-center gap-1 text-xs text-warning font-medium">
            <AlertTriangle className="h-3 w-3" />
            {t("card.stuck", "Stuck")}
          </span>
        )}
        {task.status === "backlog" && onStart && (
          <button
            type="button"
            data-testid={`run-task-${task.id}`}
            className="ml-auto inline-flex items-center gap-1 rounded-md bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onStart(task.id);
            }}
          >
            <Play className="h-3 w-3 fill-current" />
            Run Task
          </button>
        )}
        {task.status === "queue" && (
          <div className="ml-auto flex items-center gap-1.5">
            <span
              data-testid={`queued-badge-${task.id}`}
              className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300"
            >
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              Queued
            </span>
            {onStop && (
              <button
                type="button"
                data-testid={`stop-task-${task.id}`}
                className="inline-flex items-center gap-1 rounded-md bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onStop(task.id);
                }}
              >
                <Square className="h-2.5 w-2.5 fill-current" />
                Stop
              </button>
            )}
          </div>
        )}
        {task.status === "in_progress" && (
          <div className="ml-auto flex items-center gap-1.5">
            <span
              data-testid={`running-badge-${task.id}`}
              className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300"
            >
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              Running
            </span>
            {onStop && (
              <button
                type="button"
                data-testid={`stop-task-${task.id}`}
                className="inline-flex items-center gap-1 rounded-md bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onStop(task.id);
                }}
              >
                <Square className="h-2.5 w-2.5 fill-current" />
                Stop
              </button>
            )}
          </div>
        )}
        {task.status === "ai_review" && (
          <div className="ml-auto flex items-center gap-1.5">
            <span
              data-testid={`ai-review-badge-${task.id}`}
              className="inline-flex items-center gap-1 rounded-full bg-purple-500/15 px-2 py-0.5 text-xs font-medium text-purple-700 dark:text-purple-300"
            >
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              AI Reviewing
            </span>
            {onStop && (
              <button
                type="button"
                data-testid={`stop-task-${task.id}`}
                className="inline-flex items-center gap-1 rounded-md bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onStop(task.id);
                }}
              >
                <Square className="h-2.5 w-2.5 fill-current" />
                Stop
              </button>
            )}
          </div>
        )}
        {task.status === "human_review" && (
          <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
            {onReject && (
              <button
                type="button"
                data-testid={`request-changes-task-${task.id}`}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
                  showQuickComment
                    ? "border-purple-500/40 bg-purple-600 text-white"
                    : "border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:bg-purple-500/20",
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowQuickComment((prev) => !prev);
                }}
              >
                <MessageSquarePlus className="h-2.5 w-2.5" />
                Comment / AI Fix
              </button>
            )}
            {onApprove && (
              <button
                type="button"
                data-testid={`approve-task-${task.id}`}
                className="inline-flex items-center gap-1 rounded-md bg-green-700 px-2.5 py-0.5 text-xs font-medium text-white hover:bg-green-800 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onApprove(task.id);
                }}
              >
                <CheckCircle2 className="h-2.5 w-2.5" />
                Approve
              </button>
            )}
            {onStart && (
              <button
                type="button"
                data-testid={`rerun-task-${task.id}`}
                className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onStart(task.id);
                }}
              >
                <Play className="h-2.5 w-2.5 fill-current" />
                Re-run
              </button>
            )}
          </div>
        )}
        {task.status === "done" && (
          <div className="ml-auto flex items-center gap-1.5">
            {onStart && (
              <button
                type="button"
                data-testid={`rerun-task-${task.id}`}
                className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onStart(task.id);
                }}
              >
                <Play className="h-2.5 w-2.5 fill-current" />
                Re-run
              </button>
            )}
            <span
              data-testid={`completed-badge-${task.id}`}
              className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-800 dark:text-green-300"
            >
              <CheckCircle2 className="h-3 w-3" />
              Completed
            </span>
          </div>
        )}
      </div>

      {/* Remapped status badges */}
      {task.status === "pr_created" && (
        <div className="mt-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-800 dark:text-green-300">
            <GitPullRequest className="h-3 w-3" />
            {t("card.badges.prCreated")}
          </span>
        </div>
      )}
      {task.status === "error" && (
        <div className="mt-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
            <AlertCircle className="h-3 w-3" />
            {t("card.badges.error")}
          </span>
        </div>
      )}

      {/* Review reason badge & AI fix count */}
      {task.status === "human_review" && (task.reviewReason || (task.reviewComments && task.reviewComments.length > 0)) && (
        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          {task.reviewReason && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                task.reviewReason === "completed" && "bg-green-500/10 text-green-800 dark:text-green-300",
                task.reviewReason === "errors" && "bg-red-500/10 text-red-700 dark:text-red-300",
                task.reviewReason === "qa_rejected" && "bg-orange-500/10 text-orange-800 dark:text-orange-300",
                task.reviewReason === "plan_review" && "bg-blue-500/10 text-blue-700 dark:text-blue-300",
              )}
            >
              {t(`card.review.${task.reviewReason}`, task.reviewReason)}
            </span>
          )}
          {task.reviewComments && task.reviewComments.length > 0 && (
            <span
              data-testid={`task-card-ai-fixes-${task.id}`}
              className="inline-flex items-center gap-1 rounded-full bg-purple-500/15 px-2 py-0.5 text-xs font-medium text-purple-700 dark:text-purple-300"
            >
              <Sparkles className="h-2.5 w-2.5" />
              AI Fixed ({task.reviewComments.length})
            </span>
          )}
        </div>
      )}

      {/* Inline Quick Comment & AI Fix Box for Human Review */}
      {task.status === "human_review" && showQuickComment && onReject && (
        <div
          data-testid={`quick-comment-box-${task.id}`}
          className="mt-2.5 rounded-md border border-purple-500/30 bg-purple-500/5 p-2 space-y-2"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <textarea
            data-testid={`quick-comment-input-${task.id}`}
            placeholder={t(
              "card.quickCommentPlaceholder",
              "Enter comment for AI to check & fix code...",
            )}
            value={quickComment}
            onChange={(e) => setQuickComment(e.target.value)}
            rows={2}
            className="w-full rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500 resize-none"
          />
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                setShowQuickComment(false);
              }}
            >
              {t("wizard.cancel", "Cancel")}
            </button>
            <button
              type="button"
              data-testid={`quick-comment-submit-${task.id}`}
              disabled={!quickComment.trim()}
              className="inline-flex items-center gap-1 rounded bg-purple-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                if (!quickComment.trim()) return;
                const text = quickComment.trim();
                setQuickComment("");
                setShowQuickComment(false);
                onReject(task.id, text);
              }}
            >
              <Bot className="h-3 w-3" />
              {t("card.sendAiFix", "Send to AI Fix")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
