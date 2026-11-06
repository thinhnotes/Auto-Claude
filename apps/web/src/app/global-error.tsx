'use client';

/**
 * Next.js global error boundary.
 *
 * NOTE: Strings are intentionally hardcoded here rather than using i18n
 * because this component renders as a full HTML document when the root
 * layout itself crashes. At that point the i18n provider is unavailable,
 * so translation keys would not resolve. Keeping plain strings ensures
 * the user always sees a meaningful fallback regardless of provider state.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <h2>Something went wrong</h2>
        <button onClick={() => reset()}>Try again</button>
      </body>
    </html>
  );
}
