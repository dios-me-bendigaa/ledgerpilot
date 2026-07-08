import { describe, expect, it } from 'vitest';

import { workspaceBlueprint } from './index';

describe('workspace blueprint', () => {
  it('stays local-first', () => {
    expect(workspaceBlueprint).toEqual(
      expect.arrayContaining(['database', 'imports/original', 'backups']),
    );
  });
});
