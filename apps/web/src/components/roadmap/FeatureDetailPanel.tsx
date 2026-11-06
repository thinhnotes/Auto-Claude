"use client";

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  Zap,
  ExternalLink,
  Trash2,
  CheckCircle2,
  Pencil,
  Save,
  Bot,
} from "lucide-react";
import { cn } from "@auto-claude/ui";
import type {
  RoadmapFeature,
  RoadmapFeatureStatus,
} from "@/stores/roadmap-store";

export interface RoadmapFeatureUpdateInput {
  title?: string;
  description?: string;
  priority?: number | string;
  status?: RoadmapFeatureStatus | "idea";
  triggerAiBuild?: boolean;
}

interface FeatureDetailPanelProps {
  feature: RoadmapFeature;
  onClose: () => void;
  onConvertToSpec?: (feature: RoadmapFeature) => void;
  onUpdateFeature?: (
    featureId: string,
    updates: RoadmapFeatureUpdateInput,
  ) => Promise<void> | void;
  onGoToTask?: (specId: string) => void;
  onDelete?: (featureId: string) => void;
}

const STATUS_LABELS: Record<string, string> = {
  idea: "Idea",
  under_review: "Under Review",
  planned: "Planned",
  in_progress: "In Progress",
  done: "Done",
};

function priorityNumberToCode(priority?: number): string {
  if (priority === undefined || priority <= 1) return "must";
  if (priority === 2) return "should";
  if (priority === 3) return "could";
  return "wont";
}

function priorityCodeToNumber(code: string): number {
  if (code === "must" || code === "high") return 1;
  if (code === "should" || code === "medium") return 2;
  if (code === "could" || code === "low") return 3;
  return 4;
}

export function FeatureDetailPanel({
  feature,
  onClose,
  onConvertToSpec,
  onUpdateFeature,
  onGoToTask,
  onDelete,
}: FeatureDetailPanelProps) {
  const { t } = useTranslation("views");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(feature.title);
  const [editDescription, setEditDescription] = useState(feature.description);
  const [editPriority, setEditPriority] = useState(
    priorityNumberToCode(feature.priority),
  );
  const [editStatus, setEditStatus] = useState<string>(
    feature.status || "planned",
  );
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setEditTitle(feature.title);
    setEditDescription(feature.description);
    setEditPriority(priorityNumberToCode(feature.priority));
    setEditStatus(feature.status || "planned");
  }, [feature.id, feature.title, feature.description, feature.priority, feature.status]);

  const handleDelete = () => {
    onDelete?.(feature.id);
    onClose();
  };

  const handleSave = async (triggerAiBuild: boolean) => {
    const cleanTitle = editTitle.trim() || feature.title;
    const cleanDesc = editDescription.trim();
    const mappedPriority = priorityCodeToNumber(editPriority);
    const normalizedStatus = (
      editStatus === "idea" ? "under_review" : editStatus
    ) as RoadmapFeatureStatus;

    setIsSaving(true);
    try {
      if (onUpdateFeature) {
        await onUpdateFeature(feature.id, {
          title: cleanTitle,
          description: cleanDesc,
          priority: mappedPriority,
          status: normalizedStatus,
          triggerAiBuild,
        });
      } else if (triggerAiBuild && onConvertToSpec) {
        onConvertToSpec({
          ...feature,
          title: cleanTitle,
          description: cleanDesc,
          priority: mappedPriority,
          status: normalizedStatus,
        });
      }
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const priorityLabel =
    feature.priority !== undefined
      ? feature.priority <= 1
        ? "High"
        : feature.priority <= 2
          ? "Medium"
          : "Low"
      : "—";

  return (
    <div
      data-testid="roadmap-feature-detail-panel"
      className="fixed inset-y-0 right-0 z-50 w-96 border-l border-border bg-card shadow-xl flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border p-4">
        <h2 className="text-sm font-semibold">
          {t("roadmap.detail.title", "Feature Details")}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-testid="roadmap-edit-feature-btn"
            title={t("roadmap.detail.editFeature", "Edit Feature")}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
              isEditing
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            onClick={() => setIsEditing((prev) => !prev)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          {onDelete && (
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-red-500/10 hover:text-red-500 transition-colors"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent transition-colors"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isEditing ? (
          <div
            data-testid="roadmap-edit-feature-form"
            className="space-y-3 rounded-lg border border-purple-500/30 bg-purple-500/5 p-3"
          >
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                {t("roadmap.detail.featureTitle", "Feature Title")}
              </label>
              <input
                type="text"
                data-testid="roadmap-feature-title-input"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                {t("roadmap.detail.featureDescription", "Description")}
              </label>
              <textarea
                data-testid="roadmap-feature-description-input"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={4}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  {t("roadmap.detail.priority", "Priority")}
                </label>
                <select
                  data-testid="roadmap-feature-priority-select"
                  value={editPriority}
                  onChange={(e) => setEditPriority(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="must">Must Have (High)</option>
                  <option value="should">Should Have (Medium)</option>
                  <option value="could">Could Have (Low)</option>
                  <option value="wont">Won&apos;t Have</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  {t("roadmap.detail.status", "Status")}
                </label>
                <select
                  data-testid="roadmap-feature-status-select"
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="idea">Idea / Under Review</option>
                  <option value="under_review">Under Review</option>
                  <option value="planned">Planned</option>
                  <option value="in_progress">In Progress</option>
                  <option value="done">Done</option>
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <button
                type="button"
                data-testid="roadmap-save-feature-btn"
                disabled={isSaving || !editTitle.trim()}
                onClick={() => void handleSave(false)}
                className="w-full flex items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                {t("roadmap.detail.saveChanges", "Save Changes")}
              </button>
              <button
                type="button"
                data-testid="roadmap-save-and-build-btn"
                disabled={isSaving || !editTitle.trim()}
                onClick={() => void handleSave(true)}
                className="w-full flex items-center justify-center gap-1.5 rounded-md bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 transition-colors disabled:opacity-50"
              >
                <Bot className="h-3.5 w-3.5" />
                {t(
                  "roadmap.detail.saveAndAiBuild",
                  "Save & AI Fix / Build Feature",
                )}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <h3 className="text-lg font-semibold">{feature.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {feature.description}
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">
              {t("roadmap.detail.priority")}
            </p>
            <p className="text-sm font-medium">{priorityLabel}</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">
              {t("roadmap.detail.status")}
            </p>
            <p className="text-sm font-medium">
              {STATUS_LABELS[feature.status] ?? feature.status}
            </p>
          </div>
        </div>

        {/* Task outcome */}
        {feature.taskOutcome && (
          <div className="flex items-center gap-2 rounded-md border border-border p-3">
            <CheckCircle2
              className={cn(
                "h-4 w-4",
                feature.taskOutcome === "completed"
                  ? "text-green-500"
                  : feature.taskOutcome === "failed"
                    ? "text-red-500"
                    : "text-yellow-500",
              )}
            />
            <span className="text-sm font-medium capitalize">
              {feature.taskOutcome}
            </span>
          </div>
        )}

        {/* Source */}
        {feature.source && (
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">
              {t("roadmap.detail.source")}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm font-medium capitalize">
                {feature.source.provider}
              </span>
              {feature.source.issueUrl && (
                <a
                  href={feature.source.issueUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        )}

        {/* Linked task */}
        {feature.linkedSpecId && (
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">
              {t("roadmap.detail.linkedTask")}
            </p>
            <button
              className="mt-1 flex items-center gap-1.5 text-sm text-primary hover:underline"
              onClick={() => onGoToTask?.(feature.linkedSpecId!)}
            >
              <ExternalLink className="h-3 w-3" />
              {feature.linkedSpecId}
            </button>
          </div>
        )}
      </div>

      {/* Actions */}
      {!feature.taskOutcome && !feature.linkedSpecId && feature.status !== "done" && onConvertToSpec && (
        <div className="shrink-0 border-t border-border p-4">
          <button
            className="w-full flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 transition-colors"
            onClick={() => onConvertToSpec(feature)}
          >
            <Zap className="h-4 w-4" />
            {t("roadmap.detail.convertToTask")}
          </button>
        </div>
      )}

      {feature.linkedSpecId && !feature.taskOutcome && (
        <div className="shrink-0 border-t border-border p-4">
          <button
            className="w-full flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 transition-colors"
            onClick={() => onGoToTask?.(feature.linkedSpecId!)}
          >
            <ExternalLink className="h-4 w-4" />
            {t("roadmap.detail.goToTask")}
          </button>
        </div>
      )}

      {/* Delete confirmation overlay */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/95 p-6">
          <div className="text-center space-y-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
              <Trash2 className="h-6 w-6 text-red-500" />
            </div>
            <div>
              <h3 className="font-semibold">
                {t("roadmap.detail.deleteConfirmTitle")}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("roadmap.detail.deleteConfirmDescription", {
                  title: feature.title,
                })}
              </p>
            </div>
            <div className="flex justify-center gap-2">
              <button
                className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent transition-colors"
                onClick={() => setShowDeleteConfirm(false)}
              >
                {t("roadmap.detail.cancel")}
              </button>
              <button
                className="rounded-md bg-red-500 px-4 py-2 text-sm text-white hover:bg-red-600 transition-colors"
                onClick={handleDelete}
              >
                {t("roadmap.detail.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
