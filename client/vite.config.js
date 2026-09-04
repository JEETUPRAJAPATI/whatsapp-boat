import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API and websocket are proxied, so the app can use relative URLs
// everywhere and never worry about CORS in development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:5000', ws: true, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
