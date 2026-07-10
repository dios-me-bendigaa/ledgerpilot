import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@ledgerpilot/core': path.resolve(
        __dirname,
        '../../packages/core/src/index.ts',
      ),
      '@ledgerpilot/import-engine': path.resolve(
        __dirname,
        '../../packages/import-engine/src/index.ts',
      ),
      '@ledgerpilot/normalization-engine': path.resolve(
        __dirname,
        '../../packages/normalization-engine/src/index.ts',
      ),
      '@ledgerpilot/ui': path.resolve(
        __dirname,
        '../../packages/ui/src/index.tsx',
      )
    }
  },
  base: './',
  // Bind IPv4 so the electron dev launcher's `wait-on tcp:127.0.0.1:5173` resolves
  // (Vite otherwise binds IPv6 [::1] only and the launcher hangs forever).
  server: {
    host: '127.0.0.1'
  },
  build: {
    outDir: 'dist'
  }
});
