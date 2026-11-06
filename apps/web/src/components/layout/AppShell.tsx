"use client";

import { useEffect } from "react";
import { TooltipProvider } from "@auto-claude/ui";
import { WebSocketProvider } from "@/providers/WebSocketProvider";
import { Sidebar } from "./Sidebar";
import { ProjectTabBar } from "./ProjectTabBar";
import { OpenProjectDialog } from "./OpenProjectDialog";
import { useUIStore } from "@/stores/ui-store";
import { useProjectStore, loadProjects } from "@/stores/project-store";
import { useTaskStore, loadTasks, startTask, stopTask, approveTask, rejectTask } from "@/stores/task-store";
import { useSettingsStore, hydrateSettings, loadSettings } from "@/stores/settings-store";
import { useProjectEnvStore, loadProjectEnvConfig, clearProjectEnvConfig } from "@/stores/project-env-store";
import { KanbanBoard } from "@/components/kanban/KanbanBoard";
import { TaskCreationWizard } from "@/components/kanban/TaskCreationWizard";
import { TaskDetailModal } from "@/components/kanban/TaskDetailModal";
import { RoadmapView } from "@/components/roadmap/RoadmapView";
import { IdeationView } from "@/components/ideation/IdeationView";
import { InsightsView } from "@/components/insights/InsightsView";
import { ChangelogView } from "@/components/changelog/ChangelogView";
import { ContextView } from "@/components/context/ContextView";
import { GitHubIssuesView } from "@/components/github/GitHubIssuesView";
import { GitHubPRsView } from "@/components/github/GitHubPRsView";
import { GitLabIssuesView } from "@/components/gitlab/GitLabIssuesView";
import { GitLabMRsView } from "@/components/gitlab/GitLabMRsView";
import { SettingsView } from "@/components/settings/SettingsView";
import { WorktreesView } from "@/components/worktrees/WorktreesView";
import { AgentToolsView } from "@/components/agent-tools/AgentToolsView";
import { TerminalGrid } from "@/components/terminal/TerminalGrid";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { WelcomeScreen } from "./WelcomeScreen";
import type { SidebarView } from "@/stores/ui-store";

/** UI scale boundaries matching the Electron app (percentage: 75% - 200%) */
const UI_SCALE_MIN = 75;
const UI_SCALE_MAX = 200;
const UI_SCALE_DEFAULT = 100;

export function AppShell() {
  const activeView = useUIStore((s) => s.activeView);
  const isNewTaskDialogOpen = useUIStore((s) => s.isNewTaskDialogOpen);
  const setNewTaskDialogOpen = useUIStore((s) => s.setNewTaskDialogOpen);
  const isOpenProjectDialogOpen = useUIStore((s) => s.isOpenProjectDialogOpen);
  const setOpenProjectDialogOpen = useUIStore((s) => s.setOpenProjectDialogOpen);
  const isOnboardingOpen = useUIStore((s) => s.isOnboardingOpen);
  const setOnboardingOpen = useUIStore((s) => s.setOnboardingOpen);
  const selectedTask = useUIStore((s) => s.selectedTask);
  const setSelectedTask = useUIStore((s) => s.setSelectedTask);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const selectedProjectId = useProjectStore((s) => s.selectedProjectId);
  const rawProjects = useProjectStore((s) => s.projects);
  const projects = Array.isArray(rawProjects) ? rawProjects : [];
  const rawTasks = useTaskStore((s) => s.tasks);
  const tasks = Array.isArray(rawTasks) ? rawTasks : [];
  const settings = useSettingsStore((s) => s.settings) ?? {};

  const currentProjectId = activeProjectId || selectedProjectId;
  const selectedProject = projects.find((p) => p && p.id === currentProjectId);

  // Initialize settings and projects on mount
  useEffect(() => {
    hydrateSettings();
    loadSettings();
    loadProjects();
  }, []);

  // Self-heal if stale HMR state ever left projects undefined
  useEffect(() => {
    if (!Array.isArray(rawProjects)) {
      useProjectStore.setState({ projects: [], openProjectIds: [], tabOrder: [] });
      loadProjects();
    }
  }, [rawProjects]);

  // Load tasks when project changes
  useEffect(() => {
    if (currentProjectId) {
      loadTasks(currentProjectId);
    } else {
      useTaskStore.getState().clearTasks();
    }
  }, [currentProjectId]);

  // Load project env config when project changes (for GitHub/GitLab tab visibility)
  useEffect(() => {
    if (currentProjectId) {
      loadProjectEnvConfig(currentProjectId);
    } else {
      clearProjectEnvConfig();
    }
  }, [currentProjectId]);

  // Apply theme from settings
  useEffect(() => {
    const root = document.documentElement;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");

    const applyTheme = () => {
      if (settings.theme === "dark") {
        root.classList.add("dark");
      } else if (settings.theme === "light") {
        root.classList.remove("dark");
      } else {
        // System preference
        if (prefersDark.matches) {
          root.classList.add("dark");
        } else {
          root.classList.remove("dark");
        }
      }
    };

    applyTheme();
    prefersDark.addEventListener("change", applyTheme);
    return () => prefersDark.removeEventListener("change", applyTheme);
  }, [settings.theme]);

  // Apply color theme
  useEffect(() => {
    if (settings.colorTheme) {
      document.documentElement.setAttribute("data-color-theme", settings.colorTheme);
    } else {
      document.documentElement.removeAttribute("data-color-theme");
    }
  }, [settings.colorTheme]);

  // Apply UI scale
  useEffect(() => {
    const root = document.documentElement;
    const rawScale = settings.uiScale ?? UI_SCALE_DEFAULT;
    const normalizedScale =
      rawScale > 0 && rawScale <= 2 ? Math.round(rawScale * 100) : rawScale;
    const clampedScale = Math.min(
      UI_SCALE_MAX,
      Math.max(UI_SCALE_MIN, normalizedScale)
    );
    root.setAttribute("data-ui-scale", String(clampedScale));
    root.style.fontSize = `${(clampedScale / 100) * 16}px`;
    return () => {
      root.removeAttribute("data-ui-scale");
      root.style.fontSize = "";
    };
  }, [settings.uiScale]);

  // Keyboard shortcuts for navigation (all 13 views)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      if (!currentProjectId) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key.toUpperCase();
      const viewMap: Record<string, SidebarView> = {
        K: "kanban",
        A: "terminals",
        N: "insights",
        D: "roadmap",
        I: "ideation",
        L: "changelog",
        C: "context",
        M: "agent-tools",
        W: "worktrees",
        G: "github-issues",
        P: "github-prs",
        B: "gitlab-issues",
        R: "gitlab-merge-requests",
      };

      if (viewMap[key]) {
        e.preventDefault();
        useUIStore.getState().setActiveView(viewMap[key]);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentProjectId]);

  // Listen for custom event to jump directly to Terminals view for a specific Task
  useEffect(() => {
    const handleOpenTaskTerminalView = () => {
      useUIStore.getState().setActiveView("terminals");
    };
    window.addEventListener(
      "auto-claude:open-task-terminal-view",
      handleOpenTaskTerminalView,
    );
    return () => {
      window.removeEventListener(
        "auto-claude:open-task-terminal-view",
        handleOpenTaskTerminalView,
      );
    };
  }, []);

  const renderContent = () => {
    // Settings is always accessible, even without a project
    if (activeView === "settings") {
      return <SettingsView />;
    }

    if (!selectedProject) {
      return <WelcomeScreen />;
    }

    switch (activeView) {
      case "kanban":
        return <KanbanBoard />;
      case "terminals":
        return (
          <TerminalGrid
            projectId={currentProjectId!}
            projectPath={selectedProject.path}
            tasks={tasks}
            onNewTaskClick={() => setNewTaskDialogOpen(true)}
          />
        );
      case "roadmap":
        return <RoadmapView projectId={currentProjectId!} />;
      case "ideation":
        return <IdeationView projectId={currentProjectId!} />;
      case "insights":
        return <InsightsView projectId={currentProjectId!} />;
      case "changelog":
        return <ChangelogView projectId={currentProjectId!} />;
      case "context":
        return <ContextView projectId={currentProjectId!} />;
      case "github-issues":
        return <GitHubIssuesView projectId={currentProjectId!} />;
      case "github-prs":
        return <GitHubPRsView projectId={currentProjectId!} />;
      case "gitlab-issues":
        return <GitLabIssuesView projectId={currentProjectId!} />;
      case "gitlab-merge-requests":
        return <GitLabMRsView projectId={currentProjectId!} />;
      case "worktrees":
        return <WorktreesView projectId={currentProjectId!} />;
      case "agent-tools":
        return <AgentToolsView projectId={currentProjectId!} />;
      default:
        return <KanbanBoard />;
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <WebSocketProvider>
      <div className="flex h-screen bg-background text-foreground" suppressHydrationWarning>
        {/* Sidebar */}
        <Sidebar />

        {/* Main content */}
        <div className="flex flex-1 flex-col overflow-hidden" suppressHydrationWarning>
          {/* Project Tabs */}
          <ProjectTabBar />

          {/* Main content area */}
          <main className="flex-1 overflow-hidden" suppressHydrationWarning>{renderContent()}</main>
        </div>

        {/* Open / Connect Project Dialog */}
        <OpenProjectDialog
          open={isOpenProjectDialogOpen}
          onClose={() => setOpenProjectDialogOpen(false)}
        />

        {/* Task Creation Wizard */}
        {currentProjectId && (
          <TaskCreationWizard
            open={isNewTaskDialogOpen}
            onClose={() => setNewTaskDialogOpen(false)}
            projectId={currentProjectId}
          />
        )}

        {/* Task Detail Modal */}
        {selectedTask && (
          <TaskDetailModal
            task={selectedTask}
            onClose={() => setSelectedTask(null)}
            onStart={
              currentProjectId
                ? (taskId) => startTask(currentProjectId, taskId)
                : undefined
            }
            onStop={
              currentProjectId
                ? (taskId) => stopTask(currentProjectId, taskId)
                : undefined
            }
            onApprove={
              currentProjectId
                ? (taskId, feedback) => void approveTask(currentProjectId, taskId, feedback)
                : undefined
            }
            onReject={
              currentProjectId
                ? (taskId, feedback) => void rejectTask(currentProjectId, taskId, feedback)
                : undefined
            }
          />
        )}

        {/* Onboarding Wizard */}
        <OnboardingWizard
          open={isOnboardingOpen}
          onClose={() => setOnboardingOpen(false)}
        />
      </div>
      </WebSocketProvider>
    </TooltipProvider>
  );
}
