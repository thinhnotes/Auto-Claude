"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@auto-claude/ui";
import type { Task, TaskStatus } from "@auto-claude/types";
import { TaskCard } from "./TaskCard";

interface SortableTaskCardProps {
  task: Task;
  onClick: () => void;
  onStatusChange?: (taskId: string, newStatus: TaskStatus) => void;
  onStart?: (taskId: string) => void;
  onStop?: (taskId: string) => void;
  onApprove?: (taskId: string, feedback?: string) => void;
  onReject?: (taskId: string, feedback: string) => void;
  onOpenTerminal?: (task: Task, mode?: "modal" | "view") => void;
}

export function SortableTaskCard({
  task,
  onClick,
  onStatusChange,
  onStart,
  onStop,
  onApprove,
  onReject,
  onOpenTerminal,
}: SortableTaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: { type: "task", task },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("touch-none select-none", isDragging && "opacity-50")}
      {...attributes}
      {...listeners}
    >
      <TaskCard
        task={task}
        onClick={onClick}
        onStatusChange={onStatusChange}
        onStart={onStart}
        onStop={onStop}
        onApprove={onApprove}
        onReject={onReject}
        onOpenTerminal={onOpenTerminal}
      />
    </div>
  );
}
