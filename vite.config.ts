import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5180,
    host: '127.0.0.1',
  },
  build: {
    target: 'esnext',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Keep the heavy engine dependencies in stable chunks so browser cache
        // survives gameplay-code iteration.
        manualChunks: {
          three: ['three'],
          rapier: ['@dimforge/rapier3d-compat'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  worker: { format: 'es' },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
});
