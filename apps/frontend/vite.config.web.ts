import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  define: {
    VITE_PLATFORM: JSON.stringify('web'),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@features': resolve(__dirname, 'src/renderer/features'),
      '@components': resolve(__dirname, 'src/renderer/shared/components'),
      '@hooks': resolve(__dirname, 'src/renderer/shared/hooks'),
      '@lib': resolve(__dirname, 'src/renderer/shared/lib'),
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist-web'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/renderer/index.html'),
      external: [
        'electron',
        '@lydell/node-pty',
        '@electron-toolkit/preload',
        '@electron-toolkit/utils',
        'electron-updater',
        'electron-log',
        '@sentry/electron',
      ],
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    watch: {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/.worktrees/**',
        '**/.auto-claude/**',
        '**/out/**',
        resolve(__dirname, '../.worktrees/**'),
        resolve(__dirname, '../.auto-claude/**'),
      ],
    },
  },
});
