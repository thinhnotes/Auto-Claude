import { useState, useEffect, useCallback } from 'react';

/**
 * Common breakpoint values for responsive design.
 * These follow standard responsive design conventions.
 */
export const BREAKPOINTS = {
  /** Extra small devices (phones, 480px and below) */
  xs: 480,
  /** Small devices (large phones, 640px and below) */
  sm: 640,
  /** Medium devices (tablets, 768px and below) */
  md: 768,
  /** Large devices (laptops, 1024px and below) */
  lg: 1024,
  /** Extra large devices (desktops, 1280px and below) */
  xl: 1280,
  /** 2x Extra large devices (large desktops, 1536px and below) */
  '2xl': 1536,
} as const;

export type BreakpointKey = keyof typeof BREAKPOINTS;

/**
 * Hook that listens to a CSS media query and returns whether it matches.
 * Automatically updates when the viewport changes and the match status changes.
 *
 * @param query - The CSS media query string to evaluate (e.g., "(max-width: 768px)")
 * @returns boolean indicating whether the media query currently matches
 *
 * @example
 * ```tsx
 * // Check if viewport is mobile-sized
 * const isMobile = useMediaQuery('(max-width: 768px)');
 *
 * // Check for dark mode preference
 * const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
 * ```
 */
export function useMediaQuery(query: string): boolean {
  // Initialize with a function to handle SSR and avoid hydration mismatch
  const getMatches = useCallback((): boolean => {
    // Check if window is available (handles SSR/testing scenarios)
    if (typeof window === 'undefined') {
      return false;
    }
    return window.matchMedia(query).matches;
  }, [query]);

  const [matches, setMatches] = useState<boolean>(getMatches);

  useEffect(() => {
    // Check if window is available
    if (typeof window === 'undefined') {
      return;
    }

    const mediaQueryList = window.matchMedia(query);

    // Update state to current value
    setMatches(mediaQueryList.matches);

    // Handler for media query changes
    const handleChange = (event: MediaQueryListEvent): void => {
      setMatches(event.matches);
    };

    // Modern browsers support addEventListener
    mediaQueryList.addEventListener('change', handleChange);

    // Cleanup listener on unmount or query change
    return () => {
      mediaQueryList.removeEventListener('change', handleChange);
    };
  }, [query]);

  return matches;
}

/**
 * Hook that returns whether the viewport is below a specific breakpoint.
 * This is a convenience wrapper around useMediaQuery for common responsive patterns.
 *
 * @param breakpoint - The breakpoint key to check against (xs, sm, md, lg, xl, 2xl)
 * @returns boolean indicating whether the viewport width is at or below the breakpoint
 *
 * @example
 * ```tsx
 * // Check if viewport is tablet-sized or smaller
 * const isTabletOrSmaller = useBreakpoint('md');
 *
 * // Conditionally render based on screen size
 * if (isTabletOrSmaller) {
 *   return <MobileLayout />;
 * }
 * ```
 */
export function useBreakpoint(breakpoint: BreakpointKey): boolean {
  const width = BREAKPOINTS[breakpoint];
  return useMediaQuery(`(max-width: ${width}px)`);
}

/**
 * Hook that returns whether the viewport is above a specific breakpoint.
 * Useful for showing content only on larger screens.
 *
 * @param breakpoint - The breakpoint key to check against (xs, sm, md, lg, xl, 2xl)
 * @returns boolean indicating whether the viewport width is above the breakpoint
 *
 * @example
 * ```tsx
 * // Check if viewport is larger than tablet
 * const isDesktop = useBreakpointUp('md');
 *
 * // Show sidebar only on desktop
 * {isDesktop && <Sidebar />}
 * ```
 */
export function useBreakpointUp(breakpoint: BreakpointKey): boolean {
  const width = BREAKPOINTS[breakpoint];
  return useMediaQuery(`(min-width: ${width + 1}px)`);
}

/**
 * Hook that provides responsive state information for common breakpoints.
 * Returns an object with boolean flags for each standard breakpoint.
 *
 * @returns Object with boolean flags indicating current responsive state
 *
 * @example
 * ```tsx
 * const { isMobile, isTablet, isDesktop } = useResponsive();
 *
 * return (
 *   <div className={isMobile ? 'mobile-layout' : 'desktop-layout'}>
 *     {!isMobile && <Sidebar />}
 *     <Content />
 *   </div>
 * );
 * ```
 */
export function useResponsive() {
  const isMobile = useMediaQuery(`(max-width: ${BREAKPOINTS.sm}px)`);
  const isTablet = useMediaQuery(
    `(min-width: ${BREAKPOINTS.sm + 1}px) and (max-width: ${BREAKPOINTS.lg}px)`
  );
  const isDesktop = useMediaQuery(`(min-width: ${BREAKPOINTS.lg + 1}px)`);

  return {
    /** Viewport is mobile-sized (640px and below) */
    isMobile,
    /** Viewport is tablet-sized (641px to 1024px) */
    isTablet,
    /** Viewport is desktop-sized (1025px and above) */
    isDesktop,
    /** Viewport is tablet or smaller (1024px and below) */
    isTabletOrSmaller: isMobile || isTablet,
    /** Viewport is tablet or larger (641px and above) */
    isTabletOrLarger: isTablet || isDesktop,
  };
}
