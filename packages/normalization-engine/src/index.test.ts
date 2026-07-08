import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ImportBatch } from '@ledgerpilot/core';

import { NormalizationEngine } from './index';

const createBatch = (filePath: string): ImportBatch => ({
  id: 'batch-1',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  status: 'completed',
  totalFiles: 1,
  completedFiles: 1,
  failedFiles: 0,
  files: [
    {
      id: 'import-1',
      batchId: 'batch-1',
      fileName: 'checking.csv',
      originalPath: filePath,
      storedOriginalPath: filePath,
      fileSize: 100,
      status: 'completed',
      stage: 'completed',
      progress: 100,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ]
});

describe('NormalizationEngine', () => {
  it('detects transfers and low-confidence transactions', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ledgerpilot-normalize-'));
    const filePath = path.join(directory, 'checking.csv');
    await fs.writeFile(
      filePath,
      ['Date,Description,Amount,Account', '2026-01-01,Payroll Deposit,2500,Chequing', '2026-01-02,Transfer To Savings,-500,Chequing', '2026-01-02,Transfer From Chequing,500,Savings', '2026-01-03,OBSCURE MERCHANT,-44.51,Chequing'].join('\n'),
      'utf8',
    );

    const engine = new NormalizationEngine();
    const result = await engine.normalizeBatch({
      batch: createBatch(filePath),
      sources: [{ importRecordId: 'import-1', filePath, fileName: 'checking.csv' }],
      knownFingerprints: new Set()
    });

    expect(result.transactions).toHaveLength(4);
    expect(result.report.summary.internalTransfers).toBe(2);
    expect(result.report.summary.lowConfidenceTransactions).toBe(1);
    expect(result.report.summary.categories.salary).toBe(1);
  });
});
