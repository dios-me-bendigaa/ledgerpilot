import { describe, expect, it } from 'vitest';
import { maxImportFilesPerBatch, workspaceBlueprint } from '@ledgerpilot/core';

describe('workspace blueprint', () => {
  it('includes the database folder', () => {
    expect(workspaceBlueprint).toContain('database');
  });

  it('keeps the import batch limit at ten files', () => {
    expect(maxImportFilesPerBatch).toBe(10);
  });
});
