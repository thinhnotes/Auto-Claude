/**
 * Browser mock / Web adapter for window.electronAPI
 * 
 * When running in a browser (not Electron), this module sets up
 * window.electronAPI to use the web adapter that makes real HTTP calls
 * to the Python backend.
 */

import type { ElectronAPI } from '../../shared/types';
import { createWebAdapter } from '../platform/web-adapter';

/**
 * Check if we're running in Electron (without circular dependency)
 * This checks for Electron-specific globals that exist before electronAPI is set
 */
function isRunningInElectron(): boolean {
  return (
    typeof window !== 'undefined' &&
    // Check for Electron-specific process object
    typeof (window as any).process !== 'undefined' &&
    (window as any).process?.versions?.electron !== undefined
  );
}

/**
 * Initialize browser API if not running in Electron
 * Uses the real web adapter to communicate with the Python backend
 */
export function initBrowserMock(): void {
  if (!isRunningInElectron()) {
    console.info('%c[Web Mode] Connecting to backend API...', 'color: #17a2b8; font-weight: bold;');
    const webAdapter = createWebAdapter();
    
    // Use Object.defineProperty to handle cases where electronAPI might already exist
    try {
      Object.defineProperty(window, 'electronAPI', {
        value: webAdapter,
        writable: true,
        configurable: true,
      });
    } catch {
      // Fallback: try direct assignment if defineProperty fails
      try {
        (window as any).electronAPI = webAdapter;
      } catch (e) {
        console.warn('[Web Mode] Could not set electronAPI:', e);
      }
    }
    
    console.info('%c[Web Mode] API adapter initialized', 'color: #28a745; font-weight: bold;');
  }
}

// Auto-initialize
initBrowserMock();
