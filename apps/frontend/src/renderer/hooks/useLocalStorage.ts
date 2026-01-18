import { useState, useEffect, useCallback } from 'react';

/**
 * Hook that syncs state with localStorage for persistent storage across sessions.
 * Automatically handles JSON serialization/deserialization and provides
 * type-safe access to stored values.
 *
 * @param key - The localStorage key to store the value under
 * @param initialValue - The initial value to use if no stored value exists
 * @returns A tuple of [storedValue, setValue] similar to useState
 *
 * @example
 * ```tsx
 * // Store a simple boolean
 * const [isCollapsed, setIsCollapsed] = useLocalStorage('sidebar-collapsed', false);
 *
 * // Store an object
 * const [settings, setSettings] = useLocalStorage('user-settings', { theme: 'dark' });
 *
 * // Toggle the value
 * setIsCollapsed(prev => !prev);
 * ```
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  // Get initial value from localStorage or use the provided initial value
  const getStoredValue = useCallback((): T => {
    // Check if window is available (handles SSR/testing scenarios)
    if (typeof window === 'undefined') {
      return initialValue;
    }

    try {
      const item = window.localStorage.getItem(key);
      if (item === null) {
        return initialValue;
      }
      return JSON.parse(item) as T;
    } catch (error) {
      // If parsing fails, return initial value
      return initialValue;
    }
  }, [key, initialValue]);

  // State to store the current value
  const [storedValue, setStoredValue] = useState<T>(getStoredValue);

  // Update localStorage when the value changes
  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      try {
        // Allow value to be a function for same API as useState
        const valueToStore =
          value instanceof Function ? value(storedValue) : value;

        // Save to state
        setStoredValue(valueToStore);

        // Save to localStorage
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(key, JSON.stringify(valueToStore));
        }
      } catch (error) {
        // Silently fail if localStorage is not available or quota exceeded
      }
    },
    [key, storedValue]
  );

  // Listen for changes from other tabs/windows
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleStorageChange = (event: StorageEvent): void => {
      if (event.key === key && event.newValue !== null) {
        try {
          setStoredValue(JSON.parse(event.newValue) as T);
        } catch (error) {
          // Ignore parse errors
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [key]);

  return [storedValue, setValue];
}
