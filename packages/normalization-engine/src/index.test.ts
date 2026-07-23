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

  it('rejects non-numeric ("NaN") amount cells instead of silently persisting them', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ledgerpilot-nan-'));
    const filePath = path.join(directory, 'checking.csv');
    await fs.writeFile(
      filePath,
      [
        'Date,Description,Amount,Account',
        '2026-01-01,Good Transaction,-45.00,Chequing',
        '2026-01-02,Garbage Amount Cell,NOT_A_NUMBER,Chequing'
      ].join('\n'),
      'utf8',
    );

    const engine = new NormalizationEngine();
    const { transactions, report } = await engine.normalizeBatch({
      batch: createBatch(filePath),
      sources: [{ importRecordId: 'import-1', filePath, fileName: 'checking.csv' }],
      knownFingerprints: new Set()
    });

    // The malformed row must not survive into the persisted set at all — no NaN amounts, ever.
    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.descriptionRaw).toBe('Good Transaction');
    expect(transactions.some((t) => Number.isNaN(t.amount))).toBe(false);
    // But it must be visible in the report, not silently vanish with zero trace.
    expect(report.summary.malformedRowCount).toBe(1);
    expect(report.summary.droppedRowCount).toBe(1);
    expect(report.summary.malformedRowSamples[0]).toContain('Garbage Amount Cell');
  });

  it('recovers ragged/malformed rows from the real shipped fixture instead of silently dropping them', async () => {
    // tests/fixtures/csv/fixture1-chequing.csv ships with the repo and has 3 rows (of 15) whose
    // field count doesn't match the 5-column header — a stray extra delimiter shifts the CAD$
    // amount into what would normally be the USD$ column. Before the fix, all 3 (MCDONALD'S and
    // two INTERAC TRANSFER rows) resolved to amount 0 via the shifted-empty CAD$ cell and were
    // silently dropped by the zero-amount filter, with zero user-visible signal.
    const fixturePath = path.join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'csv', 'fixture1-chequing.csv');
    const raw = await fs.readFile(fixturePath, 'utf8');
    const dataRowCount = raw.trim().split('\n').length - 1;
    expect(dataRowCount).toBe(15); // sanity-check the fixture hasn't changed shape unexpectedly

    const engine = new NormalizationEngine();
    const { transactions, report } = await engine.normalizeBatch({
      batch: createBatch(fixturePath),
      sources: [{ importRecordId: 'import-1', filePath: fixturePath, fileName: 'fixture1-chequing.csv' }],
      knownFingerprints: new Set()
    });

    // All 15 rows are recovered — none silently vanish.
    expect(transactions).toHaveLength(15);
    expect(report.summary.malformedRowCount).toBe(3);
    expect(report.summary.droppedRowCount).toBe(0);

    const mcdonalds = transactions.find((t) => t.descriptionRaw.includes("MCDONALD'S"));
    expect(mcdonalds).toBeDefined();
    expect(mcdonalds?.amount).toBeCloseTo(-12.0, 5);
    // Recovered rows can't be trusted at the classifier's usual confidence — always forced into
    // the review queue regardless of how confidently the description keyword-matched a category.
    expect(mcdonalds?.requiresReview).toBe(true);
    expect(mcdonalds?.confidenceScore).toBeLessThanOrEqual(0.5);

    const interacRows = transactions.filter((t) => t.descriptionRaw.includes('INTERAC TRANSFER TO SAVINGS'));
    expect(interacRows).toHaveLength(2);
    for (const row of interacRows) {
      expect(row.amount).toBeCloseTo(-800.0, 5);
      expect(row.requiresReview).toBe(true);
    }
  });

  it('detects per-row currency from dual CAD$/USD$ columns instead of hardcoding CAD and dropping USD rows', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ledgerpilot-currency-'));
    const filePath = path.join(directory, 'dual-currency.csv');
    await fs.writeFile(
      filePath,
      [
        'Transaction Date,Description 1,Description 2,CAD$,USD$',
        '2026-01-10,USD WIRE RECEIVED,,,250.00', // CAD$ blank, USD$ populated
        '2026-01-11,GROCERY STORE,,-45.00,'        // CAD$ populated, USD$ blank (unchanged behavior)
      ].join('\n'),
      'utf8',
    );

    const engine = new NormalizationEngine();
    const { transactions, report } = await engine.normalizeBatch({
      batch: createBatch(filePath),
      sources: [{ importRecordId: 'import-1', filePath, fileName: 'dual-currency.csv' }],
      knownFingerprints: new Set()
      // homeCurrency omitted deliberately — defaults to 'CAD', matching historical behavior for
      // the CAD-column row while the USD-column row is now correctly detected as 'USD'.
    });

    expect(report.summary.droppedRowCount).toBe(0); // previously the USD-only row silently vanished
    const usdRow = transactions.find((t) => t.descriptionRaw === 'USD WIRE RECEIVED');
    expect(usdRow?.amount).toBeCloseTo(250.0, 5);
    expect(usdRow?.currency).toBe('USD');

    const cadRow = transactions.find((t) => t.descriptionRaw === 'GROCERY STORE');
    expect(cadRow?.amount).toBeCloseTo(-45.0, 5);
    expect(cadRow?.currency).toBe('CAD');
  });

  it('does not silently recategorize an unrelated same-amount salary deposit as an internal transfer', async () => {
    // Regression test for the dead `transferLike` field: previously the credit-side match in
    // markInternalTransfers never checked whether the CREDIT was itself transfer-like, so any
    // unrelated positive transaction (salary, refund, ...) landing in a different account at the
    // same amount within the +/-1 day window got silently recategorized as an internal transfer,
    // hiding real income from the dashboard.
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ledgerpilot-transferfp-'));
    const filePath = path.join(directory, 'checking.csv');
    await fs.writeFile(
      filePath,
      [
        'Date,Description,Amount,Account',
        '2026-03-05,Credit Card Payment,-500.00,Chequing', // transfer-like debit
        '2026-03-05,Payroll Deposit Employer Inc,500.00,Savings' // unrelated salary credit, same amount+date, different account
      ].join('\n'),
      'utf8',
    );

    const engine = new NormalizationEngine();
    const { transactions } = await engine.normalizeBatch({
      batch: createBatch(filePath),
      sources: [{ importRecordId: 'import-1', filePath, fileName: 'checking.csv' }],
      knownFingerprints: new Set()
    });

    const salary = transactions.find((t) => t.descriptionRaw.startsWith('Payroll Deposit'));
    expect(salary).toBeDefined();
    expect(salary?.category).toBe('salary');
    expect(salary?.isInternalTransfer).toBe(false);

    // The genuine transfer-like debit is untouched by this fix — it simply has no eligible
    // transfer-like credit to pair with in this fixture, so it stays an unpaired payment.
    const payment = transactions.find((t) => t.descriptionRaw === 'Credit Card Payment');
    expect(payment?.isInternalTransfer).toBe(false);
  });

  it('still pairs genuine cross-account internal transfers (transferLike gating does not break the happy path)', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ledgerpilot-transferok-'));
    const filePath = path.join(directory, 'checking.csv');
    await fs.writeFile(
      filePath,
      [
        'Date,Description,Amount,Account',
        '2026-03-05,Transfer To Savings,-500.00,Chequing',
        '2026-03-05,Transfer From Chequing,500.00,Savings'
      ].join('\n'),
      'utf8',
    );

    const engine = new NormalizationEngine();
    const { transactions } = await engine.normalizeBatch({
      batch: createBatch(filePath),
      sources: [{ importRecordId: 'import-1', filePath, fileName: 'checking.csv' }],
      knownFingerprints: new Set()
    });

    expect(transactions.every((t) => t.isInternalTransfer)).toBe(true);
  });
});
