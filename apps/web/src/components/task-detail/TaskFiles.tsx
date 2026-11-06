"use client";

import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  FileText,
  FilePlus,
  FileEdit,
  Search,
  Copy,
  Check,
  MessageSquarePlus,
  Bot,
  Sparkles,
  Columns2,
  AlignJustify,
  Code2,
} from "lucide-react";
import { cn, Badge, Button, Textarea } from "@auto-claude/ui";
import type { Task, TaskFileDiff } from "@auto-claude/types";
import { apiClient } from "@/lib/data";

interface TaskFilesProps {
  task: Task;
  onRequestChanges?: (feedback: string) => void;
}

type DiffViewMode = "unified" | "split" | "full";

interface ParsedDiffLine {
  type: "add" | "del" | "context" | "header";
  content: string;
  oldLine?: number;
  newLine?: number;
}

function parseUnifiedDiffLines(
  unifiedDiff: string,
  newContent: string,
): ParsedDiffLine[] {
  if (!unifiedDiff || !unifiedDiff.trim()) {
    const rawLines = (newContent || "").replace(/\r\n/g, "\n").split("\n");
    return rawLines.map((line, idx) => ({
      type: "add",
      content: line,
      newLine: idx + 1,
    }));
  }

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

export function TaskFiles({ task, onRequestChanges }: TaskFilesProps) {
  const { t } = useTranslation(["kanban"]);
  const [fetchedDiffs, setFetchedDiffs] = useState<TaskFileDiff[] | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<DiffViewMode>("unified");
  const [copied, setCopied] = useState(false);
  const [showCommentBox, setShowCommentBox] = useState(
    task.status === "human_review",
  );
  const [fixScope, setFixScope] = useState<"file" | "feature">("file");
  const [selectedLineNumber, setSelectedLineNumber] = useState<number | null>(
    null,
  );
  const [commentText, setCommentText] = useState("");

  useEffect(() => {
    if (task.status === "human_review") {
      setShowCommentBox(true);
    }
  }, [task.status]);

  // Fetch diffs from API if task.fileDiffs is not yet populated
  useEffect(() => {
    let active = true;
    if (
      (!task.fileDiffs || task.fileDiffs.length === 0) &&
      task.projectId &&
      task.id
    ) {
      apiClient
        .getTaskDiff(task.projectId, task.id)
        .then((res) => {
          if (active && Array.isArray(res?.files) && res.files.length > 0) {
            setFetchedDiffs(res.files);
          }
        })
        .catch(() => {
          // fallback to subtask files
        });
    }
    return () => {
      active = false;
    };
  }, [task.projectId, task.id, task.fileDiffs, task.updatedAt]);

  const allFiles: TaskFileDiff[] = useMemo(() => {
    if (Array.isArray(task.fileDiffs) && task.fileDiffs.length > 0) {
      return task.fileDiffs;
    }
    if (Array.isArray(fetchedDiffs) && fetchedDiffs.length > 0) {
      return fetchedDiffs;
    }

    const fallbackMap = new Map<string, TaskFileDiff>();
    for (const subtask of task.subtasks || []) {
      if (Array.isArray(subtask.files)) {
        for (const file of subtask.files) {
          if (!fallbackMap.has(file)) {
            const placeholder = `// File: ${file}\n// Generated for task: ${task.title}\n`;
            fallbackMap.set(file, {
              path: file,
              status: "created",
              additions: 2,
              deletions: 0,
              oldContent: "",
              newContent: placeholder,
              unifiedDiff: `--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,2 @@\n+// File: ${file}\n+// Generated for task: ${task.title}`,
            });
          }
        }
      }
    }
    return Array.from(fallbackMap.values());
  }, [task.fileDiffs, fetchedDiffs, task.subtasks, task.title]);

  const aiFixedFilesSet = useMemo(() => {
    const set = new Set<string>();
    if (Array.isArray(task.reviewComments)) {
      for (const rc of task.reviewComments) {
        if (Array.isArray(rc.modifiedFiles)) {
          for (const f of rc.modifiedFiles) {
            set.add(f);
          }
        }
        if (rc.filePath && rc.status === "addressed") {
          set.add(rc.filePath);
        }
      }
    }
    return set;
  }, [task.reviewComments]);

  const filteredFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allFiles;
    return allFiles.filter((f) => f.path.toLowerCase().includes(q));
  }, [allFiles, searchQuery]);

  useEffect(() => {
    if (filteredFiles.length > 0) {
      if (
        !selectedPath ||
        !filteredFiles.some((f) => f.path === selectedPath)
      ) {
        setSelectedPath(filteredFiles[0].path);
      }
    } else {
      setSelectedPath(null);
    }
  }, [filteredFiles, selectedPath]);

  const selectedFile = useMemo(
    () =>
      filteredFiles.find((f) => f.path === selectedPath) ||
      filteredFiles[0] ||
      null,
    [filteredFiles, selectedPath],
  );

  const totalAdditions = useMemo(
    () => allFiles.reduce((acc, f) => acc + (f.additions || 0), 0),
    [allFiles],
  );
  const totalDeletions = useMemo(
    () => allFiles.reduce((acc, f) => acc + (f.deletions || 0), 0),
    [allFiles],
  );

  const parsedLines = useMemo(() => {
    if (!selectedFile) return [];
    return parseUnifiedDiffLines(
      selectedFile.unifiedDiff,
      selectedFile.newContent,
    );
  }, [selectedFile]);

  const splitRows = useMemo(() => {
    if (!selectedFile) return [];
    const oldLines = selectedFile.oldContent
      ? selectedFile.oldContent.replace(/\r\n/g, "\n").split("\n")
      : [];
    const newLines = selectedFile.newContent
      ? selectedFile.newContent.replace(/\r\n/g, "\n").split("\n")
      : [];
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
  }, [selectedFile]);

  const handleCopyCode = () => {
    if (!selectedFile) return;
    navigator.clipboard?.writeText(selectedFile.newContent || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleSubmitFileComment = () => {
    if (!commentText.trim() || !onRequestChanges) return;
    if (fixScope === "feature") {
      onRequestChanges(`[Scope: Entire Feature] ${commentText.trim()}`);
    } else if (selectedFile) {
      const prefix = `[File: ${selectedFile.path}${selectedLineNumber ? `:L${selectedLineNumber}` : ""}] `;
      onRequestChanges(`${prefix}${commentText.trim()}`);
    }
    setCommentText("");
    setSelectedLineNumber(null);
  };

  if (allFiles.length === 0) {
    return (
      <div
        data-testid="task-files-empty"
        className="text-sm text-muted-foreground text-center py-8 rounded-lg border border-dashed border-border"
      >
        {t("kanban:detail.noFiles", "No files associated with this task")}
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="task-files-workbench">
      {/* Top Summary & View Mode Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-foreground">
            {t("kanban:detail.filesCount", "{{count}} files", {
              count: allFiles.length,
            })}
          </span>
          <span
            data-testid="diff-total-additions"
            className="inline-flex items-center rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400"
          >
            +{totalAdditions}
          </span>
          <span
            data-testid="diff-total-deletions"
            className="inline-flex items-center rounded bg-rose-500/15 px-1.5 py-0.5 font-mono text-xs font-semibold text-rose-600 dark:text-rose-400"
          >
            -{totalDeletions}
          </span>

          {/* File filter input */}
          <div className="relative ml-1">
            <Search className="h-3 w-3 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              data-testid="task-files-filter-input"
              placeholder="Filter files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-7 w-40 rounded-md border border-border bg-background pl-6 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        {/* Whole-Feature Fix Action & View Mode Segmented Control */}
        <div className="flex items-center gap-2 flex-wrap">
          {onRequestChanges && (
            <button
              type="button"
              data-testid="fix-entire-feature-btn"
              onClick={() => {
                setFixScope("feature");
                setSelectedLineNumber(null);
                setShowCommentBox(true);
              }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                showCommentBox && fixScope === "feature"
                  ? "border-purple-500 bg-purple-600 text-white"
                  : "border-purple-500/40 bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20",
              )}
            >
              <Sparkles className="h-3 w-3" />
              {t("kanban:detail.fixEntireFeature", "Fix Entire Feature")}
            </button>
          )}
          <div className="inline-flex items-center rounded-md border border-border bg-background p-0.5">
            <button
              type="button"
              data-testid="diff-mode-unified"
              onClick={() => setViewMode("unified")}
              className={cn(
                "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors",
                viewMode === "unified"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <AlignJustify className="h-3 w-3" />
              Unified Diff
            </button>
            <button
              type="button"
              data-testid="diff-mode-split"
              onClick={() => setViewMode("split")}
              className={cn(
                "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors",
                viewMode === "split"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Columns2 className="h-3 w-3" />
              Split Diff
            </button>
            <button
              type="button"
              data-testid="diff-mode-full"
              onClick={() => setViewMode("full")}
              className={cn(
                "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors",
                viewMode === "full"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Code2 className="h-3 w-3" />
              Full Code
            </button>
          </div>
        </div>
      </div>

      {/* 2-Pane Master-Detail Layout */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 min-h-[340px]">
        {/* Left Sidebar: File List */}
        <div className="md:col-span-4 rounded-lg border border-border bg-card/50 overflow-hidden flex flex-col">
          <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Changed Files ({filteredFiles.length})
          </div>
          <div className="divide-y divide-border/60 overflow-y-auto max-h-[420px]">
            {filteredFiles.map((file) => {
              const isSelected = selectedFile?.path === file.path;
              const isAiFixed = aiFixedFilesSet.has(file.path);
              return (
                <button
                  key={file.path}
                  type="button"
                  data-testid={`task-file-item-${file.path}`}
                  onClick={() => {
                    setSelectedPath(file.path);
                    setSelectedLineNumber(null);
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2.5 flex items-center gap-2 transition-colors hover:bg-accent/50",
                    isSelected && "bg-primary/10 border-l-2 border-l-primary",
                  )}
                >
                  {file.status === "created" ? (
                    <FilePlus className="h-4 w-4 text-emerald-500 shrink-0" />
                  ) : file.status === "modified" ? (
                    <FileEdit className="h-4 w-4 text-blue-500 shrink-0" />
                  ) : (
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs truncate font-medium text-foreground">
                      {file.path}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[9px] px-1 py-0 h-4",
                          file.status === "created"
                            ? "text-emerald-600 border-emerald-500/30"
                            : "text-blue-600 border-blue-500/30",
                        )}
                      >
                        {file.status}
                      </Badge>
                      <span className="font-mono text-xs text-emerald-600 dark:text-emerald-400">
                        +{file.additions || 0}
                      </span>
                      {(file.deletions || 0) > 0 && (
                        <span className="font-mono text-xs text-rose-600 dark:text-rose-400">
                          -{file.deletions}
                        </span>
                      )}
                      {isAiFixed && (
                        <span
                          data-testid={`ai-fixed-badge-${file.path}`}
                          className="inline-flex items-center gap-0.5 rounded bg-purple-500/15 px-1.5 py-0 text-[9px] font-semibold text-purple-600 dark:text-purple-400"
                        >
                          <Sparkles className="h-2.5 w-2.5" />
                          AI Fixed
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Viewer: Code Diff & Inline Comment */}
        <div className="md:col-span-8 rounded-lg border border-border bg-card overflow-hidden flex flex-col">
          {selectedFile ? (
            <>
              {/* File Header Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    data-testid="selected-diff-file-path"
                    className="font-mono text-xs font-semibold truncate"
                  >
                    {selectedFile.path}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs",
                      selectedFile.status === "created"
                        ? "text-emerald-600 border-emerald-500/30"
                        : "text-blue-600 border-blue-500/30",
                    )}
                  >
                    {selectedFile.status}
                  </Badge>
                  <span className="font-mono text-xs text-emerald-600 dark:text-emerald-400">
                    +{selectedFile.additions || 0}
                  </span>
                  <span className="font-mono text-xs text-rose-600 dark:text-rose-400">
                    -{selectedFile.deletions || 0}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    data-testid="copy-file-code-btn"
                    onClick={handleCopyCode}
                    className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-500" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        Copy
                      </>
                    )}
                  </button>
                  {onRequestChanges && (
                    <button
                      type="button"
                      data-testid="file-diff-comment-btn"
                      onClick={() => {
                        setFixScope("file");
                        setShowCommentBox((prev) => !prev);
                      }}
                      className={cn(
                        "inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs font-medium transition-colors",
                        showCommentBox && fixScope === "file"
                          ? "border-purple-500/40 bg-purple-500/15 text-purple-600 dark:text-purple-400"
                          : "border-border bg-background text-foreground hover:bg-accent",
                      )}
                    >
                      <MessageSquarePlus className="h-3 w-3" />
                      {t("kanban:detail.commentAndAiFix", "Comment & AI Fix")}
                    </button>
                  )}
                </div>
              </div>

              {/* Code / Diff Body */}
              <div
                data-testid="file-diff-viewer-body"
                className="overflow-x-auto overflow-y-auto max-h-[380px] font-mono text-xs leading-relaxed bg-zinc-950/90 text-zinc-100"
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

                      const lineNum = line.newLine ?? line.oldLine ?? idx + 1;
                      return (
                        <div
                          key={idx}
                          onClick={() => {
                            if (onRequestChanges) {
                              setSelectedLineNumber(lineNum);
                              setFixScope("file");
                              setShowCommentBox(true);
                            }
                          }}
                          className={cn(
                            "group flex items-start px-2 py-0.5 cursor-pointer transition-colors",
                            line.type === "add" &&
                              "bg-emerald-950/45 text-emerald-200 hover:bg-emerald-900/50",
                            line.type === "del" &&
                              "bg-rose-950/45 text-rose-200 hover:bg-rose-900/50",
                            line.type === "context" &&
                              "text-zinc-300 hover:bg-zinc-900",
                            selectedLineNumber === lineNum &&
                              "ring-1 ring-inset ring-purple-400/60",
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
                          {onRequestChanges && (
                            <span className="opacity-0 group-hover:opacity-100 ml-2 text-xs text-purple-300 shrink-0">
                              + 💬 L{lineNum}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {viewMode === "split" && (
                  <div
                    data-testid="diff-split-grid"
                    className="grid grid-cols-2 divide-x divide-zinc-800"
                  >
                    <div>
                      <div className="border-b border-zinc-800 bg-zinc-900/80 px-2.5 py-1 text-xs font-semibold text-rose-300">
                        Previous / Base ({selectedFile.oldContent ? "Before" : "Empty"})
                      </div>
                      {splitRows.map((row, idx) => (
                        <div
                          key={idx}
                          className={cn(
                            "flex items-start px-2 py-0.5",
                            row.changed && row.oldText !== undefined
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
                        Current / AI Updated
                      </div>
                      {splitRows.map((row, idx) => (
                        <div
                          key={idx}
                          className={cn(
                            "flex items-start px-2 py-0.5",
                            row.changed && row.newText !== undefined
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
                  <div data-testid="diff-full-code-view" className="py-1">
                    {(selectedFile.newContent || "")
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

              {/* Inline File / Feature Comment & AI Fix Box */}
              {onRequestChanges && showCommentBox && (
                <div
                  data-testid="file-diff-comment-box"
                  className="border-t border-border bg-purple-500/5 p-3 space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-purple-700 dark:text-purple-300 flex items-center gap-1.5">
                      <Bot className="h-3.5 w-3.5" />
                      {fixScope === "feature" ? (
                        <>
                          {t("kanban:detail.aiFixScopeLabel", "AI Fix Scope:")}{" "}
                          <code className="rounded bg-purple-500/15 px-1.5 py-0.5 font-mono">
                            {t(
                              "kanban:detail.entireFeatureFiles",
                              "Entire Feature (All {{count}} Files)",
                              { count: allFiles.length },
                            )}
                          </code>
                        </>
                      ) : (
                        <>
                          {t("kanban:detail.commentOn", "Comment on")}{" "}
                          <code className="rounded bg-purple-500/15 px-1.5 py-0.5 font-mono">
                            {selectedFile.path}
                            {selectedLineNumber ? `:L${selectedLineNumber}` : ""}
                          </code>
                        </>
                      )}
                    </span>

                    {/* Scope Toggle Bar */}
                    <div className="inline-flex items-center rounded-md border border-border bg-background p-0.5">
                      <button
                        type="button"
                        data-testid="fix-scope-file"
                        onClick={() => setFixScope("file")}
                        className={cn(
                          "rounded px-2 py-0.5 text-xs font-medium transition-colors",
                          fixScope === "file"
                            ? "bg-purple-600 text-white"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {t(
                          "kanban:detail.scopeCurrentFile",
                          "Current File ({{file}})",
                          {
                            file:
                              selectedFile.path.split("/").pop() ||
                              selectedFile.path,
                          },
                        )}
                      </button>
                      <button
                        type="button"
                        data-testid="fix-scope-feature"
                        onClick={() => {
                          setFixScope("feature");
                          setSelectedLineNumber(null);
                        }}
                        className={cn(
                          "rounded px-2 py-0.5 text-xs font-medium transition-colors",
                          fixScope === "feature"
                            ? "bg-purple-600 text-white"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {t(
                          "kanban:detail.scopeEntireFeature",
                          "Entire Feature (All {{count}} Files)",
                          { count: allFiles.length },
                        )}
                      </button>
                    </div>

                    {selectedLineNumber && fixScope === "file" && (
                      <button
                        type="button"
                        onClick={() => setSelectedLineNumber(null)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        {t("kanban:detail.clearLine", "Clear line")} L
                        {selectedLineNumber}
                      </button>
                    )}
                  </div>
                  <Textarea
                    data-testid="file-diff-comment-input"
                    placeholder={
                      fixScope === "feature"
                        ? t(
                            "kanban:detail.featureCommentPlaceholder",
                            "Enter review comment or fix request across all {{count}} files in this feature... AI will inspect and update the entire feature automatically.",
                            { count: allFiles.length },
                          )
                        : t(
                            "kanban:detail.fileCommentPlaceholder",
                            "Enter review comment or fix request for {{file}}... AI will inspect and update the code automatically.",
                            { file: selectedFile.path },
                          )
                    }
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    rows={2}
                    className="resize-none text-xs bg-background"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      data-testid="file-diff-submit-fix-btn"
                      size="sm"
                      disabled={!commentText.trim()}
                      onClick={handleSubmitFileComment}
                      className="gap-1.5 bg-purple-600 hover:bg-purple-700 text-white"
                    >
                      <Bot className="h-3.5 w-3.5" />
                      {fixScope === "feature"
                        ? t(
                            "kanban:detail.submitFeatureAiFix",
                            "Submit Whole-Feature AI Fix",
                          )
                        : t(
                            "kanban:detail.submitFileAiFix",
                            "Submit AI Check & Fix",
                          )}
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
