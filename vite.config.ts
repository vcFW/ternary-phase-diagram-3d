import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: '127.0.0.1' },
  test: { include: ['tests/**/*.test.ts'] },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: { manualChunks: { three: ['three'] } },
    },
  },
});
