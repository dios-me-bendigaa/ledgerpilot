import { describe, expect, it } from 'vitest';
import { workspaceBlueprint } from '@ledgerpilot/core';

describe('workspace blueprint', () => {
  it('includes the database folder', () => {
    expect(workspaceBlueprint).toContain('database');
  });
});
