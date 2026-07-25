import { describe, expect, it } from 'vitest';
import { maxImportFilesPerBatch, workspaceBlueprint } from '@ledgerpilot/core';

import { initialViewForWorkspace, providerRequiresConnectionTest } from './lib/startup';

describe('workspace blueprint', () => {
  it('includes the database folder', () => {
    expect(workspaceBlueprint).toContain('database');
  });

  it('keeps the import batch limit at ten files', () => {
    expect(maxImportFilesPerBatch).toBe(10);
  });
});

describe('startup flow', () => {
  it('allows local rules without a connection test', () => {
    expect(providerRequiresConnectionTest('local-rules')).toBe(false);
    expect(providerRequiresConnectionTest('ollama')).toBe(true);
    expect(providerRequiresConnectionTest('openai-compatible')).toBe(true);
    expect(providerRequiresConnectionTest('claude')).toBe(true);
  });

  it('routes new workspaces to import and existing workspaces to overview', () => {
    expect(initialViewForWorkspace(true, 0)).toBe('import');
    expect(initialViewForWorkspace(false, 0)).toBe('import');
    expect(initialViewForWorkspace(false, 25)).toBe('overview');
  });
});
