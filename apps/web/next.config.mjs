import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Node.js 22+ may reference localStorage during SSR which is not available
// in server-side contexts. This shim prevents ReferenceError crashes.
if (typeof globalThis.localStorage === "undefined") {
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    length: 0,
    key: () => null,
  };
}

const BACKEND_INTERNAL_URL = process.env.BACKEND_INTERNAL_URL || "http://127.0.0.1:8001";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  allowedDevOrigins: [
    "deeptutor.notesvnn.click",
    "openhuman.notesvnn.click",
    "multica.notesvnn.click",
    "aperant.notesvnn.click",
    "*.notesvnn.click",
    "localhost",
    "127.0.0.1",
  ],
  transpilePackages: ["@auto-claude/ui", "@auto-claude/types"],
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_INTERNAL_URL}/api/:path*`,
      },
      {
        source: "/v1/:path*",
        destination: `${BACKEND_INTERNAL_URL}/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
