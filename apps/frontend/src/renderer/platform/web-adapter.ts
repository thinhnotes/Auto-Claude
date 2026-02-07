/**
 * Web adapter for AppAPI
 *
 * This adapter provides HTTP/WebSocket-based communication with the Python backend
 * for running Auto-Claude in a browser environment.
 *
 * Note: Many features are limited or unavailable in web mode (terminals, file dialogs, etc.)
 */

import type { AppAPI, PlatformCapabilities } from './types';
import { WEB_CAPABILITIES } from './types';
import type {
  IPCResult,
  TabState,
  TaskStatus,
  TaskMetadata,
  ProjectEnvConfig,
  CustomMcpServer,
} from '../../shared/types';
import { WSClient } from './ws-client';

/**
 * Get the API base URL from runtime or build-time environment
 */
function getApiBaseUrl(): string {
  // Runtime config (Docker) takes precedence
  const runtimeUrl = (window as any).__ENV__?.VITE_API_URL;
  if (runtimeUrl && !runtimeUrl.startsWith('__')) {
    return runtimeUrl;
  }
  // Fallback to build-time env
  // @ts-expect-error - VITE_API_URL is defined in vite.config.ts env
  const envUrl = import.meta.env?.VITE_API_URL as string;
  // Use empty string for relative /api calls (nginx proxy)
  return envUrl || '';
}

/**
 * Get the WebSocket URL from API base URL
 */
function getWebSocketUrl(): string {
  const baseUrl = getApiBaseUrl();
  
  // For GitHub Codespaces and similar environments
  // Check if we're in a forwarded port environment
  const hostname = window.location.hostname;
  const isCodespaces = hostname.includes('.app.github.dev') || hostname.includes('.github.dev');
  const isGitpod = hostname.includes('.gitpod.io');
  
  if (isCodespaces || isGitpod) {
    // In Codespaces/Gitpod, replace port 5173 with 8000 for backend
    const backendHost = window.location.host.replace('5173', '8000');
    const protocol = 'wss:';
    return `${protocol}//${backendHost}/ws`;
  }
  
  if (!baseUrl) {
    // Relative path - use current host
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }
  
  // Convert http:// to ws:// or https:// to wss://
  return baseUrl.replace(/^http/, 'ws') + '/ws';
}

/**
 * Helper for making WebSocket requests to the backend
 * Falls back to HTTP for unimplemented handlers
 */
async function wsRequest<T>(
  method: string,
  params: Record<string, any> = {}
): Promise<IPCResult<T>> {
  try {
    const ws = getWSClient();
    
    try {
      const data = await ws.request<T>(method, params);
      return { success: true, data };
    } catch (wsError) {
      // If WebSocket request fails with "Unknown method", it means the handler
      // hasn't been implemented yet. Log a warning but continue.
      const errorMsg = wsError instanceof Error ? wsError.message : String(wsError);
      if (errorMsg.includes('Unknown method')) {
        console.warn(`[Web API] WebSocket handler not implemented for '${method}', handler needed`);
        return {
          success: false,
          error: `WebSocket handler not implemented: ${method}. Please implement backend handler.`,
        };
      }
      // Re-throw other errors
      throw wsError;
    }
  } catch (error) {
    console.error(`[Web API] WebSocket request failed:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * HTTP request helper for specific endpoints that legitimately need HTTP:
 * - Terminal management (uses separate PTY WebSocket)
 * - Roadmap status polling (uses WebSocket events for real-time updates)
 * - External CLI checks (Claude Code CLI version)
 * 
 * Note: Most operations should use wsRequest() for WebSocket communication.
 */
async function httpRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<IPCResult<T>> {
  try {
    const baseUrl = getApiBaseUrl();
    const url = baseUrl ? `${baseUrl}${endpoint}` : endpoint;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `HTTP ${response.status}: ${errorText}`,
      };
    }

    const data = await response.json();
    
    // Handle both {success, data} and direct data responses
    if ('success' in data) {
      return data;
    }
    
    return { success: true, data };
  } catch (error) {
    console.error(`[Web API] HTTP request failed:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ===================
// WebSocket Client Instance
// ===================
let wsClient: WSClient | null = null;

export function getWSClient(): WSClient {
  if (!wsClient) {
    const wsUrl = getWebSocketUrl();
    console.log('[Web Adapter] Creating WebSocket client:', wsUrl);

    wsClient = new WSClient({
      url: wsUrl,
      autoReconnect: true,
      onConnect: () => console.log('[Web Adapter] WebSocket connected'),
      onDisconnect: () => console.log('[Web Adapter] WebSocket disconnected'),
      onError: (err) => console.error('[Web Adapter] WebSocket error:', err),
    });
    
    wsClient.connect();
  }
  return wsClient;
}

// ===================
// Event Callback Sets (for WebSocket subscriptions)
// ===================
const taskLogCallbacks: Set<(specId: string, logs: any) => void> = new Set();
const taskProgressCallbacks: Set<(taskId: string, plan: any, projectId?: string) => void> = new Set();
const roadmapProgressCallbacks: Set<(projectId: string, status: any) => void> = new Set();
const roadmapCompleteCallbacks: Set<(projectId: string, roadmap: any) => void> = new Set();
const roadmapErrorCallbacks: Set<(projectId: string, error: string) => void> = new Set();
const roadmapStoppedCallbacks: Set<(projectId: string) => void> = new Set();

/**
 * Create a stub function that returns an error for unsupported operations
 */
function unsupported<T>(operation: string): () => Promise<IPCResult<T>> {
  return async () => ({
    success: false,
    error: `${operation} is not supported in web mode`,
  });
}

/**
 * Create a stub function that returns void for unsupported event operations
 */
function unsupportedEvent(operation: string): (...args: unknown[]) => () => void {
  return () => {
    console.warn(`[Web Adapter] ${operation} is not supported in web mode`);
    return () => {};
  };
}

/**
 * Create a stub function for void operations
 */
function unsupportedVoid(operation: string): (...args: unknown[]) => void {
  return () => {
    console.warn(`[Web Adapter] ${operation} is not supported in web mode`);
  };
}

type RoadmapStatusPayload = {
  isRunning: boolean;
  phase?: string;
  progress?: number;
  message?: string;
  error?: string;
};

/**
 * Create the Web API adapter
 *
 * This implements the AppAPI interface using HTTP/WebSocket calls
 * to the Python backend. Many operations are stubbed as they require
 * native capabilities not available in browsers.
 *
 * Note: We use a type assertion since the full ElectronAPI is very large
 * and many methods are stubbed for web mode. The core operations are
 * properly implemented, and unsupported operations return appropriate
 * error responses.
 */
export function createWebAdapter(): AppAPI {
  const api = {
    // ===================
    // Project Operations
    // ===================
    addProject: async (projectPath: string) => {
      const pathParts = projectPath.replace(/\/$/, '').split('/');
      const name = pathParts[pathParts.length - 1] || 'Untitled Project';
      return wsRequest('projects.add', { name, path: projectPath });
    },

    removeProject: async (projectId: string) =>
      wsRequest('projects.remove', { projectId }),

    getProjects: async () => wsRequest('projects.get'),

    updateProjectSettings: async (projectId: string, settings: Record<string, unknown>) =>
      wsRequest('projects.updateSettings', { projectId, settings }),

    initializeProject: async (projectId: string) =>
      wsRequest('projects.initialize', { projectId }),

    checkProjectVersion: async (projectId: string) =>
      wsRequest('projects.checkVersion', { projectId }),

    // ===================
    // Tab State
    // ===================
    getTabState: async () => wsRequest('tabs.get'),
    saveTabState: async (tabState: TabState) =>
      wsRequest('tabs.save', { tabState }),

    // ===================
    // Task Operations
    // ===================
    getTasks: async (projectId: string) =>
      wsRequest('tasks.get', { projectId }),

    createTask: async (projectId: string, title: string, description: string, metadata?: TaskMetadata) =>
      wsRequest('tasks.create', { projectId, title, description, metadata }),

    deleteTask: async (taskId: string) =>
      wsRequest('tasks.delete', { taskId }),

    updateTask: async (taskId: string, updates: { title?: string; description?: string }) =>
      wsRequest('tasks.update', { taskId, updates }),

    startTask: async (taskId: string, options?: { autoContinue?: boolean; skipQa?: boolean; model?: string }) => {
      const result = await wsRequest<{ status: string; task_id: string; pid?: number; message?: string }>('tasks.start', {
        taskId,
        autoContinue: options?.autoContinue ?? true,
        skipQa: options?.skipQa ?? false,
        model: options?.model,
      });
      if (result.success) {
        console.log(`[Web API] Task started in background: ${result.data?.message || 'Running'}`);
      }
      return result;
    },

    stopTask: async (taskId: string) => {
      return wsRequest('tasks.stop', { taskId });
    },

    checkTaskRunning: async (taskId: string) => {
      const result = await wsRequest<{ is_running: boolean; pid?: number }>('tasks.getStatus', { taskId });
      if (result.success) {
        return { success: true, data: result.data?.is_running ?? false };
      }
      return { success: false, error: result.error };
    },

    submitReview: async (taskId: string, approved: boolean, feedback?: string) =>
      wsRequest('tasks.submitReview', { taskId, approved, feedback }),

    updateTaskStatus: async (taskId: string, status: TaskStatus) =>
      wsRequest('tasks.updateStatus', { taskId, status }),

    recoverStuckTask: async (taskId: string) => {
      // For web mode, recovering a stuck task means restarting it
      return wsRequest('tasks.start', { taskId, autoContinue: true });
    },

    // Watch for task progress updates (subtasks) - uses WebSocket subscriptions
    watchTaskProgress: async (projectId: string, specId: string) => {
      // WebSocket subscriptions are handled by onTaskProgressUpdated
      // This function is kept for API compatibility but does nothing
      // The subscription happens when the UI calls onTaskProgressUpdated
      console.log('[WebSocket] watchTaskProgress called for', specId, '- subscriptions handled by event listeners');
      return { success: true };
    },

    unwatchTaskProgress: async (specId: string) => {
      // WebSocket subscriptions cleanup is handled automatically when components unmount
      console.log('[WebSocket] unwatchTaskProgress called for', specId, '- cleanup handled automatically');
      return { success: true };
    },

    // ===================
    // Workspace Management (Web mode - full support via backend API)
    // ===================
    getWorktreeStatus: async (projectId: string, specName: string) => {
      const taskId = `${projectId}:${specName}`;
      return wsRequest('tasks.worktree.status', { projectId, taskId });
    },
    getWorktreeDiff: async (projectId: string, specName: string) => {
      const taskId = `${projectId}:${specName}`;
      return wsRequest('tasks.worktree.diff', { projectId, taskId });
    },
    mergeWorktree: async (projectId: string, specName: string, options?: { deleteAfter?: boolean; noCommit?: boolean }) => {
      const taskId = `${projectId}:${specName}`;
      return wsRequest('tasks.worktree.merge', {
        projectId,
        taskId,
        deleteAfter: options?.deleteAfter,
        noCommit: options?.noCommit,
      });
    },
    mergeWorktreePreview: async (projectId: string, specName: string) => {
      const taskId = `${projectId}:${specName}`;
      return wsRequest('tasks.worktree.mergePreview', { projectId, taskId });
    },
    discardWorktree: async (projectId: string, specName: string, deleteBranch?: boolean) => {
      const taskId = `${projectId}:${specName}`;
      return wsRequest('tasks.worktree.discard', { projectId, taskId, deleteBranch });
    },
    listWorktrees: async (projectId: string) => {
      return wsRequest('tasks.listWorktrees', { projectId });
    },
    worktreeOpenInIDE: async () => ({
      success: false,
      error: 'Opening in IDE is not available in web mode. Use GitHub Codespaces or clone the worktree manually.',
    }),
    worktreeOpenInTerminal: async () => ({
      success: true,
      data: { message: 'Use the built-in terminal and navigate to the worktree path shown above.' },
    }),
    worktreeDetectTools: async (projectId: string, specName: string) => {
      return { success: false, error: 'Tool detection is not yet supported in web mode' };
    },
    createWorktreePR: async () => ({
      success: false,
      error: 'PR creation from web mode is not yet implemented. Use GitHub CLI in terminal: gh pr create --title "..." --body "..."',
    }),
    clearStagedState: async (projectId: string, specName: string) => {
      const taskId = `${projectId}:${specName}`;
      return wsRequest('tasks.clearStagedState', { projectId, taskId });
    },

    // ===================
    // Task Archive
    // ===================
    archiveTasks: async (projectId: string, taskIds: string[]) =>
      wsRequest('tasks.archive', { projectId, taskIds }),
    unarchiveTasks: async (projectId: string, taskIds: string[]) =>
      wsRequest('tasks.unarchive', { projectId, taskIds }),

    // ===================
    // Event Listeners (Web Mode - with polling for progress)
    // ===================
    onTaskProgress: (callback: (taskId: string, plan: any, projectId?: string) => void) => {
      taskProgressCallbacks.add(callback);
      return () => {
        taskProgressCallbacks.delete(callback);
      };
    },
    onTaskError: unsupportedEvent('onTaskError'),
    onTaskLog: unsupportedEvent('onTaskLog'),
    onTaskStatusChange: unsupportedEvent('onTaskStatusChange'),
    onTaskExecutionProgress: unsupportedEvent('onTaskExecutionProgress'),

    // ===================
    // Terminal Operations (Web Mode - WebSocket PTY)
    // ===================
    createTerminal: async (options?: { id?: string; cwd?: string; name?: string; shell?: string; cols?: number; rows?: number; projectPath?: string }) => {
      const frontendTerminalId = options?.id;

      const result = await httpRequest<{
        id: string;
        pid: number;
        name: string;
        cwd: string;
        shell: string;
        cols: number;
        rows: number;
        projectPath?: string;
      }>('/api/terminals', {
        method: 'POST',
        body: JSON.stringify({
          cwd: options?.cwd || '/home',
          name: options?.name || 'Terminal',
          shell: options?.shell,
          cols: options?.cols || 80,
          rows: options?.rows || 24,
          projectPath: options?.projectPath,
        }),
      });

      if (result.success && result.data) {
        const terminalId = frontendTerminalId || result.data.id;
        const backendTerminalId = result.data.id;

        let wsUrl: string;
        const apiBase = getApiBaseUrl();
        if (apiBase) {
          wsUrl = apiBase.replace('http', 'ws') + `/api/terminals/${backendTerminalId}/ws`;
        } else {
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          wsUrl = `${protocol}//${window.location.host}/api/terminals/${backendTerminalId}/ws`;
        }

        (window as any).__webTerminals = (window as any).__webTerminals || {};

        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          console.log(`[WebTerminal] Connected to terminal ${terminalId}`);
        };

        ws.onmessage = (event) => {
          const callback = (window as any).__terminalOutputCallback;
          if (callback && typeof event.data === 'string') {
            callback(terminalId, event.data);
          }
        };

        ws.onerror = (error) => {
          console.error(`[WebTerminal] Error on terminal ${terminalId}:`, error);
        };

        ws.onclose = () => {
          const exitCallback = (window as any).__terminalExitCallback;
          if (exitCallback) {
            exitCallback(terminalId, 0);
          }
        };

        (window as any).__webTerminals[terminalId] = {
          ws,
          wsUrl,
          ...result.data,
        };

        return {
          success: true,
          data: terminalId,
        };
      }

      return result as any;
    },
    destroyTerminal: async (terminalId: string) => {
      const terminalInfo = (window as any).__webTerminals?.[terminalId];
      if (terminalInfo?.ws) {
        terminalInfo.ws.close();
        delete (window as any).__webTerminals[terminalId];
      }

      const result = await httpRequest(`/api/terminals/${terminalId}`, {
        method: 'DELETE',
      });

      return result;
    },
    sendTerminalInput: (terminalId: string, data: string) => {
      const terminalInfo = (window as any).__webTerminals?.[terminalId];
      if (terminalInfo?.ws && terminalInfo.ws.readyState === WebSocket.OPEN) {
        terminalInfo.ws.send(data);
      }
    },
    resizeTerminal: (terminalId: string, cols: number, rows: number) => {
      const terminalInfo = (window as any).__webTerminals?.[terminalId];
      if (terminalInfo?.ws && terminalInfo.ws.readyState === WebSocket.OPEN) {
        terminalInfo.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    },
    invokeClaudeInTerminal: async (terminalId: string, taskId?: string) => {
      const terminalInfo = (window as any).__webTerminals?.[terminalId];
      if (terminalInfo?.ws && terminalInfo.ws.readyState === WebSocket.OPEN) {
        terminalInfo.ws.send('claude\r');
        return { success: true };
      }
      return { success: false, error: 'Terminal not connected' };
    },
    generateTerminalName: async () => ({
      success: true,
      data: `Terminal ${Date.now()}`,
    }),
    setTerminalTitle: unsupportedVoid('setTerminalTitle'),
    setTerminalWorktreeConfig: async (terminalId: string, config: any) => {
      (window as any).__webTerminals = (window as any).__webTerminals || {};
      (window as any).__webTerminals[terminalId] = (window as any).__webTerminals[terminalId] || {};
      (window as any).__webTerminals[terminalId].worktreeConfig = config;
      return { success: true };
    },

    // Terminal session management
    getTerminalSessions: async (projectPath?: string) => {
      // In web mode, filter terminals by project path
      const query = projectPath ? `?projectPath=${encodeURIComponent(projectPath)}` : '';
      const result = await httpRequest<Array<{
        id: string;
        name: string;
        cwd: string;
        shell: string;
        cols: number;
        rows: number;
        connected: boolean;
        projectPath?: string;
      }>>(`/api/terminals${query}`);

      if (result.success && result.data) {
        return {
          success: true,
          data: result.data.map(t => ({
            id: t.id,
            name: t.name,
            cwd: t.cwd,
            createdAt: new Date().toISOString(),
            projectPath: t.projectPath,
          })),
        };
      }
      return { success: true, data: [] };
    },
    restoreTerminalSession: async (sessionId: string) => {
      // In web mode, we can't restore PTY sessions, but we can create a new terminal
      // with the same working directory if the session info is available
      console.log('[Web Mode] Terminal session restore requested:', sessionId);
      
      // Return success with data.success format expected by the component
      return {
        success: true,
        data: {
          success: false,
          error: 'Terminal session restoration is not supported in web mode. Please create a new terminal.',
        },
      };
    },
    clearTerminalSessions: async () => {
      // Close all terminals
      const result = await httpRequest<Array<{ id: string }>>('/api/terminals');
      if (result.success && result.data) {
        for (const terminal of result.data) {
          // Terminal delete not supported in web mode
        }
      }
      return { success: true };
    },
    resumeClaudeInTerminal: unsupportedVoid('resumeClaudeInTerminal'),
    activateDeferredClaudeResume: unsupportedVoid('activateDeferredClaudeResume'),
    getTerminalSessionDates: async () => ({ success: true, data: [] }),
    getTerminalSessionsForDate: async () => ({ success: true, data: [] }),
    restoreTerminalSessionsFromDate: unsupported('restoreTerminalSessionsFromDate'),
    saveTerminalBuffer: async () => {},
    checkTerminalPtyAlive: async (terminalId: string) => {
      const result = await httpRequest<Array<{ id: string }>>('/api/terminals');
      if (result.success && result.data) {
        const found = result.data.some(t => t.id === terminalId);
        return { success: true, data: { alive: found } };
      }
      return { success: true, data: { alive: false } };
    },
    updateTerminalDisplayOrders: unsupported('updateTerminalDisplayOrders'),
    listOtherWorktrees: unsupported('listOtherWorktrees'),

    // Terminal worktree
    createTerminalWorktree: async () => ({
      success: false,
      error: 'Not available in web mode',
    }),
    listTerminalWorktrees: unsupported('listTerminalWorktrees'),
    removeTerminalWorktree: unsupported('removeTerminalWorktree'),

    // Terminal events - these need custom WebSocket handling
    onTerminalOutput: (callback: (terminalId: string, data: string) => void) => {
      // This is handled by the Terminal component connecting directly to WebSocket
      // Store the callback for use by the Terminal component
      (window as any).__terminalOutputCallback = callback;
      return () => {
        delete (window as any).__terminalOutputCallback;
      };
    },
    onTerminalExit: (callback: (terminalId: string, exitCode: number) => void) => {
      (window as any).__terminalExitCallback = callback;
      return () => {
        delete (window as any).__terminalExitCallback;
      };
    },
    onTerminalTitleChange: unsupportedEvent('onTerminalTitleChange'),
    onTerminalClaudeSession: unsupportedEvent('onTerminalClaudeSession'),
    onTerminalClaudeExit: unsupportedEvent('onTerminalClaudeExit'),
    onTerminalRateLimit: unsupportedEvent('onTerminalRateLimit'),
    onTerminalOAuthToken: unsupportedEvent('onTerminalOAuthToken'),
    onTerminalAuthCreated: unsupportedEvent('onTerminalAuthCreated'),
    onTerminalClaudeBusy: unsupportedEvent('onTerminalClaudeBusy'),
    onTerminalPendingResume: unsupportedEvent('onTerminalPendingResume'),
    onTerminalWorktreeConfigChange: unsupportedEvent('onTerminalWorktreeConfigChange'),
    onTerminalOnboardingComplete: unsupportedEvent('onTerminalOnboardingComplete'),
    onTerminalProfileChanged: unsupportedEvent('onTerminalProfileChanged'),
    onTerminalOAuthCodeNeeded: unsupportedEvent('onTerminalOAuthCodeNeeded'),
    submitOAuthCode: unsupported('submitOAuthCode'),

    // ===================
    // Claude Profile Management (partial web support)
    // ===================
    getClaudeProfiles: async () =>
      wsRequest('profiles.get'),

    saveClaudeProfile: async (profile: Record<string, unknown>) =>
      wsRequest('profiles.create', profile),

    deleteClaudeProfile: async (profileId: string) =>
      wsRequest('profiles.delete', { profileId }),
    renameClaudeProfile: async (profileId: string, newName: string) =>
      wsRequest('profiles.update', { profileId, name: newName }),
    setActiveClaudeProfile: async (profileId: string) =>
      wsRequest('profiles.activate', { profileId }),
    switchClaudeProfile: unsupported('switchClaudeProfile'),
    initializeClaudeProfile: unsupported('initializeClaudeProfile'),
    setClaudeProfileToken: unsupported('setClaudeProfileToken'),
    authenticateClaudeProfile: unsupported('authenticateClaudeProfile'),
    verifyClaudeProfileAuth: unsupported('verifyClaudeProfileAuth'),
    getAutoSwitchSettings: unsupported('getAutoSwitchSettings'),
    updateAutoSwitchSettings: unsupported('updateAutoSwitchSettings'),
    retryWithProfile: unsupported('retryWithProfile'),

    // ===================
    // Usage Tracking
    // ===================
    requestUsageUpdate: unsupported('requestUsageUpdate'),
    onUsageUpdated: unsupportedEvent('onUsageUpdated'),

    // ===================
    // Settings
    // ===================
    getSettings: async () => {
      const ws = getWSClient();
      const data = await ws.request('settings.get', {});
      return { success: true, data };
    },
    saveSettings: async (settings: Record<string, unknown>) => {
      const ws = getWSClient();
      const data = await ws.request('settings.update', settings);
      return { success: true, data };
    },
    getAppVersion: async () => '1.0.0-web',
    getSentryConfig: async () => ({
      dsn: '',
      tracesSampleRate: 0,
      profilesSampleRate: 0,
    }),
    notifySentryStateChanged: unsupportedVoid('notifySentryStateChanged'),

    // ===================
    // Context Operations
    // ===================
    getProjectContext: async (projectId: string) =>
      wsRequest('context.get', { projectId }),
    refreshProjectIndex: async (projectId: string) =>
      wsRequest('context.refresh', { projectId }),
    getMemoryStatus: async (projectId: string) => {
      const result = await wsRequest<{ memoryStatus: unknown }>('context.get', { projectId });
      if (result.success && result.data) {
        return { success: true, data: (result.data as any).memoryStatus };
      }
      return result as any;
    },
    searchMemories: async (projectId: string, query: string) =>
      wsRequest('context.searchMemories', { projectId, query }),
    getRecentMemories: async (projectId: string, limit?: number) =>
      wsRequest('context.getRecentMemories', { projectId, limit }),

    // ===================
    // Environment Config
    // ===================
    getProjectEnv: async (projectId: string) =>
      wsRequest('env.get', { projectId }),
    updateProjectEnv: async (projectId: string, config: Partial<ProjectEnvConfig>) =>
      wsRequest('env.update', { projectId, config }),
    checkClaudeAuth: unsupported('checkClaudeAuth'),
    invokeClaudeSetup: unsupported('invokeClaudeSetup'),

    // ===================
    // Dialog Operations (limited in web)
    // ===================
    selectDirectory: async (): Promise<string | null> => {
      try {
        // In web mode, fetch available projects from the server
        const availableResult = await wsRequest<Array<{ name: string; path: string }>>('projects.getAvailable');
        
        let message = 'Enter the server-side project path:\n\n';
        
        if (availableResult.success && availableResult.data && availableResult.data.length > 0) {
          message += 'Available projects in /home/code:\n';
          availableResult.data.forEach((proj) => {
            message += `  - ${proj.name} (${proj.path})\n`;
          });
          message += '\nEnter the full path from above, or enter a custom path:';
        } else {
          message += 'No projects found in /home/code\n\n';
          message += 'Place your project in ./code/ on the host machine, then enter:\n';
          message += '/home/code/your-project-name';
        }
        
        const path = window.prompt(message, '/home/code/');
        
        if (!path) {
          return null;
        }
        
        // Validate the path format
        if (!path.startsWith('/')) {
          window.alert('Path must be an absolute path starting with /');
          return null;
        }
        
        return path.trim();
      } catch (error) {
        console.log('[Web Adapter] Directory selection cancelled or failed:', error);
        // Fallback to simple prompt if API call fails
        const path = window.prompt(
          'Enter the server-side project path:\n\n' +
          'Example: /home/code/your-project-name\n\n' +
          'Make sure the project exists in ./code/ on your host machine.',
          '/home/code/'
        );
        return path?.trim() || null;
      }
    },
    createProjectFolder: async (
      location: string,
      name: string,
      initGit: boolean
    ): Promise<IPCResult<import('../../shared/types').CreateProjectFolderResult>> => {
      const response = await wsRequest<{
        path: string;
        name: string;
        gitInitialized: boolean;
      }>('projects.createFolder', { location, name, initGit });
      
      if (!response.success || !response.data) {
        return { success: false, error: response.error || 'Failed to create project folder' };
      }
      
      return {
        success: true,
        data: {
          path: response.data.path,
          name: response.data.name,
          gitInitialized: response.data.gitInitialized,
        },
      };
    },
    getDefaultProjectLocation: async () => null,

    // ===================
    // Memory Infrastructure
    // ===================
    getMemoryInfrastructureStatus: async (projectId: string) => {
      const result = await wsRequest('context.get', { projectId });
      if (result.success && result.data) {
        const memoryStatus = (result.data as any).memoryStatus || {};
        return {
          success: true,
          data: {
            ladybugAvailable: memoryStatus.available ?? false,
            graphitiReady: memoryStatus.available ?? false,
            llmProvider: memoryStatus.llmProvider || 'anthropic',
            embeddingProvider: memoryStatus.embeddingProvider || null,
            embeddingModel: memoryStatus.embeddingModel || null,
            missingConfig: memoryStatus.missingConfig || [],
          },
        };
      }
      return { success: false, error: result.error };
    },
    listMemoryDatabases: async (projectId: string) => {
      const result = await wsRequest('context.get', { projectId });
      if (result.success && result.data) {
        const memoryStatus = (result.data as any).memoryStatus || {};
        const databases = memoryStatus.dbPath ? [{
          name: memoryStatus.database || 'default',
          path: memoryStatus.dbPath,
          size: 0,
        }] : [];
        return { success: true, data: databases };
      }
      return { success: true, data: [] };
    },
    testMemoryConnection: async (projectId: string) => {
      const result = await wsRequest('context.get', { projectId });
      if (result.success && result.data) {
        const memoryStatus = (result.data as any).memoryStatus || {};
        return {
          success: true,
          data: {
            connected: memoryStatus.available ?? false,
            message: memoryStatus.available ? 'Memory system connected' : 'Memory system not available',
          },
        };
      }
      return { success: false, error: result.error };
    },
    validateLLMApiKey: async (provider: string, apiKey: string) => {
      // Use the existing test-connection endpoint
      const result = await wsRequest('connection.test', {
        baseUrl: provider === 'openai' ? 'https://api.openai.com' : 'https://api.anthropic.com',
        apiKey,
      });
      return result;
    },
    testGraphitiConnection: async (projectId: string) => {
      const result = await wsRequest('context.get', { projectId });
      if (result.success && result.data) {
        const memoryStatus = (result.data as any).memoryStatus || {};
        return {
          success: true,
          data: {
            connected: memoryStatus.available ?? false,
            version: '1.0.0',
            message: memoryStatus.available ? 'Graphiti connected' : 'Graphiti not configured',
          },
        };
      }
      return { success: false, error: result.error };
    },

    // ===================
    // Ollama
    // ===================
    onDownloadProgress: unsupportedEvent('onDownloadProgress'),
    checkOllamaStatus: async (baseUrl?: string) =>
      wsRequest('ollama.status', baseUrl ? { baseUrl } : {}),
    checkOllamaInstalled: async () =>
      wsRequest('ollama.checkInstalled'),
    installOllama: async () =>
      wsRequest('ollama.install'),
    listOllamaModels: async (baseUrl?: string) =>
      wsRequest('ollama.listModels', baseUrl ? { baseUrl } : {}),
    listOllamaEmbeddingModels: async (baseUrl?: string) =>
      wsRequest('ollama.listEmbeddingModels', baseUrl ? { baseUrl } : {}),
    pullOllamaModel: async (modelName: string, baseUrl?: string) =>
      wsRequest('ollama.pull', { modelName, baseUrl }),

    // ===================
    // Git Operations
    // ===================
    getGitBranches: async (projectPath: string) =>
      wsRequest('git.branches', { projectPath }),
    getCurrentGitBranch: async (projectPath: string) =>
      wsRequest('git.currentBranch', { projectPath }),
    detectMainBranch: async (projectPath: string) =>
      wsRequest('git.detectMainBranch', { projectPath }),
    checkGitStatus: async (projectPath: string) =>
      wsRequest('git.status', { projectPath }),
    initializeGit: async (projectPath: string) =>
      wsRequest('git.init', { path: projectPath }),

    // ===================
    // Linear Integration
    // ===================
    getLinearTeams: unsupported('getLinearTeams'),
    getLinearProjects: unsupported('getLinearProjects'),
    getLinearIssues: unsupported('getLinearIssues'),
    importLinearIssues: unsupported('importLinearIssues'),
    checkLinearConnection: unsupported('checkLinearConnection'),

    // ===================
    // Roadmap
    // ===================
    getRoadmap: async (projectId: string) =>
      wsRequest('roadmap.get', { projectId }),
    getRoadmapStatus: async (projectId: string) => {
      const result = await httpRequest<RoadmapStatusPayload>(`/api/projects/${projectId}/roadmap/status`);
      // No polling - WebSocket will handle real-time updates via onRoadmapProgress subscription
      return result;
    },
    saveRoadmap: async (projectId: string, roadmap: any) =>
      wsRequest('roadmap.save', { projectId, roadmap }),
    generateRoadmap: (projectId: string, enableCompetitorAnalysis?: boolean, refreshCompetitorAnalysis?: boolean) => {
      const payload = {
        enable_competitor_analysis: enableCompetitorAnalysis ?? false,
        refresh_competitor_analysis: refreshCompetitorAnalysis ?? false,
      };
      wsRequest('roadmap.generate', { projectId, ...payload });
      // No polling - WebSocket will handle real-time updates via onRoadmapProgress subscription
    },
    refreshRoadmap: (projectId: string, enableCompetitorAnalysis?: boolean, refreshCompetitorAnalysis?: boolean) => {
      const payload = {
        refresh: true,
        enable_competitor_analysis: enableCompetitorAnalysis ?? false,
        refresh_competitor_analysis: refreshCompetitorAnalysis ?? false,
      };
      wsRequest('roadmap.refresh', { projectId, ...payload });
      // No polling - WebSocket will handle real-time updates via onRoadmapProgress subscription
    },
    updateFeatureStatus: async (projectId: string, featureId: string, status: any) =>
      wsRequest('roadmap.updateFeatureStatus', { projectId, featureId, status }),
    convertFeatureToSpec: async (projectId: string, featureId: string) =>
      wsRequest('roadmap.convertToSpec', { projectId, featureId }),
    stopRoadmap: async (projectId: string) => {
      // No polling to stop - WebSocket subscriptions handle themselves
      const result = await wsRequest('roadmap.stop', { projectId });
      if (result.success) {
        roadmapStoppedCallbacks.forEach((callback) => {
          callback(projectId);
        });
      }
      return result;
    },
    onRoadmapProgress: (callback: (projectId: string, status: any) => void) => {
      // Always use WebSocket - subscribe to roadmap.status channel
      const client = getWSClient();
      return client.subscribe('roadmap.status', {}, (data, cursor) => {
        const projectId = data.projectId || data.project_id;
        if (projectId) {
          callback(projectId, data);
        }
      });
    },
    onRoadmapComplete: (callback: (projectId: string, roadmap: any) => void) => {
      // Always use WebSocket - listen for completion phase
      const client = getWSClient();
      return client.subscribe('roadmap.status', {}, (data, cursor) => {
        const projectId = data.projectId || data.project_id;
        if (projectId && data.phase === 'complete' && data.roadmap) {
          callback(projectId, data.roadmap);
        }
      });
    },
    onRoadmapError: (callback: (projectId: string, error: string) => void) => {
      // Always use WebSocket - listen for error phase
      const client = getWSClient();
      return client.subscribe('roadmap.status', {}, (data, cursor) => {
        const projectId = data.projectId || data.project_id;
        if (projectId && data.phase === 'error' && data.error) {
          callback(projectId, data.error);
        }
      });
    },
    onRoadmapStopped: (callback: (projectId: string) => void) => {
      roadmapStoppedCallbacks.add(callback as any);
      return () => {
        roadmapStoppedCallbacks.delete(callback as any);
      };
    },

    // ===================
    // Ideation
    // ===================
    getIdeation: unsupported('getIdeation'),
    generateIdeation: unsupportedVoid('generateIdeation'),
    refreshIdeation: unsupportedVoid('refreshIdeation'),
    stopIdeation: unsupported('stopIdeation'),
    updateIdeaStatus: unsupported('updateIdeaStatus'),
    convertIdeaToTask: unsupported('convertIdeaToTask'),
    dismissIdea: unsupported('dismissIdea'),
    dismissAllIdeas: unsupported('dismissAllIdeas'),
    archiveIdea: unsupported('archiveIdea'),
    deleteIdea: unsupported('deleteIdea'),
    deleteMultipleIdeas: unsupported('deleteMultipleIdeas'),
    onIdeationProgress: unsupportedEvent('onIdeationProgress'),
    onIdeationLog: unsupportedEvent('onIdeationLog'),
    onIdeationComplete: unsupportedEvent('onIdeationComplete'),
    onIdeationError: unsupportedEvent('onIdeationError'),
    onIdeationStopped: unsupportedEvent('onIdeationStopped'),
    onIdeationTypeComplete: unsupportedEvent('onIdeationTypeComplete'),
    onIdeationTypeFailed: unsupportedEvent('onIdeationTypeFailed'),

    // ===================
    // App Updates (not supported in web)
    // ===================
    checkAppUpdate: unsupported('checkAppUpdate'),
    downloadAppUpdate: unsupported('downloadAppUpdate'),
    downloadStableUpdate: unsupported('downloadStableUpdate'),
    installAppUpdate: unsupportedVoid('installAppUpdate'),
    getDownloadedAppUpdate: unsupported('getDownloadedAppUpdate'),
    onAppUpdateAvailable: unsupportedEvent('onAppUpdateAvailable'),
    onAppUpdateDownloaded: unsupportedEvent('onAppUpdateDownloaded'),
    onAppUpdateProgress: unsupportedEvent('onAppUpdateProgress'),
    onAppUpdateStableDowngrade: unsupportedEvent('onAppUpdateStableDowngrade'),

    // ===================
    // Shell Operations
    // ===================
    openExternal: async (url: string) => {
      window.open(url, '_blank');
    },
    openTerminal: unsupported('openTerminal'),

    // ===================
    // Source Environment
    // ===================
    getSourceEnv: async () =>
      wsRequest('sourceEnv.get'),
    updateSourceEnv: async (config: { claudeOAuthToken?: string }) =>
      wsRequest('sourceEnv.update', config),
    checkSourceToken: async () =>
      wsRequest('sourceEnv.checkToken'),

    // ===================
    // Changelog
    // ===================
    getChangelogDoneTasks: unsupported('getChangelogDoneTasks'),
    loadTaskSpecs: unsupported('loadTaskSpecs'),
    generateChangelog: unsupportedVoid('generateChangelog'),
    saveChangelog: unsupported('saveChangelog'),
    readExistingChangelog: unsupported('readExistingChangelog'),
    suggestChangelogVersion: unsupported('suggestChangelogVersion'),
    suggestChangelogVersionFromCommits: unsupported('suggestChangelogVersionFromCommits'),
    getChangelogBranches: unsupported('getChangelogBranches'),
    getChangelogTags: unsupported('getChangelogTags'),
    getChangelogCommitsPreview: unsupported('getChangelogCommitsPreview'),
    saveChangelogImage: unsupported('saveChangelogImage'),
    readLocalImage: unsupported('readLocalImage'),
    onChangelogGenerationProgress: unsupportedEvent('onChangelogGenerationProgress'),
    onChangelogGenerationComplete: unsupportedEvent('onChangelogGenerationComplete'),
    onChangelogGenerationError: unsupportedEvent('onChangelogGenerationError'),

    // ===================
    // Insights
    // ===================
    getInsightsSession: async (projectId: string) =>
      wsRequest('insights.getSession', { projectId }),
    sendInsightsMessage: async (projectId: string, message: string, modelConfig?: Record<string, unknown>) => {
      // Web mode: Use Server-Sent Events (SSE) for streaming response
      const insightsStoreModule = await import('../stores/insights-store');
      const store = insightsStoreModule.useInsightsStore.getState();
      
      try {
        const baseUrl = getApiBaseUrl();
        const url = `${baseUrl}/api/projects/${projectId}/insights/message`;
        
        console.log('[Web API] Sending insights message via SSE:', { projectId, message: message.substring(0, 50) + '...' });
        
        // Use fetch with streaming for SSE
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
          },
          body: JSON.stringify({ message, modelConfig }),
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error('[Web API] Insights SSE error:', errorText);
          store.setStatus({ phase: 'error', error: errorText });
          return;
        }
        
        // Read the SSE stream
        const reader = response.body?.getReader();
        if (!reader) {
          store.setStatus({ phase: 'error', error: 'No response stream' });
          return;
        }
        
        const decoder = new TextDecoder();
        let buffer = '';
        
        store.setStatus({ phase: 'streaming', message: 'Receiving response...' });
        
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            break;
          }
          
          buffer += decoder.decode(value, { stream: true });
          
          // Process complete SSE messages (lines ending with \n\n)
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || ''; // Keep incomplete message in buffer
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                
                switch (data.type) {
                  case 'text':
                    if (data.content) {
                      store.appendStreamingContent(data.content);
                    }
                    break;
                    
                  case 'tool_start':
                    if (data.tool) {
                      store.setCurrentTool({
                        name: data.tool.name,
                        input: data.tool.input
                      });
                      store.addToolUsage({
                        name: data.tool.name,
                        input: data.tool.input
                      });
                      store.setStatus({
                        phase: 'streaming',
                        message: `Using ${data.tool.name}...`
                      });
                    }
                    break;
                    
                  case 'tool_end':
                    store.setCurrentTool(null);
                    break;
                    
                  case 'task_suggestion':
                    store.setCurrentTool(null);
                    store.finalizeStreamingMessage(data.suggestedTask);
                    break;
                    
                  case 'done':
                    store.setCurrentTool(null);
                    store.finalizeStreamingMessage();
                    store.setStatus({ phase: 'complete', message: '' });
                    setTimeout(() => {
                      store.setStatus({ phase: 'idle', message: '' });
                    }, 100);
                    break;
                    
                  case 'error':
                    store.setCurrentTool(null);
                    store.setStatus({ phase: 'error', error: data.error });
                    break;
                    
                  case 'user_message':
                    // User message already added by store, skip
                    break;
                }
              } catch (parseError) {
                console.warn('[Web API] Failed to parse SSE data:', line);
              }
            }
          }
        }
        
        // Handle any remaining buffer content
        if (buffer.startsWith('data: ')) {
          try {
            const data = JSON.parse(buffer.slice(6));
            if (data.type === 'done') {
              store.finalizeStreamingMessage();
              store.setStatus({ phase: 'idle', message: '' });
            }
          } catch {
            // Ignore incomplete data
          }
        }
        
      } catch (error) {
        console.error('[Web API] sendInsightsMessage exception:', error);
        store.setStatus({ 
          phase: 'error', 
          error: error instanceof Error ? error.message : 'Unknown error occurred' 
        });
      }
    },
    clearInsightsSession: async (projectId: string) =>
      wsRequest('insights.deleteSession', { projectId }),
    createTaskFromInsights: async (projectId: string, title: string, description: string, metadata?: TaskMetadata) =>
      wsRequest('tasks.create', { projectId, title, description, metadata }),
    listInsightsSessions: async (projectId: string) =>
      wsRequest('insights.getSessions', { projectId }),
    newInsightsSession: async (projectId: string) =>
      wsRequest('insights.createSession', { projectId }),
    switchInsightsSession: async (projectId: string, sessionId: string) =>
      wsRequest('insights.switchSession', { projectId, sessionId }),
    deleteInsightsSession: async (projectId: string, sessionId: string) =>
      wsRequest('insights.deleteSession', { projectId, sessionId }),
    renameInsightsSession: async (projectId: string, sessionId: string, title: string) =>
      wsRequest('insights.renameSession', { projectId, sessionId, title }),
    updateInsightsModelConfig: async (projectId: string, sessionId: string, modelConfig: Record<string, unknown>) =>
      wsRequest('insights.updateModelConfig', { projectId, sessionId, modelConfig }),
    onInsightsStreamChunk: unsupportedEvent('onInsightsStreamChunk'),
    onInsightsStatus: unsupportedEvent('onInsightsStatus'),
    onInsightsError: unsupportedEvent('onInsightsError'),

    // ===================
    // Task Logs (Web Mode)
    // ===================
    getTaskLogs: async (projectId: string, specId: string) => {
      return wsRequest('tasks.getLogs', { projectId, specId });
    },
    watchTaskLogs: async (projectId: string, specId: string) => {
      // WebSocket subscriptions are handled by onTaskLogsChanged
      // This function is kept for API compatibility but does nothing
      console.log('[WebSocket] watchTaskLogs called for', specId, '- subscriptions handled by event listeners');
      return { success: true };
    },
    unwatchTaskLogs: async (specId: string) => {
      // WebSocket subscriptions cleanup is handled automatically when components unmount
      console.log('[WebSocket] unwatchTaskLogs called for', specId, '- cleanup handled automatically');
      return { success: true };
    },
    onTaskLogsChanged: (callback: (specId: string, logs: any) => void) => {
      // Always use WebSocket - subscribe to task.logs channel
      const client = getWSClient();
      return client.subscribe('task.logs', {}, (data, cursor) => {
        // Extract specId from event data
        const specId = data.specId || data.spec_id;
        if (specId) {
          callback(specId, data.logs || data);
        }
      });
    },
    onTaskLogsStream: unsupportedEvent('onTaskLogsStream'),

    // ===================
    // File Operations
    // ===================
    listDirectory: async (dirPath: string) => {
      console.log('[Web Adapter] listDirectory called with:', dirPath);
      const pathParts = dirPath.replace(/\/$/, '').split('/');
      const specFolder = pathParts[pathParts.length - 1];
      const specsIndex = pathParts.indexOf('specs');
      const autoClaudeIndex = pathParts.indexOf('.auto-claude');
      
      console.log('[Web Adapter] listDirectory parsed:', { specFolder, specsIndex, autoClaudeIndex, pathParts });
      
      if (specsIndex === -1 || autoClaudeIndex === -1) {
        console.warn('[Web Adapter] listDirectory: Invalid path:', dirPath);
        return { success: false, error: 'Invalid specs path format' };
      }
      
      const projectPath = pathParts.slice(0, autoClaudeIndex).join('/');
      console.log('[Web Adapter] listDirectory projectPath:', projectPath);
      
      const projectsResult = await wsRequest<Array<{ id: string; path: string }>>('projects.get');
      console.log('[Web Adapter] listDirectory projects:', projectsResult);
      
      if (!projectsResult.success || !projectsResult.data) {
        return { success: false, error: 'Failed to fetch projects' };
      }
      
      const project = projectsResult.data.find(p => p.path === projectPath);
      console.log('[Web Adapter] listDirectory found project:', project);
      
      if (!project) {
        console.warn('[Web Adapter] listDirectory: Project not found for path:', projectPath);
        return { success: false, error: 'Project not found' };
      }
      
      const endpoint = `/api/projects/${project.id}/tasks/${specFolder}/files`;
      console.log('[Web Adapter] listDirectory calling endpoint:', endpoint);
      return wsRequest('files.list', { projectId: project.id, specId: specFolder });
    },
    
    readFile: async (filePath: string) => {
      const pathParts = filePath.replace(/\/$/, '').split('/');
      const specsIndex = pathParts.indexOf('specs');
      const autoClaudeIndex = pathParts.indexOf('.auto-claude');
      
      if (specsIndex === -1 || autoClaudeIndex === -1) {
        return { success: false, error: 'Invalid file path format' };
      }
      
      const specFolder = pathParts[specsIndex + 1];
      const projectPath = pathParts.slice(0, autoClaudeIndex).join('/');
      
      const projectsResult = await wsRequest<Array<{ id: string; path: string }>>('projects.get');
      if (!projectsResult.success || !projectsResult.data) {
        return { success: false, error: 'Failed to fetch projects' };
      }
      
      const project = projectsResult.data.find(p => p.path === projectPath);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }
      
      const encodedPath = encodeURIComponent(filePath);
      return wsRequest('files.getContent', { projectId: project.id, specId: specFolder, filePath: encodedPath });
    },

    // Get git changes for a task (list of modified files)
    getTaskGitChanges: async (projectId: string, specId: string) => {
      console.log('[Web Adapter] getTaskGitChanges:', { projectId, specId });
      return wsRequest('tasks.getGitChanges', { projectId, specId });
    },

    // Get git diff for a specific file in a task
    getTaskFileDiff: async (projectId: string, specId: string, filePath: string) => {
      console.log('[Web Adapter] getTaskFileDiff:', { projectId, specId, filePath });
      const encodedPath = encodeURIComponent(filePath);
      return wsRequest('tasks.getGitDiff', { projectId, specId, filePath: encodedPath });
    },

    // ===================
    // GitHub API
    // ===================
    github: {
      getGitHubRepositories: async () => ({ success: true, data: [] }),
      getGitHubIssues: async () => ({ success: true, data: [] }),
      getGitHubIssue: async () => ({ success: true, data: null as any }),
      getIssueComments: async () => ({ success: true, data: [] }),
      checkGitHubConnection: async () => ({
        success: true,
        data: { connected: false, repoFullName: undefined, error: undefined },
      }),
      investigateGitHubIssue: () => {},
      importGitHubIssues: async () => ({
        success: true,
        data: { success: true, imported: 0, failed: 0, issues: [] },
      }),
      createGitHubRelease: async () => ({ success: true, data: { url: '' } }),
      suggestReleaseVersion: async () => ({
        success: true,
        data: {
          suggestedVersion: '1.0.0',
          currentVersion: '0.0.0',
          bumpType: 'minor' as const,
          commitCount: 0,
          reason: 'Initial',
        },
      }),
      checkGitHubCli: async () => ({ success: true, data: { installed: false } }),
      checkGitHubAuth: async () => ({ success: true, data: { authenticated: false } }),
      startGitHubAuth: async () => ({ success: true, data: { success: false } }),
      getGitHubToken: async () => ({ success: true, data: { token: '' } }),
      getGitHubUser: async () => ({ success: true, data: { username: '' } }),
      listGitHubUserRepos: async () => ({ success: true, data: { repos: [] } }),
      detectGitHubRepo: async () => ({ success: true, data: '' }),
      getGitHubBranches: async () => ({ success: true, data: [] }),
      createGitHubRepo: async () => ({ success: true, data: { fullName: '', url: '' } }),
      addGitRemote: async () => ({ success: true, data: { remoteUrl: '' } }),
      listGitHubOrgs: async () => ({ success: true, data: { orgs: [] } }),
      onGitHubAuthDeviceCode: () => () => {},
      onGitHubInvestigationProgress: () => () => {},
      onGitHubInvestigationComplete: () => () => {},
      onGitHubInvestigationError: () => () => {},
      getAutoFixConfig: async () => null,
      saveAutoFixConfig: async () => true,
      getAutoFixQueue: async () => [],
      checkAutoFixLabels: async () => [],
      checkNewIssues: async () => [],
      startAutoFix: () => {},
      onAutoFixProgress: () => () => {},
      onAutoFixComplete: () => () => {},
      onAutoFixError: () => () => {},
      listPRs: async () => [],
      getPR: async () => null,
      runPRReview: () => {},
      cancelPRReview: async () => true,
      postPRReview: async () => true,
      postPRComment: async () => true,
      mergePR: async () => true,
      assignPR: async () => true,
      getPRReview: async () => null,
      getPRReviewsBatch: async () => ({}),
      deletePRReview: async () => true,
      checkNewCommits: async () => ({ hasNewCommits: false, newCommitCount: 0 }),
      checkMergeReadiness: async () => ({
        isDraft: false,
        mergeable: 'UNKNOWN' as const,
        ciStatus: 'none' as const,
        blockers: [],
      }),
      runFollowupReview: () => {},
      getPRLogs: async () => null,
      getWorkflowsAwaitingApproval: async () => ({
        awaiting_approval: 0,
        workflow_runs: [],
        can_approve: false,
      }),
      approveWorkflow: async () => true,
      onPRReviewProgress: () => () => {},
      onPRReviewComplete: () => () => {},
      onPRReviewError: () => () => {},
      batchAutoFix: () => {},
      getBatches: async () => [],
      onBatchProgress: () => () => {},
      onBatchComplete: () => () => {},
      onBatchError: () => () => {},
      analyzeIssuesPreview: () => {},
      approveBatches: async () => ({ success: true, batches: [] }),
      onAnalyzePreviewProgress: () => () => {},
      onAnalyzePreviewComplete: () => () => {},
      onAnalyzePreviewError: () => () => {},
    },

    // ===================
    // GitLab API (flat, not nested)
    // ===================
    getGitLabProjects: unsupported('getGitLabProjects'),
    checkGitLabConnection: unsupported('checkGitLabConnection'),
    getGitLabIssues: unsupported('getGitLabIssues'),
    getGitLabIssue: unsupported('getGitLabIssue'),
    getGitLabIssueNotes: unsupported('getGitLabIssueNotes'),
    investigateGitLabIssue: unsupportedVoid('investigateGitLabIssue'),
    importGitLabIssues: unsupported('importGitLabIssues'),
    createGitLabRelease: unsupported('createGitLabRelease'),
    getGitLabMergeRequests: unsupported('getGitLabMergeRequests'),
    getGitLabMergeRequest: unsupported('getGitLabMergeRequest'),
    createGitLabMergeRequest: unsupported('createGitLabMergeRequest'),
    updateGitLabMergeRequest: unsupported('updateGitLabMergeRequest'),
    getGitLabMRReview: async () => null,
    runGitLabMRReview: unsupportedVoid('runGitLabMRReview'),
    runGitLabMRFollowupReview: unsupportedVoid('runGitLabMRFollowupReview'),
    postGitLabMRReview: async () => false,
    postGitLabMRNote: async () => false,
    mergeGitLabMR: async () => false,
    assignGitLabMR: async () => false,
    approveGitLabMR: async () => false,
    cancelGitLabMRReview: async () => true,
    checkGitLabMRNewCommits: async () => ({ hasNewCommits: false, newCommitCount: 0 }),
    onGitLabMRReviewProgress: unsupportedEvent('onGitLabMRReviewProgress'),
    onGitLabMRReviewComplete: unsupportedEvent('onGitLabMRReviewComplete'),
    onGitLabMRReviewError: unsupportedEvent('onGitLabMRReviewError'),
    checkGitLabCli: unsupported('checkGitLabCli'),
    installGitLabCli: unsupported('installGitLabCli'),
    checkGitLabAuth: unsupported('checkGitLabAuth'),
    startGitLabAuth: unsupported('startGitLabAuth'),
    getGitLabToken: unsupported('getGitLabToken'),
    getGitLabUser: unsupported('getGitLabUser'),
    listGitLabUserProjects: unsupported('listGitLabUserProjects'),
    detectGitLabProject: unsupported('detectGitLabProject'),
    getGitLabBranches: unsupported('getGitLabBranches'),
    createGitLabProject: unsupported('createGitLabProject'),
    addGitLabRemote: unsupported('addGitLabRemote'),
    listGitLabGroups: unsupported('listGitLabGroups'),
    onGitLabInvestigationProgress: unsupportedEvent('onGitLabInvestigationProgress'),
    onGitLabInvestigationComplete: unsupportedEvent('onGitLabInvestigationComplete'),
    onGitLabInvestigationError: unsupportedEvent('onGitLabInvestigationError'),

    // ===================
    // Claude Code CLI
    // ===================
    checkClaudeCodeVersion: async () => {
      // Check Claude CLI availability via backend
      const result = await httpRequest<{
        installed: string | null;
        latest: string;
        isOutdated: boolean;
        path: string | undefined;
        detectionResult: {
          found: boolean;
          path: string | undefined;
          version: string | undefined;
          source: 'system-path' | 'user-config' | 'homebrew' | 'nvm';
          message: string;
        };
      }>('/api/claude-cli/version');
      
      if (result.success && result.data) {
        return result;
      }
      
      // Fallback if backend call fails
      return {
        success: true,
        data: {
          installed: null,
          latest: '1.0.0',
          isOutdated: false,
          path: undefined,
          detectionResult: {
            found: false,
            path: undefined,
            version: undefined,
            source: 'system-path' as const,
            message: 'Claude Code CLI check failed - backend unavailable',
          },
        },
      };
    },
    installClaudeCode: async () => ({
      success: false,
      error: 'To install Claude Code CLI on the server, run: npm install -g @anthropic-ai/claude-code',
    }),

    // ===================
    // Debug
    // ===================
    getDebugInfo: async () => ({
      systemInfo: {
        appVersion: '0.0.0-web',
        platform: 'web',
        isPackaged: 'false',
      },
      recentErrors: [],
      logsPath: '/web/logs',
      debugReport: '[Web Mode] Debug report not available in browser',
    }),
    openLogsFolder: async () => ({
      success: true,
      data: {
        message: 'Log files are stored on the server. Use the terminal to access: ~/.auto-claude/logs/',
        path: '~/.auto-claude/logs/',
      },
    }),
    copyDebugInfo: async () => {
      const debugInfo = await api.getDebugInfo();
      if (debugInfo.debugReport) {
        try {
          await navigator.clipboard.writeText(debugInfo.debugReport);
          return { success: true };
        } catch (err) {
          return { success: false, error: 'Clipboard access denied. Copy manually from debug view.' };
        }
      }
      return { success: false, error: 'No debug info available' };
    },
    getRecentErrors: async () => [],
    listLogFiles: async () => [],

    // ===================
    // MCP Health Check
    // ===================
    checkMcpHealth: async (server: CustomMcpServer) => ({
      success: true,
      data: {
        serverId: server.id,
        status: 'unknown' as const,
        message: 'Health check not available in web mode',
        checkedAt: new Date().toISOString(),
      },
    }),
    testMcpConnection: async (server: CustomMcpServer) => ({
      success: true,
      data: {
        serverId: server.id,
        success: false,
        message: 'Connection test not available in web mode',
      },
    }),

    // ===================
    // API Profiles
    // ===================
    getAPIProfiles: async () => wsRequest('profiles.get'),

    saveAPIProfile: async (profile: Record<string, unknown>) =>
      wsRequest('profiles.create', profile),

    updateAPIProfile: async (profile: Record<string, unknown>) =>
      wsRequest('profiles.update', { profileId: profile.id, ...profile }),

    deleteAPIProfile: async (profileId: string) =>
      wsRequest('profiles.delete', { profileId }),

    setActiveAPIProfile: async (profileId: string | null) =>
      wsRequest('profiles.activate', { profileId }),

    testConnection: async (baseUrl: string, apiKey: string) =>
      wsRequest('connection.test', { baseUrl, apiKey }),

    discoverModels: async (baseUrl: string, apiKey: string) => {
      // Try to discover models from the API endpoint
      try {
        const response = await fetch(`${baseUrl}/v1/models`, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'x-api-key': apiKey,
          },
        });
        if (response.ok) {
          const data = await response.json();
          const models = (data.data || []).map((m: any) => ({
            id: m.id,
            name: m.id,
            created: m.created,
          }));
          return { success: true, data: { models } };
        }
        return { success: false, error: `API returned ${response.status}` };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to discover models' };
      }
    },

    // Folder browsing for web mode
    browseFolders: async (path?: string) =>
      wsRequest('folders.browse', path ? { path } : {}),

    // Stub remaining methods that may be missing
    // These are added to match ElectronAPI interface fully
    fetchClaudeUsage: unsupported('fetchClaudeUsage'),
    getBestAvailableProfile: unsupported('getBestAvailableProfile'),
    onSDKRateLimit: unsupportedEvent('onSDKRateLimit'),
    onAuthFailure: unsupportedEvent('onAuthFailure'),
    onProactiveSwapNotification: unsupportedEvent('onProactiveSwapNotification'),
    getReleaseableVersions: unsupported('getReleaseableVersions'),
    runReleasePreflightCheck: unsupported('runReleasePreflightCheck'),
    createRelease: unsupportedVoid('createRelease'),
    onReleaseProgress: unsupportedEvent('onReleaseProgress'),
    onReleaseComplete: unsupportedEvent('onReleaseComplete'),
    onReleaseError: unsupportedEvent('onReleaseError'),
    getGitHubRepositories: unsupported('getGitHubRepositories'),
    getGitHubIssues: unsupported('getGitHubIssues'),
    getGitHubIssue: unsupported('getGitHubIssue'),
    checkGitHubConnection: unsupported('checkGitHubConnection'),
    investigateGitHubIssue: unsupportedVoid('investigateGitHubIssue'),
    getIssueComments: unsupported('getIssueComments'),
    importGitHubIssues: unsupported('importGitHubIssues'),
    createGitHubRelease: unsupported('createGitHubRelease'),
    onGitHubInvestigationProgress: unsupportedEvent('onGitHubInvestigationProgress'),
    onGitHubInvestigationComplete: unsupportedEvent('onGitHubInvestigationComplete'),
    onGitHubInvestigationError: unsupportedEvent('onGitHubInvestigationError'),
    getClaudeCodeVersions: unsupported('getClaudeCodeVersions'),
    installClaudeCodeVersion: unsupported('installClaudeCodeVersion'),
    getClaudeCodeInstallations: unsupported('getClaudeCodeInstallations'),
    setClaudeCodeActivePath: unsupported('setClaudeCodeActivePath'),
    
    // Platform identification for web mode
    platform: 'web' as const,
    isElectron: false,
  } as unknown as AppAPI;

  return api;
}

/**
 * Get Web platform capabilities
 *
 * Web mode has limited capabilities compared to Electron.
 */
export function getWebCapabilities(): PlatformCapabilities {
  return WEB_CAPABILITIES;
}

/**
 * Check if running in web environment (not Electron)
 */
export function isWeb(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window.electronAPI === undefined || typeof window.electronAPI !== 'object')
  );
}
