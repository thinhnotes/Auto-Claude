"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SerializeAddon } from "@xterm/addon-serialize";
import {
  Play,
  Loader2,
  FolderOpen,
  Zap,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  CornerDownLeft,
  XCircle,
  Terminal as TerminalIcon,
  History,
  Code2,
} from "lucide-react";
import { terminalSocket } from "@/lib/websocket-client";
import { DEFAULT_TERMINAL_THEME } from "@/lib/terminal-theme";
import { webglContextManager } from "@/lib/webgl-context-manager";
import {
  useTerminalStore,
  registerOutputCallback,
  unregisterOutputCallback,
} from "@/stores/terminal-store";
import { apiClient } from "@/lib/data/api-client";
import "@xterm/xterm/css/xterm.css";

interface TerminalInteractiveMenuOption {
  id: string;
  label: string;
  description?: string;
  value: string;
}

interface TerminalInteractiveState {
  kind: "ssh-keygen" | "menu" | "confirm" | "prompt";
  step?: string;
  title?: string;
  prompt: string;
  allowEmpty?: boolean;
  maskInput?: boolean;
  defaultValue?: string;
  selectedIndex?: number;
  options?: TerminalInteractiveMenuOption[];
}

interface TerminalPanelProps {
  sessionId: string;
  projectId?: string;
  cwd?: string;
  isAgyMode?: boolean;
  onResize?: (cols: number, rows: number) => void;
  onOpenVSCodeWeb?: (cwd: string) => void;
}

const QUICK_COMMANDS = ["pwd", "ls -la", "git status", "Get-History", "clear"] as const;

const DEFAULT_POWERSHELL_HISTORY_SUGGESTIONS: string[] = [
  "agy --dangerously-skip-permissions",
  "ls -an",
  "git clone git@ssh.dev.azure.com:v3/thinhnguyenh/5100-000932%20-%20Worldline%20-%20Integrale%20Resource/5100-000932%20-%20Worldline%20-%20Integrale%20Resource IR",
  "git status",
  "git branch -a",
  "git log --oneline -n 10",
  "cat ~/.ssh/id_rsa.pub",
  "cat ~/.ssh/id_ed25519.pub",
  "ssh-keygen -t rsa -b 4096 -C \"thinhnguyen@aperant\"",
  "docker ps",
  "./run-local.sh",
  "Get-ChildItem -Force",
  "Get-History",
  "Get-Location",
  "Set-Location ..",
  "$PSVersionTable",
  "/resume",
  "/model",
  "/mode",
  "/tasks",
];

function formatShellPrompt(
  dir: string,
  isAgy: boolean,
  shell: "pwsh" | "bash",
): string {
  if (isAgy) {
    const dirName = dir.split("/").filter(Boolean).pop() || "~";
    return `⚡ agy@${dirName}> `;
  }
  if (shell === "bash") {
    return `thinhnguyen@aperant:${dir}$ `;
  }
  return `PS ${dir}> `;
}

/**
 * Terminal panel with PowerShell 7 (`pwsh`) default startup,
 * PSReadLine Predictive History Auto-Suggestion (`InlineView` ghost text + `F2` `ListView`),
 * Direct Inline Terminal Input, Up/Down Interactive TUI Menus (`/resume`, `/model`, `/mode`, `/tasks`, `ssh-keygen`),
 * Command History Navigation, Tab Autocomplete, and Interactive AGY REPL.
 *
 * IMPORTANT: This component must NEVER be statically imported.
 * Always use next/dynamic with { ssr: false }.
 */
export function TerminalPanel({
  sessionId,
  projectId,
  cwd,
  isAgyMode: isAgyModeProp = false,
  onResize,
  onOpenVSCodeWeb,
}: TerminalPanelProps) {
  const storeAgyMode = useTerminalStore(
    (s) => s.terminals.find((t) => t.id === sessionId)?.isAgyMode,
  );
  const [localAgyMode, setLocalAgyMode] = useState<boolean>(
    Boolean(isAgyModeProp || storeAgyMode),
  );
  const isAgyMode =
    localAgyMode || Boolean(isAgyModeProp) || Boolean(storeAgyMode);

  const containerRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLPreElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isDisposedRef = useRef(false);
  const prevCwdRef = useRef<string | undefined>(cwd);
  const prevAgyModeRef = useRef<boolean>(isAgyMode);
  const activeAgyModeRef = useRef<boolean>(isAgyMode);

  // Keep activeAgyModeRef and localAgyMode synced when external prop or store updates
  useEffect(() => {
    if (isAgyModeProp || storeAgyMode) {
      activeAgyModeRef.current = true;
      setLocalAgyMode(true);
    } else if (storeAgyMode === false && !isAgyModeProp) {
      activeAgyModeRef.current = false;
      setLocalAgyMode(false);
    }
  }, [isAgyModeProp, storeAgyMode]);

  const [currentCwd, setCurrentCwd] = useState<string>(cwd || "~");
  const [activeShell, setActiveShell] = useState<"pwsh" | "bash">("pwsh");
  const [commandInput, setCommandInput] = useState<string>("");
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [isThinking, setIsThinking] = useState<boolean>(false);
  const [isTerminalFocused, setIsTerminalFocused] = useState<boolean>(true);
  const [interactiveState, setInteractiveState] =
    useState<TerminalInteractiveState | null>(null);
  const [selectedMenuIndex, setSelectedMenuIndex] = useState<number>(0);
  const selectedMenuIndexRef = useRef<number>(0);

  // Command history (chronological oldest -> newest for Up/Down cursor)
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyCursor, setHistoryCursor] = useState<number>(-1);
  const draftInputRef = useRef<string>("");

  // PSReadLine History Auto-Suggestion state (most recent first)
  const [psHistorySuggestions, setPsHistorySuggestions] = useState<string[]>(
    DEFAULT_POWERSHELL_HISTORY_SUGGESTIONS,
  );
  const [predictionViewStyle, setPredictionViewStyle] = useState<
    "InlineView" | "ListView"
  >("InlineView");
  const [selectedPredictionIndex, setSelectedPredictionIndex] =
    useState<number>(0);

  const [outputLog, setOutputLog] = useState<string>(() => {
    const initialDir = cwd || "~";
    return [
      `PowerShell 7.6.7 (Aperant Interactive Shell — ${sessionId.slice(0, 8)})`,
      `PSReadLine PredictionSource: HistoryAndPlugin (→ / End to accept inline suggestion, F2 toggle ListView)`,
      `PS ${initialDir}> `,
    ].join("\n");
  });

  // Merge session commandHistory (newest first) + server PSReadLine history suggestions (newest first)
  const mergedHistorySuggestions = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    const localNewestFirst = [...commandHistory].reverse();
    for (const cmd of [...localNewestFirst, ...psHistorySuggestions]) {
      const trimmed = cmd?.trim();
      if (!trimmed || trimmed.length < 2) continue;
      const key = trimmed.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(trimmed);
      }
    }
    return result;
  }, [commandHistory, psHistorySuggestions]);

  // Compute PSReadLine matching predictions for current commandInput
  const matchingPredictions = useMemo(() => {
    if (interactiveState) return [];
    const raw = commandInput;
    const trimmedLeft = raw.trimStart();
    if (!trimmedLeft) return [];
    const lower = trimmedLeft.toLowerCase();

    const prefixMatches = mergedHistorySuggestions.filter(
      (cmd) =>
        cmd.toLowerCase().startsWith(lower) && cmd.toLowerCase() !== lower,
    );
    const substringMatches = mergedHistorySuggestions.filter(
      (cmd) =>
        !cmd.toLowerCase().startsWith(lower) &&
        cmd.toLowerCase().includes(lower) &&
        cmd.toLowerCase() !== lower,
    );
    return [...prefixMatches, ...substringMatches].slice(0, 8);
  }, [commandInput, interactiveState, mergedHistorySuggestions]);

  // Primary inline ghost-text suggestion (strictly prefix match on most recent history item, just like PSReadLine InlineView)
  const inlineSuggestion = useMemo(() => {
    if (interactiveState || !commandInput) return null;
    const lower = commandInput.toLowerCase();
    const match = mergedHistorySuggestions.find(
      (cmd) =>
        cmd.toLowerCase().startsWith(lower) &&
        cmd.length > commandInput.length,
    );
    return match || null;
  }, [commandInput, interactiveState, mergedHistorySuggestions]);

  const inlineSuggestionSuffix = useMemo(() => {
    if (!inlineSuggestion || !commandInput) return "";
    return inlineSuggestion.slice(commandInput.length);
  }, [commandInput, inlineSuggestion]);

  const focusCommandInput = useCallback(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      setIsTerminalFocused(true);
    });
  }, []);

  // Focus input on mount
  useEffect(() => {
    focusCommandInput();
  }, [focusCommandInput]);

  // Load real PowerShell ConsoleHost_history.txt suggestions and session state from backend on mount
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    apiClient
      .autocompleteTerminal(projectId, sessionId, "", currentCwd)
      .then((res) => {
        if (cancelled) return;
        if (typeof (res as any)?.isAgyMode === "boolean") {
          const serverAgy = Boolean((res as any).isAgyMode);
          if (serverAgy) {
            prevAgyModeRef.current = true;
            activeAgyModeRef.current = true;
            setLocalAgyMode(true);
            useTerminalStore.getState().setAgyMode(sessionId, true);
            useTerminalStore
              .getState()
              .setTerminalStatus(sessionId, "agy-active");
          }
        }
        if ((res as any)?.shell === "bash" || (res as any)?.shell === "pwsh") {
          setActiveShell((res as any).shell);
        }
        if (
          Array.isArray(res?.historySuggestions) &&
          res.historySuggestions.length > 0
        ) {
          setPsHistorySuggestions(res.historySuggestions);
          // Also seed commandHistory (chronological oldest -> newest) if empty
          setCommandHistory((prev) =>
            prev.length > 0
              ? prev
              : [...res.historySuggestions!].slice(0, 40).reverse(),
          );
        }
      })
      .catch(() => {
        // Keep default PowerShell suggestions on error
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, sessionId, currentCwd]);

  const appendToTerminalAndLog = useCallback((text: string) => {
    if (!text) return;
    setOutputLog((prev) =>
      `${prev}${text.replace(/\r\n/g, "\n")}`.slice(-80000),
    );
    if (xtermRef.current && !isDisposedRef.current) {
      try {
        xtermRef.current.write(text.replace(/\r?\n/g, "\r\n"));
      } catch {
        // Ignore xterm write error if canvas is hidden
      }
    }
  }, []);

  const syncInteractiveStateFromResponse = useCallback(
    (res: any) => {
      const nextState =
        res?.interactiveState !== undefined
          ? res.interactiveState
          : res?.session?.interactiveState !== undefined
            ? res.session.interactiveState
            : null;
      setInteractiveState(nextState || null);
      if (nextState && typeof nextState.selectedIndex === "number") {
        selectedMenuIndexRef.current = nextState.selectedIndex;
        setSelectedMenuIndex(nextState.selectedIndex);
      } else {
        selectedMenuIndexRef.current = 0;
        setSelectedMenuIndex(0);
      }
      if (res?.shell === "pwsh" || res?.shell === "bash") {
        setActiveShell(res.shell);
      }
      const nextAgy =
        typeof res?.isAgyMode === "boolean"
          ? res.isAgyMode
          : typeof res?.session?.isAgyMode === "boolean"
            ? res.session.isAgyMode
            : undefined;
      if (typeof nextAgy === "boolean") {
        prevAgyModeRef.current = nextAgy;
        activeAgyModeRef.current = nextAgy;
        setLocalAgyMode(nextAgy);
        useTerminalStore.getState().setAgyMode(sessionId, nextAgy);
        useTerminalStore
          .getState()
          .setTerminalStatus(sessionId, nextAgy ? "agy-active" : "running");
      }
      if (
        Array.isArray(res?.historySuggestions) &&
        res.historySuggestions.length > 0
      ) {
        setPsHistorySuggestions(res.historySuggestions);
      }
      if (res?.cwd) {
        setCurrentCwd(res.cwd);
        useTerminalStore.getState().updateTerminal(sessionId, { cwd: res.cwd });
      }
    },
    [sessionId],
  );

  // Accept full or next-word PSReadLine inline suggestion
  const acceptInlineSuggestion = useCallback(
    (mode: "full" | "word" = "full"): boolean => {
      if (!inlineSuggestion || !inlineSuggestionSuffix) return false;
      if (mode === "full") {
        setCommandInput(inlineSuggestion);
        setHistoryCursor(-1);
        focusCommandInput();
        return true;
      }
      // Accept next word (`Ctrl+RightArrow` / `Alt+F`)
      const wordMatch = inlineSuggestionSuffix.match(/^(\s*\S+)/);
      const nextChunk = wordMatch ? wordMatch[1] : inlineSuggestionSuffix;
      setCommandInput(`${commandInput}${nextChunk}`);
      setHistoryCursor(-1);
      focusCommandInput();
      return true;
    },
    [commandInput, focusCommandInput, inlineSuggestion, inlineSuggestionSuffix],
  );

  const fit = useCallback(() => {
    if (isDisposedRef.current || !fitAddonRef.current || !xtermRef.current)
      return;
    try {
      fitAddonRef.current.fit();
    } catch {
      // Container may not be visible
    }
  }, []);

  // Auto-scroll transcript log to bottom
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [
    outputLog,
    isThinking,
    commandInput,
    interactiveState,
    selectedMenuIndex,
    predictionViewStyle,
    selectedPredictionIndex,
  ]);

  // Execute an AGY (--dangerously-skip-permissions) prompt or enter interactive AGY session
  const executeAgyPrompt = useCallback(
    async (rawPrompt: string) => {
      const promptText = rawPrompt.trim() || "__enter_agy_session__";
      setIsExecuting(true);
      setIsThinking(true);
      try {
        if (projectId) {
          const res = await apiClient.execAgyCommand(
            projectId,
            sessionId,
            promptText,
            currentCwd,
          );
          const nextCwd = res.cwd || currentCwd;
          setCurrentCwd(nextCwd);
          useTerminalStore.getState().updateTerminal(sessionId, { cwd: nextCwd });
          syncInteractiveStateFromResponse(res);
          const block =
            res.formattedOutput ||
            `${promptText}\r\n${res.output || ""}⚡ agy@${nextCwd.split("/").pop()}> `;
          appendToTerminalAndLog(block);
        } else {
          const cmd = `/home/thinhnguyen/.local/bin/agy --dangerously-skip-permissions --mode auto -p "${promptText}"\n`;
          terminalSocket.emit("input", { sessionId, data: cmd });
          appendToTerminalAndLog(`${cmd}⚡ agy> `);
        }
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to execute AGY command";
        appendToTerminalAndLog(
          `\r\nError running AGY: ${msg}\r\n⚡ agy@${currentCwd.split("/").pop()}> `,
        );
      } finally {
        setIsThinking(false);
        setIsExecuting(false);
        focusCommandInput();
      }
    },
    [
      appendToTerminalAndLog,
      currentCwd,
      focusCommandInput,
      projectId,
      sessionId,
      syncInteractiveStateFromResponse,
    ],
  );

  // Execute a shell command or interactive turn via Same-Origin HTTP engine (and sync to xterm + transcript)
  const executeShellCommand = useCallback(
    async (rawCmd: string) => {
      const trimmed = rawCmd.trim();

      if (
        trimmed === "clear" ||
        trimmed === "/clear" ||
        trimmed.toLowerCase() === "cls"
      ) {
        setInteractiveState(null);
        const prompt = formatShellPrompt(
          currentCwd,
          activeAgyModeRef.current || isAgyMode,
          activeShell,
        );
        setOutputLog(prompt);
        if (xtermRef.current && !isDisposedRef.current) {
          try {
            xtermRef.current.clear();
            xtermRef.current.write(prompt);
          } catch {
            // Ignore
          }
        }
        if (projectId) {
          apiClient
            .execTerminalCommand(projectId, sessionId, "clear", currentCwd)
            .catch(() => {});
        }
        focusCommandInput();
        return;
      }

      setIsExecuting(true);
      try {
        if (projectId) {
          const res = await apiClient.execTerminalCommand(
            projectId,
            sessionId,
            rawCmd,
            currentCwd,
          );
          const nextCwd = res.cwd || currentCwd;
          const nextShell =
            res.shell === "bash" || res.shell === "pwsh"
              ? res.shell
              : activeShell;
          setCurrentCwd(nextCwd);
          setActiveShell(nextShell);
          useTerminalStore.getState().updateTerminal(sessionId, { cwd: nextCwd });
          syncInteractiveStateFromResponse(res);
          const fallbackPrompt = formatShellPrompt(
            nextCwd,
            Boolean(
              typeof (res as any)?.isAgyMode === "boolean"
                ? (res as any).isAgyMode
                : activeAgyModeRef.current,
            ),
            nextShell,
          );
          const block =
            res.formattedOutput !== undefined
              ? res.formattedOutput
              : `${trimmed}\r\n${res.output || ""}${fallbackPrompt}`;
          appendToTerminalAndLog(block);
        } else {
          terminalSocket.emit("input", { sessionId, data: `${trimmed}\n` });
          const fallbackPrompt = formatShellPrompt(
            currentCwd,
            activeAgyModeRef.current || isAgyMode,
            activeShell,
          );
          appendToTerminalAndLog(`${trimmed}\r\n${fallbackPrompt}`);
        }
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to execute command";
        const fallbackPrompt = formatShellPrompt(
          currentCwd,
          activeAgyModeRef.current || isAgyMode,
          activeShell,
        );
        appendToTerminalAndLog(`${trimmed}\r\nError: ${msg}\r\n${fallbackPrompt}`);
      } finally {
        setIsExecuting(false);
        focusCommandInput();
      }
    },
    [
      activeShell,
      appendToTerminalAndLog,
      currentCwd,
      focusCommandInput,
      isAgyMode,
      projectId,
      sessionId,
      syncInteractiveStateFromResponse,
    ],
  );

  // Auto-enter AGY Interactive Session when user toggles AGY mode ON via the header button
  useEffect(() => {
    if (isAgyMode && !prevAgyModeRef.current) {
      prevAgyModeRef.current = true;
      activeAgyModeRef.current = true;
      executeAgyPrompt("__enter_agy_session__");
      focusCommandInput();
    } else if (!isAgyMode && prevAgyModeRef.current) {
      prevAgyModeRef.current = false;
      activeAgyModeRef.current = false;
      setInteractiveState(null);
      if (projectId) {
        void executeShellCommand("/exit");
      } else {
        const prompt = formatShellPrompt(currentCwd, false, activeShell);
        appendToTerminalAndLog(
          `\r\n[Exited AGY Interactive Session — ${activeShell === "pwsh" ? "PowerShell 7.6" : "bash"} active]\r\n${prompt}`,
        );
      }
      focusCommandInput();
    }
  }, [
    activeShell,
    isAgyMode,
    executeAgyPrompt,
    executeShellCommand,
    appendToTerminalAndLog,
    currentCwd,
    focusCommandInput,
    projectId,
  ]);

  // Sync external cwd changes (e.g. WorktreeSelector switch)
  useEffect(() => {
    if (cwd && cwd !== prevCwdRef.current) {
      prevCwdRef.current = cwd;
      setCurrentCwd(cwd);
      const prompt = formatShellPrompt(cwd, isAgyMode, activeShell);
      appendToTerminalAndLog(
        `\r\n[Switched working directory to ${cwd}]\r\n${prompt}`,
      );
    }
  }, [activeShell, cwd, isAgyMode, appendToTerminalAndLog]);

  // Register terminal-store callback
  useEffect(() => {
    registerOutputCallback(sessionId, (data: string) => {
      appendToTerminalAndLog(data);
    });
    return () => {
      unregisterOutputCallback(sessionId);
    };
  }, [sessionId, appendToTerminalAndLog]);

  // Initialize xterm
  useEffect(() => {
    if (!containerRef.current || xtermRef.current) return;
    isDisposedRef.current = false;

    const xterm = new XTerm({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 12,
      fontFamily:
        "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, monospace",
      lineHeight: 1.2,
      theme: DEFAULT_TERMINAL_THEME,
      allowProposedApi: true,
      scrollback: 10_000,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      window.open(uri, "_blank", "noopener,noreferrer");
    });
    const serializeAddon = new SerializeAddon();

    xterm.loadAddon(fitAddon);
    xterm.loadAddon(webLinksAddon);
    xterm.loadAddon(serializeAddon);
    xterm.open(containerRef.current);

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    // WebGL acceleration with fallback to canvas
    webglContextManager.register(sessionId, xterm);
    webglContextManager.acquire(sessionId);

    const initialDir = cwd || "~";
    xterm.write(
      [
        `PowerShell 7.6.7 (Aperant Interactive Shell — ${sessionId.slice(0, 8)})`,
        `PSReadLine PredictionSource: HistoryAndPlugin (→ / End to accept inline suggestion, F2 toggle ListView)`,
        `PS ${initialDir}> `,
      ].join("\r\n"),
    );

    // Initial fit
    requestAnimationFrame(() => {
      if (!isDisposedRef.current) fit();
    });

    // Send input to backend via Socket.IO
    const dataDisposable = xterm.onData((data) => {
      terminalSocket.emit("input", { sessionId, data });
    });

    // Notify backend on resize
    const resizeDisposable = xterm.onResize(({ cols, rows }) => {
      terminalSocket.emit("resize", { sessionId, cols, rows });
      onResize?.(cols, rows);
    });

    return () => {
      isDisposedRef.current = true;
      dataDisposable.dispose();
      resizeDisposable.dispose();
      webglContextManager.unregister(sessionId);
      xterm.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId, fit, onResize, cwd]);

  // Listen for output from backend via Socket.IO (both event names)
  useEffect(() => {
    const handleOutput = (data: { sessionId: string; data: string }) => {
      if (data.sessionId === sessionId && data.data) {
        appendToTerminalAndLog(data.data);
      }
    };

    terminalSocket.on("output", handleOutput);
    terminalSocket.on("terminal:output", handleOutput);
    return () => {
      terminalSocket.off("output", handleOutput);
      terminalSocket.off("terminal:output", handleOutput);
    };
  }, [sessionId, appendToTerminalAndLog]);

  // Resize observer for container size changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (!isDisposedRef.current) fit();
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [fit]);

  // Submit command or interactive prompt response (supports empty Enter when interactive prompt allows defaults!)
  const dispatchTerminalInput = useCallback(
    async (overrideInput?: string) => {
      if (isExecuting) return;
      const rawToUse =
        overrideInput !== undefined ? overrideInput : commandInput;
      const trimmed = rawToUse.trim();

      // If an interactive state is active, send the response (or selected option / empty Enter default) directly!
      if (interactiveState) {
        setCommandInput("");
        setHistoryCursor(-1);
        focusCommandInput();

        let payload = rawToUse;
        if (!trimmed) {
          if (
            interactiveState.options &&
            interactiveState.options.length > 0 &&
            interactiveState.kind === "menu"
          ) {
            payload = `__select:${selectedMenuIndexRef.current}__`;
          } else {
            payload = "__enter__";
          }
        }
        await executeShellCommand(payload);
        return;
      }

      // If no interactive state and user pressed Enter on an empty line, print a fresh prompt line like a real PTY
      if (!trimmed) {
        await executeShellCommand("__enter__");
        return;
      }

      // Record command in local history & PSReadLine suggestions immediately!
      setCommandHistory((prev) => {
        const filtered =
          prev[prev.length - 1] === trimmed ? prev : [...prev, trimmed];
        return filtered.slice(-100);
      });
      setPsHistorySuggestions((prev) => {
        const withoutDup = prev.filter(
          (item) => item.toLowerCase() !== trimmed.toLowerCase(),
        );
        return [trimmed, ...withoutDup].slice(0, 150);
      });
      setHistoryCursor(-1);
      setSelectedPredictionIndex(0);
      draftInputRef.current = "";
      setCommandInput("");
      focusCommandInput();

      const lower = trimmed.toLowerCase();
      const currentlyInAgyMode = activeAgyModeRef.current || isAgyMode;

      // Allow exiting AGY mode via `exit`, `/exit`, `quit`, `/quit`
      if (
        currentlyInAgyMode &&
        (lower === "exit" ||
          lower === "/exit" ||
          lower === "quit" ||
          lower === "/quit")
      ) {
        prevAgyModeRef.current = false;
        activeAgyModeRef.current = false;
        setLocalAgyMode(false);
        useTerminalStore.getState().setAgyMode(sessionId, false);
        useTerminalStore.getState().setTerminalStatus(sessionId, "running");
        await executeShellCommand("/exit");
        return;
      }

      // Allow clearing terminal in either mode
      if (lower === "clear" || lower === "/clear" || lower === "cls") {
        await executeShellCommand("clear");
        return;
      }

      // Allow running raw shell command inside AGY mode with `!` prefix
      if (trimmed.startsWith("!")) {
        await executeShellCommand(trimmed);
        return;
      }

      // Interactive slash commands, shell switchers & ssh-keygen work seamlessly in both modes
      if (
        lower.startsWith("/resume") ||
        lower.startsWith("/model") ||
        lower.startsWith("/mode") ||
        lower.startsWith("/permissions") ||
        lower.startsWith("/tasks") ||
        lower.startsWith("/worktree") ||
        lower === "/help" ||
        lower === "ssh-keygen" ||
        lower.startsWith("ssh-keygen ") ||
        lower === "pwsh" ||
        lower === "powershell" ||
        lower === "bash" ||
        lower === "/bin/bash" ||
        lower === "get-history"
      ) {
        await executeShellCommand(trimmed);
        return;
      }

      // If user is in standard shell mode and types `agy` or `ayg` (or `agy ...` / `ayg ...`),
      // immediately switch the frontend terminal into Interactive AGY Mode!
      const isAgyLaunchCmd =
        lower === "agy" ||
        lower === "ayg" ||
        lower.startsWith("agy ") ||
        lower.startsWith("ayg ");

      if (!currentlyInAgyMode && isAgyLaunchCmd) {
        prevAgyModeRef.current = true;
        activeAgyModeRef.current = true;
        setLocalAgyMode(true);
        useTerminalStore.getState().setAgyMode(sessionId, true);
        useTerminalStore.getState().setTerminalStatus(sessionId, "agy-active");
        const subPrompt = trimmed.replace(/^(agy|ayg)\s*/i, "").trim();
        await executeAgyPrompt(subPrompt || "__enter_agy_session__");
        return;
      }

      // When in Interactive AGY Mode, EVERY message ("HI", questions, instructions) goes directly to AGY!
      if (currentlyInAgyMode) {
        await executeAgyPrompt(trimmed);
      } else {
        await executeShellCommand(trimmed);
      }
    },
    [
      commandInput,
      executeAgyPrompt,
      executeShellCommand,
      focusCommandInput,
      interactiveState,
      isAgyMode,
      isExecuting,
      sessionId,
    ],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      await dispatchTerminalInput();
    },
    [dispatchTerminalInput],
  );

  // Move Up / Down in Interactive Menu, PSReadLine ListView, OR Command History
  const handleNavigateUpDown = useCallback(
    (direction: "up" | "down") => {
      // 1. If an interactive menu/confirm with options is active, move the option highlight!
      if (interactiveState?.options && interactiveState.options.length > 0) {
        const len = interactiveState.options.length;
        const delta = direction === "up" ? -1 : 1;
        const next = (selectedMenuIndexRef.current + delta + len) % len;
        selectedMenuIndexRef.current = next;
        setSelectedMenuIndex(next);
        if (projectId) {
          apiClient
            .execTerminalCommand(
              projectId,
              sessionId,
              direction === "up" ? "__key:up__" : "__key:down__",
              currentCwd,
            )
            .catch(() => {});
        }
        terminalSocket.emit("input", {
          sessionId,
          data: direction === "up" ? "\x1b[A" : "\x1b[B",
        });
        focusCommandInput();
        return;
      }

      // 2. If PSReadLine ListView is active and has matching predictions, cycle through them!
      if (
        predictionViewStyle === "ListView" &&
        matchingPredictions.length > 0
      ) {
        const len = matchingPredictions.length;
        const delta = direction === "up" ? -1 : 1;
        const next = (selectedPredictionIndex + delta + len) % len;
        setSelectedPredictionIndex(next);
        focusCommandInput();
        return;
      }

      // 3. Otherwise, navigate through commandHistory (seeded with PowerShell history)!
      const historyPool =
        commandHistory.length > 0
          ? commandHistory
          : [...mergedHistorySuggestions].slice(0, 40).reverse();
      if (historyPool.length === 0) return;

      if (direction === "up") {
        if (historyCursor === -1) {
          draftInputRef.current = commandInput;
          const nextIdx = historyPool.length - 1;
          setHistoryCursor(nextIdx);
          setCommandInput(historyPool[nextIdx]);
        } else if (historyCursor > 0) {
          const nextIdx = historyCursor - 1;
          setHistoryCursor(nextIdx);
          setCommandInput(historyPool[nextIdx]);
        }
      } else {
        if (historyCursor !== -1) {
          if (historyCursor < historyPool.length - 1) {
            const nextIdx = historyCursor + 1;
            setHistoryCursor(nextIdx);
            setCommandInput(historyPool[nextIdx]);
          } else {
            setHistoryCursor(-1);
            setCommandInput(draftInputRef.current);
          }
        }
      }
      focusCommandInput();
    },
    [
      commandHistory,
      commandInput,
      currentCwd,
      focusCommandInput,
      historyCursor,
      interactiveState,
      matchingPredictions,
      mergedHistorySuggestions,
      predictionViewStyle,
      projectId,
      selectedPredictionIndex,
      sessionId,
    ],
  );

  // Handle Tab Autocomplete (also accepts PSReadLine inline suggestion if present!)
  const handleTabAutocomplete = useCallback(async () => {
    if (isExecuting) return;

    if (!projectId) {
      if (inlineSuggestion) {
        acceptInlineSuggestion("full");
      }
      return;
    }

    try {
      const res = await apiClient.autocompleteTerminal(
        projectId,
        sessionId,
        commandInput,
        currentCwd,
      );
      if (
        Array.isArray(res?.historySuggestions) &&
        res.historySuggestions.length > 0
      ) {
        setPsHistorySuggestions(res.historySuggestions);
      }
      if (res?.completedInput && res.completedInput !== commandInput) {
        setCommandInput(res.completedInput);
      } else if (inlineSuggestion && inlineSuggestion !== commandInput) {
        setCommandInput(inlineSuggestion);
      } else if (
        Array.isArray(res?.completions) &&
        res.completions.length > 1
      ) {
        const prompt = formatShellPrompt(currentCwd, isAgyMode, activeShell);
        appendToTerminalAndLog(
          `${commandInput}\r\n${res.completions.join("  ")}\r\n${prompt}`,
        );
      }
    } catch {
      if (inlineSuggestion) {
        acceptInlineSuggestion("full");
      }
    } finally {
      focusCommandInput();
    }
  }, [
    acceptInlineSuggestion,
    activeShell,
    appendToTerminalAndLog,
    commandInput,
    currentCwd,
    focusCommandInput,
    inlineSuggestion,
    isAgyMode,
    isExecuting,
    projectId,
    sessionId,
  ]);

  // Handle Ctrl+C / Escape interrupt
  const handleInterrupt = useCallback(async () => {
    terminalSocket.emit("input", { sessionId, data: "\x03" });
    if (interactiveState) {
      setCommandInput("");
      await executeShellCommand("__ctrl_c__");
      return;
    }
    if (commandInput) {
      const cancelled = commandInput;
      setCommandInput("");
      const prompt = formatShellPrompt(currentCwd, isAgyMode, activeShell);
      appendToTerminalAndLog(`${cancelled}^C\r\n${prompt}`);
    } else {
      await executeShellCommand("__ctrl_c__");
    }
    focusCommandInput();
  }, [
    activeShell,
    appendToTerminalAndLog,
    commandInput,
    currentCwd,
    executeShellCommand,
    focusCommandInput,
    interactiveState,
    isAgyMode,
    sessionId,
  ]);

  // Unified keyboard handler for both the <input> bar AND direct typing on the <pre> terminal screen
  const handleTerminalKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      const isInputTarget = e.currentTarget === inputRef.current;

      // F2: Toggle PSReadLine PredictionViewStyle (InlineView <-> ListView)
      if (e.key === "F2") {
        e.preventDefault();
        setPredictionViewStyle((prev) =>
          prev === "InlineView" ? "ListView" : "InlineView",
        );
        setSelectedPredictionIndex(0);
        focusCommandInput();
        return;
      }

      // ArrowRight (`→`) or End: Accept PSReadLine inline history auto-suggestion!
      if (e.key === "ArrowRight" && inlineSuggestion && !interactiveState) {
        const inputEl = inputRef.current;
        const isCursorAtEnd =
          !isInputTarget ||
          !inputEl ||
          inputEl.selectionStart === null ||
          inputEl.selectionStart >= commandInput.length;

        if (isCursorAtEnd) {
          e.preventDefault();
          acceptInlineSuggestion(e.ctrlKey ? "word" : "full");
          return;
        }
      }

      if (e.key === "End" && inlineSuggestion && !interactiveState) {
        e.preventDefault();
        acceptInlineSuggestion("full");
        return;
      }

      if (
        e.altKey &&
        (e.key === "f" || e.key === "F") &&
        inlineSuggestion &&
        !interactiveState
      ) {
        e.preventDefault();
        acceptInlineSuggestion("word");
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        handleNavigateUpDown("up");
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        handleNavigateUpDown("down");
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        if (
          predictionViewStyle === "ListView" &&
          matchingPredictions.length > 0 &&
          matchingPredictions[selectedPredictionIndex] &&
          commandInput.trim() &&
          matchingPredictions[selectedPredictionIndex] !== commandInput
        ) {
          const picked = matchingPredictions[selectedPredictionIndex];
          setCommandInput(picked);
          setSelectedPredictionIndex(0);
          return;
        }
        void dispatchTerminalInput();
        return;
      }

      if (e.key === "Tab") {
        e.preventDefault();
        void handleTabAutocomplete();
        return;
      }

      if (e.key === "Escape") {
        if (interactiveState) {
          e.preventDefault();
          void handleInterrupt();
          return;
        }
        if (predictionViewStyle === "ListView") {
          e.preventDefault();
          setPredictionViewStyle("InlineView");
          return;
        }
        return;
      }

      if (e.ctrlKey && (e.key === "c" || e.key === "C")) {
        if (!window.getSelection()?.toString()) {
          e.preventDefault();
          void handleInterrupt();
        }
        return;
      }

      if (e.ctrlKey && (e.key === "l" || e.key === "L")) {
        e.preventDefault();
        void executeShellCommand("clear");
        return;
      }

      if (e.ctrlKey && (e.key === "u" || e.key === "U")) {
        e.preventDefault();
        setCommandInput("");
        return;
      }

      // If the user is typing directly while focused on the <pre> terminal viewport
      if (!isInputTarget) {
        if (e.key === "Backspace") {
          e.preventDefault();
          setCommandInput((prev) => prev.slice(0, -1));
          setSelectedPredictionIndex(0);
          focusCommandInput();
          return;
        }
        if (
          e.key.length === 1 &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          !isExecuting
        ) {
          e.preventDefault();
          setCommandInput((prev) => `${prev}${e.key}`);
          setSelectedPredictionIndex(0);
          focusCommandInput();
        }
      }
    },
    [
      acceptInlineSuggestion,
      commandInput,
      dispatchTerminalInput,
      executeShellCommand,
      focusCommandInput,
      handleInterrupt,
      handleNavigateUpDown,
      handleTabAutocomplete,
      inlineSuggestion,
      interactiveState,
      isExecuting,
      matchingPredictions,
      predictionViewStyle,
      selectedPredictionIndex,
    ],
  );

  const inlineDisplayInput = interactiveState?.maskInput
    ? "•".repeat(commandInput.length)
    : commandInput;

  const canSubmit =
    !isExecuting &&
    (Boolean(commandInput.trim()) ||
      Boolean(interactiveState?.allowEmpty) ||
      Boolean(interactiveState?.options?.length));

  return (
    <div
      className="flex h-full w-full flex-col bg-[#0B0B0F] text-[#E4E4E7]"
      data-testid={`terminal-panel-${sessionId}`}
      onClick={() => {
        if (!window.getSelection()?.toString()) {
          focusCommandInput();
        }
      }}
    >
      {/* Working directory status bar + PowerShell PSReadLine & AGY Quick command chips */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-[#12121A] px-2.5 py-1 text-xs">
        <div
          className="flex items-center gap-1.5 text-emerald-400 truncate max-w-[52%]"
          data-testid={`terminal-cwd-${sessionId}`}
          title={currentCwd}
        >
          <FolderOpen className="h-3 w-3 flex-shrink-0" />
          <span className="font-mono truncate">{currentCwd}</span>

          {/* Active Shell Indicator / Switcher (PowerShell 7.6 default vs Bash) */}
          <button
            type="button"
            disabled={isExecuting}
            data-testid={`terminal-shell-badge-${sessionId}`}
            onClick={(e) => {
              e.stopPropagation();
              const nextShell = activeShell === "pwsh" ? "bash" : "pwsh";
              void dispatchTerminalInput(nextShell);
            }}
            title="Click to switch between PowerShell 7 (pwsh) and Bash"
            className="ml-1 rounded bg-sky-500/20 px-1.5 py-0.5 font-mono text-xs font-semibold text-sky-300 border border-sky-500/35 hover:bg-sky-500/30"
          >
            {activeShell === "pwsh" ? "PS 7.6 (pwsh)" : "bash"}
          </button>

          {/* PSReadLine Prediction Mode Toggle (InlineView / ListView F2) */}
          <button
            type="button"
            data-testid={`terminal-psreadline-mode-${sessionId}`}
            onClick={(e) => {
              e.stopPropagation();
              setPredictionViewStyle((prev) =>
                prev === "InlineView" ? "ListView" : "InlineView",
              );
              focusCommandInput();
            }}
            title="Toggle PowerShell PSReadLine PredictionViewStyle (F2: InlineView / ListView)"
            className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs text-zinc-300 border border-white/15 hover:bg-white/15"
          >
            <History className="inline h-3 w-3 mr-1 text-emerald-400" />
            F2: {predictionViewStyle}
          </button>

          {onOpenVSCodeWeb && (
            <button
              type="button"
              data-testid={`terminal-cwd-vscode-btn-${sessionId}`}
              onClick={(e) => {
                e.stopPropagation();
                onOpenVSCodeWeb(currentCwd);
              }}
              title={`Open ${currentCwd} in local VS Code Online IDE`}
              className="flex items-center gap-1 rounded bg-sky-500/20 px-1.5 py-0.5 font-mono text-xs font-semibold text-sky-300 hover:bg-sky-500/30 transition-colors"
            >
              <Code2 className="h-3 w-3 flex-shrink-0" />
              <span>VS Code Web</span>
            </button>
          )}

          {isAgyMode && (
            <span
              className="ml-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-xs font-semibold text-emerald-300 border border-emerald-500/30"
              data-testid={`terminal-agy-badge-${sessionId}`}
            >
              ⚡ AGY (--dangerously-skip-permissions)
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <button
            type="button"
            disabled={isExecuting}
            data-testid={`terminal-slash-resume-${sessionId}`}
            onClick={(e) => {
              e.stopPropagation();
              void dispatchTerminalInput("/resume");
            }}
            className="rounded border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 font-mono text-xs text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
            title="Interactive session & task switcher (↑/↓ + Enter)"
          >
            /resume
          </button>
          <button
            type="button"
            disabled={isExecuting}
            data-testid={`terminal-slash-model-${sessionId}`}
            onClick={(e) => {
              e.stopPropagation();
              void dispatchTerminalInput("/model");
            }}
            className="rounded border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 font-mono text-xs text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
            title="Interactive AI model selector (↑/↓ + Enter)"
          >
            /model
          </button>
          <button
            type="button"
            disabled={isExecuting}
            data-testid={`terminal-agy-summarize-${sessionId}`}
            onClick={(e) => {
              e.stopPropagation();
              if (!isAgyMode) {
                prevAgyModeRef.current = true;
                activeAgyModeRef.current = true;
                setLocalAgyMode(true);
                useTerminalStore.getState().setAgyMode(sessionId, true);
                useTerminalStore
                  .getState()
                  .setTerminalStatus(sessionId, "agy-active");
              }
              executeAgyPrompt(
                "Summarize this project architecture, key files, and current status.",
              );
            }}
            className="flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 font-mono text-xs text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
          >
            <Zap className="h-3 w-3" />
            <span>AGY Summary</span>
          </button>
          <button
            type="button"
            disabled={isExecuting}
            data-testid={`terminal-agy-audit-${sessionId}`}
            onClick={(e) => {
              e.stopPropagation();
              if (!isAgyMode) {
                prevAgyModeRef.current = true;
                activeAgyModeRef.current = true;
                setLocalAgyMode(true);
                useTerminalStore.getState().setAgyMode(sessionId, true);
                useTerminalStore
                  .getState()
                  .setTerminalStatus(sessionId, "agy-active");
              }
              executeAgyPrompt(
                "Audit workspace files and check Program.cs for build readiness.",
              );
            }}
            className="rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-xs text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
          >
            AGY Audit
          </button>
          {QUICK_COMMANDS.map((preset) => (
            <button
              key={preset}
              type="button"
              disabled={isExecuting}
              data-testid={`terminal-preset-${preset.replace(/\s+/g, "-")}-${sessionId}`}
              onClick={(e) => {
                e.stopPropagation();
                executeShellCommand(preset);
              }}
              className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-xs text-zinc-300 hover:bg-white/15 hover:text-white disabled:opacity-50"
            >
              {preset}
            </button>
          ))}
        </div>
      </div>

      {/* Synchronized shell transcript & direct-input terminal viewport */}
      <div className="relative flex-1 min-h-[140px] overflow-hidden">
        {/* Hidden/background xterm canvas for WebGL/PTY compatibility */}
        <div
          ref={containerRef}
          className="pointer-events-none absolute inset-0 opacity-0"
          style={{ backgroundColor: DEFAULT_TERMINAL_THEME.background }}
        />
        {/* Direct-focusable, selectable, high-contrast interactive shell transcript */}
        <pre
          ref={transcriptRef}
          tabIndex={0}
          onFocus={() => setIsTerminalFocused(true)}
          onKeyDown={handleTerminalKeyDown}
          onPaste={(e) => {
            const pasted = e.clipboardData?.getData("text");
            if (pasted && !isExecuting) {
              e.preventDefault();
              setCommandInput((prev) => `${prev}${pasted.replace(/\r?\n/g, " ")}`);
              focusCommandInput();
            }
          }}
          data-testid={`terminal-output-log-${sessionId}`}
          className="h-full w-full overflow-y-auto p-3 font-mono text-xs leading-relaxed text-zinc-100 whitespace-pre-wrap break-words select-text cursor-text focus:outline-none"
        >
          <span>{outputLog}</span>
          {/* Live inline typing preview + blinking block cursor + PSReadLine Ghost-Text Auto-Suggestion right on the terminal prompt line */}
          <span className="text-emerald-300 font-semibold">{inlineDisplayInput}</span>
          {!isExecuting && (
            <span
              aria-hidden="true"
              className={`inline-block w-2 h-3.5 align-middle ml-0.5 ${
                isTerminalFocused
                  ? "bg-emerald-400 animate-pulse"
                  : "border border-emerald-400/60"
              }`}
            />
          )}
          {!interactiveState && inlineSuggestionSuffix && (
            <span
              data-testid={`terminal-ghost-suggestion-${sessionId}`}
              onClick={(e) => {
                e.stopPropagation();
                acceptInlineSuggestion("full");
              }}
              title="PSReadLine History Suggestion — Press Right Arrow (→) or End, or click to accept"
              className="text-zinc-400 italic cursor-pointer hover:text-emerald-300"
            >
              {inlineSuggestionSuffix}
              <span className="ml-2 not-italic rounded bg-white/10 px-1.5 py-0.5 text-xs text-zinc-300 border border-white/15">
                → / End
              </span>
            </span>
          )}

          {isThinking && (
            <span
              className="block mt-1 text-emerald-400 animate-pulse"
              data-testid={`terminal-agy-thinking-${sessionId}`}
            >
              ⏳ [AGY Thinking...] Processing with --dangerously-skip-permissions...
            </span>
          )}

          {/* PSReadLine History Prediction ListView (when F2 ListView is enabled or user wants dropdown history matches) */}
          {!interactiveState &&
            predictionViewStyle === "ListView" &&
            matchingPredictions.length > 0 && (
              <div
                data-testid={`terminal-psreadline-list-${sessionId}`}
                onClick={(e) => e.stopPropagation()}
                className="mt-2 rounded-md border border-sky-500/40 bg-[#121624] p-2 text-xs text-zinc-100 shadow-lg"
              >
                <div className="flex items-center justify-between border-b border-white/10 pb-1 mb-1.5 text-sky-300">
                  <span className="font-semibold">
                    PSReadLine History Predictions ({matchingPredictions.length})
                  </span>
                  <span className="text-zinc-300">
                    ↑/↓ Select · Enter/→ Accept · F2 InlineView
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  {matchingPredictions.map((pred, idx) => {
                    const isSelected = idx === selectedPredictionIndex;
                    return (
                      <button
                        key={`${idx}-${pred}`}
                        type="button"
                        data-testid={`terminal-psreadline-item-${idx}-${sessionId}`}
                        onMouseEnter={() => setSelectedPredictionIndex(idx)}
                        onClick={() => {
                          setCommandInput(pred);
                          focusCommandInput();
                        }}
                        className={`flex items-center justify-between rounded px-2 py-1 text-left font-mono text-xs ${
                          isSelected
                            ? "bg-sky-500/25 text-sky-200 border border-sky-500/40"
                            : "text-zinc-300 hover:bg-white/5"
                        }`}
                      >
                        <span className="truncate">
                          <span className="inline-block w-4 font-bold text-sky-400">
                            {isSelected ? "❯" : " "}
                          </span>
                          {pred}
                        </span>
                        <span className="text-zinc-300 ml-2 flex-shrink-0">
                          [History]
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

          {/* Interactive TUI Menu / Prompt Overlay directly inside the terminal screen */}
          {interactiveState && (
            <div
              data-testid={`terminal-interactive-widget-${sessionId}`}
              onClick={(e) => e.stopPropagation()}
              className="mt-2 rounded-md border border-emerald-500/40 bg-[#141622] p-2.5 text-xs text-zinc-100 shadow-lg"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-1.5 mb-2">
                <div className="flex items-center gap-1.5 font-semibold text-emerald-300">
                  <TerminalIcon className="h-3.5 w-3.5" />
                  <span>
                    {interactiveState.title || "Interactive Terminal Prompt"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-zinc-300">
                  {interactiveState.options &&
                    interactiveState.options.length > 0 && (
                      <span>↑/↓ Navigate · Enter Select</span>
                    )}
                  {interactiveState.allowEmpty && (
                    <button
                      type="button"
                      data-testid={`terminal-interactive-default-btn-${sessionId}`}
                      onClick={() => void dispatchTerminalInput("")}
                      className="rounded bg-emerald-600/30 border border-emerald-500/40 px-2 py-0.5 text-xs text-emerald-200 hover:bg-emerald-600/50"
                    >
                      ↵ Enter (Accept Default)
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid={`terminal-interactive-cancel-btn-${sessionId}`}
                    onClick={() => void handleInterrupt()}
                    className="rounded bg-red-500/20 border border-red-500/30 px-2 py-0.5 text-xs text-red-300 hover:bg-red-500/30"
                  >
                    Esc / Ctrl+C
                  </button>
                </div>
              </div>

              {interactiveState.options &&
              interactiveState.options.length > 0 ? (
                <div className="flex flex-col gap-1">
                  {interactiveState.options.map((opt, idx) => {
                    const isSelected = idx === selectedMenuIndex;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        data-testid={`terminal-interactive-option-${idx}-${sessionId}`}
                        onMouseEnter={() => setSelectedMenuIndex(idx)}
                        onClick={() => {
                          setSelectedMenuIndex(idx);
                          void dispatchTerminalInput(`__select:${idx}__`);
                        }}
                        className={`flex items-center justify-between gap-2 rounded px-2 py-1 text-left font-mono text-xs transition-colors ${
                          isSelected
                            ? "bg-emerald-500/25 text-emerald-200 border border-emerald-500/40"
                            : "text-zinc-300 hover:bg-white/5"
                        }`}
                      >
                        <span className="truncate">
                          <span className="inline-block w-4 font-bold text-emerald-400">
                            {isSelected ? "❯" : " "}
                          </span>
                          {idx + 1}. {opt.label}
                        </span>
                        {opt.description && (
                          <span className="text-zinc-300 truncate max-w-[45%]">
                            {opt.description}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2 text-zinc-200">
                  <span>{interactiveState.prompt}</span>
                  {interactiveState.defaultValue && (
                    <span className="text-zinc-300">
                      Default: {interactiveState.defaultValue}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </pre>
      </div>

      {/* Interactive Command & Key Action Bar */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-1.5 border-t border-white/10 bg-[#12121A] px-2.5 py-1.5"
      >
        <span
          className="font-mono text-xs font-semibold text-emerald-400 select-none"
          data-testid={`terminal-prompt-prefix-${sessionId}`}
        >
          {interactiveState
            ? "⌨ prompt>"
            : isAgyMode
              ? "⚡ agy>"
              : activeShell === "pwsh"
                ? "PS>"
                : "$"}
        </span>

        <div className="relative flex-1 flex items-center">
          <input
            ref={inputRef}
            type={interactiveState?.maskInput ? "password" : "text"}
            autoFocus
            value={commandInput}
            onFocus={() => setIsTerminalFocused(true)}
            onBlur={() => setIsTerminalFocused(false)}
            onChange={(e) => {
              setCommandInput(e.target.value);
              setHistoryCursor(-1);
              setSelectedPredictionIndex(0);
            }}
            onKeyDown={handleTerminalKeyDown}
            placeholder={
              interactiveState
                ? `${interactiveState.prompt} (Press Enter for default, ↑/↓ to navigate, Esc to cancel)`
                : isAgyMode
                  ? 'Chat with AGY, type "/resume" or "/model" (↑/↓), or "/exit" to quit...'
                  : 'PowerShell 7 (PSReadLine auto-suggest: type command, press → or End to accept, F2 ListView)...'
            }
            readOnly={isExecuting}
            data-testid={`terminal-command-input-${sessionId}`}
            className="w-full bg-transparent font-mono text-xs text-zinc-100 placeholder:text-zinc-400 focus:outline-none"
          />

          {/* Live PSReadLine Auto-Suggestion Accept Chip inside the input bar */}
          {!interactiveState && inlineSuggestion && (
            <button
              type="button"
              data-testid={`terminal-accept-suggestion-${sessionId}`}
              onClick={(e) => {
                e.stopPropagation();
                acceptInlineSuggestion("full");
              }}
              title={`Accept PSReadLine history suggestion: ${inlineSuggestion} (Right Arrow → or End)`}
              className="ml-1.5 flex items-center gap-1 rounded border border-sky-500/35 bg-sky-500/15 px-2 py-0.5 font-mono text-xs text-sky-200 hover:bg-sky-500/25 max-w-[45%] truncate flex-shrink-0"
            >
              <span className="truncate text-zinc-300">{inlineSuggestion}</span>
              <ArrowRight className="h-3 w-3 text-sky-300 flex-shrink-0" />
            </button>
          )}
        </div>

        {/* Interactive Hardware Key Controls (Up, Down, Right/Accept, Tab, Ctrl+C) */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={isExecuting}
            data-testid={`terminal-key-up-${sessionId}`}
            onClick={(e) => {
              e.stopPropagation();
              handleNavigateUpDown("up");
            }}
            title="Up Arrow (↑) — Previous history or menu item"
            className="flex items-center justify-center rounded border border-white/15 bg-white/5 px-1.5 py-1 font-mono text-xs text-zinc-200 hover:bg-white/15 disabled:opacity-40"
          >
            <ArrowUp className="h-3 w-3" />
          </button>
          <button
            type="button"
            disabled={isExecuting}
            data-testid={`terminal-key-down-${sessionId}`}
            onClick={(e) => {
              e.stopPropagation();
              handleNavigateUpDown("down");
            }}
            title="Down Arrow (↓) — Next history or menu item"
            className="flex items-center justify-center rounded border border-white/15 bg-white/5 px-1.5 py-1 font-mono text-xs text-zinc-200 hover:bg-white/15 disabled:opacity-40"
          >
            <ArrowDown className="h-3 w-3" />
          </button>
          <button
            type="button"
            disabled={isExecuting || !inlineSuggestion}
            data-testid={`terminal-key-right-${sessionId}`}
            onClick={(e) => {
              e.stopPropagation();
              acceptInlineSuggestion("full");
            }}
            title="Right Arrow (→) / End — Accept PSReadLine History Auto-Suggestion"
            className="flex items-center justify-center rounded border border-white/15 bg-white/5 px-1.5 py-1 font-mono text-xs text-zinc-200 hover:bg-white/15 disabled:opacity-40"
          >
            <ArrowRight className="h-3 w-3" />
          </button>
          <button
            type="button"
            disabled={isExecuting}
            data-testid={`terminal-key-tab-${sessionId}`}
            onClick={(e) => {
              e.stopPropagation();
              void handleTabAutocomplete();
            }}
            title="Tab — Autocomplete path, command, or history suggestion"
            className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 font-mono text-xs text-zinc-200 hover:bg-white/15 disabled:opacity-40"
          >
            Tab
          </button>
          <button
            type="button"
            disabled={isExecuting}
            data-testid={`terminal-key-ctrlc-${sessionId}`}
            onClick={(e) => {
              e.stopPropagation();
              void handleInterrupt();
            }}
            title="Ctrl+C — Interrupt or cancel interactive prompt"
            className="flex items-center gap-0.5 rounded border border-red-500/30 bg-red-500/15 px-1.5 py-0.5 font-mono text-xs text-red-300 hover:bg-red-500/25 disabled:opacity-40"
          >
            <XCircle className="h-3 w-3" />
            <span>^C</span>
          </button>
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          data-testid={`terminal-command-submit-${sessionId}`}
          className="flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
        >
          {isExecuting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : interactiveState ? (
            <CornerDownLeft className="h-3 w-3" />
          ) : (
            <Play className="h-3 w-3" />
          )}
          <span>
            {interactiveState
              ? "Enter"
              : isAgyMode
                ? "Ask AGY"
                : "Run"}
          </span>
        </button>
      </form>
    </div>
  );
}
