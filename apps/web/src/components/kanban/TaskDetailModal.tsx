"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  GitPullRequest,
  ExternalLink,
  Bot,
  Save,
  Sparkles,
  Loader2,
  Terminal,
} from "lucide-react";
import {
  cn,
  Button,
  Input,
  Textarea,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Separator,
  TooltipProvider,
} from "@auto-claude/ui";
import { TaskHeader } from "@/components/task-detail/TaskHeader";
import { TaskMetadata } from "@/components/task-detail/TaskMetadata";
import { TaskProgress } from "@/components/task-detail/TaskProgress";
import { TaskSubtasks } from "@/components/task-detail/TaskSubtasks";
import { TaskFiles } from "@/components/task-detail/TaskFiles";
import { TaskLogs } from "@/components/task-detail/TaskLogs";
import { TaskActions } from "@/components/task-detail/TaskActions";
import { TaskReview } from "@/components/task-detail/TaskReview";
import { TaskWarnings } from "@/components/task-detail/TaskWarnings";
import { TaskTerminal } from "@/components/task-detail/TaskTerminal";
import {
  approveTask,
  rejectTask,
  updateTaskDetails,
} from "@/stores/task-store";
import type { Task } from "@auto-claude/types";

interface TaskDetailModalProps {
  task: Task;
  initialTab?: string;
  onClose: () => void;
  onStart?: (taskId: string) => void;
  onStop?: (taskId: string) => void;
  onApprove?: (taskId: string, feedback?: string) => void;
  onReject?: (taskId: string, feedback: string) => void;
  onDelete?: (taskId: string) => void;
  onOpenInTerminalsView?: (task: Task) => void;
  onUpdateTask?: (
    taskId: string,
    updates: {
      title?: string;
      description?: string;
      instructions?: string;
      triggerAiFix?: boolean;
    },
  ) => void;
}

export function TaskDetailModal({
  task,
  initialTab = "overview",
  onClose,
  onStart,
  onStop,
  onApprove,
  onReject,
  onDelete,
  onOpenInTerminalsView,
  onUpdateTask,
}: TaskDetailModalProps) {
  const { t } = useTranslation(["kanban", "common"]);
  const [activeTab, setActiveTab] = useState<string>(initialTab || "overview");
  const [isStuck, setIsStuck] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const [editDescription, setEditDescription] = useState(
    task.description || "",
  );
  const [editInstructions, setEditInstructions] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  useEffect(() => {
    setActiveTab(initialTab || "overview");
  }, [initialTab, task.id]);

  useEffect(() => {
    setEditTitle(task.title);
    setEditDescription(task.description || "");
  }, [task.id, task.title, task.description]);

  // Escape key handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Stuck detection: if in_progress but no updates for 60s
  useEffect(() => {
    if (task.status !== "in_progress") {
      setIsStuck(false);
      return;
    }

    const checkStuck = () => {
      const lastUpdate = task.updatedAt
        ? new Date(task.updatedAt).getTime()
        : 0;
      const elapsed = Date.now() - lastUpdate;
      setIsStuck(elapsed > 60_000);
    };

    checkStuck();
    const interval = setInterval(checkStuck, 10_000);
    return () => clearInterval(interval);
  }, [task.status, task.updatedAt]);

  const isRunning = task.status === "in_progress";
  const safeSubtasks = useMemo(
    () => (Array.isArray(task.subtasks) ? task.subtasks : []),
    [task.subtasks],
  );
  const safeLogs = useMemo(
    () => (Array.isArray(task.logs) ? task.logs : []),
    [task.logs],
  );
  const isIncomplete = useMemo(() => {
    if (safeSubtasks.length === 0) return false;
    const completed = safeSubtasks.filter(
      (s) => s.status === "completed",
    ).length;
    return (
      completed > 0 &&
      completed < safeSubtasks.length &&
      !isRunning &&
      task.status !== "done"
    );
  }, [safeSubtasks, isRunning, task.status]);

  const taskProgress = useMemo(
    () => ({
      completed: safeSubtasks.filter((s) => s.status === "completed").length,
      total: safeSubtasks.length,
    }),
    [safeSubtasks],
  );

  const fileCount = useMemo(() => {
    if (Array.isArray(task.fileDiffs) && task.fileDiffs.length > 0) {
      return task.fileDiffs.length;
    }
    const set = new Set<string>();
    for (const st of safeSubtasks) {
      if (Array.isArray(st.files)) {
        for (const f of st.files) set.add(f);
      }
    }
    return set.size;
  }, [task.fileDiffs, safeSubtasks]);

  const reviewCommentsCount = Array.isArray(task.reviewComments)
    ? task.reviewComments.length
    : 0;

  const hasSubtasks = safeSubtasks.length > 0;
  const hasLogs = safeLogs.length > 0;
  const isReviewable = task.status === "human_review";

  const handleApprove = (feedback?: string) => {
    if (onApprove) {
      onApprove(task.id, feedback);
    } else if (task.projectId) {
      void approveTask(task.projectId, task.id, feedback);
    }
    onClose();
  };

  const handleReject = (feedback: string) => {
    if (onReject) {
      onReject(task.id, feedback);
    } else if (task.projectId) {
      void rejectTask(task.projectId, task.id, feedback);
    }
  };

  const handleSaveFeature = async (triggerAiFix: boolean) => {
    const cleanTitle = editTitle.trim() || task.title;
    const cleanDesc = editDescription.trim();
    const cleanInstructions = editInstructions.trim();

    setIsSavingEdit(true);
    try {
      if (onUpdateTask) {
        onUpdateTask(task.id, {
          title: cleanTitle,
          description: cleanDesc,
          instructions: cleanInstructions || undefined,
          triggerAiFix,
        });
      }
      if (triggerAiFix && onReject) {
        const feedbackBody =
          cleanInstructions ||
          `Updated feature specification: ${cleanTitle} — ${cleanDesc || cleanTitle}`;
        onReject(
          task.id,
          feedbackBody.startsWith("[Scope:")
            ? feedbackBody
            : `[Scope: Entire Feature] ${feedbackBody}`,
        );
      }
      if (task.projectId) {
        await updateTaskDetails(task.projectId, task.id, {
          title: cleanTitle,
          description: cleanDesc,
          instructions: cleanInstructions || undefined,
          triggerAiFix,
        }).catch(() => {
          // Ignore network error in unit test environment without live server
        });
      }
      setEditInstructions("");
      setIsEditing(false);
    } finally {
      setIsSavingEdit(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4"
      data-testid="task-detail-modal"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        data-testid="task-detail-modal-container"
        data-expanded={isExpanded ? "true" : "false"}
        className={cn(
          "relative z-10 w-full overflow-hidden rounded-xl border border-border bg-card shadow-2xl flex flex-col transition-all duration-200",
          isExpanded
            ? "w-[95vw] max-w-[95vw] h-[92vh] max-h-[92vh]"
            : "max-w-3xl max-h-[85vh]",
        )}
      >
        <TooltipProvider>
          {/* Header */}
          <TaskHeader
            task={task}
            isStuck={isStuck}
            isIncomplete={isIncomplete}
            taskProgress={taskProgress}
            isRunning={isRunning}
            isExpanded={isExpanded}
            onToggleExpand={() => setIsExpanded((prev) => !prev)}
            onOpenTerminal={() => setActiveTab("terminal")}
            onClose={onClose}
            onEdit={() => setIsEditing((prev) => !prev)}
          />

          <Separator />

          {/* Edit Entire Feature Panel */}
          {isEditing && (
            <div
              data-testid="task-edit-feature-panel"
              className="border-b border-purple-500/30 bg-purple-500/5 px-4 py-3.5 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-purple-700 dark:text-purple-300">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>
                    {t(
                      "kanban:detail.editEntireFeatureTitle",
                      "Edit Entire Feature & Multi-File AI Fix",
                    )}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {t(
                    "kanban:detail.editFeatureSubtitle",
                    "Changes apply across the feature spec and all associated files",
                  )}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-2.5">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    {t("kanban:detail.featureTitleLabel", "Feature Title")}
                  </label>
                  <Input
                    data-testid="edit-feature-title-input"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder={t(
                      "kanban:detail.featureTitlePlaceholder",
                      "Enter feature title...",
                    )}
                    className="h-8 text-xs bg-background"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    {t(
                      "kanban:detail.featureDescriptionLabel",
                      "Feature Description & Specification",
                    )}
                  </label>
                  <Textarea
                    data-testid="edit-feature-description-input"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    placeholder={t(
                      "kanban:detail.featureDescriptionPlaceholder",
                      "Describe the feature requirements, architecture, and expected behavior...",
                    )}
                    rows={3}
                    className="resize-none text-xs bg-background"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-purple-700 dark:text-purple-300 mb-1">
                    {t(
                      "kanban:detail.featureAiInstructionsLabel",
                      "AI Fix / Rebuild Instructions across Entire Feature (Optional)",
                    )}
                  </label>
                  <Textarea
                    data-testid="edit-feature-instructions-input"
                    value={editInstructions}
                    onChange={(e) => setEditInstructions(e.target.value)}
                    placeholder={t(
                      "kanban:detail.featureAiInstructionsPlaceholder",
                      "Optional instructions for the AI agent to check and update all files in this feature...",
                    )}
                    rows={2}
                    className="resize-none text-xs bg-background"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="cancel-edit-feature-btn"
                  onClick={() => {
                    setEditTitle(task.title);
                    setEditDescription(task.description || "");
                    setEditInstructions("");
                    setIsEditing(false);
                  }}
                >
                  {t("kanban:wizard.cancel", "Cancel")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="save-feature-btn"
                  disabled={isSavingEdit || !editTitle.trim()}
                  onClick={() => void handleSaveFeature(false)}
                  className="gap-1.5"
                >
                  {isSavingEdit ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  {t("kanban:detail.saveFeature", "Save Feature")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  data-testid="save-and-ai-fix-feature-btn"
                  disabled={isSavingEdit || !editTitle.trim()}
                  onClick={() => void handleSaveFeature(true)}
                  className="gap-1.5 bg-purple-600 hover:bg-purple-700 text-white"
                >
                  {isSavingEdit ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Bot className="h-3.5 w-3.5" />
                  )}
                  {t(
                    "kanban:detail.saveAndAiFixFeature",
                    "Save & AI Fix Entire Feature",
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Warnings */}
          <div className="px-4 pt-3">
            <TaskWarnings task={task} isStuck={isStuck} />
          </div>

          {/* Tabbed Content */}
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="flex-1 flex flex-col min-h-0"
          >
            <div className="px-4 pt-2">
              <TabsList>
                <TabsTrigger value="overview" data-testid="tab-overview">
                  {t("kanban:detail.tabOverview", "Overview")}
                </TabsTrigger>
                {hasSubtasks && (
                  <TabsTrigger value="subtasks" data-testid="tab-subtasks">
                    {t("kanban:detail.tabSubtasks", "Subtasks")}
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({taskProgress.completed}/{taskProgress.total})
                    </span>
                  </TabsTrigger>
                )}
                <TabsTrigger value="files" data-testid="tab-files">
                  {t("kanban:detail.tabFiles", "Files")}
                  {fileCount > 0 && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({fileCount})
                    </span>
                  )}
                </TabsTrigger>
                {hasLogs && (
                  <TabsTrigger value="logs" data-testid="tab-logs">
                    {t("kanban:detail.tabLogs", "Logs")}
                  </TabsTrigger>
                )}
                {(isReviewable || reviewCommentsCount > 0) && (
                  <TabsTrigger value="review" data-testid="tab-review">
                    {t("kanban:detail.tabReview", "Review")}
                    {reviewCommentsCount > 0 && (
                      <span className="ml-1 text-xs text-purple-600 dark:text-purple-400 font-semibold">
                        ({reviewCommentsCount})
                      </span>
                    )}
                  </TabsTrigger>
                )}
                <TabsTrigger value="terminal" data-testid="tab-terminal">
                  <Terminal className="h-3.5 w-3.5 mr-1" />
                  {t("kanban:detail.tabTerminal", "Terminal")}
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-4">
              {/* Overview Tab */}
              <TabsContent value="overview" className="space-y-6 mt-4">
                {/* Direct Human Review Comment & AI Fix Panel inside Overview when in human_review or has comments */}
                {(isReviewable || reviewCommentsCount > 0) && (
                  <TaskReview
                    task={task}
                    onApprove={handleApprove}
                    onReject={handleReject}
                  />
                )}

                {/* Description */}
                {task.description && (
                  <div>
                    <h3 className="text-sm font-medium mb-2">
                      {t("kanban:detail.description")}
                    </h3>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {task.description}
                    </p>
                  </div>
                )}

                {/* Progress */}
                {(task.executionProgress || isRunning) && (
                  <div>
                    <h3 className="text-sm font-medium mb-2">
                      {t("kanban:detail.executionProgress")}
                    </h3>
                    <TaskProgress task={task} />
                  </div>
                )}

                {/* Metadata */}
                <div>
                  <h3 className="text-sm font-medium mb-2">
                    {t("kanban:detail.details")}
                  </h3>
                  <TaskMetadata task={task} />
                </div>

                {/* QA Report */}
                {task.qaReport && (
                  <div>
                    <h3 className="text-sm font-medium mb-2">
                      {t("kanban:detail.qaReport")}
                    </h3>
                    <div
                      className={cn(
                        "rounded-lg border p-4",
                        task.qaReport.status === "passed" &&
                          "border-green-500/30 bg-green-500/5",
                        task.qaReport.status === "failed" &&
                          "border-red-500/30 bg-red-500/5",
                        task.qaReport.status === "pending" &&
                          "border-border bg-card",
                      )}
                    >
                      <p className="text-sm font-medium capitalize">
                        {t("kanban:detail.qaStatus", {
                          status: task.qaReport.status,
                        })}
                      </p>
                      {task.qaReport.issues &&
                        task.qaReport.issues.length > 0 && (
                          <ul className="mt-2 space-y-1">
                            {task.qaReport.issues.map((issue) => (
                              <li
                                key={issue.id}
                                className="text-xs text-muted-foreground flex items-start gap-1"
                              >
                                <span
                                  className={cn(
                                    "shrink-0 mt-0.5 h-1.5 w-1.5 rounded-full",
                                    issue.severity === "critical" &&
                                      "bg-red-500",
                                    issue.severity === "major" &&
                                      "bg-orange-500",
                                    issue.severity === "minor" &&
                                      "bg-yellow-500",
                                  )}
                                />
                                {issue.description}
                              </li>
                            ))}
                          </ul>
                        )}
                    </div>
                  </div>
                )}

                {/* PR Link */}
                {task.metadata?.prUrl && (
                  <a
                    href={task.metadata.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded-lg border border-border p-3 hover:bg-accent transition-colors"
                  >
                    <GitPullRequest className="h-4 w-4 text-green-500" />
                    <span className="text-sm">
                      {t("kanban:detail.viewPullRequest")}
                    </span>
                    <ExternalLink className="h-3 w-3 text-muted-foreground ml-auto" />
                  </a>
                )}
              </TabsContent>

              {/* Subtasks Tab */}
              <TabsContent value="subtasks" className="mt-4">
                <TaskSubtasks task={task} />
              </TabsContent>

              {/* Files & Code Diff Tab */}
              <TabsContent value="files" className="mt-4">
                <TaskFiles task={task} onRequestChanges={handleReject} />
              </TabsContent>

              {/* Logs Tab */}
              <TabsContent value="logs" className="mt-4">
                <TaskLogs task={task} />
              </TabsContent>

              {/* Review Tab */}
              <TabsContent value="review" className="mt-4">
                <TaskReview
                  task={task}
                  onApprove={handleApprove}
                  onReject={handleReject}
                />
              </TabsContent>

              {/* Terminal Tab (Scoped to Task Source Tree Folder) */}
              <TabsContent value="terminal" className="mt-4">
                <TaskTerminal
                  task={task}
                  onOpenInTerminalsView={(t) => {
                    onClose();
                    onOpenInTerminalsView?.(t);
                  }}
                />
              </TabsContent>
            </div>
          </Tabs>

          {/* Footer Actions */}
          <Separator />
          <div className="p-4 flex items-center justify-between gap-2">
            <TaskActions
              task={task}
              isStuck={isStuck}
              onStart={onStart ? () => onStart(task.id) : undefined}
              onStop={onStop ? () => onStop(task.id) : undefined}
              onDelete={
                onDelete
                  ? () => {
                      onDelete(task.id);
                      onClose();
                    }
                  : undefined
              }
            />
            {task.status === "human_review" && (
              <button
                type="button"
                data-testid="modal-approve-task-btn"
                className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 transition-colors"
                onClick={() => handleApprove()}
              >
                ✓ Approve & Complete
              </button>
            )}
          </div>
        </TooltipProvider>
      </div>
    </div>
  );
}
