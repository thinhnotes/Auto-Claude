"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  Loader2,
  MessageSquare,
  Bot,
  Sparkles,
  FileCode,
} from "lucide-react";
import { cn, Button, Textarea, Badge } from "@auto-claude/ui";
import type { Task } from "@auto-claude/types";

interface TaskReviewProps {
  task: Task;
  onApprove?: (feedback: string) => void;
  onReject?: (feedback: string) => void;
  isSubmitting?: boolean;
}

export function TaskReview({
  task,
  onApprove,
  onReject,
  isSubmitting = false,
}: TaskReviewProps) {
  const { t } = useTranslation(["kanban"]);
  const [feedback, setFeedback] = useState("");

  const reviewComments = Array.isArray(task.reviewComments)
    ? task.reviewComments
    : [];
  const isHumanReview = task.status === "human_review";

  if (!isHumanReview && reviewComments.length === 0) return null;

  const handleReject = () => {
    if (!feedback.trim() || !onReject) return;
    const text = feedback.trim();
    setFeedback("");
    onReject(text);
  };

  return (
    <div
      data-testid="task-review-section"
      className="space-y-4 rounded-lg border border-purple-500/30 bg-purple-500/5 p-4"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground flex-wrap">
          <MessageSquare className="h-4 w-4 text-purple-700 dark:text-purple-300" />
          <span>
            {t(
              "kanban:detail.reviewFeedback",
              "Human Review — Comment & AI Check / Fix",
            )}
          </span>
          <Badge
            variant="outline"
            data-testid="review-scope-badge"
            className="text-xs border-purple-500/40 bg-purple-500/15 text-purple-700 dark:text-purple-300"
          >
            <Sparkles className="h-3 w-3 mr-1" />
            {t(
              "kanban:detail.entireFeatureScopeBadge",
              "Scope: Entire Feature (All Files)",
            )}
          </Badge>
          {reviewComments.length > 0 && (
            <Badge
              variant="outline"
              className="text-xs border-purple-500/40 text-purple-700 dark:text-purple-300"
            >
              {reviewComments.length} comment{reviewComments.length > 1 ? "s" : ""}
            </Badge>
          )}
        </div>

        {task.reviewReason && (
          <span className="text-xs text-muted-foreground">
            {t("kanban:detail.reviewReason", "Status:")}{" "}
            <span className="font-medium text-emerald-800 dark:text-emerald-300">
              {t(`kanban:card.review.${task.reviewReason}`, task.reviewReason)}
            </span>
          </span>
        )}
      </div>

      {/* Review Comment & AI Fix History */}
      {reviewComments.length > 0 && (
        <div
          data-testid="review-comments-history"
          className="space-y-2.5 max-h-60 overflow-y-auto pr-1"
        >
          {reviewComments.map((item) => (
            <div
              key={item.id}
              data-testid={`review-comment-item-${item.id}`}
              className="rounded-md bg-muted/40 p-3 space-y-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold text-foreground">
                    👤 Reviewer Comment
                  </span>
                  {item.filePath ? (
                    <code className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-purple-700 dark:text-purple-300">
                      <FileCode className="h-3 w-3" />
                      {item.filePath}
                      {item.lineNumber ? `:L${item.lineNumber}` : ""}
                    </code>
                  ) : (
                    <code className="inline-flex items-center gap-1 rounded bg-purple-500/15 px-1.5 py-0.5 font-mono text-xs text-purple-700 dark:text-purple-300">
                      <Sparkles className="h-3 w-3" />
                      {t(
                        "kanban:detail.entireFeatureBadge",
                        "Entire Feature (All Files)",
                      )}
                    </code>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    data-testid={`review-comment-status-${item.id}`}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                      item.status === "addressed"
                        ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"
                        : "bg-amber-500/15 text-amber-800 dark:text-amber-300",
                    )}
                  >
                    {item.status === "addressed" ? (
                      <>
                        <Sparkles className="h-3 w-3" />
                        ✓ AI Fixed
                      </>
                    ) : (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        AI Fixing...
                      </>
                    )}
                  </span>
                </div>
              </div>

              <p className="text-foreground whitespace-pre-wrap">
                {item.comment}
              </p>

              {item.aiResponse && (
                <div
                  data-testid={`review-comment-ai-response-${item.id}`}
                  className="rounded bg-emerald-500/10 p-2.5 text-emerald-900 dark:text-emerald-200 space-y-1.5"
                >
                  <div className="flex items-center gap-1.5 font-semibold text-xs text-emerald-800 dark:text-emerald-300">
                    <Bot className="h-3.5 w-3.5" />
                    AI Agent Check & Fix Report
                  </div>
                  <p className="text-xs leading-relaxed">
                    {item.aiResponse}
                  </p>
                  {Array.isArray(item.modifiedFiles) &&
                    item.modifiedFiles.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap pt-0.5">
                        <span className="text-xs text-muted-foreground">
                          Updated files:
                        </span>
                        {item.modifiedFiles.map((f) => (
                          <code
                            key={f}
                            className="rounded bg-background/80 px-1.5 py-0.5 font-mono text-xs"
                          >
                            {f}
                          </code>
                        ))}
                      </div>
                    )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Interactive Comment & Action Form when in human_review */}
      {isHumanReview && (
        <div className="space-y-3">
          <Textarea
            data-testid="review-feedback-textarea"
            placeholder={t(
              "kanban:detail.feedbackPlaceholder",
              "Enter review comments or requested changes for the AI agent to check and fix (e.g., add error handling, unit tests, edge cases)...",
            )}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={3}
            className="resize-none bg-background text-sm"
          />

          <div className="flex flex-wrap items-center gap-2">
            {onReject && (
              <Button
                type="button"
                data-testid="submit-review-reject-btn"
                onClick={handleReject}
                disabled={isSubmitting || !feedback.trim()}
                size="sm"
                className="gap-1.5 bg-purple-600 hover:bg-purple-700 text-white"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Bot className="h-4 w-4" />
                )}
                {t("kanban:detail.requestAiFix", "Comment & Request AI Fix")}
              </Button>
            )}
            {onApprove && (
              <Button
                type="button"
                data-testid="submit-review-approve-btn"
                onClick={() => onApprove(feedback)}
                disabled={isSubmitting}
                size="sm"
                className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                ✓ Approve & Complete
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
