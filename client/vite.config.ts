import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/uploads': { target: 'http://localhost:3001', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3001', ws: true, changeOrigin: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/react-router-dom/')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/framer-motion/')) {
            return 'motion';
          }
          if (id.includes('node_modules/date-fns/')) {
            return 'date';
          }
          if (id.includes('node_modules/lucide-react/')) {
            return 'icons';
          }
          if (id.includes('node_modules/zustand/')) {
            return 'state';
          }
          if (id.includes('node_modules/socket.io-client/')) {
            return 'socket';
          }

          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
});
