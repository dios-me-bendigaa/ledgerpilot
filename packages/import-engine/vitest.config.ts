import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@ledgerpilot/core': path.resolve(__dirname, '../core/src/index.ts'),
      '@ledgerpilot/normalization-engine': path.resolve(
        __dirname,
        '../normalization-engine/src/index.ts',
      )
    }
  }
});
