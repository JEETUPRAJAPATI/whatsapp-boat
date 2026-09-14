import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    // Cloudflare quick tunnels forward requests with the tunnel hostname in the
    // Host header; Vite rejects unknown hosts unless they are listed here.
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      // The browser only ever talks to our server, never to Meta. This keeps
      // the access token server-side by construction.
      '/api': { target: 'http://localhost:4100', changeOrigin: true },
      '/media': { target: 'http://localhost:4100', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:4100', ws: true },
    },
  },
});
