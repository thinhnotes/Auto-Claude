"use client";

import { useState, useEffect } from "react";
import {
  FolderOpen,
  FolderPlus,
  Folder,
  X,
  Check,
  Loader2,
  AlertCircle,
  ArrowRight,
} from "lucide-react";
import {
  useProjectStore,
  loadProjects,
  createAndOpenProject,
} from "@/stores/project-store";
import { useUIStore } from "@/stores/ui-store";

interface OpenProjectDialogProps {
  open: boolean;
  onClose: () => void;
}

const QUICK_SERVER_PATHS = [
  {
    name: "AZ305 Telegram Bot",
    path: "/home/thinhnguyen/ClawdCodeWorkspace/sandbox/az305-telegram-bot",
  },
  {
    name: "ClawdCodeWorkspace",
    path: "/home/thinhnguyen/ClawdCodeWorkspace",
  },
  {
    name: "Aperant Web",
    path: "/home/thinhnguyen/.gemini/antigravity-cli/scratch/Aperant",
  },
];

export function OpenProjectDialog({ open, onClose }: OpenProjectDialogProps) {
  const rawProjects = useProjectStore((s) => s.projects);
  const projects = Array.isArray(rawProjects) ? rawProjects : [];
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const openProjectTab = useProjectStore((s) => s.openProjectTab);
  const setActiveView = useUIStore((s) => s.setActiveView);

  const [pathInput, setPathInput] = useState(
    "/home/thinhnguyen/ClawdCodeWorkspace/sandbox/az305-telegram-bot",
  );
  const [nameInput, setNameInput] = useState("AZ305 Telegram Bot");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      loadProjects();
    }
  }, [open]);

  if (!open) return null;

  const handleSelectExisting = (projectId: string) => {
    openProjectTab(projectId);
    setActiveView("kanban");
    onClose();
  };

  const handleConnectPath = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pathInput.trim()) {
      setError("Please enter a directory path on the server.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await createAndOpenProject(pathInput.trim(), nameInput.trim() || undefined);
      setActiveView("kanban");
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to connect project",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      data-testid="open-project-dialog"
    >
      <div className="w-full max-w-xl rounded-xl border border-border bg-card text-card-foreground shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FolderOpen className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">
                Open / Connect Project
              </h2>
              <p className="text-xs text-muted-foreground">
                Select a registered workspace or connect a server directory
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-6 p-6">
          {/* Registered Projects List */}
          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Registered Projects ({projects.length})
              </span>
            </div>
            <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
              {projects.map((project) => {
                const isCurrent = project.id === activeProjectId;
                return (
                  <div
                    key={project.id}
                    className="flex items-center justify-between rounded-lg border border-border bg-background/60 px-3.5 py-2.5 transition-colors hover:border-primary/50 hover:bg-accent/30"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3 pr-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Folder className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {project.name}
                          </span>
                          {isCurrent && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                              <Check className="h-2.5 w-2.5" /> Active
                            </span>
                          )}
                        </div>
                        <span className="block truncate font-mono text-xs text-muted-foreground">
                          {project.path}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      data-testid={`dialog-open-project-${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                      onClick={() => handleSelectExisting(project.id)}
                      className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      Open
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}

              {projects.length === 0 && (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  No registered projects found. Use the form below to connect one.
                </div>
              )}
            </div>
          </div>

          <div className="h-px bg-border" />

          {/* Connect by Server Directory Path */}
          <form onSubmit={handleConnectPath} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Connect Server Directory Path
              </label>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {QUICK_SERVER_PATHS.map((preset) => (
                  <button
                    key={preset.path}
                    type="button"
                    onClick={() => {
                      setPathInput(preset.path);
                      setNameInput(preset.name);
                    }}
                    className="rounded-md border border-border bg-secondary/60 px-2.5 py-1 text-xs text-foreground hover:bg-secondary"
                  >
                    + {preset.name}
                  </button>
                ))}
              </div>
              <input
                type="text"
                data-testid="project-path-input"
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                placeholder="/home/thinhnguyen/ClawdCodeWorkspace/sandbox/az305-telegram-bot"
                className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Project Display Name (Optional)
              </label>
              <input
                type="text"
                data-testid="project-name-input"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="AZ305 Telegram Bot"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border bg-secondary px-4 py-2 text-xs font-medium text-foreground hover:bg-secondary/80"
              >
                Cancel
              </button>
              <button
                type="submit"
                data-testid="submit-connect-project"
                disabled={isSubmitting}
                className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FolderPlus className="h-4 w-4" />
                )}
                Connect & Open Project
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
