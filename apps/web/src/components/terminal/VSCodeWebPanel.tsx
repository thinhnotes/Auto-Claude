"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Code2,
  ExternalLink,
  FolderOpen,
  Loader2,
  RotateCw,
  TerminalSquare,
} from "lucide-react";
import { apiClient } from "@/lib/data/api-client";
import { useTerminalStore } from "@/stores/terminal-store";

interface VSCodeWebPanelProps {
  sessionId: string;
  projectId?: string;
  cwd?: string;
  onBackToTerminal: () => void;
}

export function VSCodeWebPanel({
  sessionId,
  projectId,
  cwd,
  onBackToTerminal,
}: VSCodeWebPanelProps) {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resolvedFolder, setResolvedFolder] = useState<string>(cwd || "~");
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState<number>(0);

  const initVSCodeWeb = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    const fallbackFolder =
      cwd && cwd.trim() !== "" && cwd.trim() !== "~"
        ? cwd.trim()
        : "/home/thinhnguyen";
    try {
      let res;
      try {
        res = await apiClient.openVSCodeWeb(projectId, {
          sessionId,
          folderPath: cwd,
        });
      } catch {
        // Retry once after brief delay in case of transient gateway/tunnel reconnect
        await new Promise((r) => setTimeout(r, 600));
        res = await apiClient.openVSCodeWeb(projectId, {
          sessionId,
          folderPath: cwd,
        });
      }
      const folder =
        res?.folderPath ||
        res?.data?.folderPath ||
        fallbackFolder;
      setResolvedFolder(folder);

      const url = `/vscode-web/?folder=${encodeURIComponent(folder)}`;
      setIframeUrl(url);
      useTerminalStore.getState().setVSCodeMode(sessionId, true, url);
    } catch {
      // Even if the API call failed transiently, open the same-origin /vscode-web/ endpoint directly
      setResolvedFolder(fallbackFolder);
      const url = `/vscode-web/?folder=${encodeURIComponent(fallbackFolder)}`;
      setIframeUrl(url);
      useTerminalStore.getState().setVSCodeMode(sessionId, true, url);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, sessionId, cwd]);

  useEffect(() => {
    void initVSCodeWeb();
  }, [initVSCodeWeb, reloadNonce]);

  return (
    <div
      className="flex h-full w-full flex-col bg-[#0B0B0F] text-zinc-100"
      data-testid={`vscode-web-panel-${sessionId}`}
    >
      {/* Top status & action bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-[#12121A] px-2.5 py-1.5 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex items-center gap-1 rounded bg-sky-500/20 px-2 py-0.5 font-semibold text-sky-300">
            <Code2 className="h-3.5 w-3.5 flex-shrink-0" />
            <span>VS Code Online (Local)</span>
          </span>
          <span
            className="flex items-center gap-1.5 font-mono text-emerald-300 truncate max-w-md"
            title={resolvedFolder}
            data-testid={`vscode-web-folder-${sessionId}`}
          >
            <FolderOpen className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="truncate">{resolvedFolder}</span>
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid={`vscode-web-reload-${sessionId}`}
            onClick={(e) => {
              e.stopPropagation();
              setReloadNonce((n) => n + 1);
            }}
            className="flex items-center gap-1 rounded bg-white/10 px-2 py-0.5 text-xs font-medium text-zinc-200 hover:bg-white/20 transition-colors"
            title="Reload VS Code Online frame"
          >
            <RotateCw className="h-3 w-3" />
            <span>Reload</span>
          </button>

          {iframeUrl && (
            <a
              href={iframeUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid={`vscode-web-open-tab-${sessionId}`}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 rounded bg-sky-500/20 px-2 py-0.5 text-xs font-medium text-sky-200 hover:bg-sky-500/30 transition-colors"
              title="Open VS Code Online in a full browser tab"
            >
              <ExternalLink className="h-3 w-3" />
              <span>Open Tab</span>
            </a>
          )}

          <button
            type="button"
            data-testid={`vscode-web-back-terminal-${sessionId}`}
            onClick={(e) => {
              e.stopPropagation();
              onBackToTerminal();
            }}
            className="flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/30 transition-colors"
            title="Switch back to PowerShell / Terminal view (session stays active)"
          >
            <TerminalSquare className="h-3 w-3" />
            <span>Back to Terminal</span>
          </button>
        </div>
      </div>

      {/* Main VS Code Web Iframe Viewport */}
      <div className="relative flex-1 min-h-[320px] w-full overflow-hidden bg-[#0B0B0F]">
        {isLoading && (
          <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[#0B0B0F]/90 text-xs text-zinc-200"
            data-testid={`vscode-web-loading-${sessionId}`}
          >
            <Loader2 className="h-5 w-5 animate-spin text-sky-400" />
            <span>
              Starting local VS Code Web IDE for{" "}
              <strong className="font-mono text-emerald-300">
                {resolvedFolder}
              </strong>
              ...
            </span>
          </div>
        )}

        {errorMsg ? (
          <div
            className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-xs text-red-300"
            data-testid={`vscode-web-error-${sessionId}`}
          >
            <p className="font-medium">Failed to launch local VS Code Web: {errorMsg}</p>
            <button
              type="button"
              onClick={() => setReloadNonce((n) => n + 1)}
              className="rounded bg-sky-500/20 px-3 py-1 text-xs font-medium text-sky-200 hover:bg-sky-500/30"
            >
              Retry
            </button>
          </div>
        ) : iframeUrl ? (
          <iframe
            key={`${iframeUrl}-${reloadNonce}`}
            src={iframeUrl}
            title={`VS Code Online — ${resolvedFolder}`}
            data-testid={`vscode-web-iframe-${sessionId}`}
            allow="clipboard-read; clipboard-write"
            className="h-full w-full border-0"
          />
        ) : null}
      </div>
    </div>
  );
}
