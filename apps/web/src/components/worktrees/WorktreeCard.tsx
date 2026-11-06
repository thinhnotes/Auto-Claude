"use client";

import {
  GitBranch,
  GitMerge,
  FileCode,
  Plus,
  Minus,
  AlertCircle,
  Eye,
  EyeOff,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@auto-claude/ui";
import type { WorktreeListItem } from "@auto-claude/types";

interface WorktreeCardProps {
  worktree: WorktreeListItem;
  isSelected?: boolean;
  isDiffOpen?: boolean;
  onSelect?: () => void;
  onCheckDiff?: (specName: string) => void;
}

export function WorktreeCard({
  worktree,
  isSelected,
  isDiffOpen,
  onSelect,
  onCheckDiff,
}: WorktreeCardProps) {
  const { t } = useTranslation("views");

  return (
    <div
      data-testid={`worktree-card-${worktree.specName}`}
      className={cn(
        "cursor-pointer rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/50",
        isSelected && "border-primary bg-accent/30",
        worktree.isOrphaned && "border-destructive/50 opacity-75",
      )}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium">{worktree.specName}</span>
            {worktree.status === "merged" && (
              <span
                data-testid={`worktree-merged-badge-${worktree.specName}`}
                className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:text-emerald-300"
              >
                <GitMerge className="h-3 w-3" />
                Merged into {worktree.baseBranch || "main"}
              </span>
            )}
            {worktree.isOrphaned && (
              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
            )}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {worktree.branch} → {worktree.baseBranch}
          </p>
        </div>

        {/* Stats & Direct Check Diff Action */}
        <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
          {worktree.filesChanged != null && (
            <span
              data-testid={`worktree-files-changed-${worktree.specName}`}
              className="flex items-center gap-1"
            >
              <FileCode className="h-3 w-3" />
              {worktree.filesChanged}
            </span>
          )}
          {worktree.additions != null && (
            <span
              data-testid={`worktree-additions-${worktree.specName}`}
              className="flex items-center gap-0.5 text-green-700 dark:text-green-300"
            >
              <Plus className="h-3 w-3" />
              {worktree.additions}
            </span>
          )}
          {worktree.deletions != null && (
            <span
              data-testid={`worktree-deletions-${worktree.specName}`}
              className="flex items-center gap-0.5 text-red-700 dark:text-red-300"
            >
              <Minus className="h-3 w-3" />
              {worktree.deletions}
            </span>
          )}
          {onCheckDiff && (
            <button
              type="button"
              data-testid={`worktree-card-check-diff-btn-${worktree.specName}`}
              onClick={(e) => {
                e.stopPropagation();
                onCheckDiff(worktree.specName);
              }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                isDiffOpen
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20",
              )}
            >
              {isDiffOpen ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
              {isDiffOpen
                ? t("worktrees.actions.hideDiff", "Hide Diff")
                : t("worktrees.actions.checkDiff", "Check Diff")}
            </button>
          )}
        </div>
      </div>

      {worktree.status === "merged" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {worktree.mergeCommitSha && (
            <span
              data-testid={`worktree-merge-sha-${worktree.specName}`}
              className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-medium text-foreground"
            >
              commit #{worktree.mergeCommitSha}
            </span>
          )}
          {worktree.mergeCommitMessage && (
            <span className="truncate text-muted-foreground">
              {worktree.mergeCommitMessage}
            </span>
          )}
        </div>
      ) : (
        worktree.commitCount != null &&
        worktree.commitCount > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            {worktree.commitCount} commit{worktree.commitCount !== 1 ? "s" : ""} ahead
          </p>
        )
      )}
    </div>
  );
}
