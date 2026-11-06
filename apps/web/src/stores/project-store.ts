import { create } from "zustand";
import type { Project } from "@auto-claude/types";
import { apiClient } from "@/lib/data";
import { APERANT_STORE_CHUNK_VERSION } from "./store-bust-v3";

// localStorage keys for persisting tab state
const TAB_STATE_KEY = "auto-claude-tab-state";
export const PROJECT_STORE_CHUNK_ID = APERANT_STORE_CHUNK_VERSION;

interface TabState {
  openProjectIds: string[];
  activeProjectId: string | null;
}

interface ProjectState {
  projects: Project[];
  selectedProjectId: string | null;
  activeProjectId: string | null;
  openProjectIds: string[];
  tabOrder: string[];
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;

  // Actions
  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  removeProject: (projectId: string) => void;
  updateProject: (projectId: string, updates: Partial<Project>) => void;
  selectProject: (id: string | null) => void;
  setActiveProject: (id: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Tab management
  openProjectTab: (id: string) => void;
  closeProjectTab: (id: string) => void;
  reorderTabs: (oldIndex: number, newIndex: number) => void;
  restoreTabState: () => void;

  // Selectors
  getSelectedProject: () => Project | undefined;
  getActiveProject: () => Project | undefined;
  getProjectTabs: () => Project[];
  getOpenProjects: () => Project[];
}

function saveTabState(state: TabState): void {
  try {
    localStorage.setItem(TAB_STATE_KEY, JSON.stringify(state));
  } catch {
    // localStorage may be unavailable
  }
}

function loadTabState(): TabState | null {
  try {
    const raw = localStorage.getItem(TAB_STATE_KEY);
    if (raw) return JSON.parse(raw) as TabState;
  } catch {
    // Ignore parse errors
  }
  return null;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  selectedProjectId: null,
  activeProjectId: null,
  openProjectIds: [],
  tabOrder: [],
  isLoading: false,
  isInitialized: false,
  error: null,

  setProjects: (projects) => set({ projects: Array.isArray(projects) ? projects : [] }),

  addProject: (project) =>
    set((state) => ({
      projects: [...(Array.isArray(state.projects) ? state.projects : []), project],
    })),

  removeProject: (projectId) =>
    set((state) => {
      const safeProjects = Array.isArray(state.projects) ? state.projects : [];
      const safeOpenIds = Array.isArray(state.openProjectIds) ? state.openProjectIds : [];
      const safeTabOrder = Array.isArray(state.tabOrder) ? state.tabOrder : [];
      const newOpenIds = safeOpenIds.filter((id) => id !== projectId);
      const newTabOrder = safeTabOrder.filter((id) => id !== projectId);
      const isActive = state.activeProjectId === projectId;
      const newActiveId = isActive
        ? newTabOrder[0] ?? null
        : state.activeProjectId;

      saveTabState({ openProjectIds: newOpenIds, activeProjectId: newActiveId });

      return {
        projects: safeProjects.filter((p) => p.id !== projectId),
        selectedProjectId:
          state.selectedProjectId === projectId ? null : state.selectedProjectId,
        activeProjectId: newActiveId,
        openProjectIds: newOpenIds,
        tabOrder: newTabOrder,
      };
    }),

  updateProject: (projectId, updates) =>
    set((state) => ({
      projects: (Array.isArray(state.projects) ? state.projects : []).map((p) =>
        p.id === projectId ? { ...p, ...updates } : p,
      ),
    })),

  selectProject: (id) => set({ selectedProjectId: id }),

  setActiveProject: (id) => {
    set({ activeProjectId: id, selectedProjectId: id });
    const state = get();
    saveTabState({
      openProjectIds: Array.isArray(state.openProjectIds) ? state.openProjectIds : [],
      activeProjectId: id,
    });
  },

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  openProjectTab: (id) =>
    set((state) => {
      const safeOpenIds = Array.isArray(state.openProjectIds) ? state.openProjectIds : [];
      const safeTabOrder = Array.isArray(state.tabOrder) ? state.tabOrder : [];
      if (safeOpenIds.includes(id)) {
        saveTabState({ openProjectIds: safeOpenIds, activeProjectId: id });
        return { activeProjectId: id, selectedProjectId: id };
      }
      const newOpenIds = [...safeOpenIds, id];
      const newTabOrder = safeTabOrder.includes(id)
        ? safeTabOrder
        : [...safeTabOrder, id];

      saveTabState({ openProjectIds: newOpenIds, activeProjectId: id });

      return {
        openProjectIds: newOpenIds,
        tabOrder: newTabOrder,
        activeProjectId: id,
        selectedProjectId: id,
      };
    }),

  closeProjectTab: (id) =>
    set((state) => {
      const safeOpenIds = Array.isArray(state.openProjectIds) ? state.openProjectIds : [];
      const safeTabOrder = Array.isArray(state.tabOrder) ? state.tabOrder : [];
      const newOpenIds = safeOpenIds.filter((pid) => pid !== id);
      const newTabOrder = safeTabOrder.filter((pid) => pid !== id);
      const newActiveId =
        state.activeProjectId === id
          ? newTabOrder[0] ?? null
          : state.activeProjectId;

      saveTabState({ openProjectIds: newOpenIds, activeProjectId: newActiveId });

      return {
        openProjectIds: newOpenIds,
        tabOrder: newTabOrder,
        activeProjectId: newActiveId,
        selectedProjectId: newActiveId,
      };
    }),

  reorderTabs: (oldIndex, newIndex) =>
    set((state) => {
      const newOrder = [...(Array.isArray(state.tabOrder) ? state.tabOrder : [])];
      const [removed] = newOrder.splice(oldIndex, 1);
      newOrder.splice(newIndex, 0, removed);
      saveTabState({
        openProjectIds: newOrder,
        activeProjectId: state.activeProjectId,
      });
      return { tabOrder: newOrder, openProjectIds: newOrder };
    }),

  restoreTabState: () => {
    const saved = loadTabState();
    if (saved) {
      const state = get();
      const safeProjects = Array.isArray(state.projects) ? state.projects : [];
      const savedOpenIds = Array.isArray(saved.openProjectIds) ? saved.openProjectIds : [];
      // Only restore IDs that match existing projects
      const validIds = new Set(safeProjects.map((p) => p.id));
      const openIds = savedOpenIds.filter((id) => validIds.has(id));
      const activeId =
        saved.activeProjectId && validIds.has(saved.activeProjectId)
          ? saved.activeProjectId
          : openIds[0] ?? null;
      if (activeId && !openIds.includes(activeId)) {
        openIds.push(activeId);
      }

      set({
        openProjectIds: openIds,
        tabOrder: openIds,
        activeProjectId: activeId,
        selectedProjectId: activeId,
      });
    }
  },

  getSelectedProject: () => {
    const state = get();
    const safeProjects = Array.isArray(state.projects) ? state.projects : [];
    return safeProjects.find((p) => p.id === state.selectedProjectId);
  },

  getActiveProject: () => {
    const state = get();
    const safeProjects = Array.isArray(state.projects) ? state.projects : [];
    return safeProjects.find((p) => p.id === state.activeProjectId);
  },

  getProjectTabs: () => {
    const state = get();
    const safeProjects = Array.isArray(state.projects) ? state.projects : [];
    const safeTabOrder = Array.isArray(state.tabOrder) ? state.tabOrder : [];
    return safeTabOrder
      .map((id) => safeProjects.find((p) => p.id === id))
      .filter((p): p is Project => p !== undefined);
  },

  getOpenProjects: () => {
    const state = get();
    const safeProjects = Array.isArray(state.projects) ? state.projects : [];
    const safeOpenIds = Array.isArray(state.openProjectIds) ? state.openProjectIds : [];
    return safeProjects.filter((p) => safeOpenIds.includes(p.id));
  },
}));

/** Load projects from API and restore tab state */
export async function loadProjects() {
  useProjectStore.setState({ isLoading: true, error: null });
  try {
    const result = await apiClient.getProjects();
    const rawList = (result as unknown as { projects?: Project[]; data?: Project[] }).projects
      ?? (result as unknown as { data?: Project[] }).data
      ?? [];
    const projectsList = Array.isArray(rawList) ? rawList : [];
    useProjectStore.setState({
      projects: projectsList,
      isLoading: false,
      isInitialized: true,
    });

    // Restore tab state from localStorage if present
    useProjectStore.getState().restoreTabState();
  } catch (error) {
    useProjectStore.setState({
      isLoading: false,
      isInitialized: true,
      error:
        error instanceof Error ? error.message : "Failed to load projects",
    });
  }
}

/** Register/connect a project by server directory path and immediately open its tab */
export async function createAndOpenProject(
  path: string,
  name?: string,
): Promise<Project> {
  const cleanPath = path.trim();
  const cleanName =
    name?.trim() ||
    cleanPath.split("/").filter(Boolean).pop() ||
    "Project";

  const result = await apiClient.createProject({
    path: cleanPath,
    name: cleanName,
  });
  const created =
    (result as unknown as { project?: Project; data?: Project }).project ??
    (result as unknown as { data?: Project }).data;

  if (!created || !created.id) {
    throw new Error("Invalid project response from backend");
  }

  const state = useProjectStore.getState();
  const exists = state.projects.some((p) => p.id === created.id);
  if (!exists) {
    state.addProject(created);
  } else {
    state.updateProject(created.id, created);
  }
  useProjectStore.getState().openProjectTab(created.id);
  return created;
}
