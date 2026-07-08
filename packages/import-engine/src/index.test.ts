import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ImportEngine } from './index';

const tempDirs: string[] = [];

const createWorkspace = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ledgerpilot-import-'));
  tempDirs.push(root);

  await fs.mkdir(path.join(root, 'imports', 'original'), { recursive: true });
  await fs.mkdir(path.join(root, 'imports', 'processed'), { recursive: true });
  await fs.mkdir(path.join(root, 'reports'), { recursive: true });
  await fs.mkdir(path.join(root, 'settings'), { recursive: true });

  return root;
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('ImportEngine', () => {
  it('copies valid CSV files into the workspace and persists history', async () => {
    const workspaceRoot = await createWorkspace();
    const sourceFile = path.join(workspaceRoot, 'sample.csv');
    await fs.writeFile(sourceFile, 'date,amount\n2026-01-01,10\n', 'utf8');

    const engine = new ImportEngine({ workspaceRoot });
    const result = await engine.importFiles([
      {
        name: 'sample.csv',
        path: sourceFile,
        size: 25,
        lastModifiedMs: Date.now()
      }
    ]);

    expect(result.batch.completedFiles).toBe(1);
    expect(result.batch.files[0]?.storedOriginalPath).toBeDefined();
    expect(result.batch.files[0]?.storedProcessedPath).toBeDefined();

    const history = await engine.getHistory();
    expect(history.batches).toHaveLength(1);
  });

  it('marks previously imported files as duplicates', async () => {
    const workspaceRoot = await createWorkspace();
    const sourceFile = path.join(workspaceRoot, 'duplicate.csv');
    await fs.writeFile(sourceFile, 'date,amount\n2026-01-01,10\n', 'utf8');

    const engine = new ImportEngine({ workspaceRoot });
    await engine.importFiles([
      {
        name: 'duplicate.csv',
        path: sourceFile,
        size: 25,
        lastModifiedMs: Date.now()
      }
    ]);

    const secondImport = await engine.importFiles([
      {
        name: 'duplicate.csv',
        path: sourceFile,
        size: 25,
        lastModifiedMs: Date.now()
      }
    ]);

    expect(secondImport.batch.failedFiles).toBe(1);
    expect(secondImport.batch.files[0]?.errorCode).toBe('DUPLICATE_FILE');
  });
});
