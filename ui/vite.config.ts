/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The console calls /mcp relatively (ADR-006): in the image Frank serves both,
// so there is no cross-origin request and no CORS. In dev, Vite proxies /mcp to
// a local Frank on :3000 to keep that same relative URL — no VITE_FRANK_URL.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/mcp': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
