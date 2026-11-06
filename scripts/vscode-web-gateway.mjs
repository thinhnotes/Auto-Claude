#!/usr/bin/env node
/**
 * Aperant Web + Local VS Code Online Same-Origin Gateway (Port 3782)
 *
 * Routes:
 * - `/vscode-web*` (HTTP + WebSocket Upgrade) -> Local VS Code Web Server (`127.0.0.1:8443`)
 * - All other paths (HTTP + WebSocket Upgrade) -> Next.js Web UI (`127.0.0.1:3783`)
 *
 * Features:
 * - Strips restrictive CSP/X-Frame-Options headers and upgrades `http://*.notesvnn.click`
 *   references in the workbench HTML so embedding inside `https://deeptutor.notesvnn.click`
 *   works with zero Mixed Content or CSP errors.
 * - Compresses large uncompressed VS Code static assets (`workbench.js` 21.7MB -> 5.4MB gzip,
 *   `workbench.css` 1.8MB -> 220KB gzip) and caches them in memory with immutable Cache-Control.
 * - Paces large static asset writes over Docker/Cloudflare Tunnel (`172.20.0.1`) so UDP QUIC
 *   tunnels never suffer upload bufferbloat (`timeout: no recent network activity` / 502).
 */

import http from "node:http";
import net from "node:net";
import zlib from "node:zlib";

const LISTEN_HOST = process.env.GATEWAY_HOST || "0.0.0.0";
const LISTEN_PORT = Number(process.env.GATEWAY_PORT) || 3782;
const NEXT_HOST = "127.0.0.1";
const NEXT_PORT = Number(process.env.NEXT_INTERNAL_PORT) || 3783;
const VSCODE_HOST = "127.0.0.1";
const VSCODE_PORT = Number(process.env.VSCODE_WEB_PORT) || 8443;

// Cache compressed static assets in memory (max ~32 entries)
const gzipCache = new Map();
const MAX_CACHE_ENTRIES = 32;

function getCachedGzip(cacheKey, rawBuffer) {
  if (gzipCache.has(cacheKey)) {
    return gzipCache.get(cacheKey);
  }
  const compressed = zlib.gzipSync(rawBuffer, { level: 6 });
  if (gzipCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = gzipCache.keys().next().value;
    if (oldestKey) gzipCache.delete(oldestKey);
  }
  gzipCache.set(cacheKey, compressed);
  return compressed;
}

function isVSCodePath(url = "") {
  return url === "/vscode-web" || url.startsWith("/vscode-web/") || url.startsWith("/vscode-web?");
}

function isCompressibleContentType(contentType = "", url = "") {
  const ct = contentType.toLowerCase();
  if (
    ct.includes("javascript") ||
    ct.includes("text/css") ||
    ct.includes("application/json") ||
    ct.includes("image/svg+xml") ||
    ct.includes("application/wasm") ||
    ct.includes("font/")
  ) {
    return true;
  }
  return /\.(js|css|json|svg|wasm|ttf)(\?|$)/i.test(url);
}

/**
 * Write a buffer to clientRes, pacing chunks when sending large payloads through
 * Cloudflare Tunnel (non-loopback) to prevent QUIC upload bufferbloat.
 */
function sendBufferWithPacing(clientReq, clientRes, statusCode, headers, buffer) {
  const remoteAddr = String(clientReq.socket?.remoteAddress || "");
  const isLoopback =
    remoteAddr === "127.0.0.1" ||
    remoteAddr === "::1" ||
    remoteAddr === "::ffff:127.0.0.1";

  const finalHeaders = { ...headers };
  delete finalHeaders["transfer-encoding"];
  finalHeaders["content-length"] = String(buffer.length);

  clientRes.writeHead(statusCode, finalHeaders);

  if (clientReq.method === "HEAD" || buffer.length === 0) {
    clientRes.end();
    return;
  }

  // Localhost or small responses (< 256 KB): send immediately
  if (isLoopback || buffer.length <= 262144) {
    clientRes.end(buffer);
    return;
  }

  // Non-loopback (Cloudflare Tunnel on 172.20.0.1) with large payload (> 256 KB):
  // Pace at 64 KB per 16ms (~4 MB/s) so QUIC control frames are never starved.
  const CHUNK_SIZE = 65536;
  const INTERVAL_MS = 16;
  let offset = 0;
  let closed = false;

  const onClose = () => {
    closed = true;
  };
  clientRes.once("close", onClose);
  clientRes.once("error", onClose);

  function pushNext() {
    if (closed || clientRes.destroyed) return;
    if (offset >= buffer.length) {
      clientRes.end();
      return;
    }
    const end = Math.min(offset + CHUNK_SIZE, buffer.length);
    const slice = buffer.subarray(offset, end);
    offset = end;

    const canContinue = clientRes.write(slice);
    if (offset >= buffer.length) {
      clientRes.end();
      return;
    }
    if (!canContinue) {
      clientRes.once("drain", () => setTimeout(pushNext, INTERVAL_MS));
    } else {
      setTimeout(pushNext, INTERVAL_MS);
    }
  }

  pushNext();
}

const server = http.createServer((clientReq, clientRes) => {
  const url = clientReq.url || "/";
  const routeToVSCode = isVSCodePath(url);
  const targetHost = routeToVSCode ? VSCODE_HOST : NEXT_HOST;
  const targetPort = routeToVSCode ? VSCODE_PORT : NEXT_PORT;

  // Normalize `/vscode-web?...` to `/vscode-web/?...` so code-server matches base path
  let forwardPath = url;
  if (routeToVSCode && url.startsWith("/vscode-web?")) {
    forwardPath = "/vscode-web/" + url.slice("/vscode-web".length);
  } else if (routeToVSCode && url === "/vscode-web") {
    forwardPath = "/vscode-web/";
  }

  const clientAcceptEncoding = String(clientReq.headers["accept-encoding"] || "");
  const clientSupportsGzip = clientAcceptEncoding.includes("gzip");

  const headers = { ...clientReq.headers };
  if (routeToVSCode) {
    // Request uncompressed from local code-server so we can rewrite HTML or gzip-cache static assets
    delete headers["accept-encoding"];
  }

  const proxyReq = http.request(
    {
      host: targetHost,
      port: targetPort,
      method: clientReq.method,
      path: forwardPath,
      headers,
      agent: false, // Avoid keep-alive race conditions with upstream servers
    },
    (proxyRes) => {
      const resHeaders = { ...proxyRes.headers };
      const statusCode = proxyRes.statusCode || 200;

      if (routeToVSCode) {
        delete resHeaders["content-security-policy"];
        delete resHeaders["content-security-policy-report-only"];
        delete resHeaders["x-frame-options"];
      }

      const contentType = String(resHeaders["content-type"] || "");

      // 1. Rewrite VS Code Workbench HTML so http://*.notesvnn.click becomes https://*.notesvnn.click
      if (routeToVSCode && contentType.includes("text/html")) {
        const chunks = [];
        proxyRes.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        proxyRes.on("end", () => {
          let html = Buffer.concat(chunks).toString("utf-8");
          const reqHost = String(clientReq.headers.host || "");
          const isHttps =
            clientReq.headers["x-forwarded-proto"] === "https" ||
            reqHost.endsWith(".notesvnn.click") ||
            reqHost.endsWith(".ts.net");
          if (isHttps && reqHost) {
            html = html.replaceAll(`http://${reqHost}`, `https://${reqHost}`);
          }
          let bodyBuf = Buffer.from(html, "utf-8");
          if (clientSupportsGzip && bodyBuf.length > 1024) {
            bodyBuf = zlib.gzipSync(bodyBuf);
            resHeaders["content-encoding"] = "gzip";
          }
          sendBufferWithPacing(clientReq, clientRes, statusCode, resHeaders, bodyBuf);
        });
        return;
      }

      // 2. Compress & cache VS Code static assets (.js, .css, .json, .svg, .wasm)
      if (
        routeToVSCode &&
        statusCode === 200 &&
        !resHeaders["content-encoding"] &&
        isCompressibleContentType(contentType, forwardPath)
      ) {
        const chunks = [];
        proxyRes.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        proxyRes.on("end", () => {
          const rawBuf = Buffer.concat(chunks);
          let outBuf = rawBuf;
          if (clientSupportsGzip && rawBuf.length > 1024) {
            outBuf = getCachedGzip(forwardPath, rawBuf);
            resHeaders["content-encoding"] = "gzip";
            resHeaders["vary"] = "Accept-Encoding";
          }
          if (forwardPath.includes("/static/")) {
            resHeaders["cache-control"] = "public, max-age=31536000, immutable";
          }
          sendBufferWithPacing(clientReq, clientRes, statusCode, resHeaders, outBuf);
        });
        return;
      }

      clientRes.writeHead(statusCode, resHeaders);
      proxyRes.pipe(clientRes);
    },
  );

  const cleanupUpstream = () => {
    if (!proxyReq.destroyed) {
      proxyReq.destroy();
    }
  };
  clientRes.once("close", cleanupUpstream);

  proxyReq.on("error", (err) => {
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    }
    clientRes.end(
      `Gateway proxy error (${routeToVSCode ? "VS Code Web" : "Next.js"}): ${err.message}`,
    );
  });

  clientReq.pipe(proxyReq);
});

server.on("upgrade", (req, clientSocket, head) => {
  const url = req.url || "/";
  const routeToVSCode = isVSCodePath(url);
  const targetHost = routeToVSCode ? VSCODE_HOST : NEXT_HOST;
  const targetPort = routeToVSCode ? VSCODE_PORT : NEXT_PORT;

  const upstreamSocket = net.connect(targetPort, targetHost, () => {
    const headerLines = [`${req.method || "GET"} ${url} HTTP/${req.httpVersion || "1.1"}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const k = req.rawHeaders[i];
      const v = req.rawHeaders[i + 1];
      if (routeToVSCode && k.toLowerCase() === "origin") {
        continue;
      }
      headerLines.push(`${k}: ${v}`);
    }
    headerLines.push("", "");
    upstreamSocket.write(headerLines.join("\r\n"));
    if (head && head.length > 0) {
      upstreamSocket.write(head);
    }

    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
  });

  const closeBoth = () => {
    try {
      upstreamSocket.destroy();
    } catch {}
    try {
      clientSocket.destroy();
    } catch {}
  };

  upstreamSocket.on("error", closeBoth);
  clientSocket.on("error", closeBoth);
  upstreamSocket.on("close", closeBoth);
  clientSocket.on("close", closeBoth);
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(
    `[Aperant Gateway] Listening on http://${LISTEN_HOST}:${LISTEN_PORT} (-> Next.js :${NEXT_PORT}, /vscode-web -> :${VSCODE_PORT})`,
  );
});
