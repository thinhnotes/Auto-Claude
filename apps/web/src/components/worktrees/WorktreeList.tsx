"use client";

import { useState, useMemo } from "react";
import {
  FolderGit,
  Loader2,
  FileCode,
  FilePlus,
  FileEdit,
  FileText,
  Search,
  Copy,
  Check,
  RefreshCw,
  AlignJustify,
  Columns2,
  Code2,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn, Badge } from "@auto-claude/ui";
import type { WorktreeListItem } from "@auto-claude/types";
import { apiClient } from "@/lib/data/api-client";
import { WorktreeCard } from "./WorktreeCard";
import {
  WorktreeActions,
  type WorktreeMergeNotification,
} from "./WorktreeActions";

interface WorktreeListProps {
  worktrees: WorktreeListItem[];
  isLoading: boolean;
  error: string | null;
  projectId: string;
  selectedSpecName: string | null;
  onSelect: (specName: string) => void;
  onRefresh: () => void;
  onMerged?: (info?: WorktreeMergeNotification) => void;
}

type WorktreeDiffViewMode = "unified" | "split" | "full";

interface WorktreeDiffFileEntry {
  file: string;
  path?: string;
  status?: "created" | "modified" | "deleted";
  additions: number;
  deletions: number;
  oldContent?: string;
  newContent?: string;
  unifiedDiff?: string;
  snippet: string;
}

interface ParsedDiffLine {
  type: "add" | "del" | "context" | "header";
  content: string;
  oldLine?: number;
  newLine?: number;
}

function parseWorktreeUnifiedDiffLines(
  fileEntry: WorktreeDiffFileEntry,
): ParsedDiffLine[] {
  const unifiedDiff = fileEntry.unifiedDiff || "";
  if (unifiedDiff.trim()) {
    const lines = unifiedDiff.replace(/\r\n/g, "\n").split("\n");
    const parsed: ParsedDiffLine[] = [];
    let oldNum = 1;
    let newNum = 1;

    for (const raw of lines) {
      if (
        raw.startsWith("--- ") ||
        raw.startsWith("+++ ") ||
        raw.startsWith("@@ ")
      ) {
        parsed.push({ type: "header", content: raw });
        const hunkMatch = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (hunkMatch) {
          oldNum = Math.max(1, parseInt(hunkMatch[1], 10));
          newNum = Math.max(1, parseInt(hunkMatch[2], 10));
        }
        continue;
      }

      if (raw.startsWith("+")) {
        parsed.push({
          type: "add",
          content: raw.slice(1),
          newLine: newNum++,
        });
      } else if (raw.startsWith("-")) {
        parsed.push({
          type: "del",
          content: raw.slice(1),
          oldLine: oldNum++,
        });
      } else {
        const text = raw.startsWith(" ") ? raw.slice(1) : raw;
        parsed.push({
          type: "context",
          content: text,
          oldLine: oldNum++,
          newLine: newNum++,
        });
      }
    }
    return parsed;
  }

  const rawText = (fileEntry.newContent || fileEntry.snippet || "").replace(
    /\r\n/g,
    "\n",
  );
  return rawText.split("\n").map((line, idx) => {
    const clean = line.startsWith("+ ")
      ? line.slice(2)
      : line.startsWith("+")
        ? line.slice(1)
        : line;
    return {
      type: "add" as const,
      content: clean,
      newLine: idx + 1,
    };
  });
}

export function WorktreeList({
  worktrees,
  isLoading,
  error,
  projectId,
  selectedSpecName,
  onSelect,
  onRefresh,
  onMerged,
}: WorktreeListProps) {
  const { t } = useTranslation("views");
  const [diffSpecName, setDiffSpecName] = useState<string | null>(null);
  const [diffData, setDiffData] = useState<{
    branch: string;
    baseBranch: string;
    files: WorktreeDiffFileEntry[];
  } | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileFilter, setFileFilter] = useState("");
  const [viewMode, setViewMode] = useState<WorktreeDiffViewMode>("unified");
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedFile, setCopiedFile] = useState<string | null>(null);

  const fetchWorktreeDiff = async (specName: string) => {
    setIsLoadingDiff(true);
    try {
      const res = await apiClient.getWorktreeDiff(projectId, specName);
      const files: WorktreeDiffFileEntry[] = Array.isArray(res.files)
        ? res.files
        : [];
      setDiffData({
        branch: res.branch || `auto-claude/${specName}`,
        baseBranch: res.baseBranch || "main",
        files,
      });
      setSelectedFilePath((prev) => {
        if (prev && files.some((f) => (f.path || f.file) === prev)) {
          return prev;
        }
        return files[0] ? files[0].path || files[0].file : null;
      });
    } catch {
      setDiffData({
        branch: `auto-claude/${specName}`,
        baseBranch: "main",
        files: [],
      });
      setSelectedFilePath(null);
    } finally {
      setIsLoadingDiff(false);
    }
  };

  const handleToggleDiff = async (specName: string) => {
    if (selectedSpecName !== specName) {
      onSelect(specName);
    }
    if (diffSpecName === specName) {
      setDiffSpecName(null);
      setDiffData(null);
      setSelectedFilePath(null);
      return;
    }
    setDiffSpecName(specName);
    setFileFilter("");
    await fetchWorktreeDiff(specName);
  };

  const filteredDiffFiles = useMemo(() => {
    const files = diffData?.files || [];
    const q = fileFilter.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) =>
      (f.path || f.file || "").toLowerCase().includes(q),
    );
  }, [diffData?.files, fileFilter]);

  const activeFile = useMemo(() => {
    if (filteredDiffFiles.length === 0) return null;
    return (
      filteredDiffFiles.find(
        (f) => (f.path || f.file) === selectedFilePath,
      ) || filteredDiffFiles[0]
    );
  }, [filteredDiffFiles, selectedFilePath]);

  const totalAdditions = useMemo(
    () =>
      (diffData?.files || []).reduce((acc, f) => acc + (f.additions || 0), 0),
    [diffData?.files],
  );

  const totalDeletions = useMemo(
    () =>
      (diffData?.files || []).reduce((acc, f) => acc + (f.deletions || 0), 0),
    [diffData?.files],
  );

  const parsedLines = useMemo(() => {
    if (!activeFile) return [];
    return parseWorktreeUnifiedDiffLines(activeFile);
  }, [activeFile]);

  const splitRows = useMemo(() => {
    if (!activeFile) return [];
    const oldLines = activeFile.oldContent
      ? activeFile.oldContent.replace(/\r\n/g, "\n").split("\n")
      : [];
    const newRaw =
      activeFile.newContent !== undefined
        ? activeFile.newContent
        : (activeFile.snippet || "")
            .replace(/\r\n/g, "\n")
            .split("\n")
            .map((l) => (l.startsWith("+ ") ? l.slice(2) : l))
            .join("\n");
    const newLines = newRaw ? newRaw.replace(/\r\n/g, "\n").split("\n") : [];
    const maxLen = Math.max(oldLines.length, newLines.length);
    const rows: Array<{
      oldNum?: number;
      oldText?: string;
      newNum?: number;
      newText?: string;
      changed: boolean;
    }> = [];
    for (let i = 0; i < maxLen; i++) {
      const o = i < oldLines.length ? oldLines[i] : undefined;
      const n = i < newLines.length ? newLines[i] : undefined;
      rows.push({
        oldNum: o !== undefined ? i + 1 : undefined,
        oldText: o,
        newNum: n !== undefined ? i + 1 : undefined,
        newText: n,
        changed: o !== n,
      });
    }
    return rows;
  }, [activeFile]);

  const handleCopyCode = (fileEntry: WorktreeDiffFileEntry) => {
    const key = fileEntry.path || fileEntry.file;
    const text =
      fileEntry.newContent ||
      fileEntry.unifiedDiff ||
      fileEntry.snippet ||
      "";
    navigator.clipboard?.writeText(text);
    setCopiedFile(key);
    setTimeout(() => setCopiedFile(null), 1800);
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        data-testid="worktrees-error"
        className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground"
      >
        <p className="text-sm">{error}</p>
        <button
          className="text-xs text-primary underline hover:no-underline"
          onClick={onRefresh}
        >
          {t("worktrees.retry")}
        </button>
      </div>
    );
  }

  if (worktrees.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
        <FolderGit className="h-10 w-10 opacity-30" />
        <p className="text-sm">{t("worktrees.empty.title")}</p>
        <p className="text-xs">{t("worktrees.empty.description")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {worktrees.map((wt) => {
        const isSelected = selectedSpecName === wt.specName;
        const isDiffOpen = diffSpecName === wt.specName;

        return (
          <div key={wt.specName} className="space-y-2">
            <WorktreeCard
              worktree={wt}
              isSelected={isSelected || isDiffOpen}
              isDiffOpen={isDiffOpen}
              onSelect={() => onSelect(wt.specName)}
              onCheckDiff={(specName) => handleToggleDiff(specName)}
            />
            {(isSelected || isDiffOpen) && (
              <div className="pl-4 space-y-2">
                <WorktreeActions
                  worktree={wt}
                  projectId={projectId}
                  isDiffOpen={isDiffOpen}
                  onMerged={(info) => {
                    setDiffSpecName(null);
                    onMerged?.(info);
                    onRefresh();
                  }}
                  onDeleted={() => {
                    setDiffSpecName(null);
                    onRefresh();
                  }}
                  onDiffView={() => handleToggleDiff(wt.specName)}
                />

                {isDiffOpen && (
                  <div
                    data-testid={`worktree-diff-panel-${wt.specName}`}
                    className="rounded-lg border border-border bg-card/90 p-3 text-xs space-y-3 shadow-sm"
                  >
                    {/* Top Summary & Controls Toolbar */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium flex items-center gap-1.5 text-foreground">
                          <FileCode className="h-3.5 w-3.5 text-primary" />
                          Diff Preview: {diffData?.branch || wt.branch} →{" "}
                          {diffData?.baseBranch || wt.baseBranch}
                        </span>
                        <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {t(
                            "worktrees.diff.changedFilesCount",
                            `${diffData?.files?.length || 0} changed file(s)`,
                            {
                              count: diffData?.files?.length || 0,
                            },
                          )}
                        </span>
                        <span
                          data-testid={`worktree-diff-total-additions-${wt.specName}`}
                          className="inline-flex items-center rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400"
                        >
                          +{totalAdditions}
                        </span>
                        <span
                          data-testid={`worktree-diff-total-deletions-${wt.specName}`}
                          className="inline-flex items-center rounded bg-rose-500/15 px-1.5 py-0.5 font-mono text-xs font-semibold text-rose-600 dark:text-rose-400"
                        >
                          -{totalDeletions}
                        </span>

                        {/* Filter files input */}
                        <div className="relative ml-1">
                          <Search className="h-3 w-3 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            data-testid={`worktree-diff-filter-${wt.specName}`}
                            placeholder={t(
                              "worktrees.diff.filterPlaceholder",
                              "Filter files...",
                            )}
                            value={fileFilter}
                            onChange={(e) => setFileFilter(e.target.value)}
                            className="h-7 w-40 rounded-md border border-border bg-background pl-6 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>
                      </div>

                      {/* View Mode Switcher & Actions */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <div className="inline-flex items-center rounded-md border border-border bg-background p-0.5">
                          <button
                            type="button"
                            data-testid={`worktree-diff-mode-unified-${wt.specName}`}
                            onClick={() => setViewMode("unified")}
                            className={cn(
                              "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors",
                              viewMode === "unified"
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            <AlignJustify className="h-3 w-3" />
                            {t("worktrees.diff.unifiedDiff", "Unified Diff")}
                          </button>
                          <button
                            type="button"
                            data-testid={`worktree-diff-mode-split-${wt.specName}`}
                            onClick={() => setViewMode("split")}
                            className={cn(
                              "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors",
                              viewMode === "split"
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            <Columns2 className="h-3 w-3" />
                            {t("worktrees.diff.splitDiff", "Split Diff")}
                          </button>
                          <button
                            type="button"
                            data-testid={`worktree-diff-mode-full-${wt.specName}`}
                            onClick={() => setViewMode("full")}
                            className={cn(
                              "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors",
                              viewMode === "full"
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            <Code2 className="h-3 w-3" />
                            {t("worktrees.diff.fullCode", "Full Code")}
                          </button>
                        </div>

                        <button
                          type="button"
                          data-testid={`worktree-diff-refresh-${wt.specName}`}
                          onClick={() => fetchWorktreeDiff(wt.specName)}
                          disabled={isLoadingDiff}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                        >
                          <RefreshCw
                            className={cn(
                              "h-3 w-3",
                              isLoadingDiff && "animate-spin",
                            )}
                          />
                          {t("worktrees.diff.refresh", "Refresh Diff")}
                        </button>

                        <button
                          type="button"
                          data-testid={`worktree-diff-expand-${wt.specName}`}
                          onClick={() => setIsExpanded((prev) => !prev)}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {isExpanded ? (
                            <>
                              <Minimize2 className="h-3 w-3" />
                              {t("worktrees.diff.collapse", "Collapse")}
                            </>
                          ) : (
                            <>
                              <Maximize2 className="h-3 w-3" />
                              {t("worktrees.diff.expand", "Expand")}
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {isLoadingDiff ? (
                      <div className="flex items-center gap-2 py-4 text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        {t("worktrees.diff.loading", "Loading diff...")}
                      </div>
                    ) : filteredDiffFiles.length === 0 ? (
                      <div className="py-6 text-center text-muted-foreground">
                        {t(
                          "worktrees.diff.noChanges",
                          "No code changes detected in this worktree.",
                        )}
                      </div>
                    ) : (
                      /* 2-Pane Code Diff Workbench */
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                        {/* Left Sidebar: Changed Files List */}
                        <div className="md:col-span-4 rounded-lg border border-border bg-background/80 overflow-hidden flex flex-col">
                          <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            {t(
                              "worktrees.diff.changedFilesHeader",
                              `Changed Files (${filteredDiffFiles.length})`,
                              {
                                count: filteredDiffFiles.length,
                              },
                            )}
                          </div>
                          <div
                            className={cn(
                              "divide-y divide-border/60 overflow-y-auto",
                              isExpanded ? "max-h-[540px]" : "max-h-[340px]",
                            )}
                          >
                            {filteredDiffFiles.map((f) => {
                              const filePath = f.path || f.file;
                              const isFileSelected =
                                (activeFile?.path || activeFile?.file) ===
                                filePath;
                              const status = f.status || "created";
                              return (
                                <button
                                  key={filePath}
                                  type="button"
                                  data-testid={`worktree-diff-file-${wt.specName}-${filePath}`}
                                  onClick={() => setSelectedFilePath(filePath)}
                                  className={cn(
                                    "w-full text-left px-3 py-2 flex items-center gap-2 transition-colors hover:bg-accent/50",
                                    isFileSelected &&
                                      "bg-primary/10 border-l-2 border-l-primary",
                                  )}
                                >
                                  {status === "created" ? (
                                    <FilePlus className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                                  ) : status === "modified" ? (
                                    <FileEdit className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                                  ) : (
                                    <FileText className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                                  )}
                                  <div className="min-w-0 flex-1">
                                    <div className="font-mono text-xs truncate font-medium text-foreground">
                                      {filePath}
                                    </div>
                                    <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                                      <Badge
                                        variant="outline"
                                        className={cn(
                                          "text-[9px] px-1 py-0 h-4",
                                          status === "created"
                                            ? "text-emerald-600 border-emerald-500/30"
                                            : status === "modified"
                                              ? "text-blue-600 border-blue-500/30"
                                              : "text-rose-600 border-rose-500/30",
                                        )}
                                      >
                                        {status}
                                      </Badge>
                                      <span className="font-mono text-xs text-emerald-600 dark:text-emerald-400">
                                        +{f.additions || 0}
                                      </span>
                                      {(f.deletions || 0) > 0 && (
                                        <span className="font-mono text-xs text-rose-600 dark:text-rose-400">
                                          -{f.deletions}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Right Pane: Active File Code Diff Viewer */}
                        <div className="md:col-span-8 rounded-lg border border-border bg-card overflow-hidden flex flex-col">
                          {activeFile && (
                            <>
                              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span
                                    data-testid={`worktree-selected-file-${wt.specName}`}
                                    className="font-mono text-xs font-semibold truncate"
                                  >
                                    {activeFile.path || activeFile.file}
                                  </span>
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      "text-xs",
                                      (activeFile.status || "created") ===
                                        "created"
                                        ? "text-emerald-600 border-emerald-500/30"
                                        : "text-blue-600 border-blue-500/30",
                                    )}
                                  >
                                    {activeFile.status || "created"}
                                  </Badge>
                                  <span className="font-mono text-xs text-emerald-600 dark:text-emerald-400">
                                    +{activeFile.additions || 0}
                                  </span>
                                  <span className="font-mono text-xs text-rose-600 dark:text-rose-400">
                                    -{activeFile.deletions || 0}
                                  </span>
                                </div>

                                <button
                                  type="button"
                                  data-testid={`worktree-diff-copy-${wt.specName}`}
                                  onClick={() => handleCopyCode(activeFile)}
                                  className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  {copiedFile ===
                                  (activeFile.path || activeFile.file) ? (
                                    <>
                                      <Check className="h-3 w-3 text-emerald-500" />
                                      {t("worktrees.diff.copied", "Copied")}
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="h-3 w-3" />
                                      {t("worktrees.diff.copy", "Copy")}
                                    </>
                                  )}
                                </button>
                              </div>

                              <div
                                data-testid={`worktree-diff-viewer-body-${wt.specName}`}
                                className={cn(
                                  "overflow-x-auto overflow-y-auto font-mono text-xs leading-relaxed bg-zinc-950/90 text-zinc-100",
                                  isExpanded
                                    ? "max-h-[500px]"
                                    : "max-h-[320px]",
                                )}
                              >
                                {viewMode === "unified" && (
                                  <div className="divide-y divide-zinc-800/40">
                                    {parsedLines.map((line, idx) => {
                                      if (line.type === "header") {
                                        return (
                                          <div
                                            key={idx}
                                            className="bg-blue-950/40 text-blue-300 px-3 py-1 text-xs select-none"
                                          >
                                            {line.content}
                                          </div>
                                        );
                                      }
                                      return (
                                        <div
                                          key={idx}
                                          className={cn(
                                            "flex items-start px-2 py-0.5",
                                            line.type === "add" &&
                                              "bg-emerald-950/45 text-emerald-200",
                                            line.type === "del" &&
                                              "bg-rose-950/45 text-rose-200",
                                            line.type === "context" &&
                                              "text-zinc-300",
                                          )}
                                        >
                                          <span className="w-8 shrink-0 select-none text-right pr-2 text-xs text-zinc-500">
                                            {line.oldLine ?? ""}
                                          </span>
                                          <span className="w-8 shrink-0 select-none text-right pr-2 text-xs text-zinc-500">
                                            {line.newLine ?? ""}
                                          </span>
                                          <span className="w-4 shrink-0 select-none text-center font-bold">
                                            {line.type === "add"
                                              ? "+"
                                              : line.type === "del"
                                                ? "-"
                                                : " "}
                                          </span>
                                          <span className="flex-1 whitespace-pre-wrap break-all">
                                            {line.content || " "}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}

                                {viewMode === "split" && (
                                  <div
                                    data-testid={`worktree-diff-split-grid-${wt.specName}`}
                                    className="grid grid-cols-2 divide-x divide-zinc-800"
                                  >
                                    <div>
                                      <div className="border-b border-zinc-800 bg-zinc-900/80 px-2.5 py-1 text-xs font-semibold text-rose-300">
                                        {t(
                                          "worktrees.diff.baseHeader",
                                          `Base (${diffData?.baseBranch || wt.baseBranch})`,
                                          {
                                            branch:
                                              diffData?.baseBranch ||
                                              wt.baseBranch,
                                          },
                                        )}
                                      </div>
                                      {splitRows.map((row, idx) => (
                                        <div
                                          key={idx}
                                          className={cn(
                                            "flex items-start px-2 py-0.5",
                                            row.changed &&
                                              row.oldText !== undefined
                                              ? "bg-rose-950/40 text-rose-200"
                                              : "text-zinc-400",
                                          )}
                                        >
                                          <span className="w-7 shrink-0 select-none text-right pr-2 text-xs text-zinc-600">
                                            {row.oldNum ?? ""}
                                          </span>
                                          <span className="flex-1 whitespace-pre-wrap break-all">
                                            {row.oldText ?? ""}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                    <div>
                                      <div className="border-b border-zinc-800 bg-zinc-900/80 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                                        {t(
                                          "worktrees.diff.worktreeHeader",
                                          `Worktree (${diffData?.branch || wt.branch})`,
                                          {
                                            branch:
                                              diffData?.branch || wt.branch,
                                          },
                                        )}
                                      </div>
                                      {splitRows.map((row, idx) => (
                                        <div
                                          key={idx}
                                          className={cn(
                                            "flex items-start px-2 py-0.5",
                                            row.changed &&
                                              row.newText !== undefined
                                              ? "bg-emerald-950/40 text-emerald-200"
                                              : "text-zinc-200",
                                          )}
                                        >
                                          <span className="w-7 shrink-0 select-none text-right pr-2 text-xs text-zinc-500">
                                            {row.newNum ?? ""}
                                          </span>
                                          <span className="flex-1 whitespace-pre-wrap break-all">
                                            {row.newText ?? ""}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {viewMode === "full" && (
                                  <div
                                    data-testid={`worktree-diff-full-code-${wt.specName}`}
                                    className="py-1"
                                  >
                                    {(
                                      activeFile.newContent ||
                                      activeFile.oldContent ||
                                      activeFile.snippet ||
                                      ""
                                    )
                                      .replace(/\r\n/g, "\n")
                                      .split("\n")
                                      .map((line, idx) => (
                                        <div
                                          key={idx}
                                          className="flex items-start px-3 py-0.5 hover:bg-zinc-900"
                                        >
                                          <span className="w-8 shrink-0 select-none text-right pr-3 text-xs text-zinc-500">
                                            {idx + 1}
                                          </span>
                                          <span className="flex-1 whitespace-pre-wrap break-all text-zinc-100">
                                            {line || " "}
                                          </span>
                                        </div>
                                      ))}
                                  </div>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
