import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    allowedHosts: true, // lets tunnel links (ngrok, cloudflared) reach the dev server
    proxy: {
      '/api': 'http://localhost:3001'
    }
  }
});
