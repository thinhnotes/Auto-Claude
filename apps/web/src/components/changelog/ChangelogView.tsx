"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  FileText,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useChangelogStore } from "@/stores/changelog-store";
import { apiClient } from "@/lib/data/api-client";
import { ChangelogFilters } from "./ChangelogFilters";
import { ConfigurationPanel } from "./ConfigurationPanel";
import { PreviewPanel } from "./PreviewPanel";
import { TaskCard, CommitCard } from "./ChangelogEntry";

interface ChangelogViewProps {
  projectId: string;
}

export function ChangelogView({ projectId }: ChangelogViewProps) {
  const { t } = useTranslation("views");
  const [step, setStep] = useState<1 | 2>(1);

  const {
    doneTasks,
    selectedTaskIds,
    existingChangelog,
    sourceMode,
    branches,
    tags,
    defaultBranch,
    previewCommits,
    isLoadingGitData,
    isLoadingCommits,
    gitHistoryType,
    gitHistoryCount,
    gitHistorySinceDate,
    gitHistoryFromTag,
    gitHistoryToTag,
    gitHistorySinceVersion,
    includeMergeCommits,
    baseBranch,
    compareBranch,
    version,
    date,
    format,
    audience,
    emojiLevel,
    customInstructions,
    generationProgress,
    generatedChangelog,
    isGenerating,
    error,
    toggleTaskSelection,
    selectAllTasks,
    deselectAllTasks,
    setSourceMode,
    setGitHistoryType,
    setGitHistoryCount,
    setGitHistorySinceDate,
    setGitHistoryFromTag,
    setGitHistoryToTag,
    setGitHistorySinceVersion,
    setIncludeMergeCommits,
    setBaseBranch,
    setCompareBranch,
    setVersion,
    setDate,
    setFormat,
    setAudience,
    setEmojiLevel,
    setCustomInstructions,
    updateGeneratedChangelog,
    setDoneTasks,
    setSelectedTaskIds,
    setExistingChangelog,
    setGeneratedChangelog,
    setIsGenerating,
    setError,
    setBranches,
    setPreviewCommits,
  } = useChangelogStore();

  const loadChangelogData = useCallback(async () => {
    if (!projectId) return;
    try {
      const [tasksRes, clRes] = await Promise.all([
        apiClient.getTasks(projectId).catch(() => ({ tasks: [] })),
        apiClient.getChangelog(projectId).catch(() => ({ changelog: null })),
      ]);
      const rawTasks = Array.isArray((tasksRes as any)?.tasks)
        ? (tasksRes as any).tasks
        : Array.isArray((tasksRes as any)?.data)
          ? (tasksRes as any).data
          : [];
      const completedOrAll = rawTasks.filter(
        (t: any) => t.status === "done" || t.status === "completed" || rawTasks.length > 0,
      );
      const mapped = completedOrAll.map((t: any, idx: number) => ({
        id: String(t.id),
        title: String(t.title || t.id),
        specNumber: String(t.specId || t.id).split("-")[0] || String(idx + 1).padStart(3, "0"),
        status: String(t.status || "done"),
      }));
      setDoneTasks(mapped);
      setSelectedTaskIds(mapped.map((t: { id: string }) => t.id));

      setBranches([
        { name: "main", isCurrent: true, isRemote: false },
        { name: "develop", isCurrent: false, isRemote: false },
      ]);
      setPreviewCommits(
        mapped.map((t: { id: string; title: string }, idx: number) => ({
          hash: `a1b2c3${idx}`,
          message: `feat: ${t.title}`,
          author: "Aperant AI Agent",
          date: new Date().toISOString(),
        })),
      );

      const content =
        (clRes as any)?.content ||
        (clRes as any)?.changelog ||
        (clRes as any)?.data?.content ||
        null;
      if (typeof content === "string" && content.trim()) {
        setExistingChangelog({
          content,
          lastVersion: "1.0.0",
          path: "CHANGELOG.md",
        });
        setGeneratedChangelog(content);
      }
    } catch {
      // Non-fatal
    }
  }, [
    projectId,
    setDoneTasks,
    setSelectedTaskIds,
    setBranches,
    setPreviewCommits,
    setExistingChangelog,
    setGeneratedChangelog,
  ]);

  useEffect(() => {
    loadChangelogData();
  }, [loadChangelogData]);

  const canContinue =
    sourceMode === "tasks"
      ? selectedTaskIds.length > 0
      : previewCommits.length > 0;

  const canGenerate = !isGenerating;
  const canSave = generatedChangelog.length > 0;

  const handleContinue = useCallback(() => {
    if (canContinue) {
      setStep(2);
    }
  }, [canContinue]);

  const handleBack = useCallback(() => {
    setStep(1);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!projectId) return;
    setIsGenerating(true);
    setError(null);
    try {
      const res = await apiClient.generateChangelog(projectId, {
        version: version || "1.0.0",
        taskIds: selectedTaskIds,
      });
      const content =
        (res as any)?.content ||
        (res as any)?.changelog ||
        (res as any)?.data?.content ||
        "";
      if (content) {
        setGeneratedChangelog(content);
        setExistingChangelog({
          content,
          lastVersion: version || "1.0.0",
          path: "CHANGELOG.md",
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate changelog");
    } finally {
      setIsGenerating(false);
    }
  }, [
    projectId,
    version,
    selectedTaskIds,
    setIsGenerating,
    setError,
    setGeneratedChangelog,
    setExistingChangelog,
  ]);

  const handleCopy = useCallback(() => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(generatedChangelog).catch(() => {});
    }
  }, [generatedChangelog]);

  const handleRefresh = useCallback(() => {
    loadChangelogData();
  }, [loadChangelogData]);

  const handleLoadCommitsPreview = useCallback(() => {
    loadChangelogData();
  }, [loadChangelogData]);

  const selectedCount =
    sourceMode === "tasks" ? selectedTaskIds.length : previewCommits.length;

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <FileText className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-medium">
            {t("changelog.empty.title")}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("changelog.empty.description")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="changelog-view">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">{t("changelog.title")}</h1>
          {step === 2 && (
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
              {t("changelog.stepConfigure")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="changelog-refresh-btn"
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            onClick={handleRefresh}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("changelog.refresh")}
          </button>
          {step === 1 && (
            <button
              type="button"
              data-testid="changelog-continue-btn"
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              onClick={handleContinue}
              disabled={!canContinue}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {t("changelog.continue")}
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {step === 1 && (
        <div className="flex flex-1 overflow-hidden">
          <ChangelogFilters
            sourceMode={sourceMode}
            onSourceModeChange={setSourceMode}
            doneTasksCount={doneTasks.length}
            branches={branches}
            tags={tags}
            defaultBranch={defaultBranch}
            isLoadingGitData={isLoadingGitData}
            isLoadingCommits={isLoadingCommits}
            gitHistoryType={gitHistoryType}
            gitHistoryCount={gitHistoryCount}
            gitHistorySinceDate={gitHistorySinceDate}
            gitHistoryFromTag={gitHistoryFromTag}
            gitHistoryToTag={gitHistoryToTag}
            gitHistorySinceVersion={gitHistorySinceVersion}
            includeMergeCommits={includeMergeCommits}
            onGitHistoryTypeChange={setGitHistoryType}
            onGitHistoryCountChange={setGitHistoryCount}
            onGitHistorySinceDateChange={setGitHistorySinceDate}
            onGitHistoryFromTagChange={setGitHistoryFromTag}
            onGitHistoryToTagChange={setGitHistoryToTag}
            onGitHistorySinceVersionChange={setGitHistorySinceVersion}
            onIncludeMergeCommitsChange={setIncludeMergeCommits}
            baseBranch={baseBranch}
            compareBranch={compareBranch}
            onBaseBranchChange={setBaseBranch}
            onCompareBranchChange={setCompareBranch}
            onLoadCommitsPreview={handleLoadCommitsPreview}
          />

          {/* Task/Commit List */}
          <div className="flex-1 overflow-y-auto p-6">
            {sourceMode === "tasks" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-medium">
                    {t("changelog.tasks.title")}
                  </h2>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      data-testid="changelog-select-all-btn"
                      className="text-xs text-primary hover:underline"
                      onClick={selectAllTasks}
                    >
                      {t("changelog.tasks.selectAll")}
                    </button>
                    <span className="text-xs text-muted-foreground">/</span>
                    <button
                      type="button"
                      data-testid="changelog-deselect-all-btn"
                      className="text-xs text-primary hover:underline"
                      onClick={deselectAllTasks}
                    >
                      {t("changelog.tasks.deselectAll")}
                    </button>
                  </div>
                </div>
                {doneTasks.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <FileText className="h-10 w-10 text-muted-foreground/30" />
                    <p className="mt-3 text-sm text-muted-foreground">
                      {t("changelog.tasks.empty")}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {doneTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        isSelected={selectedTaskIds.includes(task.id)}
                        onToggle={() => toggleTaskSelection(task.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {sourceMode !== "tasks" && (
              <div className="space-y-4">
                <h2 className="text-sm font-medium">
                  {t("changelog.commits.title")}
                </h2>
                {previewCommits.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <FileText className="h-10 w-10 text-muted-foreground/30" />
                    <p className="mt-3 text-sm text-muted-foreground">
                      {t("changelog.commits.empty")}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {previewCommits.map((commit) => (
                      <CommitCard key={commit.hash} commit={commit} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-1 overflow-hidden">
          <ConfigurationPanel
            sourceMode={sourceMode}
            selectedCount={selectedCount}
            existingChangelog={existingChangelog}
            version={version}
            date={date}
            format={format}
            audience={audience}
            emojiLevel={emojiLevel}
            customInstructions={customInstructions}
            generationProgress={generationProgress}
            isGenerating={isGenerating}
            error={error}
            canGenerate={canGenerate}
            onBack={handleBack}
            onVersionChange={setVersion}
            onDateChange={setDate}
            onFormatChange={setFormat}
            onAudienceChange={setAudience}
            onEmojiLevelChange={setEmojiLevel}
            onCustomInstructionsChange={setCustomInstructions}
            onGenerate={handleGenerate}
          />
          <PreviewPanel
            generatedChangelog={generatedChangelog}
            canSave={canSave}
            onCopy={handleCopy}
            onChangelogEdit={updateGeneratedChangelog}
          />
        </div>
      )}
    </div>
  );
}
