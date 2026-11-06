"use client";

import { useState, useEffect, useCallback } from "react";
import {
  GitBranch,
  GitMerge,
  GitCommit,
  RefreshCw,
  Plus,
  Loader2,
  CheckCircle2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@auto-claude/ui";
import {
  apiClient,
  type GitLogCommitEntry,
} from "@/lib/data/api-client";
import type { WorktreeListItem } from "@auto-claude/types";
import { WorktreeList } from "./WorktreeList";
import { CreateWorktreeDialog } from "./CreateWorktreeDialog";
import type { WorktreeMergeNotification } from "./WorktreeActions";

interface WorktreesViewProps {
  projectId: string;
}

export function WorktreesView({ projectId }: WorktreesViewProps) {
  const { t } = useTranslation("views");
  const [worktrees, setWorktrees] = useState<WorktreeListItem[]>([]);
  const [mergedWorktrees, setMergedWorktrees] = useState<WorktreeListItem[]>(
    [],
  );
  const [gitLog, setGitLog] = useState<GitLogCommitEntry[]>([]);
  const [activeTab, setActiveTab] = useState<"active" | "merged">("active");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSpecName, setSelectedSpecName] = useState<string | null>(null);
  const [selectedMergedSpecName, setSelectedMergedSpecName] = useState<
    string | null
  >(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [lastMergedBanner, setLastMergedBanner] =
    useState<WorktreeMergeNotification | null>(null);

  const loadWorktrees = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiClient.listWorktrees(projectId);
      const rawWorktrees =
        response.worktrees ??
        (response as unknown as { data?: WorktreeListItem[] }).data ??
        [];
      const rawMerged = response.mergedWorktrees ?? [];
      const rawGitLog = response.gitLog ?? [];
      setWorktrees(Array.isArray(rawWorktrees) ? rawWorktrees : []);
      setMergedWorktrees(Array.isArray(rawMerged) ? rawMerged : []);
      setGitLog(Array.isArray(rawGitLog) ? rawGitLog : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load worktrees");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadWorktrees();
  }, [loadWorktrees]);

  const handleWorktreeMerged = useCallback(
    (info?: WorktreeMergeNotification) => {
      if (info?.specName) {
        setLastMergedBanner(info);
      }
    },
    [],
  );

  const renderGitLogSection = (testIdPrefix: string) => {
    if (gitLog.length === 0) return null;
    return (
      <div
        data-testid={`${testIdPrefix}-git-log-list`}
        className="rounded-lg border border-border bg-card overflow-hidden"
      >
        <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <GitCommit className="h-4 w-4 text-primary" />
            <span className="text-xs font-semibold text-foreground">
              {t(
                "worktrees.gitLog.title",
                "main Branch Commit Log (git log)",
              )}
            </span>
          </div>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {gitLog.length} commit{gitLog.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="divide-y divide-border/60 max-h-72 overflow-y-auto">
          {gitLog.map((entry) => (
            <div
              key={entry.sha}
              data-testid={`git-log-commit-${entry.shortSha}`}
              className="flex items-center justify-between gap-3 px-4 py-2 text-xs hover:bg-accent/30"
            >
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-semibold text-primary">
                  {entry.shortSha}
                </span>
                <span className="truncate font-medium text-foreground">
                  {entry.message}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                <span>{entry.author}</span>
                {entry.date && (
                  <span className="font-mono">
                    {entry.date.slice(0, 10)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div data-testid="worktrees-view" className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-3">
        <div className="flex items-center gap-3">
          <GitBranch className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{t("worktrees.title")}</h1>
          {worktrees.length > 0 && (
            <span
              data-testid="worktrees-count-badge"
              className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
            >
              {worktrees.length}
            </span>
          )}

          {/* Tab Switcher */}
          <div className="ml-2 inline-flex items-center rounded-lg border border-border bg-muted/40 p-0.5">
            <button
              type="button"
              data-testid="worktrees-tab-active"
              onClick={() => setActiveTab("active")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors",
                activeTab === "active"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <GitBranch className="h-3.5 w-3.5" />
              {t("worktrees.tabs.active", "Active Worktrees")} ({worktrees.length})
            </button>
            <button
              type="button"
              data-testid="worktrees-tab-merged"
              onClick={() => setActiveTab("merged")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors",
                activeTab === "merged"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <GitMerge className="h-3.5 w-3.5 text-emerald-500" />
              {t("worktrees.tabs.merged", "Merged & main Git Log")} (
              {mergedWorktrees.length})
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            data-testid="worktrees-refresh-btn"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            onClick={loadWorktrees}
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {t("worktrees.refresh")}
          </button>
          <button
            data-testid="worktrees-new-btn"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            onClick={() => setShowCreateDialog(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("worktrees.create.button")}
          </button>
        </div>
      </div>

      {/* Merge Confirmation Banner */}
      {lastMergedBanner && (
        <div
          data-testid="worktree-merged-banner"
          className="mx-6 mt-4 flex items-center justify-between gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-800 dark:text-emerald-300"
        >
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
            <span className="truncate font-medium">
              Merged <code className="font-mono">auto-claude/{lastMergedBanner.specName}</code>{" "}
              into <code className="font-mono">main</code>
              {lastMergedBanner.mergeCommitSha
                ? ` (commit #${lastMergedBanner.mergeCommitSha})`
                : ""}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {activeTab !== "merged" && (
              <button
                type="button"
                data-testid="worktree-merged-banner-view-btn"
                onClick={() => setActiveTab("merged")}
                className="rounded border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold hover:bg-emerald-500/25"
              >
                View in Merged & main Git Log
              </button>
            )}
            <button
              type="button"
              onClick={() => setLastMergedBanner(null)}
              className="rounded p-1 hover:bg-emerald-500/20"
              aria-label="Dismiss merge banner"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {activeTab === "active" ? (
          <>
            <WorktreeList
              worktrees={worktrees}
              isLoading={isLoading}
              error={error}
              projectId={projectId}
              selectedSpecName={selectedSpecName}
              onSelect={setSelectedSpecName}
              onRefresh={loadWorktrees}
              onMerged={handleWorktreeMerged}
            />

            {(mergedWorktrees.length > 0 || gitLog.length > 0) && (
              <div
                data-testid="worktrees-merged-history-section"
                className="space-y-4 border-t border-border pt-6"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <GitMerge className="h-4 w-4 text-emerald-500" />
                    <h2 className="text-sm font-semibold text-foreground">
                      {t(
                        "worktrees.mergedSection.title",
                        `Recently Merged into main (${mergedWorktrees.length})`,
                      )}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab("merged")}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Open Full Merged & Git Log View →
                  </button>
                </div>

                {mergedWorktrees.length > 0 && (
                  <WorktreeList
                    worktrees={mergedWorktrees}
                    isLoading={false}
                    error={null}
                    projectId={projectId}
                    selectedSpecName={selectedMergedSpecName}
                    onSelect={setSelectedMergedSpecName}
                    onRefresh={loadWorktrees}
                  />
                )}

                {renderGitLogSection("worktrees")}
              </div>
            )}
          </>
        ) : (
          <div
            data-testid="worktrees-merged-tab-panel"
            className="space-y-6"
          >
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <GitMerge className="h-4 w-4 text-emerald-500" />
                <h2 className="text-sm font-semibold text-foreground">
                  Merged Worktrees into main ({mergedWorktrees.length})
                </h2>
              </div>
              <WorktreeList
                worktrees={mergedWorktrees}
                isLoading={isLoading}
                error={error}
                projectId={projectId}
                selectedSpecName={selectedMergedSpecName}
                onSelect={setSelectedMergedSpecName}
                onRefresh={loadWorktrees}
              />
            </div>

            {renderGitLogSection("merged-tab")}
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <CreateWorktreeDialog
        projectId={projectId}
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreated={loadWorktrees}
      />
    </div>
  );
}
