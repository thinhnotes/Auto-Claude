"use client";

import {
  RefreshCw,
  AlertCircle,
  FolderTree,
  Server,
  Globe,
  Box,
  Code,
} from "lucide-react";
import { cn } from "@auto-claude/ui";
import { useTranslation } from "react-i18next";
import type { ProjectIndex } from "@/stores/context-store";

interface ServiceInfo {
  name: string;
  language: string;
  framework: string;
  type: string;
  path: string;
}

interface ProjectIndexTabProps {
  projectIndex: ProjectIndex | null;
  indexLoading: boolean;
  indexError: string | null;
  onRefresh: () => void;
}

const TYPE_ICONS: Record<string, React.ElementType> = {
  frontend: Globe,
  backend: Server,
  library: Box,
  worker: Code,
};

export function ProjectIndexTab({
  projectIndex,
  indexLoading,
  indexError,
  onRefresh,
}: ProjectIndexTabProps) {
  const { t } = useTranslation("integrations");

  const languages = Array.isArray(projectIndex?.languages)
    ? projectIndex.languages
    : [];
  const frameworks = Array.isArray(projectIndex?.frameworks)
    ? projectIndex.frameworks
    : [];
  const fileList = Array.isArray(projectIndex?.fileList)
    ? projectIndex.fileList
    : Array.isArray((projectIndex as any)?.files)
      ? ((projectIndex as any).files as string[])
      : [];
  const fileCount =
    typeof projectIndex?.files === "number"
      ? projectIndex.files
      : (projectIndex?.fileCount ?? fileList.length);
  const services = Array.isArray(projectIndex?.services)
    ? (projectIndex.services as ServiceInfo[])
    : [];
  const analyzedAt =
    projectIndex?.analyzedAt || (projectIndex as any)?.updatedAt;

  return (
    <div className="max-w-4xl mx-auto space-y-6" data-testid="project-index-tab">
      {/* Header with refresh */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            {t("context.fields.projectStructure")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t("context.projectIndex.description", { defaultValue: "AI-discovered knowledge about your codebase" })}
          </p>
        </div>
        <button
          data-testid="context-reindex-btn"
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
          onClick={onRefresh}
          disabled={indexLoading}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", indexLoading && "animate-spin")} />
          {t("context.reindex")}
        </button>
      </div>

      {/* Error state */}
      {indexError && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/10 text-destructive">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <div>
            <p className="text-sm font-medium">{t("context.errors.indexFailed", { defaultValue: "Failed to load project index" })}</p>
            <p className="text-xs opacity-80">{indexError}</p>
          </div>
        </div>
      )}

      {/* Loading state */}
      {indexLoading && !projectIndex && (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* No index state */}
      {!indexLoading && !projectIndex && !indexError && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <FolderTree className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-sm font-semibold mb-1">
            {t("context.empty.noIndex", { defaultValue: "No Project Index Found" })}
          </h3>
          <p className="text-xs text-muted-foreground max-w-sm">
            {t("context.empty.noIndexDescription", { defaultValue: "Click Refresh to analyze your project structure and create an index." })}
          </p>
          <button
            data-testid="context-empty-reindex-btn"
            onClick={onRefresh}
            className="mt-4 flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("context.reindex")}
          </button>
        </div>
      )}

      {/* Project index content */}
      {projectIndex && (
        <div className="space-y-6" data-testid="project-index-content">
          {/* Overview Card */}
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <FolderTree className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">{t("context.fields.projectStructure")}</h2>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-md bg-muted/40 p-3" data-testid="project-index-files-count">
                <p className="text-xs text-muted-foreground">{t("context.fields.files", { defaultValue: "Files" })}</p>
                <p className="text-sm font-medium">{fileCount}</p>
              </div>
              <div className="rounded-md bg-muted/40 p-3" data-testid="project-index-languages">
                <p className="text-xs text-muted-foreground">{t("context.fields.languages", { defaultValue: "Languages" })}</p>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {languages.map((lang) => (
                    <span
                      key={lang}
                      className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {lang}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            {frameworks.length > 0 && (
              <div className="mt-4 border-t border-border pt-4" data-testid="project-index-frameworks">
                <p className="text-xs text-muted-foreground mb-1">{t("context.fields.frameworks", { defaultValue: "Frameworks" })}</p>
                <div className="flex flex-wrap gap-1">
                  {frameworks.map((fw) => (
                    <span
                      key={fw}
                      className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {fw}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {services.length > 0 && (
              <div className="mt-4 border-t border-border pt-4" data-testid="project-index-services">
                <p className="text-xs text-muted-foreground mb-2">
                  {t("context.fields.services", { defaultValue: "Discovered Services & Modules" })}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {services.map((svc) => {
                    const Icon = TYPE_ICONS[svc.type] || Code;
                    return (
                      <div
                        key={svc.path}
                        className="flex items-center gap-2 rounded bg-muted/40 px-2.5 py-1.5 text-xs"
                      >
                        <Icon className="h-3.5 w-3.5 text-primary shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{svc.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{svc.path}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {fileList.length > 0 && (
              <div className="mt-4 border-t border-border pt-4" data-testid="project-index-file-list">
                <p className="text-xs text-muted-foreground mb-2">
                  Indexed Files ({fileList.length})
                </p>
                <div className="max-h-48 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1 font-mono text-xs text-muted-foreground">
                  {fileList.map((filePath) => (
                    <div
                      key={filePath}
                      className="truncate rounded px-1.5 py-0.5 hover:bg-accent/50"
                    >
                      {filePath}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Analyzed timestamp */}
          {analyzedAt && (
            <p className="text-xs text-muted-foreground text-right" data-testid="project-index-analyzed-at">
              {t("context.fields.lastAnalyzed", { defaultValue: "Last analyzed" })}:{" "}
              {new Date(analyzedAt).toLocaleString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
