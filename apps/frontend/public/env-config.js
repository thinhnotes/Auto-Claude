// Runtime environment configuration
// This file is replaced at container startup by docker-entrypoint.sh
window.__ENV__ = {
  VITE_API_URL: '/api',  // Default: nginx proxy to backend:8000
  VITE_CUSTOM_DOMAIN: '__VITE_CUSTOM_DOMAIN__',
};
