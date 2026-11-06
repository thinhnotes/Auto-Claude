/**
 * Cloud Mode Detection + Dynamic Domain & Token Resolution
 *
 * Self-hosted mode (default):
 * - Next.js rewrites `/api/*` and `/v1/*` directly to `http://127.0.0.1:8001`,
 *   allowing Same-Origin REST API calls on any domain (`multica.notesvnn.click`,
 *   `deeptutor.notesvnn.click`, `aperant.notesvnn.click`, or `localhost:3000`).
 * - Socket.IO connects to `https://deeptutor-api.notesvnn.click` when accessed
 *   via `*.notesvnn.click`, or `http://127.0.0.1:8001` when accessed locally.
 */

export const isCloudMode: boolean = Boolean(
  process.env.NEXT_PUBLIC_CONVEX_URL,
);

export const CLOUD_MODE: boolean = isCloudMode;

export const isSelfHosted: boolean = !isCloudMode;

export const API_TOKEN: string =
  process.env.NEXT_PUBLIC_API_TOKEN ?? "aperant-local-web-token";

export function getApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    // Use same-origin Next.js rewrite proxy (/api/* -> 127.0.0.1:8001/api/*)
    return "";
  }
  return process.env.BACKEND_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8001";
}

export function getSocketBaseUrl(): string {
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host.endsWith(".notesvnn.click") || host === "notesvnn.click") {
      return process.env.NEXT_PUBLIC_PUBLIC_SOCKET_URL ?? "https://deeptutor-api.notesvnn.click";
    }
    return `http://${host}:8001`;
  }
  return process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://127.0.0.1:8001";
}

export const API_URL: string =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export const SOCKET_URL: string =
  process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:8000";

export const CONVEX_URL: string =
  process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

export const CONVEX_SITE_URL: string =
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "";
