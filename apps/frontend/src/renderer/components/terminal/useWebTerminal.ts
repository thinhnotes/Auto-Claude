/**
 * Web Terminal Hook
 * 
 * This hook provides WebSocket-based terminal functionality for web mode.
 * It connects to the backend PTY via WebSocket for real-time I/O.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import type { Terminal as XTerm } from '@xterm/xterm';

interface UseWebTerminalOptions {
  terminalId: string;
  xterm: XTerm | null;
  cwd?: string;
  cols: number;
  rows: number;
  onCreated?: () => void;
  onError?: (error: string) => void;
  onExit?: (code: number) => void;
}

interface WebTerminalInfo {
  wsUrl: string;
  id: string;
  pid: number;
  name: string;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  ws?: WebSocket;
}

/**
 * Check if we're running in web mode
 */
function isWebMode(): boolean {
  return typeof window !== 'undefined' && 
    !('electronAPI' in window && (window as any).electronAPI?.isElectron);
}

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
 * Get the WebSocket base URL for terminal connections
 */
function getWsBaseUrl(): string {
  return getApiBaseUrl().replace('http', 'ws');
}

export function useWebTerminal({
  terminalId,
  xterm,
  cwd,
  cols,
  rows,
  onCreated,
  onError,
  onExit,
}: UseWebTerminalOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const backendTerminalIdRef = useRef<string | null>(null);

  // Create terminal and connect WebSocket
  const createTerminal = useCallback(async () => {
    if (!isWebMode()) return;
    if (isCreating || wsRef.current) return;
    
    setIsCreating(true);
    
    try {
      // Create terminal on backend
      const response = await fetch(`${getApiBaseUrl()}/api/terminals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cwd: cwd || '/home',
          name: `Terminal ${terminalId}`,
          cols,
          rows,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to create terminal: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to create terminal');
      }
      
      const backendTerminalId = result.data.id;
      backendTerminalIdRef.current = backendTerminalId;
      
      // Connect WebSocket
      const wsUrl = `${getWsBaseUrl()}/api/terminals/${backendTerminalId}/ws`;
      const ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        console.log(`[WebTerminal] Connected to ${backendTerminalId}`);
        setIsConnected(true);
        
        // Store WebSocket reference for sendTerminalInput
        (window as any).__webTerminals = (window as any).__webTerminals || {};
        (window as any).__webTerminals[terminalId] = {
          ...result.data,
          wsUrl,
          ws,
          backendId: backendTerminalId,
        };
        
        onCreated?.();
      };
      
      ws.onmessage = (event) => {
        if (xterm) {
          // Check if it's a JSON message (like exit notification)
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'exit') {
              console.log(`[WebTerminal] Process exited with code ${data.code}`);
              onExit?.(data.code);
              return;
            }
          } catch {
            // Not JSON, treat as terminal output
          }
          
          // Write terminal output
          xterm.write(event.data);
        }
      };
      
      ws.onerror = (event) => {
        console.error('[WebTerminal] WebSocket error:', event);
        onError?.('WebSocket connection error');
      };
      
      ws.onclose = (event) => {
        console.log(`[WebTerminal] WebSocket closed: ${event.code} ${event.reason}`);
        setIsConnected(false);
        wsRef.current = null;
        
        // Clean up tracking
        if ((window as any).__webTerminals?.[terminalId]) {
          delete (window as any).__webTerminals[terminalId];
        }
        
        if (event.code !== 1000) {
          // Abnormal close
          onExit?.(-1);
        }
      };
      
      wsRef.current = ws;
      
    } catch (error) {
      console.error('[WebTerminal] Failed to create terminal:', error);
      onError?.(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsCreating(false);
    }
  }, [terminalId, cwd, cols, rows, xterm, onCreated, onError, onExit, isCreating]);

  // Send input to terminal
  const sendInput = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
    }
  }, []);

  // Resize terminal
  const resize = useCallback((newCols: number, newRows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'resize', cols: newCols, rows: newRows }));
    }
  }, []);

  // Destroy terminal
  const destroy = useCallback(async () => {
    if (wsRef.current) {
      wsRef.current.close(1000, 'Terminal destroyed');
      wsRef.current = null;
    }
    
    if (backendTerminalIdRef.current) {
      try {
        await fetch(`${getApiBaseUrl()}/api/terminals/${backendTerminalIdRef.current}`, {
          method: 'DELETE',
        });
      } catch (error) {
        console.error('[WebTerminal] Failed to destroy terminal:', error);
      }
      backendTerminalIdRef.current = null;
    }
    
    // Clean up tracking
    if ((window as any).__webTerminals?.[terminalId]) {
      delete (window as any).__webTerminals[terminalId];
    }
    
    setIsConnected(false);
  }, [terminalId]);

  // Create terminal on mount
  useEffect(() => {
    if (xterm && cols > 0 && rows > 0) {
      createTerminal();
    }
    
    return () => {
      // Don't auto-destroy on unmount, let the component handle it
    };
  }, [xterm, cols, rows, createTerminal]);

  // Handle xterm input
  useEffect(() => {
    if (!xterm || !isConnected) return;
    
    const disposable = xterm.onData((data) => {
      sendInput(data);
    });
    
    return () => {
      disposable.dispose();
    };
  }, [xterm, isConnected, sendInput]);

  // Handle resize
  useEffect(() => {
    if (isConnected && cols > 0 && rows > 0) {
      resize(cols, rows);
    }
  }, [cols, rows, isConnected, resize]);

  return {
    isConnected,
    isCreating,
    sendInput,
    resize,
    destroy,
  };
}

export default useWebTerminal;
