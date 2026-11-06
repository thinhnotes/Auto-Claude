"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  X,
  RefreshCw,
  Play,
  Download,
  Plus,
  Settings2,
  CheckCircle2,
  MessageSquare,
  ExternalLink,
  Search,
  Loader2,
  Bug,
  BookOpen,
  CheckSquare,
} from "lucide-react";
import { cn } from "@auto-claude/ui";
import { apiClient } from "@/lib/data";

interface AzureDevOpsComment {
  id: string;
  author: string;
  text: string;
  createdAt: string;
}

interface AzureDevOpsWorkItem {
  id: number;
  type: string;
  title: string;
  state: string;
  priority: number;
  assignedTo: string;
  tags: string[];
  description: string;
  url: string;
  linkedTaskId?: string;
  linkedTaskStatus?: string;
  comments: AzureDevOpsComment[];
  updatedAt: string;
}

interface AzureDevOpsConfig {
  organizationUrl: string;
  project: string;
  personalAccessToken: string;
  useMock: boolean;
  connected: boolean;
  updatedAt: string;
}

interface AzureDevOpsModalProps {
  projectId: string;
  onClose: () => void;
  onImported: () => void;
}

const STATE_BADGE_STYLES: Record<string, string> = {
  New: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  Active: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  Resolved: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30",
  Done: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30",
  Closed: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30",
};

const TYPE_BADGE_STYLES: Record<string, string> = {
  Bug: "bg-red-500/15 text-red-600 dark:text-red-400",
  "User Story": "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  Task: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
};

export function AzureDevOpsModal({
  projectId,
  onClose,
  onImported,
}: AzureDevOpsModalProps) {
  const [config, setConfig] = useState<AzureDevOpsConfig | null>(null);
  const [workItems, setWorkItems] = useState<AzureDevOpsWorkItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [filterType, setFilterType] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [showConfigForm, setShowConfigForm] = useState(false);
  const [showNewTicketForm, setShowNewTicketForm] = useState(false);
  const [expandedComments, setExpandedComments] = useState<Record<number, boolean>>({});
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Config form state
  const [orgUrlInput, setOrgUrlInput] = useState("https://dev.azure.com/auto-claude-org");
  const [adoProjectInput, setAdoProjectInput] = useState("Aperant-Platform");
  const [patInput, setPatInput] = useState("");
  const [useMockInput, setUseMockInput] = useState(true);
  const [isTestingConfig, setIsTestingConfig] = useState(false);
  const [configTestFeedback, setConfigTestFeedback] = useState<{
    success: boolean;
    message: string;
    details?: string;
  } | null>(null);

  // New ticket form state
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newType, setNewType] = useState("Bug");
  const [newPriority, setNewPriority] = useState(1);

  const showConfigFormRef = useRef(showConfigForm);
  showConfigFormRef.current = showConfigForm;

  const loadAzureDevOpsData = useCallback(
    async (forceRefresh: boolean = false) => {
      setIsLoading(true);
      try {
        const res = await apiClient.getAzureDevOps(projectId, {
          refresh: forceRefresh,
        });
        if (res?.config) {
          setConfig(res.config);
          if (!showConfigFormRef.current) {
            setOrgUrlInput(
              res.config.organizationUrl || "https://dev.azure.com/auto-claude-org",
            );
            setAdoProjectInput(res.config.project || "Aperant-Platform");
            setPatInput(res.config.personalAccessToken || "");
            setUseMockInput(res.config.useMock ?? true);
          }
        }
        if (Array.isArray(res?.workItems)) {
          setWorkItems(res.workItems);
        }
        if (forceRefresh) {
          if ((res as any)?.refreshError) {
            setStatusBanner(`Refresh warning: ${(res as any).refreshError}`);
          } else {
            setStatusBanner("Azure DevOps tickets refreshed successfully from server.");
          }
        }
      } catch (err: any) {
        console.error("[AzureDevOpsModal] Failed to load work items:", err);
        if (forceRefresh) {
          setStatusBanner(`Refresh failed: ${err.message || "Failed to contact server."}`);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [projectId],
  );

  const handleTestConfig = async () => {
    setIsTestingConfig(true);
    setConfigTestFeedback(null);
    try {
      const res = await apiClient.testAzureDevOpsConnection(projectId, {
        organizationUrl: orgUrlInput,
        project: adoProjectInput,
        personalAccessToken: patInput,
        useMock: useMockInput,
      });
      if (res.valid) {
        setConfigTestFeedback({
          success: true,
          message:
            res.message || "Connection to Azure DevOps verified successfully!",
        });
      } else {
        setConfigTestFeedback({
          success: false,
          message: res.message || "Connection test failed.",
          details: res.error,
        });
      }
    } catch (err: any) {
      setConfigTestFeedback({
        success: false,
        message: err.message || "Failed to validate Azure DevOps connection.",
      });
    } finally {
      setIsTestingConfig(false);
    }
  };

  useEffect(() => {
    void loadAzureDevOpsData();
  }, [loadAzureDevOpsData]);

  useEffect(() => {
    const timer = setInterval(() => {
      void apiClient
        .getAzureDevOps(projectId)
        .then((res) => {
          if (Array.isArray(res?.workItems)) {
            setWorkItems(res.workItems);
          }
          if (res?.config && !showConfigFormRef.current) {
            setConfig(res.config);
          }
        })
        .catch(() => {});
    }, 1200);
    return () => clearInterval(timer);
  }, [projectId]);

  const filteredItems = useMemo(() => {
    return workItems.filter((item) => {
      if (filterType !== "All" && item.type !== filterType) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = item.title.toLowerCase().includes(q);
        const matchId = String(item.id).includes(q) || `#${item.id}`.includes(q);
        const matchTag = (item.tags || []).some((t) => t.toLowerCase().includes(q));
        return matchTitle || matchId || matchTag;
      }
      return true;
    });
  }, [workItems, filterType, searchQuery]);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleSaveConfig = async () => {
    setIsSubmitting(true);
    try {
      const res = await apiClient.saveAzureDevOpsConfig(projectId, {
        organizationUrl: orgUrlInput,
        project: adoProjectInput,
        personalAccessToken: patInput,
        useMock: useMockInput,
      });
      if (res?.config) setConfig(res.config);
      if (Array.isArray(res?.workItems)) setWorkItems(res.workItems);
      setShowConfigForm(false);
      if ((res as any)?.refreshError) {
        setStatusBanner(`Configuration saved with warning: ${(res as any).refreshError}`);
      } else {
        setStatusBanner("Azure DevOps connection settings saved and synchronized.");
      }
    } catch (err: any) {
      setConfigTestFeedback({
        success: false,
        message: err.message || "Failed to save Azure DevOps configuration.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateTicket = async () => {
    if (!newTitle.trim()) return;
    setIsSubmitting(true);
    try {
      const res = await apiClient.createAzureDevOpsTicket(projectId, {
        title: newTitle.trim(),
        description: newDescription.trim(),
        type: newType,
        priority: newPriority,
        tags: ["azure-devops", newType.toLowerCase().replace(/\s+/g, "-")],
      });
      if (Array.isArray(res?.workItems)) {
        setWorkItems(res.workItems);
      }
      if (res?.ticket?.id) {
        setSelectedIds((prev) => [...prev, res.ticket.id]);
      }
      setNewTitle("");
      setNewDescription("");
      setShowNewTicketForm(false);
      setStatusBanner(`Created Azure DevOps Work Item #${res?.ticket?.id || "new"}.`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleImport = async (idsToImport: number[], autoStart: boolean) => {
    const targetIds =
      idsToImport.length > 0
        ? idsToImport
        : filteredItems[0]
          ? [filteredItems[0].id]
          : [];
    if (targetIds.length === 0) return;

    setIsSubmitting(true);
    try {
      const res = await apiClient.importAzureDevOpsTickets(
        projectId,
        targetIds,
        autoStart,
      );
      if (Array.isArray(res?.workItems)) {
        setWorkItems(res.workItems);
      }
      onImported();
      setStatusBanner(
        autoStart
          ? `Imported & started ${targetIds.map((id) => `#${id}`).join(", ")} in Auto Claude pipeline!`
          : `Imported ${targetIds.map((id) => `#${id}`).join(", ")} to Kanban Backlog.`,
      );
      if (autoStart) {
        onClose();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderTypeIcon = (type: string) => {
    if (type === "Bug") return <Bug className="h-3 w-3" />;
    if (type === "User Story") return <BookOpen className="h-3 w-3" />;
    return <CheckSquare className="h-3 w-3" />;
  };

  return (
    <div
      data-testid="azure-devops-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4 bg-muted/20">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600/15 text-blue-600 dark:text-blue-400 font-bold text-base">
              🔷
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold">
                  Azure DevOps Work Items & 2-Way Kanban Sync
                </h2>
                <span
                  data-testid="ado-connection-badge"
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
                    config?.connected
                      ? "bg-green-500/15 text-green-600 dark:text-green-400"
                      : "bg-red-500/15 text-red-600 dark:text-red-400",
                  )}
                >
                  <CheckCircle2 className="h-3 w-3" />
                  {config?.connected ? "Connected" : "Disconnected"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {config?.organizationUrl || "https://dev.azure.com/auto-claude-org"} /{" "}
                <span className="font-medium text-foreground">
                  {config?.project || "Aperant-Platform"}
                </span>{" "}
                • REST API v7.1 (WIQL + 2-Way State & Comment Sync)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="ado-new-ticket-toggle-btn"
              onClick={() => {
                setShowNewTicketForm((v) => !v);
                setShowConfigForm(false);
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              New Work Item
            </button>
            <button
              type="button"
              data-testid="ado-toggle-config-btn"
              onClick={() => {
                setShowConfigForm((v) => !v);
                setShowNewTicketForm(false);
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
            >
              <Settings2 className="h-3.5 w-3.5" />
              Configure
            </button>
            <button
              type="button"
              data-testid="ado-refresh-btn"
              disabled={isLoading}
              onClick={() => void loadAzureDevOpsData(true)}
              className="inline-flex items-center justify-center rounded-md border border-border bg-background p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
              title="Refresh Work Items"
            >
              <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
            </button>
            <button
              type="button"
              data-testid="ado-modal-close-btn"
              onClick={onClose}
              className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Status feedback banner */}
        {statusBanner && (
          <div
            data-testid="ado-status-banner"
            className="flex items-center justify-between border-b border-blue-500/20 bg-blue-500/10 px-6 py-2 text-xs text-blue-600 dark:text-blue-300"
          >
            <span>{statusBanner}</span>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              className="text-xs underline opacity-80 hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Collapsible Connection Config Form */}
        {showConfigForm && (
          <div
            data-testid="ado-config-form"
            className="border-b border-border bg-muted/30 px-6 py-4 space-y-3"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Organization URL
                </label>
                <input
                  data-testid="ado-config-org-input"
                  value={orgUrlInput}
                  onChange={(e) => {
                    setOrgUrlInput(e.target.value);
                    setConfigTestFeedback(null);
                  }}
                  placeholder="https://dev.azure.com/your-org"
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Project Name
                </label>
                <input
                  data-testid="ado-config-project-input"
                  value={adoProjectInput}
                  onChange={(e) => {
                    setAdoProjectInput(e.target.value);
                    setConfigTestFeedback(null);
                  }}
                  placeholder="Aperant-Platform"
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Personal Access Token (PAT)
                </label>
                <input
                  data-testid="ado-config-pat-input"
                  type="password"
                  value={patInput}
                  onChange={(e) => {
                    setPatInput(e.target.value);
                    setConfigTestFeedback(null);
                    if (e.target.value.trim().length > 0 && useMockInput) {
                      setUseMockInput(false);
                    }
                  }}
                  placeholder="azd_pat_..."
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs"
                />
              </div>
            </div>
            {configTestFeedback && (
              <div
                data-testid="ado-config-test-feedback"
                className={cn(
                  "rounded-md p-2.5 text-xs flex items-start gap-2",
                  configTestFeedback.success
                    ? "bg-green-500/15 border border-green-500/30 text-green-700 dark:text-green-300"
                    : "bg-red-500/15 border border-red-500/30 text-red-700 dark:text-red-300",
                )}
              >
                {configTestFeedback.success ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                ) : (
                  <span className="font-bold text-red-600 dark:text-red-400 shrink-0 mt-0.5">⚠</span>
                )}
                <div className="space-y-0.5 flex-1">
                  <p className="font-semibold text-xs">
                    {configTestFeedback.success ? "Connection Succeeded" : "Connection Failed"}
                  </p>
                  <p>{configTestFeedback.message}</p>
                  {configTestFeedback.details && (
                    <p className="text-xs opacity-80 font-mono mt-0.5">
                      {configTestFeedback.details}
                    </p>
                  )}
                </div>
              </div>
            )}
            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={useMockInput}
                  onChange={(e) => setUseMockInput(e.target.checked)}
                />
                Enable Local Sandbox / Offline Work Item Simulator (REST API v7.1 compatible)
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="ado-config-test-btn"
                  onClick={() => void handleTestConfig()}
                  disabled={isSubmitting || isTestingConfig}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {isTestingConfig && <Loader2 className="h-3 w-3 animate-spin" />}
                  {isTestingConfig ? "Testing..." : "Test Connection"}
                </button>
                <button
                  type="button"
                  data-testid="ado-config-save-btn"
                  onClick={() => void handleSaveConfig()}
                  disabled={isSubmitting || isTestingConfig}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  Save Connection
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Collapsible Create New Ticket Form */}
        {showNewTicketForm && (
          <div
            data-testid="ado-new-ticket-form"
            className="border-b border-border bg-muted/30 px-6 py-4 space-y-3"
          >
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="md:col-span-2">
                <label className="text-xs font-medium text-muted-foreground">
                  Work Item Title
                </label>
                <input
                  data-testid="ado-new-ticket-title"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Fix race condition in webhook dispatcher"
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Work Item Type
                </label>
                <select
                  data-testid="ado-new-ticket-type"
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs"
                >
                  <option value="Bug">Bug</option>
                  <option value="User Story">User Story</option>
                  <option value="Task">Task</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Priority
                </label>
                <select
                  data-testid="ado-new-ticket-priority"
                  value={newPriority}
                  onChange={(e) => setNewPriority(Number(e.target.value))}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs"
                >
                  <option value={1}>P1 — Critical</option>
                  <option value={2}>P2 — High</option>
                  <option value={3}>P3 — Medium</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <input
                data-testid="ado-new-ticket-desc"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Description / ReproSteps (HTML or Markdown)..."
                className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs"
              />
              <button
                type="button"
                data-testid="ado-new-ticket-submit"
                onClick={() => void handleCreateTicket()}
                disabled={isSubmitting || !newTitle.trim()}
                className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                Create Ticket
              </button>
            </div>
          </div>
        )}

        {/* Filter & Search Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-3">
          <div className="flex items-center gap-1.5">
            {["All", "Bug", "User Story", "Task"].map((tab) => (
              <button
                key={tab}
                type="button"
                data-testid={`ado-filter-${tab.toLowerCase().replace(/\s+/g, "-")}`}
                onClick={() => setFilterType(tab)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  filterType === tab
                    ? "bg-blue-600 text-white"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="relative w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              data-testid="ado-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search #ID, title, or tag..."
              className="w-full rounded-md border border-border bg-background pl-8 pr-3 py-1 text-xs"
            />
          </div>
        </div>

        {/* Work Items List */}
        <div className="flex-1 overflow-y-auto divide-y divide-border px-6 py-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No Azure DevOps Work Items match your filter.
            </div>
          ) : (
            filteredItems.map((item) => {
              const isSelected = selectedIds.includes(item.id);
              const comments = Array.isArray(item.comments) ? item.comments : [];
              const showComments =
                expandedComments[item.id] ?? comments.length > 0;

              return (
                <div
                  key={item.id}
                  data-testid={`ado-ticket-row-${item.id}`}
                  className={cn(
                    "py-3.5 transition-colors",
                    isSelected && "bg-blue-500/5",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      data-testid={`ado-ticket-checkbox-${item.id}`}
                      checked={isSelected}
                      onChange={() => toggleSelect(item.id)}
                      className="mt-1 h-4 w-4 rounded border-border cursor-pointer"
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">
                          #{item.id}
                        </span>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                            TYPE_BADGE_STYLES[item.type] ||
                              "bg-secondary text-muted-foreground",
                          )}
                        >
                          {renderTypeIcon(item.type)}
                          {item.type}
                        </span>
                        <span
                          data-testid={`ado-ticket-state-${item.id}`}
                          className={cn(
                            "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold",
                            STATE_BADGE_STYLES[item.state] ||
                              "bg-secondary text-muted-foreground",
                          )}
                        >
                          {item.state}
                        </span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                          P{item.priority}
                        </span>

                        {item.linkedTaskId && (
                          <span
                            data-testid={`ado-ticket-linked-task-${item.id}`}
                            className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-600 dark:text-blue-400"
                          >
                            <CheckCircle2 className="h-2.5 w-2.5" />
                            Kanban: {item.linkedTaskStatus || "synced"}
                          </span>
                        )}

                        {item.tags?.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-secondary/70 px-2 py-0.5 text-xs text-muted-foreground"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>

                      <h4 className="mt-1 text-sm font-medium text-foreground">
                        {item.title}
                      </h4>
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                        {item.description}
                      </p>

                      {/* 2-Way Sync Comments & Activity Log */}
                      {comments.length > 0 && (
                        <div className="mt-2">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedComments((prev) => ({
                                ...prev,
                                [item.id]: !showComments,
                              }))
                            }
                            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            <MessageSquare className="h-3 w-3" />
                            2-Way Sync Activity Log ({comments.length})
                          </button>
                          {showComments && (
                            <div
                              data-testid={`ado-ticket-comments-${item.id}`}
                              className="mt-1.5 space-y-1 rounded-lg border border-border/70 bg-muted/40 p-2.5 text-xs"
                            >
                              {comments.map((c) => (
                                <div
                                  key={c.id}
                                  className="flex items-start gap-2 text-xs"
                                >
                                  <span className="font-semibold text-foreground shrink-0">
                                    {c.author}:
                                  </span>
                                  <span className="text-muted-foreground flex-1">
                                    {c.text}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Per-Ticket Quick Actions */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        data-testid={`ado-import-single-${item.id}`}
                        disabled={isSubmitting}
                        onClick={() => void handleImport([item.id], false)}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent transition-colors"
                      >
                        <Download className="h-3 w-3" />
                        Import
                      </button>
                      <button
                        type="button"
                        data-testid={`ado-import-run-single-${item.id}`}
                        disabled={isSubmitting}
                        onClick={() => void handleImport([item.id], true)}
                        className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
                      >
                        <Play className="h-3 w-3 fill-current" />
                        Import & Auto-Run
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-border bg-muted/20 px-6 py-3.5">
          <div className="text-xs text-muted-foreground">
            {selectedIds.length > 0 ? (
              <span>
                Selected{" "}
                <strong className="text-foreground">
                  {selectedIds.map((id) => `#${id}`).join(", ")}
                </strong>{" "}
                for Kanban sync
              </span>
            ) : (
              <span>
                Select Work Items above or use quick actions to import into Auto Claude Kanban
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="ado-import-btn"
              disabled={isSubmitting || filteredItems.length === 0}
              onClick={() => void handleImport(selectedIds, false)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Import to Backlog {selectedIds.length > 0 ? `(${selectedIds.length})` : ""}
            </button>
            <button
              type="button"
              data-testid="ado-import-run-btn"
              disabled={isSubmitting || filteredItems.length === 0}
              onClick={() => void handleImport(selectedIds, true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              ⚡ Import & Auto-Run {selectedIds.length > 0 ? `(${selectedIds.length})` : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
