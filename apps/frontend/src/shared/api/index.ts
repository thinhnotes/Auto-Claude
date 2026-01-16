/**
 * Shared API types and utilities
 *
 * This module exports the platform-agnostic API interfaces that can be used
 * by both Electron and Web adapters.
 */

export type {
  AppAPI,
  PlatformCapabilities,
  ElectronAPI,
} from './app-api';

export {
  ELECTRON_CAPABILITIES,
  WEB_CAPABILITIES,
} from './app-api';
