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
  build: {
    outDir: 'dist'
  }
});
