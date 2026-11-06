import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, act, within } from "@testing-library/react";
import { TooltipProvider } from "@auto-claude/ui";
import type { Task, TaskStatus, TaskOrderState } from "@auto-claude/types";

// Hold captured DndContext props to simulate drag events
let capturedDndProps: any = {};

// Mock @dnd-kit/core to capture DndContext handlers and DragOverlay
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: (props: any) => {
      capturedDndProps = props;
      return <div data-testid="dnd-context-root">{props.children}</div>;
    },
    DragOverlay: ({ children }: { children?: React.ReactNode }) => {
      return children ? (
        <div data-testid="drag-overlay-root">{children}</div>
      ) : null;
    },
  };
});

// Mock i18next translation
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
    i18n: { changeLanguage: () => new Promise(() => {}) },
  }),
}));

// Mock project store with active project
vi.mock("@/stores/project-store", () => ({
  useProjectStore: (selector: any) =>
    selector({
      activeProjectId: "test-proj-dnd",
      selectedProjectId: "test-proj-dnd",
      projects: [{ id: "test-proj-dnd", name: "DnD Test Project" }],
    }),
}));

// Mock UI store
vi.mock("@/stores/ui-store", () => ({
  useUIStore: (selector: any) =>
    selector({
      setNewTaskDialogOpen: vi.fn(),
    }),
}));

// Mock task-store functions that perform API calls
vi.mock("@/stores/task-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/task-store")>();
  return {
    ...actual,
    loadTasks: vi.fn().mockResolvedValue(undefined),
    updateTaskStatusAPI: vi.fn().mockResolvedValue(undefined),
    startTask: vi.fn().mockResolvedValue(undefined),
    stopTask: vi.fn().mockResolvedValue(undefined),
    approveTask: vi.fn().mockResolvedValue(undefined),
    rejectTask: vi.fn().mockResolvedValue(undefined),
  };
});

import { KanbanBoard } from "../KanbanBoard";
import { SortableTaskCard } from "../SortableTaskCard";
import { useTaskStore, loadTasks } from "@/stores/task-store";

function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${Math.random().toString(36).substring(2, 9)}`,
    specId: "spec-001",
    projectId: "test-proj-dnd",
    title: "Test Task",
    description: "Task description",
    status: "backlog" as TaskStatus,
    subtasks: [],
    logs: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createEmptyTaskOrder(): TaskOrderState {
  return {
    backlog: [],
    queue: [],
    in_progress: [],
    ai_review: [],
    human_review: [],
    done: [],
    pr_created: [],
    error: [],
  };
}

function renderBoard() {
  return render(
    <TooltipProvider delayDuration={0}>
      <KanbanBoard />
    </TooltipProvider>,
  );
}

describe("Kanban Drag-and-Drop & Interaction Resilience (Milestone 1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    capturedDndProps = {};
    useTaskStore.setState({
      tasks: [],
      selectedTaskId: null,
      isLoading: false,
      error: null,
      taskOrder: null,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("handleDragCancel safety and overlay cleanup", () => {
    it("provides onDragCancel handler to DndContext", () => {
      renderBoard();
      expect(capturedDndProps.onDragCancel).toBeDefined();
      expect(typeof capturedDndProps.onDragCancel).toBe("function");
    });

    it("resets activeId to null and dismisses DragOverlay when drag is cancelled", () => {
      const task1 = createMockTask({ id: "task-drag-1", title: "Draggable Task 1" });
      useTaskStore.setState({
        tasks: [task1],
        taskOrder: {
          ...createEmptyTaskOrder(),
          backlog: ["task-drag-1"],
        },
      });

      renderBoard();

      // Initially no drag overlay is rendered
      expect(screen.queryByTestId("drag-overlay-root")).toBeNull();

      // 1. Simulate onDragStart
      act(() => {
        capturedDndProps.onDragStart({
          active: { id: "task-drag-1" },
        });
      });

      // Drag overlay should be active and render the card
      const overlay = screen.getByTestId("drag-overlay-root");
      expect(overlay).toBeInTheDocument();
      expect(within(overlay).getByText("Draggable Task 1")).toBeInTheDocument();

      // 2. Simulate onDragCancel (e.g. user pressed Escape or drag cancelled)
      act(() => {
        capturedDndProps.onDragCancel();
      });

      // Overlay should be cleanly dismissed / removed from DOM
      expect(screen.queryByTestId("drag-overlay-root")).toBeNull();
    });
  });

  describe("Active drag polling suppression", () => {
    it("polls loadTasks every 650ms when hasRunningTask is true and activeId is null", () => {
      const runningTask = createMockTask({
        id: "task-running-1",
        status: "in_progress",
        title: "Active Coding Task",
      });

      useTaskStore.setState({
        tasks: [runningTask],
      });

      renderBoard();

      expect(loadTasks).not.toHaveBeenCalled();

      // Advance by 650ms -> polling interval triggers loadTasks
      act(() => {
        vi.advanceTimersByTime(650);
      });
      expect(loadTasks).toHaveBeenCalledTimes(1);

      // Advance another 650ms -> second poll triggers
      act(() => {
        vi.advanceTimersByTime(650);
      });
      expect(loadTasks).toHaveBeenCalledTimes(2);
    });

    it("suppresses loadTasks polling while drag is active (activeId !== null) to prevent DOM detach", () => {
      const runningTask = createMockTask({
        id: "task-running-2",
        status: "queue",
        title: "Queued Pipeline Task",
      });

      useTaskStore.setState({
        tasks: [runningTask],
      });

      renderBoard();

      // 1. Begin active drag
      act(() => {
        capturedDndProps.onDragStart({
          active: { id: "task-running-2" },
        });
      });

      vi.mocked(loadTasks).mockClear();

      // 2. Advance time through multiple polling cycles (650ms, 1300ms, 2600ms)
      act(() => {
        vi.advanceTimersByTime(2600);
      });

      // Invariant: loadTasks MUST NOT be called while user is dragging
      expect(loadTasks).not.toHaveBeenCalled();
    });

    it("resumes polling immediately after drag ends (onDragEnd)", () => {
      const runningTask = createMockTask({
        id: "task-running-3",
        status: "ai_review",
        title: "QA Review Task",
      });

      useTaskStore.setState({
        tasks: [runningTask],
      });

      renderBoard();

      // Start drag
      act(() => {
        capturedDndProps.onDragStart({
          active: { id: "task-running-3" },
        });
      });

      vi.mocked(loadTasks).mockClear();

      // End drag
      act(() => {
        capturedDndProps.onDragEnd({
          active: { id: "task-running-3" },
          over: null,
        });
      });

      // Advance by 650ms -> polling should resume
      act(() => {
        vi.advanceTimersByTime(650);
      });
      expect(loadTasks).toHaveBeenCalledTimes(1);
    });

    it("resumes polling immediately after drag is cancelled (onDragCancel)", () => {
      const runningTask = createMockTask({
        id: "task-running-4",
        status: "in_progress",
        title: "Resuming Task",
      });

      useTaskStore.setState({
        tasks: [runningTask],
      });

      renderBoard();

      // Start drag
      act(() => {
        capturedDndProps.onDragStart({
          active: { id: "task-running-4" },
        });
      });

      vi.mocked(loadTasks).mockClear();

      // Cancel drag
      act(() => {
        capturedDndProps.onDragCancel();
      });

      // Advance timer by 650ms -> polling must resume
      act(() => {
        vi.advanceTimersByTime(650);
      });
      expect(loadTasks).toHaveBeenCalledTimes(1);
    });
  });

  describe("Column task card sorting with taskOrder", () => {
    it("renders tasks within column in the exact visual sequence defined by taskOrder", () => {
      const taskA = createMockTask({
        id: "task-alpha",
        status: "backlog",
        title: "Alpha Feature",
      });
      const taskB = createMockTask({
        id: "task-beta",
        status: "backlog",
        title: "Beta Feature",
      });
      const taskC = createMockTask({
        id: "task-gamma",
        status: "backlog",
        title: "Gamma Feature",
      });

      // Custom ordering: Gamma (first), Alpha (second), Beta (third)
      useTaskStore.setState({
        tasks: [taskA, taskB, taskC],
        taskOrder: {
          ...createEmptyTaskOrder(),
          backlog: ["task-gamma", "task-alpha", "task-beta"],
        },
      });

      renderBoard();

      const backlogColumn = screen.getByTestId("kanban-column-backlog");
      const renderedHeadings = within(backlogColumn)
        .getAllByRole("heading", { level: 3 })
        .map((el) => el.textContent?.trim());

      expect(renderedHeadings).toEqual([
        "Gamma Feature",
        "Alpha Feature",
        "Beta Feature",
      ]);
    });

    it("re-sorts cards dynamically when taskOrder updates", () => {
      const task1 = createMockTask({
        id: "t1",
        status: "in_progress",
        title: "Ticket One",
      });
      const task2 = createMockTask({
        id: "t2",
        status: "in_progress",
        title: "Ticket Two",
      });

      useTaskStore.setState({
        tasks: [task1, task2],
        taskOrder: {
          ...createEmptyTaskOrder(),
          in_progress: ["t1", "t2"],
        },
      });

      const { rerender } = renderBoard();

      let col = screen.getByTestId("kanban-column-in_progress");
      let headings = within(col)
        .getAllByRole("heading", { level: 3 })
        .map((el) => el.textContent?.trim());
      expect(headings).toEqual(["Ticket One", "Ticket Two"]);

      // Reverse taskOrder
      act(() => {
        useTaskStore.setState({
          taskOrder: {
            ...createEmptyTaskOrder(),
            in_progress: ["t2", "t1"],
          },
        });
      });

      rerender(
        <TooltipProvider delayDuration={0}>
          <KanbanBoard />
        </TooltipProvider>,
      );

      col = screen.getByTestId("kanban-column-in_progress");
      headings = within(col)
        .getAllByRole("heading", { level: 3 })
        .map((el) => el.textContent?.trim());
      expect(headings).toEqual(["Ticket Two", "Ticket One"]);
    });

    it("appends unordered tasks gracefully when new tasks arrive not yet in taskOrder", () => {
      const task1 = createMockTask({
        id: "ordered-1",
        status: "backlog",
        title: "First Ordered",
      });
      const task2 = createMockTask({
        id: "new-untracked",
        status: "backlog",
        title: "Untracked New Arrival",
      });

      useTaskStore.setState({
        tasks: [task1, task2],
        taskOrder: {
          ...createEmptyTaskOrder(),
          backlog: ["ordered-1"], // only task 1 is in taskOrder
        },
      });

      renderBoard();

      const backlogColumn = screen.getByTestId("kanban-column-backlog");
      const headings = within(backlogColumn)
        .getAllByRole("heading", { level: 3 })
        .map((el) => el.textContent?.trim());

      // Must include both tasks without crashing or dropping cards
      expect(headings).toContain("First Ordered");
      expect(headings).toContain("Untracked New Arrival");
      expect(headings[0]).toBe("First Ordered");
    });
  });

  describe("DOM gesture resilience classes and drag overlay transparency", () => {
    it("renders SortableTaskCard with touch-none and select-none classes", () => {
      const task = createMockTask({ id: "touch-card", title: "Touch Card" });
      const { container } = render(
        <TooltipProvider delayDuration={0}>
          <SortableTaskCard task={task} onClick={() => {}} />
        </TooltipProvider>,
      );

      const root = container.firstElementChild as HTMLElement;
      expect(root.className).toContain("touch-none");
      expect(root.className).toContain("select-none");
    });

    it("renders DragOverlay child with pointer-events-none and select-none", () => {
      const task = createMockTask({ id: "overlay-card", title: "Overlay Card" });
      useTaskStore.setState({
        tasks: [task],
      });

      renderBoard();

      act(() => {
        capturedDndProps.onDragStart({
          active: { id: "overlay-card" },
        });
      });

      const overlay = screen.getByTestId("drag-overlay-root");
      const innerContainer = overlay.firstElementChild as HTMLElement;
      expect(innerContainer.className).toContain("pointer-events-none");
      expect(innerContainer.className).toContain("select-none");
    });
  });
});
