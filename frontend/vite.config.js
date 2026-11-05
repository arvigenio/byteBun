import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { seoPlugin } from './seo-plugin.js';

// Inside Docker the API is reachable by its service name; outside Docker, on localhost.
const apiTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), tailwindcss(), seoPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // Windows bind mounts don't forward file-change events into containers, so poll instead.
    watch: { usePolling: true, interval: 300 },
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
