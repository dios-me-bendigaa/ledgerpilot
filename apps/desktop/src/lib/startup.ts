import type { AiProvider } from '@ledgerpilot/core';

export const providerRequiresConnectionTest = (provider: AiProvider) => provider !== 'local-rules';

export const initialViewForWorkspace = (createdNow: boolean, transactionCount: number): 'import' | 'overview' =>
  createdNow || transactionCount === 0 ? 'import' : 'overview';
