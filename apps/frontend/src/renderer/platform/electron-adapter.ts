/**
 * Electron adapter for AppAPI
 *
 * This adapter wraps the window.electronAPI exposed via preload scripts
 * to provide full native desktop functionality.
 */

import type { AppAPI, PlatformCapabilities } from './types';
import { ELECTRON_CAPABILITIES } from './types';

/**
 * Check if running in Electron environment
 */
export function isElectron(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.electronAPI !== undefined &&
    typeof window.electronAPI === 'object'
  );
}

/**
 * Get the Electron API adapter
 *
 * Returns the window.electronAPI exposed via preload scripts.
 * Throws an error if not running in Electron.
 */
export function getElectronAdapter(): AppAPI {
  if (!isElectron()) {
    throw new Error(
      'Electron adapter called but not running in Electron environment. ' +
        'Use getPlatform() to check the current platform before calling this.'
    );
  }

  return window.electronAPI;
}

/**
 * Get Electron platform capabilities
 *
 * Electron supports all native capabilities.
 */
export function getElectronCapabilities(): PlatformCapabilities {
  return ELECTRON_CAPABILITIES;
}
