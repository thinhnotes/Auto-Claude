/**
 * HTTP API client for self-hosted mode.
 *
 * Communicates with the Python backend (Auto Claude) via REST API.
 * In self-hosted mode, the backend runs locally or on a user's server.
 *
 * Provides typed fetch wrappers for all backend REST endpoints including
 * projects, tasks, settings, env, roadmap, ideation, insights (SSE),
 * changelog, context, GitHub, and GitLab integrations.
 */

import { API_URL, API_TOKEN, getApiBaseUrl } from "@/lib/cloud-mode";
import type {
  Task,
  TaskStatus,
  TaskMetadata,
  TaskLogs,
  ImplementationPlan,
  Project,
  ProjectSettings,
  ProjectEnvConfig,
  IPCResult,
} from "@auto-claude/types";

// ============================================
// Response Types
// ============================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ProjectListResponse {
  projects: Project[];
}

export interface ProjectResponse {
  project: Project;
}

export interface TaskListResponse {
  tasks: Task[];
}

export interface TaskResponse {
  task: Task;
}

export interface SettingsResponse {
  settings: Record<string, unknown>;
}

export interface EnvConfigResponse {
  config: ProjectEnvConfig;
}

export interface RoadmapResponse {
  roadmap: unknown;
}

export interface IdeationResponse {
  ideas: unknown[];
}

export interface ChangelogResponse {
  changelog: unknown;
}

export interface ContextResponse {
  context: unknown;
}

export interface MemoriesResponse {
  memories: unknown[];
}

export interface ProjectIndexResponse {
  index: unknown;
}

export interface InsightsStreamEvent {
  type: "chunk" | "done" | "error";
  content?: string;
  error?: string;
}

export interface GitHubIssuesResponse {
  issues: unknown[];
}

export interface GitHubPRsResponse {
  prs: unknown[];
}

export interface GitHubOAuthResponse {
  url: string;
}

export interface GitHubInvestigationResponse {
  investigation: unknown;
}

export interface GitHubReviewResponse {
  review: unknown;
}

export interface GitHubAutoFixResponse {
  result: unknown;
}

export interface GitLabIssuesResponse {
  issues: unknown[];
}

export interface GitLabMRsResponse {
  merge_requests: unknown[];
}

export interface GitLabOAuthResponse {
  url: string;
}

export interface GitLabReviewResponse {
  review: unknown;
}

export interface TaskLogsResponse {
  logs: TaskLogs;
}

export interface HealthResponse {
  status: string;
}

export interface GitLogCommitEntry {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
}

export interface WorktreeListResponse {
  worktrees: Array<{
    specName: string;
    path: string;
    branch: string;
    baseBranch: string;
    commitCount?: number;
    filesChanged?: number;
    additions?: number;
    deletions?: number;
    isOrphaned?: boolean;
    status?: "active" | "merged" | "discarded";
    files?: string[];
    createdAt?: string;
    updatedAt?: string;
    mergedAt?: string;
    mergeCommitSha?: string;
    mergeCommitMessage?: string;
  }>;
  mergedWorktrees?: Array<{
    specName: string;
    path: string;
    branch: string;
    baseBranch: string;
    commitCount?: number;
    filesChanged?: number;
    additions?: number;
    deletions?: number;
    isOrphaned?: boolean;
    status?: "active" | "merged" | "discarded";
    files?: string[];
    createdAt?: string;
    updatedAt?: string;
    mergedAt?: string;
    mergeCommitSha?: string;
    mergeCommitMessage?: string;
  }>;
  gitLog?: GitLogCommitEntry[];
}

export interface WorktreeMergeApiResponse extends ApiResponse {
  specName?: string;
  merged?: boolean;
  mergeCommitSha?: string;
  mergeCommitMessage?: string;
  mergedAt?: string;
}

export interface McpStatusResponse {
  servers: Array<{
    name: string;
    status: "connected" | "disconnected" | "error";
    toolCount?: number;
  }>;
}

// ============================================
// Request option types
// ============================================

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

// ============================================
// API Client
// ============================================

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = "") {
    this.baseUrl = baseUrl;
  }

  /**
   * Core request method with timeout and abort support.
   */
  private async request<T>(
    path: string,
    options: RequestInit = {},
    timeoutMs: number = 10000,
    externalSignal?: AbortSignal,
  ): Promise<T> {
    const base = this.baseUrl || getApiBaseUrl();
    const url = `${base}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    // Link external abort signal if provided
    const onExternalAbort = () => controller.abort();
    externalSignal?.addEventListener("abort", onExternalAbort);

    try {
      const method = (options.method ?? "GET").toUpperCase();
      const body =
        options.body !== undefined
          ? options.body
          : method === "POST" || method === "PUT" || method === "PATCH"
            ? JSON.stringify({})
            : undefined;
      const response = await fetch(url, {
        ...options,
        ...(body !== undefined ? { body } : {}),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_TOKEN}`,
          ...options.headers,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text().catch(() => "Unknown error");
        throw new Error(`API error ${response.status}: ${error}`);
      }

      return response.json();
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  }

  // ============================================
  // Projects
  // ============================================

  async getProjects(opts?: RequestOptions): Promise<ProjectListResponse> {
    return this.request<ProjectListResponse>(
      "/api/projects",
      {},
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  async getProject(
    id: string,
    opts?: RequestOptions,
  ): Promise<ProjectResponse> {
    return this.request<ProjectResponse>(
      `/api/projects/${id}`,
      {},
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  async createProject(
    data: { name: string; path: string },
    opts?: RequestOptions,
  ): Promise<ProjectResponse> {
    return this.request<ProjectResponse>(
      "/api/projects",
      { method: "POST", body: JSON.stringify(data) },
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  async updateProjectSettings(
    projectId: string,
    settings: Partial<ProjectSettings>,
    opts?: RequestOptions,
  ): Promise<ApiResponse> {
    return this.request<ApiResponse>(
      `/api/projects/${projectId}/settings`,
      { method: "PUT", body: JSON.stringify(settings) },
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  // ============================================
  // Tasks
  // ============================================

  async getTasks(
    projectId: string,
    opts?: RequestOptions,
  ): Promise<TaskListResponse> {
    return this.request<TaskListResponse>(
      `/api/projects?action=tasks&projectId=${encodeURIComponent(projectId)}`,
      {},
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  async getTask(
    projectId: string,
    taskId: string,
    opts?: RequestOptions,
  ): Promise<TaskResponse> {
    return this.request<TaskResponse>(
      `/api/projects?action=task&projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(taskId)}`,
      {},
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  async createTask(
    projectId: string,
    data: { title: string; description: string; metadata?: TaskMetadata },
    opts?: RequestOptions,
  ): Promise<TaskResponse> {
    return this.request<TaskResponse>(
      `/api/projects?action=createTask&projectId=${encodeURIComponent(projectId)}`,
      { method: "POST", body: JSON.stringify(data) },
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  async updateTaskStatus(
    projectId: string,
    taskId: string,
    status: TaskStatus,
    opts?: RequestOptions,
  ): Promise<ApiResponse> {
    return this.request<ApiResponse>(
      `/api/projects?action=updateTaskStatus&projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(taskId)}`,
      { method: "PUT", body: JSON.stringify({ status }) },
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  async updateTask(
    projectId: string,
    taskId: string,
    data: Record<string, unknown>,
    opts?: RequestOptions,
  ): Promise<TaskResponse> {
    return this.request<TaskResponse>(
      `/api/projects?action=task&projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(taskId)}`,
      { method: "PUT", body: JSON.stringify(data) },
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  async createPR(
    projectId: string,
    taskId: string,
    opts?: RequestOptions,
  ): Promise<ApiResponse<{ url: string }>> {
    return this.request<ApiResponse<{ url: string }>>(
      `/api/projects/${projectId}/tasks/${taskId}/pr`,
      { method: "POST" },
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  async deleteTask(
    projectId: string,
    taskId: string,
    opts?: RequestOptions,
  ): Promise<ApiResponse> {
    return this.request<ApiResponse>(
      `/api/projects?action=deleteTask&projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(taskId)}`,
      { method: "DELETE" },
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  async startTask(
    projectId: string,
    taskId: string,
    options?: Record<string, unknown>,
    opts?: RequestOptions,
  ): Promise<ApiResponse> {
    return this.request<ApiResponse>(
      `/api/projects?action=startTask&projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(taskId)}`,
      { method: "POST", body: JSON.stringify(options ?? {}) },
      opts?.timeoutMs ?? 30000,
      opts?.signal,
    );
  }

  async stopTask(
    projectId: string,
    taskId: string,
    opts?: RequestOptions,
  ): Promise<ApiResponse> {
    return this.request<ApiResponse>(
      `/api/projects?action=stopTask&projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(taskId)}`,
      { method: "POST" },
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  async approveTask(
    projectId: string,
    taskId: string,
    feedback?: string,
    opts?: RequestOptions,
  ): Promise<ApiResponse> {
    return this.request<ApiResponse>(
      `/api/projects?action=approveTask&projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(taskId)}`,
      { method: "POST", body: JSON.stringify({ feedback }) },
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  async rejectTask(
    projectId: string,
    taskId: string,
    feedback: string,
    opts?: RequestOptions,
  ): Promise<ApiResponse> {
    return this.request<ApiResponse>(
      `/api/projects?action=rejectTask&projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(taskId)}`,
      { method: "POST", body: JSON.stringify({ feedback }) },
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  async getTaskDiff(
    projectId: string,
    taskId: string,
    opts?: RequestOptions,
  ): Promise<{
    success: boolean;
    files: Array<{
      path: string;
      status: "created" | "modified" | "deleted";
      additions: number;
      deletions: number;
      oldContent: string;
      newContent: string;
      unifiedDiff: string;
      updatedAt?: string;
    }>;
  }> {
    return this.request(
      `/api/projects?action=taskDiff&projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(taskId)}`,
      {},
      opts?.timeoutMs ?? 15000,
      opts?.signal,
    );
  }

  async getTaskLogs(
    projectId: string,
    specId: string,
    opts?: RequestOptions,
  ): Promise<TaskLogsResponse> {
    return this.request<TaskLogsResponse>(
      `/api/projects?action=logs&projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(specId)}`,
      {},
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  async getTaskPlan(
    projectId: string,
    taskId: string,
    opts?: RequestOptions,
  ): Promise<ApiResponse<ImplementationPlan>> {
    return this.request<ApiResponse<ImplementationPlan>>(
      `/api/projects/${projectId}/tasks/${taskId}/plan`,
      {},
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  // ============================================
  // Settings
  // ============================================

  async getSettings(opts?: RequestOptions): Promise<SettingsResponse> {
    return this.request<SettingsResponse>(
      "/api/settings",
      {},
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  async saveSettings(
    settings: Record<string, unknown>,
    opts?: RequestOptions,
  ): Promise<ApiResponse> {
    return this.request<ApiResponse>(
      "/api/settings",
      { method: "PUT", body: JSON.stringify(settings) },
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  // ============================================
  // Environment Config
  // ============================================

  async getProjectEnv(
    projectId: string,
    opts?: RequestOptions,
  ): Promise<EnvConfigResponse> {
    return this.request<EnvConfigResponse>(
      `/api/projects/${projectId}/env`,
      {},
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  async saveProjectEnv(
    projectId: string,
    config: Partial<ProjectEnvConfig>,
    opts?: RequestOptions,
  ): Promise<ApiResponse> {
    return this.request<ApiResponse>(
      `/api/projects/${projectId}/env`,
      { method: "PUT", body: JSON.stringify(config) },
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  // ============================================
  // Roadmap
  // ============================================

  async getRoadmap(
    projectId: string,
    opts?: RequestOptions,
  ): Promise<RoadmapResponse> {
    return this.request<RoadmapResponse>(
      `/api/projects?action=roadmap&projectId=${encodeURIComponent(projectId)}`,
      {},
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  async generateRoadmap(
    projectId: string,
    opts?: RequestOptions,
  ): Promise<RoadmapResponse> {
    return this.request<RoadmapResponse>(
      `/api/projects?action=generateRoadmap&projectId=${encodeURIComponent(projectId)}`,
      { method: "POST", body: JSON.stringify({}) },
      opts?.timeoutMs ?? 60000,
      opts?.signal,
    );
  }

  async updateRoadmapFeature(
    projectId: string,
    featureId: string,
    updates: {
      title?: string;
      description?: string;
      priority?: number | string;
      status?: string;
      triggerAiBuild?: boolean;
    },
    opts?: RequestOptions,
  ): Promise<RoadmapResponse & { feature?: unknown; task?: Task }> {
    return this.request<RoadmapResponse & { feature?: unknown; task?: Task }>(
      `/api/projects?action=updateRoadmapFeature&projectId=${encodeURIComponent(projectId)}&featureId=${encodeURIComponent(featureId)}`,
      { method: "PUT", body: JSON.stringify({ featureId, ...updates }) },
      opts?.timeoutMs ?? 20000,
      opts?.signal,
    );
  }

  // ============================================
  // Ideation
  // ============================================

  async getIdeas(
    projectId: string,
    opts?: RequestOptions,
  ): Promise<IdeationResponse> {
    return this.request<IdeationResponse>(
      `/api/projects?action=ideas&projectId=${encodeURIComponent(projectId)}`,
      {},
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  async generateIdeas(
    projectId: string,
    data?: { category?: string },
    opts?: RequestOptions,
  ): Promise<IdeationResponse> {
    return this.request<IdeationResponse>(
      `/api/projects?action=generateIdeas&projectId=${encodeURIComponent(projectId)}`,
      { method: "POST", body: JSON.stringify(data ?? {}) },
      opts?.timeoutMs ?? 60000,
      opts?.signal,
    );
  }

  async updateIdeas(
    projectId: string,
    data: {
      operation: "dismiss" | "dismissAll" | "delete" | "convert" | "updateStatus";
      ideaId?: string;
      status?: string;
    },
    opts?: RequestOptions,
  ): Promise<IdeationResponse & { task?: any }> {
    return this.request<IdeationResponse & { task?: any }>(
      `/api/projects?action=updateIdeas&projectId=${encodeURIComponent(projectId)}`,
      { method: "POST", body: JSON.stringify(data) },
      opts?.timeoutMs ?? 15000,
      opts?.signal,
    );
  }

  // ============================================
  // Insights (SSE Streaming)
  // ============================================

  /**
   * Query insights with Server-Sent Events streaming.
   * Returns an async generator that yields events as they arrive.
   */
  async *streamInsights(
    projectId: string,
    message: string,
    signal?: AbortSignal,
  ): AsyncGenerator<InsightsStreamEvent> {
    const base = this.baseUrl || getApiBaseUrl();
    const url = `${base}/api/projects?action=insightsStream&projectId=${encodeURIComponent(projectId)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_TOKEN}`,
      },
      body: JSON.stringify({ message }),
      signal,
    });

    if (!response.ok) {
      const error = await response.text().catch(() => "Unknown error");
      throw new Error(`API error ${response.status}: ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body for SSE stream");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") {
              yield { type: "done" };
              return;
            }
            try {
              yield JSON.parse(data) as InsightsStreamEvent;
            } catch {
              yield { type: "chunk", content: data };
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Non-streaming insights query (falls back to simple POST).
   */
  async queryInsights(
    projectId: string,
    message: string,
    opts?: RequestOptions,
  ): Promise<ApiResponse<{ response: string }>> {
    return this.request<ApiResponse<{ response: string }>>(
      `/api/projects/${projectId}/insights`,
      { method: "POST", body: JSON.stringify({ message }) },
      opts?.timeoutMs ?? 60000,
      opts?.signal,
    );
  }

  // ============================================
  // Changelog
  // ============================================

  async getChangelog(
    projectId: string,
    opts?: RequestOptions,
  ): Promise<ChangelogResponse> {
    return this.request<ChangelogResponse>(
      `/api/projects?action=changelog&projectId=${encodeURIComponent(projectId)}`,
      {},
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  async generateChangelog(
    projectId: string,
    data?: { version?: string; taskIds?: string[] },
    opts?: RequestOptions,
  ): Promise<ChangelogResponse> {
    return this.request<ChangelogResponse>(
      `/api/projects?action=generateChangelog&projectId=${encodeURIComponent(projectId)}`,
      { method: "POST", body: JSON.stringify(data ?? {}) },
      opts?.timeoutMs ?? 60000,
      opts?.signal,
    );
  }

  // ============================================
  // Context
  // ============================================

  async getProjectContext(
    projectId: string,
    opts?: RequestOptions,
  ): Promise<ContextResponse> {
    return this.request<ContextResponse>(
      `/api/projects?action=context&projectId=${encodeURIComponent(projectId)}`,
      {},
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  async getMemories(
    projectId: string,
    query?: string,
    opts?: RequestOptions,
  ): Promise<MemoriesResponse> {
    const params = query
      ? `&query=${encodeURIComponent(query)}`
      : "";
    return this.request<MemoriesResponse>(
      `/api/projects?action=memories&projectId=${encodeURIComponent(projectId)}${params}`,
      {},
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  async refreshProjectIndex(
    projectId: string,
    opts?: RequestOptions,
  ): Promise<ProjectIndexResponse> {
    return this.request<ProjectIndexResponse>(
      `/api/projects?action=refreshProjectIndex&projectId=${encodeURIComponent(projectId)}`,
      { method: "POST", body: JSON.stringify({}) },
      opts?.timeoutMs ?? 30000,
      opts?.signal,
    );
  }

  // ============================================
  // GitHub
  // ============================================

  async getGitHubIssues(
    projectId: string,
    opts?: RequestOptions,
  ): Promise<GitHubIssuesResponse> {
    return this.request<GitHubIssuesResponse>(
      `/api/projects/${projectId}/github/issues`,
      {},
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  async getGitHubPRs(
    projectId: string,
    opts?: RequestOptions,
  ): Promise<GitHubPRsResponse> {
    return this.request<GitHubPRsResponse>(
      `/api/projects/${projectId}/github/prs`,
      {},
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  async getGitHubOAuthUrl(
    projectId: string,
    opts?: RequestOptions,
  ): Promise<GitHubOAuthResponse> {
    return this.request<GitHubOAuthResponse>(
      `/api/projects/${projectId}/github/oauth`,
      {},
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  async investigateGitHubIssue(
    projectId: string,
    issueNumber: number,
    opts?: RequestOptions,
  ): Promise<GitHubInvestigationResponse> {
    return this.request<GitHubInvestigationResponse>(
      `/api/projects/${projectId}/github/issues/${issueNumber}/investigate`,
      { method: "POST" },
      opts?.timeoutMs ?? 60000,
      opts?.signal,
    );
  }

  async reviewGitHubPR(
    projectId: string,
    prNumber: number,
    opts?: RequestOptions,
  ): Promise<GitHubReviewResponse> {
    return this.request<GitHubReviewResponse>(
      `/api/projects/${projectId}/github/prs/${prNumber}/review`,
      { method: "POST" },
      opts?.timeoutMs ?? 60000,
      opts?.signal,
    );
  }

  async autoFixGitHubPR(
    projectId: string,
    prNumber: number,
    opts?: RequestOptions,
  ): Promise<GitHubAutoFixResponse> {
    return this.request<GitHubAutoFixResponse>(
      `/api/projects/${projectId}/github/prs/${prNumber}/auto-fix`,
      { method: "POST" },
      opts?.timeoutMs ?? 120000,
      opts?.signal,
    );
  }

  // ============================================
  // GitLab
  // ============================================

  async getGitLabIssues(
    projectId: string,
    opts?: RequestOptions,
  ): Promise<GitLabIssuesResponse> {
    return this.request<GitLabIssuesResponse>(
      `/api/projects/${projectId}/gitlab/issues`,
      {},
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  async getGitLabMRs(
    projectId: string,
    opts?: RequestOptions,
  ): Promise<GitLabMRsResponse> {
    return this.request<GitLabMRsResponse>(
      `/api/projects/${projectId}/gitlab/merge-requests`,
      {},
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  async getGitLabOAuthUrl(
    projectId: string,
    opts?: RequestOptions,
  ): Promise<GitLabOAuthResponse> {
    return this.request<GitLabOAuthResponse>(
      `/api/projects/${projectId}/gitlab/oauth`,
      {},
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  async reviewGitLabMR(
    projectId: string,
    mrNumber: number,
    opts?: RequestOptions,
  ): Promise<GitLabReviewResponse> {
    return this.request<GitLabReviewResponse>(
      `/api/projects/${projectId}/gitlab/merge-requests/${mrNumber}/review`,
      { method: "POST" },
      opts?.timeoutMs ?? 60000,
      opts?.signal,
    );
  }

  // ============================================
  // Worktrees
  // ============================================

  async listWorktrees(
    projectId: string,
    opts?: RequestOptions,
  ): Promise<WorktreeListResponse> {
    return this.request<WorktreeListResponse>(
      `/api/projects?action=worktrees&projectId=${encodeURIComponent(projectId)}`,
      {},
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  async mergeWorktree(
    projectId: string,
    specName: string,
    opts?: RequestOptions,
  ): Promise<WorktreeMergeApiResponse> {
    return this.request<WorktreeMergeApiResponse>(
      `/api/projects?action=mergeWorktree&projectId=${encodeURIComponent(projectId)}&specName=${encodeURIComponent(specName)}`,
      { method: "POST", body: JSON.stringify({ specName }) },
      opts?.timeoutMs ?? 60000,
      opts?.signal,
    );
  }

  async discardWorktree(
    projectId: string,
    specName: string,
    opts?: RequestOptions,
  ): Promise<ApiResponse> {
    return this.request<ApiResponse>(
      `/api/projects?action=discardWorktree&projectId=${encodeURIComponent(projectId)}&specName=${encodeURIComponent(specName)}`,
      { method: "POST", body: JSON.stringify({ specName }) },
      opts?.timeoutMs ?? 30000,
      opts?.signal,
    );
  }

  async createWorktree(
    projectId: string,
    specName: string,
    baseBranch?: string,
    opts?: RequestOptions,
  ): Promise<ApiResponse> {
    return this.request<ApiResponse>(
      `/api/projects?action=createWorktree&projectId=${encodeURIComponent(projectId)}`,
      { method: "POST", body: JSON.stringify({ specName, baseBranch }) },
      opts?.timeoutMs ?? 30000,
      opts?.signal,
    );
  }

  async getWorktreeDiff(
    projectId: string,
    specName: string,
    opts?: RequestOptions,
  ): Promise<{
    success: boolean;
    specName: string;
    branch: string;
    baseBranch: string;
    filesChanged?: number;
    totalAdditions?: number;
    totalDeletions?: number;
    files: Array<{
      file: string;
      path?: string;
      status?: "created" | "modified" | "deleted";
      additions: number;
      deletions: number;
      oldContent?: string;
      newContent?: string;
      unifiedDiff?: string;
      snippet: string;
    }>;
  }> {
    return this.request(
      `/api/projects?action=worktreeDiff&projectId=${encodeURIComponent(projectId)}&specName=${encodeURIComponent(specName)}`,
      {},
      opts?.timeoutMs ?? 15000,
      opts?.signal,
    );
  }

  // ============================================
  // MCP / Agent Tools
  // ============================================

  async getMcpStatus(
    projectId: string,
    opts?: RequestOptions,
  ): Promise<McpStatusResponse> {
    return this.request<McpStatusResponse>(
      `/api/projects?action=mcpStatus&projectId=${encodeURIComponent(projectId)}`,
      {},
      opts?.timeoutMs,
      opts?.signal,
    );
  }

  // ============================================
  // Terminals
  // ============================================

  async listTerminals(
    projectId: string,
    opts?: RequestOptions,
  ): Promise<{
    success: boolean;
    sessions: Array<{
      id: string;
      title: string;
      status: string;
      cwd: string;
      outputBuffer: string;
      history: Array<{
        id: string;
        command: string;
        output: string;
        exitCode: number;
        cwd: string;
        executedAt: string;
      }>;
    }>;
  }> {
    return this.request(
      `/api/projects?action=terminals&projectId=${encodeURIComponent(projectId)}`,
      {},
      opts?.timeoutMs ?? 15000,
      opts?.signal,
    );
  }

  async createTerminalSession(
    projectId: string,
    params?: {
      sessionId?: string;
      title?: string;
      cwd?: string;
      worktreePath?: string;
      associatedTaskId?: string;
      isClaudeMode?: boolean;
    },
    opts?: RequestOptions,
  ): Promise<any> {
    return this.request(
      `/api/projects?action=createTerminal&projectId=${encodeURIComponent(projectId)}`,
      { method: "POST", body: JSON.stringify(params || {}) },
      opts?.timeoutMs ?? 15000,
      opts?.signal,
    );
  }

  async openTaskTerminal(
    projectId: string,
    taskId: string,
    params?: {
      sessionId?: string;
      title?: string;
    },
    opts?: RequestOptions,
  ): Promise<{
    success: boolean;
    session: any;
    worktreePath: string;
    branch: string;
    specName: string;
    filesSynced: string[];
    task?: Task;
  }> {
    return this.request(
      `/api/projects?action=openTaskTerminal&projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(taskId)}`,
      {
        method: "POST",
        body: JSON.stringify({ taskId, ...(params || {}) }),
      },
      opts?.timeoutMs ?? 15000,
      opts?.signal,
    );
  }

  async syncTaskSourceTree(
    projectId: string,
    taskId: string,
    opts?: RequestOptions,
  ): Promise<{
    success: boolean;
    worktreePath: string;
    branch: string;
    specName: string;
    filesSynced: string[];
  }> {
    return this.request(
      `/api/projects?action=syncTaskSourceTree&projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(taskId)}`,
      {
        method: "POST",
        body: JSON.stringify({ taskId }),
      },
      opts?.timeoutMs ?? 15000,
      opts?.signal,
    );
  }

  async execTerminalCommand(
    projectId: string,
    sessionId: string,
    command: string,
    cwd?: string,
    opts?: RequestOptions,
  ): Promise<{
    success: boolean;
    sessionId: string;
    command: string;
    output: string;
    formattedOutput: string;
    exitCode: number;
    cwd: string;
    shell?: "pwsh" | "bash";
    isAgyMode?: boolean;
    historySuggestions?: string[];
    interactiveState?: {
      kind: "ssh-keygen" | "menu" | "confirm" | "prompt";
      step?: string;
      title?: string;
      prompt: string;
      allowEmpty?: boolean;
      maskInput?: boolean;
      defaultValue?: string;
      selectedIndex?: number;
      options?: Array<{
        id: string;
        label: string;
        description?: string;
        value: string;
      }>;
    } | null;
  }> {
    return this.request(
      `/api/projects?action=execTerminal&projectId=${encodeURIComponent(projectId)}`,
      {
        method: "POST",
        body: JSON.stringify({ sessionId, command, cwd }),
      },
      opts?.timeoutMs ?? 20000,
      opts?.signal,
    );
  }

  async execAgyCommand(
    projectId: string,
    sessionId: string,
    prompt: string,
    cwd?: string,
    opts?: RequestOptions,
  ): Promise<{
    success: boolean;
    sessionId: string;
    command: string;
    prompt: string;
    agyVersion: string;
    output: string;
    formattedOutput: string;
    exitCode: number;
    cwd: string;
    shell?: "pwsh" | "bash";
    isAgyMode?: boolean;
    historySuggestions?: string[];
    interactiveState?: {
      kind: "ssh-keygen" | "menu" | "confirm" | "prompt";
      step?: string;
      title?: string;
      prompt: string;
      allowEmpty?: boolean;
      maskInput?: boolean;
      defaultValue?: string;
      selectedIndex?: number;
      options?: Array<{
        id: string;
        label: string;
        description?: string;
        value: string;
      }>;
    } | null;
  }> {
    return this.request(
      `/api/projects?action=execAgy&projectId=${encodeURIComponent(projectId)}`,
      {
        method: "POST",
        body: JSON.stringify({ sessionId, prompt, cwd }),
      },
      opts?.timeoutMs ?? 25000,
      opts?.signal,
    );
  }

  async autocompleteTerminal(
    projectId: string,
    sessionId: string,
    input: string,
    cwd?: string,
    opts?: RequestOptions,
  ): Promise<{
    success: boolean;
    completions: string[];
    completedInput: string;
    inlineSuggestion?: string | null;
    historyMatches?: string[];
    historySuggestions?: string[];
  }> {
    return this.request(
      `/api/projects?action=terminalAutocomplete&projectId=${encodeURIComponent(projectId)}`,
      {
        method: "POST",
        body: JSON.stringify({ sessionId, input, cwd }),
      },
      opts?.timeoutMs ?? 5000,
      opts?.signal,
    );
  }

  async closeTerminalSession(
    projectId: string,
    sessionId: string,
    opts?: RequestOptions,
  ): Promise<ApiResponse> {
    return this.request<ApiResponse>(
      `/api/projects?action=closeTerminal&projectId=${encodeURIComponent(projectId)}&sessionId=${encodeURIComponent(sessionId)}`,
      { method: "POST", body: JSON.stringify({ sessionId }) },
      opts?.timeoutMs ?? 15000,
      opts?.signal,
    );
  }

  async openVSCodeWeb(
    projectId: string | undefined,
    payload: {
      sessionId?: string;
      folderPath?: string;
    },
    opts?: RequestOptions,
  ): Promise<{
    success: boolean;
    port: number;
    folderPath: string;
    ready: boolean;
    data?: {
      port: number;
      folderPath: string;
      ready: boolean;
    };
  }> {
    const pid = projectId ? encodeURIComponent(projectId) : "";
    return this.request(
      `/api/projects?action=openVSCodeWeb&projectId=${pid}`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      opts?.timeoutMs ?? 15000,
      opts?.signal,
    );
  }

  // ============================================
  // Azure DevOps Integration (Work Items & 2-Way Sync)
  // ============================================

  async getAzureDevOps(
    projectId: string,
    opts?: RequestOptions & { refresh?: boolean },
  ): Promise<{
    success: boolean;
    config: {
      organizationUrl: string;
      project: string;
      personalAccessToken: string;
      useMock: boolean;
      connected: boolean;
      updatedAt: string;
    };
    workItems: Array<{
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
      comments: Array<{
        id: string;
        author: string;
        text: string;
        createdAt: string;
      }>;
      updatedAt: string;
    }>;
    syncedTasksCount: number;
  }> {
    const refreshParam = opts?.refresh ? "&refresh=true" : "";
    return this.request(
      `/api/projects?action=azureDevOps&projectId=${encodeURIComponent(projectId)}${refreshParam}`,
      {},
      opts?.timeoutMs ?? 15000,
      opts?.signal,
    );
  }

  async testAzureDevOpsConnection(
    projectId: string,
    config: {
      organizationUrl?: string;
      project?: string;
      personalAccessToken?: string;
      useMock?: boolean;
    },
    opts?: RequestOptions,
  ): Promise<{
    success: boolean;
    valid: boolean;
    message: string;
    project?: any;
    error?: string;
  }> {
    return this.request(
      `/api/projects?action=testAzureDevOpsConnection&projectId=${encodeURIComponent(projectId)}`,
      {
        method: "POST",
        body: JSON.stringify(config),
      },
      opts?.timeoutMs ?? 15000,
      opts?.signal,
    );
  }

  async refreshAzureDevOps(
    projectId: string,
    opts?: RequestOptions,
  ): Promise<any> {
    return this.getAzureDevOps(projectId, { ...opts, refresh: true });
  }

  async saveAzureDevOpsConfig(
    projectId: string,
    config: {
      organizationUrl?: string;
      project?: string;
      personalAccessToken?: string;
      useMock?: boolean;
    },
    opts?: RequestOptions,
  ): Promise<any> {
    return this.request(
      `/api/projects?action=saveAzureDevOpsConfig&projectId=${encodeURIComponent(projectId)}`,
      {
        method: "POST",
        body: JSON.stringify(config),
      },
      opts?.timeoutMs ?? 15000,
      opts?.signal,
    );
  }

  async createAzureDevOpsTicket(
    projectId: string,
    ticket: {
      title: string;
      description?: string;
      type?: string;
      priority?: number;
      tags?: string[];
    },
    opts?: RequestOptions,
  ): Promise<any> {
    return this.request(
      `/api/projects?action=createAzureDevOpsTicket&projectId=${encodeURIComponent(projectId)}`,
      {
        method: "POST",
        body: JSON.stringify(ticket),
      },
      opts?.timeoutMs ?? 15000,
      opts?.signal,
    );
  }

  async importAzureDevOpsTickets(
    projectId: string,
    workItemIds: number[],
    autoStart: boolean = false,
    opts?: RequestOptions,
  ): Promise<any> {
    return this.request(
      `/api/projects?action=importAzureDevOpsTickets&projectId=${encodeURIComponent(projectId)}`,
      {
        method: "POST",
        body: JSON.stringify({ workItemIds, autoStart }),
      },
      opts?.timeoutMs ?? 20000,
      opts?.signal,
    );
  }

  // ============================================
  // Health
  // ============================================

  async health(opts?: RequestOptions): Promise<HealthResponse> {
    return this.request<HealthResponse>(
      "/api/health",
      {},
      opts?.timeoutMs ?? 3000,
      opts?.signal,
    );
  }
}

export const apiClient = new ApiClient();
