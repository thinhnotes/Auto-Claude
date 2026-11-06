"use client";

import { FolderGit, Plus, RotateCcw } from "lucide-react";
import {
  cn,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@auto-claude/ui";

export interface WorktreeConfig {
  name: string;
  path: string;
  branch: string;
}

interface WorktreeSelectorProps {
  terminalId: string;
  projectPath: string;
  currentWorktree?: WorktreeConfig;
  worktrees?: WorktreeConfig[];
  onCreateWorktree: () => void;
  onSelectWorktree: (config: WorktreeConfig | undefined) => void;
}

export function WorktreeSelector({
  terminalId,
  projectPath,
  currentWorktree,
  worktrees = [],
  onCreateWorktree,
  onSelectWorktree,
}: WorktreeSelectorProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          data-testid={`terminal-worktree-selector-${terminalId}`}
          className={cn(
            "h-5 px-1.5 text-xs",
            currentWorktree
              ? "font-medium text-amber-500 bg-amber-500/10 hover:bg-amber-500/20 max-w-44"
              : "text-muted-foreground hover:text-foreground",
          )}
          title={
            currentWorktree
              ? `Worktree: ${currentWorktree.name} (${currentWorktree.path})`
              : `Working directory: ${projectPath}`
          }
        >
          <FolderGit className="h-3 w-3 flex-shrink-0" />
          {currentWorktree ? (
            <span className="ml-1 truncate">{currentWorktree.name}</span>
          ) : (
            <span className="ml-1 hidden sm:inline">Worktree</span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuItem
          onClick={() => onSelectWorktree(undefined)}
          data-testid={`terminal-worktree-root-${terminalId}`}
        >
          <RotateCcw className="h-3.5 w-3.5 mr-2 flex-shrink-0" />
          <span className="truncate">Project Root ({projectPath.split("/").pop()})</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {worktrees.length === 0 ? (
          <DropdownMenuItem disabled>No worktrees</DropdownMenuItem>
        ) : (
          worktrees.map((wt) => (
            <DropdownMenuItem
              key={wt.path}
              data-testid={`terminal-worktree-option-${wt.name}`}
              onClick={() => onSelectWorktree(wt)}
            >
              <FolderGit className="h-3.5 w-3.5 mr-2 flex-shrink-0 text-amber-500" />
              <span className="truncate">{wt.name}</span>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={onCreateWorktree}
          data-testid={`terminal-worktree-create-${terminalId}`}
        >
          <Plus className="h-3.5 w-3.5 mr-2" />
          Create worktree
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
