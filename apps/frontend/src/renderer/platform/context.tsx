/**
 * React context for platform abstraction
 *
 * Provides React hooks and context for accessing the AppAPI
 * and platform capabilities throughout the component tree.
 */

import React, { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { AppAPI, Platform, PlatformCapabilities } from './types';
import { getPlatform, getAppAPI, getCapabilities } from './index';

/**
 * Context value type
 */
interface AppAPIContextValue {
  api: AppAPI;
  platform: Platform;
  capabilities: PlatformCapabilities;
}

/**
 * Create the context with a default value
 * (will be overridden by the provider)
 */
const AppAPIContext = createContext<AppAPIContextValue | null>(null);

/**
 * Props for the AppAPIProvider
 */
interface AppAPIProviderProps {
  children: ReactNode;
  /** Optional API override for testing */
  api?: AppAPI;
  /** Optional platform override for testing */
  platform?: Platform;
  /** Optional capabilities override for testing */
  capabilities?: PlatformCapabilities;
}

/**
 * Provider component for AppAPI context
 *
 * Wrap your app with this provider to enable the useAppAPI,
 * usePlatform, and useCapabilities hooks.
 *
 * @example
 * ```tsx
 * <AppAPIProvider>
 *   <App />
 * </AppAPIProvider>
 * ```
 */
export function AppAPIProvider({
  children,
  api: overrideApi,
  platform: overridePlatform,
  capabilities: overrideCapabilities,
}: AppAPIProviderProps): React.ReactElement {
  const value = useMemo<AppAPIContextValue>(() => ({
    api: overrideApi ?? getAppAPI(),
    platform: overridePlatform ?? getPlatform(),
    capabilities: overrideCapabilities ?? getCapabilities(),
  }), [overrideApi, overridePlatform, overrideCapabilities]);

  return (
    <AppAPIContext.Provider value={value}>
      {children}
    </AppAPIContext.Provider>
  );
}

/**
 * Hook to access the AppAPI
 *
 * @returns The AppAPI instance for the current platform
 * @throws Error if used outside of AppAPIProvider
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const api = useAppAPI();
 *   const [projects, setProjects] = useState([]);
 *
 *   useEffect(() => {
 *     api.getProjects().then(result => {
 *       if (result.success) setProjects(result.data);
 *     });
 *   }, [api]);
 * }
 * ```
 */
export function useAppAPI(): AppAPI {
  const context = useContext(AppAPIContext);

  if (context === null) {
    throw new Error(
      'useAppAPI must be used within an AppAPIProvider. ' +
        'Wrap your app with <AppAPIProvider> to use this hook.'
    );
  }

  return context.api;
}

/**
 * Hook to get the current platform
 *
 * @returns 'electron' or 'web'
 * @throws Error if used outside of AppAPIProvider
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const platform = usePlatform();
 *
 *   return (
 *     <div>
 *       Running on: {platform}
 *     </div>
 *   );
 * }
 * ```
 */
export function usePlatform(): Platform {
  const context = useContext(AppAPIContext);

  if (context === null) {
    throw new Error(
      'usePlatform must be used within an AppAPIProvider. ' +
        'Wrap your app with <AppAPIProvider> to use this hook.'
    );
  }

  return context.platform;
}

/**
 * Hook to get platform capabilities
 *
 * Use this to conditionally render UI based on what the
 * current platform supports.
 *
 * @returns PlatformCapabilities object
 * @throws Error if used outside of AppAPIProvider
 *
 * @example
 * ```tsx
 * function TerminalButton() {
 *   const capabilities = useCapabilities();
 *
 *   if (!capabilities.supportsLocalTerminal) {
 *     return null; // Don't show terminal button on web
 *   }
 *
 *   return <button>Open Terminal</button>;
 * }
 * ```
 */
export function useCapabilities(): PlatformCapabilities {
  const context = useContext(AppAPIContext);

  if (context === null) {
    throw new Error(
      'useCapabilities must be used within an AppAPIProvider. ' +
        'Wrap your app with <AppAPIProvider> to use this hook.'
    );
  }

  return context.capabilities;
}

/**
 * Hook to check if a specific capability is supported
 *
 * Convenience hook for checking a single capability.
 *
 * @param capability The capability key to check
 * @returns boolean indicating if the capability is supported
 *
 * @example
 * ```tsx
 * function UpdateButton() {
 *   const supportsUpdates = useHasCapability('supportsAppUpdates');
 *
 *   if (!supportsUpdates) return null;
 *
 *   return <button>Check for Updates</button>;
 * }
 * ```
 */
export function useHasCapability(capability: keyof PlatformCapabilities): boolean {
  const capabilities = useCapabilities();
  return capabilities[capability];
}

export { AppAPIContext };
