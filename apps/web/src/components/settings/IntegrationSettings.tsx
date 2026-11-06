"use client";

import { useState, useEffect } from "react";
import { Github, ExternalLink, Check, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useProjectStore } from "@/stores/project-store";
import { apiClient } from "@/lib/data";

function GitLabIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" role="img" aria-labelledby="gitlab-icon-title">
      <title id="gitlab-icon-title">GitLab</title>
      <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z" />
    </svg>
  );
}

function LinearIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" role="img" aria-labelledby="linear-icon-title">
      <title id="linear-icon-title">Linear</title>
      <path d="M2.93 17.07A10 10 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10a10 10 0 0 1-5.07-1.37l-4.56 1.07 1.07-4.56-.51-.07z" />
    </svg>
  );
}

function AzureDevOpsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" role="img" aria-labelledby="azure-devops-icon-title">
      <title id="azure-devops-icon-title">Azure DevOps</title>
      <path d="M22 4.6v14.8L17 22l-9-3.2v3.2L3 18.2l14 1.2V4.8L7.5 2 2 5.9v11.2l3 1.1V7.5L13.5 5 22 4.6z" />
    </svg>
  );
}

interface IntegrationConfig {
  id: string;
  name: string;
  icon: React.ElementType;
  description: string;
  connected: boolean;
  fields: { key: string; label: string; placeholder: string; type?: string }[];
}

/**
 * Integration settings — Azure DevOps, GitHub, GitLab, Linear setup
 */
export function IntegrationSettings() {
  const { t } = useTranslation("settings");
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const selectedProjectId = useProjectStore((s) => s.selectedProjectId);
  const currentProjectId = activeProjectId || selectedProjectId;

  const [expandedId, setExpandedId] = useState<string | null>("azure-devops");
  const [adoConnected, setAdoConnected] = useState(true);
  const [adoSaving, setAdoSaving] = useState(false);
  const [adoTesting, setAdoTesting] = useState(false);
  const [adoSavedMessage, setAdoSavedMessage] = useState<string | null>(null);
  const [adoTestFeedback, setAdoTestFeedback] = useState<{
    success: boolean;
    message: string;
    details?: string;
  } | null>(null);
  const [formValues, setFormValues] = useState<Record<string, Record<string, string>>>({
    "azure-devops": {
      organizationUrl: "https://dev.azure.com/auto-claude-org",
      project: "Aperant-Platform",
      token: "",
    },
  });

  useEffect(() => {
    if (!currentProjectId) return;
    apiClient
      .getAzureDevOps(currentProjectId)
      .then((res) => {
        if (res?.config) {
          setAdoConnected(Boolean(res.config.connected));
          setFormValues((prev) => ({
            ...prev,
            "azure-devops": {
              organizationUrl:
                res.config.organizationUrl || "https://dev.azure.com/auto-claude-org",
              project: res.config.project || "Aperant-Platform",
              token: res.config.personalAccessToken || "",
            },
          }));
        }
      })
      .catch(() => {
        // Keep defaults
      });
  }, [currentProjectId]);

  const handleFieldChange = (integrationId: string, key: string, value: string) => {
    if (integrationId === "azure-devops") {
      setAdoTestFeedback(null);
      setAdoSavedMessage(null);
    }
    setFormValues((prev) => ({
      ...prev,
      [integrationId]: {
        ...(prev[integrationId] || {}),
        [key]: value,
      },
    }));
  };

  const handleTestConnection = async (integrationId: string) => {
    if (integrationId === "azure-devops" && currentProjectId) {
      setAdoTesting(true);
      setAdoTestFeedback(null);
      setAdoSavedMessage(null);
      try {
        const vals = formValues["azure-devops"] || {};
        const res = await apiClient.testAzureDevOpsConnection(currentProjectId, {
          organizationUrl: vals.organizationUrl,
          project: vals.project,
          personalAccessToken: vals.token,
          useMock: false,
        });
        if (res.valid) {
          setAdoConnected(true);
          setAdoTestFeedback({
            success: true,
            message: res.message || "Connection verified successfully!",
          });
        } else {
          setAdoConnected(false);
          setAdoTestFeedback({
            success: false,
            message: res.message || "Connection test failed.",
            details: res.error,
          });
        }
      } catch (err: any) {
        setAdoConnected(false);
        setAdoTestFeedback({
          success: false,
          message: err.message || "Failed to test connection against Azure DevOps.",
        });
      } finally {
        setAdoTesting(false);
      }
    }
  };

  const handleSave = async (integrationId: string) => {
    if (integrationId === "azure-devops" && currentProjectId) {
      setAdoSaving(true);
      setAdoSavedMessage(null);
      try {
        const vals = formValues["azure-devops"] || {};
        const res = await apiClient.saveAzureDevOpsConfig(currentProjectId, {
          organizationUrl: vals.organizationUrl,
          project: vals.project,
          personalAccessToken: vals.token,
        });
        const isConnected = Boolean(res?.config?.connected);
        setAdoConnected(isConnected);
        setAdoSavedMessage(
          res?.refreshError
            ? "Azure DevOps configuration saved."
            : "Azure DevOps configuration saved & 2-way sync enabled.",
        );
        if (res?.refreshError) {
          setAdoTestFeedback({
            success: false,
            message: `Configuration saved, but live sync encountered an issue: ${res.refreshError}`,
          });
        }
      } catch (err: any) {
        setAdoTestFeedback({
          success: false,
          message: `Failed to save configuration: ${err.message || err}`,
        });
      } finally {
        setAdoSaving(false);
      }
    }
  };

  const integrations: IntegrationConfig[] = [
    {
      id: "azure-devops",
      name: "Azure DevOps",
      icon: AzureDevOpsIcon,
      description: t(
        "integrations.azureDevops.description",
        "Connect Azure DevOps Work Items (Bugs, User Stories, Tasks) via REST API v7.1 with 2-way Kanban status & comment sync.",
      ),
      connected: adoConnected,
      fields: [
        {
          key: "organizationUrl",
          label: t("integrations.azureDevops.orgUrl", "Organization URL"),
          placeholder: "https://dev.azure.com/your-org",
        },
        {
          key: "project",
          label: t("integrations.azureDevops.project", "Project Name"),
          placeholder: "Aperant-Platform",
        },
        {
          key: "token",
          label: t("integrations.azureDevops.token", "Personal Access Token (PAT)"),
          placeholder: "azd_pat_...",
          type: "password",
        },
      ],
    },
    {
      id: "github",
      name: "GitHub",
      icon: Github,
      description: t("integrations.github.description"),
      connected: false,
      fields: [
        { key: "repo", label: t("fields.repositoryLabel"), placeholder: t("placeholders.ownerRepo") },
        { key: "branch", label: t("fields.mainBranch"), placeholder: t("placeholders.main") },
        { key: "token", label: t("integrations.github.token"), placeholder: "ghp_...", type: "password" },
      ],
    },
    {
      id: "gitlab",
      name: "GitLab",
      icon: GitLabIcon,
      description: t("integrations.gitlab.description"),
      connected: false,
      fields: [
        { key: "url", label: t("integrations.gitlab.url"), placeholder: "https://gitlab.com" },
        { key: "project", label: t("integrations.gitlab.project"), placeholder: "group/project" },
        { key: "token", label: t("integrations.gitlab.token"), placeholder: "glpat-...", type: "password" },
      ],
    },
    {
      id: "linear",
      name: "Linear",
      icon: LinearIcon,
      description: t("integrations.linear.description"),
      connected: false,
      fields: [
        { key: "apiKey", label: t("integrations.linear.apiKey"), placeholder: "lin_api_...", type: "password" },
        { key: "team", label: t("integrations.linear.team"), placeholder: t("integrations.linear.teamPlaceholder") },
      ],
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">{t("sections.integrations.title", "Integrations")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("sections.integrations.description", "Connect issue trackers and source control platforms.")}
        </p>
      </div>

      <div className="space-y-3">
        {integrations.map((integration) => {
          const Icon = integration.icon;
          const isExpanded = expandedId === integration.id;
          return (
            <div
              key={integration.id}
              data-testid={`integration-card-${integration.id}`}
              className="rounded-lg border border-border overflow-hidden"
            >
              <button
                type="button"
                className="w-full flex items-center justify-between p-4 hover:bg-accent/50 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : integration.id)}
              >
                <div className="flex items-center gap-3">
                  <Icon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  <div className="text-left">
                    <p className="text-sm font-medium">{integration.name}</p>
                    <p className="text-xs text-muted-foreground">{integration.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {integration.connected && (
                    <span className="flex items-center gap-1 rounded-full bg-green-500/10 text-green-600 px-2 py-0.5 text-xs">
                      <Check className="h-3 w-3" />
                      {t("status.connected", "Connected")}
                    </span>
                  )}
                  <ExternalLink className="h-4 w-4 text-muted-foreground" />
                </div>
              </button>
              {isExpanded && (
                <div className="border-t border-border p-4 space-y-3 bg-muted/30">
                  {integration.fields.map((field) => (
                    <div key={field.key}>
                      <label className="text-xs text-muted-foreground">{field.label}</label>
                      <input
                        data-testid={`integration-${integration.id}-${field.key}`}
                        className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                        placeholder={field.placeholder}
                        type={field.type ?? "text"}
                        value={formValues[integration.id]?.[field.key] ?? ""}
                        onChange={(e) =>
                          handleFieldChange(integration.id, field.key, e.target.value)
                        }
                      />
                    </div>
                  ))}
                  {integration.id === "azure-devops" && adoTestFeedback && (
                    <div
                      data-testid="integration-ado-test-feedback"
                      className={`rounded-md p-3 text-xs flex items-start gap-2.5 transition-all ${
                        adoTestFeedback.success
                          ? "bg-green-500/10 border border-green-500/30 text-green-700 dark:text-green-300"
                          : "bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-300"
                      }`}
                    >
                      {adoTestFeedback.success ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400 mt-0.5" />
                      ) : (
                        <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400 mt-0.5" />
                      )}
                      <div className="space-y-0.5 flex-1">
                        <p className="font-semibold text-xs">
                          {adoTestFeedback.success
                            ? "Connection Succeeded"
                            : "Connection Failed"}
                        </p>
                        <p className="opacity-90">{adoTestFeedback.message}</p>
                        {adoTestFeedback.details && (
                          <p className="text-xs opacity-75 font-mono mt-1">
                            {adoTestFeedback.details}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1">
                    {integration.id === "azure-devops" && adoSavedMessage ? (
                      <span
                        data-testid="integration-ado-saved-msg"
                        className="text-xs text-green-600 dark:text-green-400 font-medium"
                      >
                        {adoSavedMessage}
                      </span>
                    ) : (
                      <span />
                    )}
                    <div className="flex items-center gap-2">
                      {integration.id === "azure-devops" && (
                        <button
                          type="button"
                          data-testid="integration-test-azure-devops"
                          disabled={adoTesting || adoSaving}
                          onClick={() => void handleTestConnection(integration.id)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50"
                        >
                          {adoTesting ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Testing...
                            </>
                          ) : (
                            "Test Connection"
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        data-testid={`integration-save-${integration.id}`}
                        disabled={integration.id === "azure-devops" && (adoSaving || adoTesting)}
                        onClick={() => void handleSave(integration.id)}
                        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                      >
                        {integration.id === "azure-devops" && adoSaving && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        )}
                        {t("actions.save")}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
