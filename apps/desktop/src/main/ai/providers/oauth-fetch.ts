/**
 * Generic OAuth Fetch Interceptor
 *
 * Data-driven OAuth token management for file-based OAuth providers.
 * Adding a new OAuth provider = adding an entry to OAUTH_PROVIDER_REGISTRY.
 *
 * Works in both main thread and worker threads since it operates
 * on a pre-resolved token file path (no Electron APIs needed).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// =============================================================================
// Debug Logging
// =============================================================================

const DEBUG = process.env.DEBUG === 'true' || process.argv.includes('--debug');

function debugLog(message: string, data?: unknown): void {
  if (!DEBUG) return;
  const prefix = `[OAuthFetch ${new Date().toISOString()}]`;
  if (data !== undefined) {
    console.log(prefix, message, data);
  } else {
    console.log(prefix, message);
  }
}

// =============================================================================
// OAuth Provider Registry
// =============================================================================

interface OAuthProviderSpec {
  /** Token endpoint for refresh_token grant */
  tokenEndpoint: string;
  /** OAuth client ID */
  clientId: string;
  /** Extra headers injected on every API request */
  extraHeaders?: Record<string, string>;
  /** Rewrite the request URL (e.g., to a subscription-specific endpoint) */
  rewriteUrl?: (url: string) => string;
}

const CODEX_API_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';
const COPILOT_TOKEN_EXCHANGE_ENDPOINT = 'https://api.github.com/copilot_internal/v2/token';

export const COPILOT_DEFAULT_HEADERS: Record<string, string> = {
  'Copilot-Integration-Id': 'vscode-chat',
  'Editor-Version': 'vscode/1.99.0',
  'Editor-Plugin-Version': 'copilot-chat/0.26.0',
};

export const OAUTH_PROVIDER_REGISTRY: Record<string, OAuthProviderSpec> = {
  openai: {
    tokenEndpoint: 'https://auth.openai.com/oauth/token',
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    rewriteUrl: (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname.includes('/chat/completions') || parsed.pathname.includes('/v1/responses')) {
        return CODEX_API_ENDPOINT;
      }
      return url;
    },
  },
  'github-copilot': {
    tokenEndpoint: COPILOT_TOKEN_EXCHANGE_ENDPOINT,
    clientId: 'Iv1.b507a08c87ecfe98',
    extraHeaders: COPILOT_DEFAULT_HEADERS,
  },
  antigravity: {
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    clientId: 'antigravity-cli',
  },
};

/**
 * Discover a GitHub OAuth token from local GitHub Copilot CLI / IDE config files
 * (`~/.config/github-copilot/hosts.json` or `apps.json`).
 */
export function discoverLocalGitHubCopilotOAuthToken(): string | null {
  const home = os.homedir();
  if (!home) return null;

  const candidates = [
    path.join(home, '.config', 'github-copilot', 'hosts.json'),
    path.join(home, '.config', 'github-copilot', 'apps.json'),
  ];

  for (const filePath of candidates) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, { oauth_token?: string }>;
      for (const [key, entry] of Object.entries(parsed)) {
        if (key.includes('github.com') && entry?.oauth_token) {
          return entry.oauth_token;
        }
      }
    } catch {
      // Ignore missing or unreadable files
    }
  }

  return null;
}

/**
 * Discover local Antigravity CLI (`agy`) credentials or gateway config from
 * `~/.gemini/antigravity-cli/settings.json`.
 */
export function discoverLocalAntigravityAuth(): { apiKey?: string; baseURL?: string } | null {
  const home = os.homedir();
  if (!home) return null;

  const settingsPath = path.join(home, '.gemini', 'antigravity-cli', 'settings.json');
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const apiKey =
      (typeof parsed.apiKey === 'string' && parsed.apiKey) ||
      (typeof parsed.googleApiKey === 'string' && parsed.googleApiKey) ||
      (typeof parsed.accessToken === 'string' && parsed.accessToken) ||
      undefined;
    const baseURL =
      (typeof parsed.baseURL === 'string' && parsed.baseURL) ||
      (typeof parsed.endpoint === 'string' && parsed.endpoint) ||
      undefined;
    if (apiKey || baseURL) {
      return { apiKey, baseURL };
    }
  } catch {
    // Ignore missing settings.json
  }

  return null;
}

// =============================================================================
// Token File I/O
// =============================================================================

interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix ms
}

/** How far before expiry to consider a token "near expiry" and trigger refresh */
const REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

function readTokenFile(tokenFilePath: string): StoredTokens | null {
  try {
    const raw = fs.readFileSync(tokenFilePath, 'utf8');
    const tokens = JSON.parse(raw) as StoredTokens;
    debugLog('Read token file', { path: tokenFilePath, expiresAt: tokens.expires_at });
    return tokens;
  } catch {
    debugLog('Failed to read token file', { path: tokenFilePath });
    return null;
  }
}

function writeTokenFile(tokenFilePath: string, tokens: StoredTokens): void {
  // CodeQL: network data validated before write - validate token fields match expected StoredTokens schema
  const safeTokens: StoredTokens = {
    access_token: typeof tokens.access_token === 'string' ? tokens.access_token : '',
    refresh_token: typeof tokens.refresh_token === 'string' ? tokens.refresh_token : '',
    expires_at: typeof tokens.expires_at === 'number' ? tokens.expires_at : 0,
  };
  fs.writeFileSync(tokenFilePath, JSON.stringify(safeTokens, null, 2), 'utf8');
  try {
    fs.chmodSync(tokenFilePath, 0o600);
  } catch {
    // chmod may fail on Windows; non-critical
  }
  debugLog('Wrote tokens to file', { path: tokenFilePath, expiresAt: tokens.expires_at });
}

// =============================================================================
// Token Refresh
// =============================================================================

async function refreshOAuthToken(
  refreshToken: string,
  providerSpec: OAuthProviderSpec,
  tokenFilePath: string,
): Promise<string | null> {
  debugLog('Refreshing OAuth token');

  // GitHub Copilot exchanges a long-lived GitHub OAuth token (refresh_token) via GET with Bearer header
  if (providerSpec.tokenEndpoint === COPILOT_TOKEN_EXCHANGE_ENDPOINT) {
    const ghToken = refreshToken || discoverLocalGitHubCopilotOAuthToken();
    if (!ghToken) return null;

    const response = await fetch(COPILOT_TOKEN_EXCHANGE_ENDPOINT, {
      method: 'GET',
      headers: {
        Authorization: `token ${ghToken}`,
        Accept: 'application/json',
        ...COPILOT_DEFAULT_HEADERS,
      },
    });

    if (!response.ok) {
      debugLog('GitHub Copilot token exchange failed', { status: response.status });
      return null;
    }

    const data = (await response.json()) as { token?: string; expires_at?: number };
    if (!data.token) return null;

    const expiresAt = typeof data.expires_at === 'number'
      ? data.expires_at * 1000
      : Date.now() + 25 * 60 * 1000;

    writeTokenFile(tokenFilePath, {
      access_token: data.token,
      refresh_token: ghToken,
      expires_at: expiresAt,
    });

    return data.token;
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: providerSpec.clientId,
  });

  const response = await fetch(providerSpec.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  debugLog('Token refresh response', { status: response.status, ok: response.ok });

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`;
    try {
      const errorData = await response.json() as Record<string, string>;
      errorMessage = errorData.error_description ?? errorData.error ?? errorMessage;
    } catch {
      // Ignore parse errors
    }
    debugLog('Token refresh failed', { error: errorMessage });
    return null;
  }

  const data = await response.json() as Record<string, unknown>;
  debugLog('Token refresh success', {
    hasAccessToken: !!data.access_token,
    hasNewRefreshToken: !!data.refresh_token,
    expiresIn: data.expires_in,
  });

  if (!data.access_token || typeof data.access_token !== 'string') {
    debugLog('Token refresh response missing access_token');
    return null;
  }

  // Token rotation: new refresh token may be issued
  const newRefreshToken =
    typeof data.refresh_token === 'string' ? data.refresh_token : refreshToken;
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
  const expiresAt = Date.now() + expiresIn * 1000;

  writeTokenFile(tokenFilePath, {
    access_token: data.access_token,
    refresh_token: newRefreshToken,
    expires_at: expiresAt,
  });

  return data.access_token;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Detect the OAuth provider from a token file path.
 * Falls back to 'openai' (the only provider currently).
 */
function detectProvider(provider?: string): OAuthProviderSpec | undefined {
  const key = provider ?? 'openai';
  return OAUTH_PROVIDER_REGISTRY[key];
}

/**
 * Ensure a valid OAuth access token is available from the given token file.
 *
 * - Returns null if no tokens are stored.
 * - If the token expires within 5 minutes, auto-refreshes.
 * - Returns the valid access token.
 *
 * Works in both main thread and worker threads (no Electron APIs needed).
 */
export async function ensureValidOAuthToken(
  tokenFilePath: string,
  provider?: string,
): Promise<string | null> {
  debugLog('Ensuring valid OAuth token', { path: tokenFilePath, provider });

  const stored = readTokenFile(tokenFilePath);
  if (!stored) {
    debugLog('No stored tokens — returning null');
    return null;
  }

  const expiresIn = stored.expires_at - Date.now();
  debugLog('Token expiry check', { expiresInMs: expiresIn, thresholdMs: REFRESH_THRESHOLD_MS });

  if (expiresIn > REFRESH_THRESHOLD_MS) {
    debugLog('Token still valid');
    return stored.access_token;
  }

  // Token expired or near expiry — attempt refresh
  debugLog('Token expired or near expiry, attempting refresh');
  const providerSpec = detectProvider(provider);
  if (!providerSpec) {
    debugLog('No provider spec found for refresh', { provider });
    return null;
  }

  try {
    return await refreshOAuthToken(stored.refresh_token, providerSpec, tokenFilePath);
  } catch (err) {
    debugLog('Token refresh failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Create a custom fetch function for file-based OAuth providers.
 *
 * The returned fetch interceptor:
 * 1. Reads and auto-refreshes the OAuth token from the token file
 * 2. Strips any existing Authorization header and injects the real token
 * 3. Rewrites the URL if the provider specifies a rewrite rule
 *
 * Data-driven: adding a new provider = adding an entry to OAUTH_PROVIDER_REGISTRY.
 */

export function createOAuthProviderFetch(
  tokenFilePath: string,
  provider?: string,
): typeof globalThis.fetch {
  const providerSpec = detectProvider(provider);

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // 1. Get valid OAuth token (auto-refresh if needed)
    const token = await ensureValidOAuthToken(tokenFilePath, provider);
    if (!token) {
      throw new Error('OAuth: No valid token available. Please re-authenticate.');
    }

    // 2. Build headers — strip dummy Authorization, inject real token + provider extra headers
    const headers = new Headers(init?.headers);
    headers.delete('authorization');
    headers.delete('Authorization');
    headers.set('Authorization', `Bearer ${token}`);
    if (providerSpec?.extraHeaders) {
      for (const [k, v] of Object.entries(providerSpec.extraHeaders)) {
        if (!headers.has(k)) {
          headers.set(k, v);
        }
      }
    }

    // 3. Resolve URL
    let url: string;
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof URL) {
      url = input.toString();
    } else if (input instanceof Request) {
      url = input.url;
    } else {
      url = String(input);
    }

    // 4. Rewrite URL if provider specifies a rewrite rule
    const originalUrl = url;
    if (providerSpec?.rewriteUrl) {
      url = providerSpec.rewriteUrl(url);
    }

    if (DEBUG && url !== originalUrl) {
      debugLog(`${originalUrl} -> ${url} (token: [redacted])`);
    }

    const finalInit = { ...init, headers };
    const response = await globalThis.fetch(url, finalInit);

    if (DEBUG) {
      debugLog(`Response: ${response.status} ${response.statusText}`, { url });
      if (response.status >= 400 && response.status < 500) {
        try {
          const cloned = response.clone();
          const errorBody = await cloned.text();
          debugLog('Error response body', errorBody.substring(0, 500));
        } catch {
          // Ignore clone/read errors
        }
      }
    }

    return response;
  };
}
