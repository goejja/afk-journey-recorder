import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The dev server proxies the API and portraits to the local Hono server.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api/': 'http://127.0.0.1:3000',
      '/images/': 'http://127.0.0.1:3000',
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
