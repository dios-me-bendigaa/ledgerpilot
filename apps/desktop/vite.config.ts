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
      '@ledgerpilot/ui': path.resolve(
        __dirname,
        '../../packages/ui/src/index.tsx',
      )
    }
  },
  build: {
    outDir: 'dist'
  }
});
