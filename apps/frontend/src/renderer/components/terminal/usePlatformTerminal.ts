/**
 * Platform Terminal Hook
 * 
 * This hook automatically selects between Electron PTY and Web WebSocket terminal
 * based on the current platform.
 */

import { useCallback, useRef, type RefObject } from 'react';
import type { Terminal as XTerm } from '@xterm/xterm';
import { usePtyProcess } from './usePtyProcess';
import { useWebTerminal } from './useWebTerminal';

interface UsePlatformTerminalOptions {
  terminalId: string;
  xterm: XTerm | null;
  cwd?: string;
  projectPath?: string;
  cols: number;
  rows: number;
  skipCreation?: boolean;
  isRecreatingRef?: RefObject<boolean>;
  onCreated?: () => void;
  onError?: (error: string) => void;
  onOutput?: (data: string) => void;
  onExit?: (code: number) => void;
}

/**
 * Check if we're running in web mode (not Electron)
 */
function isWebMode(): boolean {
  if (typeof window === 'undefined') return false;
  
  // Check for Electron
  const electronAPI = (window as any).electronAPI;
  if (electronAPI?.isElectron) return false;
  
  // Check if we have the web platform marker
  if (electronAPI?.platform === 'web') return true;
  
  // Fallback: check for navigator.userAgent patterns
  const isElectron = /electron/i.test(navigator.userAgent);
  return !isElectron;
}

export function usePlatformTerminal({
  terminalId,
  xterm,
  cwd,
  projectPath,
  cols,
  rows,
  skipCreation = false,
  isRecreatingRef,
  onCreated,
  onError,
  onOutput,
  onExit,
}: UsePlatformTerminalOptions) {
  const isWeb = isWebMode();
  
  // Web mode: use WebSocket terminal
  const webTerminal = useWebTerminal({
    terminalId,
    xterm,
    cwd,
    cols,
    rows,
    onCreated: isWeb ? onCreated : undefined,
    onError: isWeb ? onError : undefined,
    onExit: isWeb ? onExit : undefined,
  });
  
  // Electron mode: use PTY process
  const ptyProcess = usePtyProcess({
    terminalId,
    cwd,
    projectPath,
    cols,
    rows,
    skipCreation: isWeb || skipCreation,
    isRecreatingRef,
    onCreated: !isWeb ? onCreated : undefined,
    onError: !isWeb ? onError : undefined,
  });
  
  // Return unified interface
  if (isWeb) {
    return {
      isWeb: true,
      isConnected: webTerminal.isConnected,
      isCreating: webTerminal.isCreating,
      sendInput: webTerminal.sendInput,
      resize: webTerminal.resize,
      destroy: webTerminal.destroy,
      prepareForRecreate: async () => {
        await webTerminal.destroy();
      },
      resetForRecreate: () => {
        // Web terminals don't need this
      },
    };
  }
  
  return {
    isWeb: false,
    isConnected: true, // PTY is always "connected" once created
    isCreating: false,
    sendInput: (data: string) => {
      window.electronAPI.sendTerminalInput(terminalId, data);
    },
    resize: (newCols: number, newRows: number) => {
      window.electronAPI.resizeTerminal(terminalId, newCols, newRows);
    },
    destroy: async () => {
      await window.electronAPI.destroyTerminal(terminalId);
    },
    prepareForRecreate: ptyProcess.prepareForRecreate,
    resetForRecreate: ptyProcess.resetForRecreate,
  };
}

export default usePlatformTerminal;
