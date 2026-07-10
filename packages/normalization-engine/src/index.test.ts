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

  it('trusts the bank Category column and lets merchant overrides win', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ledgerpilot-bankcat-'));
    const filePath = path.join(directory, 'checking.csv');
    await fs.writeFile(
      filePath,
      [
        'Date,Description,Category,Debit,Credit,Balance',
        '2026-01-01,SkipTheDishes,Salary,0,3500,100',      // bank says Salary -> income, not a restaurant
        '2026-01-02,Transfer between accounts,Transfer,600,0,100', // bank Transfer -> internal_transfers
        '2026-01-03,Remitly Transfer,Transfer,1100,0,100',  // merchant override wins -> india_expenses
        '2026-01-04,RBC Loan Payment,Car payment,418,0,100',// bank Car payment -> car_payments
        '2026-01-05,OBSCURE MERCHANT,Cash,50,0,100'         // unmapped bank label -> unknown/review
      ].join('\n'),
      'utf8',
    );

    const engine = new NormalizationEngine();
    const { transactions } = await engine.normalizeBatch({
      batch: createBatch(filePath),
      sources: [{ importRecordId: 'import-1', filePath, fileName: 'checking.csv' }],
      knownFingerprints: new Set()
    });

    const byDesc = Object.fromEntries(transactions.map((t) => [t.descriptionRaw, t.category]));
    expect(byDesc['SkipTheDishes']).toBe('salary');
    expect(byDesc['Transfer between accounts']).toBe('internal_transfers');
    expect(byDesc['Remitly Transfer']).toBe('india_expenses');
    expect(byDesc['RBC Loan Payment']).toBe('car_payments');
    expect(byDesc['OBSCURE MERCHANT']).toBe('unknown');
  });
});
