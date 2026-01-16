/**
 * Platform abstraction layer
 *
 * This module provides a unified API for accessing platform-specific functionality.
 * It automatically detects the current platform (Electron or Web) and returns
 * the appropriate adapter.
 */

import type { AppAPI, Platform, PlatformCapabilities } from './types';
import { isElectron, getElectronAdapter, getElectronCapabilities } from './electron-adapter';
import { isWeb, createWebAdapter, getWebCapabilities } from './web-adapter';

let cachedPlatform: Platform | null = null;
let cachedAppAPI: AppAPI | null = null;

/**
 * Detect the current platform
 *
 * Returns 'electron' if running in Electron, 'web' otherwise.
 * Result is cached for performance.
 */
export function getPlatform(): Platform {
  if (cachedPlatform !== null) {
    return cachedPlatform;
  }

  cachedPlatform = isElectron() ? 'electron' : 'web';
  return cachedPlatform;
}

/**
 * Get the AppAPI instance for the current platform
 *
 * Returns the Electron adapter if running in Electron,
 * or the Web adapter if running in a browser.
 * Result is cached for performance.
 */
export function getAppAPI(): AppAPI {
  if (cachedAppAPI !== null) {
    return cachedAppAPI;
  }

  const platform = getPlatform();

  if (platform === 'electron') {
    cachedAppAPI = getElectronAdapter();
  } else {
    cachedAppAPI = createWebAdapter();
  }

  return cachedAppAPI;
}

/**
 * Get the capabilities for the current platform
 */
export function getCapabilities(): PlatformCapabilities {
  const platform = getPlatform();

  if (platform === 'electron') {
    return getElectronCapabilities();
  }

  return getWebCapabilities();
}

/**
 * Reset cached values (useful for testing)
 */
export function resetPlatformCache(): void {
  cachedPlatform = null;
  cachedAppAPI = null;
}

// Re-export types and utilities
export type { AppAPI, Platform, PlatformCapabilities } from './types';
export { ELECTRON_CAPABILITIES, WEB_CAPABILITIES } from './types';
export { isElectron } from './electron-adapter';
export { isWeb } from './web-adapter';
