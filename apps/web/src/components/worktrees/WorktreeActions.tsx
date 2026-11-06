"use client";

import { useState } from "react";
import {
  GitMerge,
  Trash2,
  FileCode,
  Loader2,
  GitPullRequest,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { WorktreeListItem } from "@auto-claude/types";
import { apiClient } from "@/lib/data/api-client";

export interface WorktreeMergeNotification {
  specName: string;
  mergeCommitSha?: string;
  mergeCommitMessage?: string;
  mergedAt?: string;
}

interface WorktreeActionsProps {
  worktree: WorktreeListItem;
  projectId: string;
  isDiffOpen?: boolean;
  onMerged?: (info?: WorktreeMergeNotification) => void;
  onDeleted?: () => void;
  onDiffView?: () => void;
}

export function WorktreeActions({
  worktree,
  projectId,
  isDiffOpen,
  onMerged,
  onDeleted,
  onDiffView,
}: WorktreeActionsProps) {
  const { t } = useTranslation("views");
  const [isMerging, setIsMerging] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [prMessage, setPrMessage] = useState<string | null>(null);
  const isMerged = worktree.status === "merged";

  const handleMerge = async () => {
    setIsMerging(true);
    try {
      const res = await apiClient.mergeWorktree(projectId, worktree.specName);
      const dataObj = (res?.data || {}) as Record<string, unknown>;
      onMerged?.({
        specName: worktree.specName,
        mergeCommitSha:
          res?.mergeCommitSha ||
          (typeof dataObj.mergeCommitSha === "string"
            ? dataObj.mergeCommitSha
            : undefined),
        mergeCommitMessage:
          res?.mergeCommitMessage ||
          (typeof dataObj.mergeCommitMessage === "string"
            ? dataObj.mergeCommitMessage
            : undefined),
        mergedAt:
          res?.mergedAt ||
          (typeof dataObj.mergedAt === "string" ? dataObj.mergedAt : undefined),
      });
    } catch {
      // Error handled by caller
    } finally {
      setIsMerging(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setIsDeleting(true);
    try {
      await apiClient.discardWorktree(projectId, worktree.specName);
      onDeleted?.();
    } catch {
      // Error handled by caller
    } finally {
      setIsDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          data-testid={`worktree-diff-btn-${worktree.specName}`}
          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
            isDiffOpen
              ? "border-primary bg-primary/15 text-primary"
              : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
          onClick={onDiffView}
        >
          <FileCode className="h-3.5 w-3.5" />
          {isDiffOpen
            ? t("worktrees.actions.hideDiff", "Hide Diff")
            : t("worktrees.actions.diff", "Check Diff")}
        </button>

        {!worktree.isOrphaned && !isMerged && (
          <>
            <button
              data-testid={`worktree-merge-btn-${worktree.specName}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
              onClick={handleMerge}
              disabled={isMerging}
            >
              {isMerging ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <GitMerge className="h-3.5 w-3.5" />
              )}
              {t("worktrees.actions.merge")}
            </button>

            <button
              data-testid={`worktree-pr-btn-${worktree.specName}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
              onClick={() =>
                setPrMessage(
                  `Branch ${worktree.branch} is ready for Pull Request against ${worktree.baseBranch}.`,
                )
              }
            >
              <GitPullRequest className="h-3.5 w-3.5" />
              {t("worktrees.actions.createPR")}
            </button>
          </>
        )}

        {!isMerged && (
          <button
            data-testid={`worktree-discard-btn-${worktree.specName}`}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
              confirmDelete
                ? "border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
            onClick={handleDelete}
            disabled={isDeleting}
            onBlur={() => setConfirmDelete(false)}
          >
            {isDeleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            {confirmDelete ? t("worktrees.actions.confirmDelete") : t("worktrees.actions.discard")}
          </button>
        )}
      </div>
      {prMessage && (
        <p className="text-xs text-primary">{prMessage}</p>
      )}
    </div>
  );
}
