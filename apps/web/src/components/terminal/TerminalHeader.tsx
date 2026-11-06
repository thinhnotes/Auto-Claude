"use client";

import {
  X,
  Sparkles,
  Zap,
  Code2,
  ExternalLink,
  TerminalSquare,
  GripVertical,
  Maximize2,
  Minimize2,
} from "lucide-react";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import type { Task } from "@auto-claude/types";
import { cn, Button } from "@auto-claude/ui";
import { TaskSelector } from "./TaskSelector";
import { WorktreeSelector, type WorktreeConfig } from "./WorktreeSelector";

const STATUS_COLORS: Record<string, string> = {
  idle: "bg-gray-400",
  running: "bg-green-500",
  "claude-active": "bg-purple-500 animate-pulse",
  "agy-active": "bg-emerald-400 animate-pulse",
  exited: "bg-red-500",
};

interface TerminalHeaderProps {
  terminalId: string;
  title: string;
  status: string;
  isClaudeMode: boolean;
  isAgyMode?: boolean;
  isVSCodeMode?: boolean;
  vscodeUrl?: string;
  tasks: Task[];
  associatedTask?: Task;
  onClose: () => void;
  onTitleChange: (newTitle: string) => void;
  onTaskSelect: (taskId: string) => void;
  onClearTask: () => void;
  onNewTaskClick?: () => void;
  onToggleClaudeMode?: () => void;
  onToggleAgyMode?: () => void;
  onToggleVSCodeMode?: () => void;
  terminalCount?: number;
  worktreeConfig?: WorktreeConfig;
  worktrees?: WorktreeConfig[];
  projectPath?: string;
  onCreateWorktree?: () => void;
  onSelectWorktree?: (config: WorktreeConfig | undefined) => void;
  dragHandleListeners?: SyntheticListenerMap;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

export function TerminalHeader({
  terminalId,
  title,
  status,
  isClaudeMode,
  isAgyMode = false,
  isVSCodeMode = false,
  vscodeUrl,
  tasks,
  associatedTask,
  onClose,
  onTitleChange,
  onTaskSelect,
  onClearTask,
  onNewTaskClick,
  onToggleClaudeMode,
  onToggleAgyMode,
  onToggleVSCodeMode,
  terminalCount = 1,
  worktreeConfig,
  worktrees = [],
  projectPath,
  onCreateWorktree,
  onSelectWorktree,
  dragHandleListeners,
  isExpanded,
  onToggleExpand,
}: TerminalHeaderProps) {
  const selectableTasks = tasks;

  return (
    <div
      className="group/header flex h-9 items-center justify-between border-b border-border/50 bg-card/30 px-2"
      data-testid={`terminal-header-${terminalId}`}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        {/* Drag handle */}
        {dragHandleListeners && (
          <div
            {...dragHandleListeners}
            className={cn(
              "flex items-center justify-center",
              "w-4 h-6 -ml-1",
              "opacity-0 group-hover/header:opacity-60",
              "hover:opacity-100 transition-opacity",
              "cursor-grab active:cursor-grabbing",
              "text-muted-foreground hover:text-foreground",
            )}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </div>
        )}

        <div
          className={cn(
            "h-2 w-2 rounded-full flex-shrink-0",
            STATUS_COLORS[status] ?? "bg-gray-400",
          )}
          data-testid={`terminal-status-dot-${terminalId}`}
        />

        <div className="flex items-center gap-1.5 min-w-0">
          <TerminalSquare className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <span
            className="text-xs font-medium text-foreground truncate max-w-32 cursor-text"
            data-testid={`terminal-title-${terminalId}`}
            contentEditable
            suppressContentEditableWarning
            onBlur={(e) => {
              const newTitle = e.currentTarget.textContent?.trim();
              if (newTitle && newTitle !== title) {
                onTitleChange(newTitle);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
          >
            {title}
          </span>
        </div>

        {/* Claude mode toggle button */}
        <button
          type="button"
          data-testid={`terminal-claude-toggle-${terminalId}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleClaudeMode?.();
          }}
          className={cn(
            "flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded transition-colors",
            isClaudeMode
              ? "text-primary bg-primary/15"
              : "text-muted-foreground hover:text-foreground hover:bg-muted",
          )}
          title={isClaudeMode ? "Claude Mode Active" : "Enable Claude Mode"}
        >
          <Sparkles className="h-2.5 w-2.5" />
          {terminalCount < 4 && <span>Claude</span>}
        </button>

        {/* AGY (--dangerously-skip-permissions) mode toggle button right next to Claude */}
        <button
          type="button"
          data-testid={`terminal-agy-toggle-${terminalId}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleAgyMode?.();
          }}
          className={cn(
            "flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded transition-colors",
            isAgyMode
              ? "text-emerald-800 dark:text-emerald-300 bg-emerald-500/15"
              : "text-muted-foreground hover:text-emerald-700 dark:hover:text-emerald-300 hover:bg-emerald-500/10",
          )}
          title={
            isAgyMode
              ? "AGY Active (--dangerously-skip-permissions)"
              : "Open AGY (--dangerously-skip-permissions) to summarize & execute tasks"
          }
        >
          <Zap className="h-2.5 w-2.5" />
          {terminalCount < 4 && <span>AGY</span>}
        </button>

        {/* VS Code Online (Local Self-Hosted Web IDE) toggle button */}
        <button
          type="button"
          data-testid={`terminal-vscode-toggle-${terminalId}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleVSCodeMode?.();
          }}
          className={cn(
            "flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded transition-colors",
            isVSCodeMode
              ? "text-sky-800 dark:text-sky-300 bg-sky-500/20"
              : "text-muted-foreground hover:text-sky-700 dark:hover:text-sky-300 hover:bg-sky-500/10",
          )}
          title={
            isVSCodeMode
              ? "Switch back to Terminal (VS Code Online active)"
              : "Open current directory in local VS Code Online IDE"
          }
        >
          <Code2 className="h-3 w-3" />
          {terminalCount < 4 && <span>Code</span>}
        </button>

        {isVSCodeMode && vscodeUrl && (
          <a
            href={vscodeUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`terminal-vscode-external-${terminalId}`}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded text-sky-800 dark:text-sky-300 bg-sky-500/15 hover:bg-sky-500/25 transition-colors"
            title="Open VS Code Online in a new browser tab"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}

        <TaskSelector
          terminalId={terminalId}
          backlogTasks={selectableTasks}
          associatedTask={associatedTask}
          onTaskSelect={onTaskSelect}
          onClearTask={onClearTask}
          onNewTaskClick={onNewTaskClick}
        />

        {/* Worktree selector */}
        {projectPath && onCreateWorktree && onSelectWorktree && (
          <WorktreeSelector
            terminalId={terminalId}
            projectPath={projectPath}
            currentWorktree={worktreeConfig}
            worktrees={worktrees}
            onCreateWorktree={onCreateWorktree}
            onSelectWorktree={onSelectWorktree}
          />
        )}
      </div>

      <div className="flex items-center gap-1">
        {onToggleExpand && (
          <Button
            variant="ghost"
            size="icon"
            data-testid={`terminal-expand-btn-${terminalId}`}
            className="h-6 w-6 hover:bg-muted"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
          >
            {isExpanded ? (
              <Minimize2 className="h-3 w-3" />
            ) : (
              <Maximize2 className="h-3 w-3" />
            )}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          data-testid={`terminal-close-btn-${terminalId}`}
          className="h-6 w-6 hover:bg-destructive/20 hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
