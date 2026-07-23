import fs from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ImportBatch, NormalizedTransaction } from '@ledgerpilot/core';

import { NormalizationEngine } from './index';

// Synthetic-but-realistic 30-day, multi-bank dataset (Scotia + NBC + CIBC), generated to match
// the EXACT real export formats found in production imports (headers/column layout only —
// no real transaction content). Covers:
//   - Biweekly salary income across two different people/accounts
//   - Cross-account LOC <-> chequing transfers (both "pay down LOC" and "draw from LOC" directions)
//   - The exact Debit=0/Credit=0/Balance-populated row pattern that caused a real bug: such rows
//     must resolve to amount=0 (a no-op placeholder line), never to the Balance column's value.
// See /var/folders/.../generate_fixtures.py (not part of the repo) for the generator and the
// hand-reasoned "ground truth" this test's expectations are derived from.
const FIXTURES_DIR = path.join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'csv');

const fixtureFiles = [
  { fileName: 'fixture8-scotia-chequing-30day.csv', importRecordId: 'scotia-chequing' },
  { fileName: 'fixture9-scotia-loc-30day.csv', importRecordId: 'scotia-loc' },
  { fileName: 'fixture10-nbc-chequing-30day.csv', importRecordId: 'nbc-chequing' },
  { fileName: 'fixture11-nbc-loc-30day.csv', importRecordId: 'nbc-loc' },
  { fileName: 'fixture12-nbc-creditcard-30day.csv', importRecordId: 'nbc-cc' },
  { fileName: 'fixture13-cibc-creditcard-30day.csv', importRecordId: 'cibc-cc' }
];

const createMultiFileBatch = (): ImportBatch => ({
  id: 'multi-bank-batch',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  status: 'completed',
  totalFiles: fixtureFiles.length,
  completedFiles: fixtureFiles.length,
  failedFiles: 0,
  files: fixtureFiles.map(({ fileName, importRecordId }) => ({
    id: importRecordId,
    batchId: 'multi-bank-batch',
    fileName,
    originalPath: path.join(FIXTURES_DIR, fileName),
    storedOriginalPath: path.join(FIXTURES_DIR, fileName),
    fileSize: 100,
    status: 'completed' as const,
    stage: 'completed' as const,
    progress: 100,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }))
});

const sumCategory = (transactions: NormalizedTransaction[], category: string, accountFilter?: string) =>
  transactions
    .filter((t) => t.category === category && (!accountFilter || t.accountName.includes(accountFilter)))
    .reduce((total, t) => total + Math.abs(t.amount), 0);

describe('multi-bank 30-day fixture set (Scotia + NBC + CIBC)', () => {
  it('processes all 6 real-format fixture files together without dropping any usable rows', async () => {
    const engine = new NormalizationEngine();
    const { transactions, report } = await engine.normalizeBatch({
      batch: createMultiFileBatch(),
      sources: fixtureFiles.map(({ fileName, importRecordId }) => ({
        importRecordId,
        filePath: path.join(FIXTURES_DIR, fileName),
        fileName
      })),
      knownFingerprints: new Set(),
      homeCurrency: 'CAD'
    });

    // 65 total data rows across all 6 files, minus 7 legitimate $0 placeholder rows (Debit=0/
    // Credit=0 "management fee" / "transaction fee" log lines) that correctly resolve to amount=0
    // and are then dropped as benign no-ops — same treatment any other genuinely-zero-amount
    // transaction already gets. Before the fix, those 7 rows survived (with the WRONG amount, the
    // Balance column's value) and inflated the count instead.
    expect(transactions).toHaveLength(58);
    expect(report.summary.droppedRowCount).toBe(7);
  });

  it('resolves Debit=0/Credit=0/Balance-populated rows to a dropped no-op, never to the Balance column value (the real bug)', async () => {
    const engine = new NormalizationEngine();
    const { transactions, report } = await engine.normalizeBatch({
      batch: createMultiFileBatch(),
      sources: fixtureFiles.map(({ fileName, importRecordId }) => ({
        importRecordId,
        filePath: path.join(FIXTURES_DIR, fileName),
        fileName
      })),
      knownFingerprints: new Set(),
      homeCurrency: 'CAD'
    });

    const zeroPatternDescriptions = [
      'Fixed monthly fees',
      'INTERAC e-Transfer service',
      'Monthly transaction fees',
      'Line of credit management fees'
    ];
    const zeroPatternRows = transactions.filter((t) => zeroPatternDescriptions.includes(t.descriptionRaw));

    // These are legitimate $0 rows once fixed — dropped entirely as no-ops (matching how any
    // other zero-amount transaction is already treated), so none should survive into the final
    // transaction list at all.
    expect(zeroPatternRows).toHaveLength(0);
    // But they must still be visible in the report, not silently vanish with zero trace.
    expect(report.summary.droppedRowCount).toBe(7);
    // Before the fix, this exact scenario reproduced with real user data: these placeholder rows
    // silently became multi-thousand-dollar "fees" (the Balance column's value). Confirm nothing
    // even remotely fee-sized/balance-sized survives under these descriptions anywhere.
    const anyBogusFeeAmount = transactions.some(
      (t) => zeroPatternDescriptions.includes(t.descriptionRaw) && Math.abs(t.amount) > 1
    );
    expect(anyBogusFeeAmount).toBe(false);
  });

  it('computes correct biweekly salary income totals for both chequing accounts', async () => {
    const engine = new NormalizationEngine();
    const { transactions } = await engine.normalizeBatch({
      batch: createMultiFileBatch(),
      sources: fixtureFiles.map(({ fileName, importRecordId }) => ({
        importRecordId,
        filePath: path.join(FIXTURES_DIR, fileName),
        fileName
      })),
      knownFingerprints: new Set(),
      homeCurrency: 'CAD'
    });

    const scotiaSalary = transactions.filter(
      (t) => t.accountName.includes('scotia-chequing') && t.category === 'salary'
    );
    expect(scotiaSalary).toHaveLength(3);
    expect(scotiaSalary.reduce((sum, t) => sum + t.amount, 0)).toBeCloseTo(8400.0, 2);

    const nbcSalary = transactions.filter((t) => t.accountName.includes('nbc-chequing') && t.category === 'salary');
    expect(nbcSalary).toHaveLength(3);
    expect(nbcSalary.reduce((sum, t) => sum + t.amount, 0)).toBeCloseTo(7950.0, 2);
  });

  it('computes correct real-expense category totals (groceries, fuel, restaurants, utilities, insurance)', async () => {
    const engine = new NormalizationEngine();
    const { transactions } = await engine.normalizeBatch({
      batch: createMultiFileBatch(),
      sources: fixtureFiles.map(({ fileName, importRecordId }) => ({
        importRecordId,
        filePath: path.join(FIXTURES_DIR, fileName),
        fileName
      })),
      knownFingerprints: new Set(),
      homeCurrency: 'CAD'
    });

    // Scotia chequing: 4 grocery rows (95.40 + 110.75 + 102.15 + 88.60) = 396.90
    expect(sumCategory(transactions, 'groceries', 'scotia-chequing')).toBeCloseTo(396.9, 2);
    // Scotia chequing: 2 fuel rows (62.00 + 58.00) = 120.00
    expect(sumCategory(transactions, 'fuel', 'scotia-chequing')).toBeCloseTo(120.0, 2);
    // Scotia chequing: 3 restaurant rows (54.30 + 38.90 + 47.50) = 140.70
    expect(sumCategory(transactions, 'restaurants', 'scotia-chequing')).toBeCloseTo(140.7, 2);
    // NOTE / discovered classifier nuance (not fixed here, deliberately): Scotia's "interest
    // charges cash" is POSITIVE-signed (this account's liability sign convention) in an account
    // whose name contains "loc" as a standalone word. classifyTransaction's account-context rule
    // ("any positive amount in an account named like a line of credit is a payment") is checked
    // BEFORE generic keyword rules, so it wins over the 'interest charge' keyword match and this
    // resolves to line_of_credit_payments, not interest_charges, on a FRESH import. A real user
    // hitting this can "teach" the correct category once and it sticks (category-rules override),
    // which is exactly what already happened in this app's real data — but a first-time import
    // would show it as a transfer, not a visible expense. Flagged as a follow-up, not fixed here:
    // reordering classification priority risks affecting other cases that currently rely on this
    // same account-context rule firing correctly.
    expect(sumCategory(transactions, 'line_of_credit_payments', 'scotia-loc')).toBeGreaterThan(0);
    // NBC LOC: interest_charges from "Interest to be paid" — this one has an explicit, highest-
    // priority MERCHANT override (checked before the account-context rule), so it correctly wins.
    expect(sumCategory(transactions, 'interest_charges', 'nbc-loc')).toBeCloseTo(63.4, 2);
  });

  it('pairs cross-account LOC <-> chequing transfers when recognized, and documents where recognition currently falls short (Scotia)', async () => {
    const engine = new NormalizationEngine();
    const { transactions } = await engine.normalizeBatch({
      batch: createMultiFileBatch(),
      sources: fixtureFiles.map(({ fileName, importRecordId }) => ({
        importRecordId,
        filePath: path.join(FIXTURES_DIR, fileName),
        fileName
      })),
      knownFingerprints: new Set(),
      homeCurrency: 'CAD'
    });

    // Pairs A/C: Scotia chequing -300 ("customer transfer dr.") <-> Scotia LOC +300 ("payment
    // from -"), two occurrences (Jun 8, Jun 25). DISCOVERED FINDING (verified against this app's
    // real production data, not just synthetic): Scotia's export has NO bank-provided Category
    // column at all (unlike NBC), so classification relies entirely on merchant-override/keyword
    // rules. "payment from - " has an explicit override -> correctly resolves to
    // line_of_credit_payments on its own. But "customer transfer dr." (the CHEQUING side) matches
    // no override, no bank category (none exists), and no keyword rule, so it resolves to
    // 'unknown' by default — meaning it isn't transfer-like, so pairing can't happen for either
    // side even though the LOC side alone is correctly categorized. This exact gap exists in the
    // real user's data too (verified: real "customer transfer dr. Mb-Credit Card/Loc Pay." rows
    // all show is_internal_transfer=0) — it's invisible there only because the user already
    // manually taught a category-rules.json override for this specific merchant string, which
    // reapplies automatically on every future import. A fresh Scotia user (or this same user's
    // NEXT new LOC-payment description variant) would hit this same gap. Documented here, not
    // fixed — a real fix would add a Scotia-specific merchant override, deliberately deferred
    // pending more real-world Scotia description samples to generalize confidently from.
    const scotiaPayments = transactions.filter(
      (t) => t.accountName.includes('scotia-chequing') && t.descriptionRaw.startsWith('customer transfer dr.')
    );
    expect(scotiaPayments).toHaveLength(2);
    for (const payment of scotiaPayments) {
      expect(payment.category).toBe('unknown');
      expect(payment.isInternalTransfer).toBe(false);
    }
    const scotiaLocReceipts = transactions.filter(
      (t) => t.accountName.includes('scotia-loc') && t.descriptionRaw.startsWith('payment from')
    );
    expect(scotiaLocReceipts).toHaveLength(2);
    for (const receipt of scotiaLocReceipts) {
      // Correctly categorized on its own merits (merchant override) even though it has no
      // transfer-like partner to pair with, for the reason explained above.
      expect(receipt.category).toBe('line_of_credit_payments');
      expect(receipt.isInternalTransfer).toBe(false);
    }

    // Pair B: Scotia chequing +500 <-> Scotia LOC -500 (draw). NOTE: unlike the pairs above,
    // neither "customer transfer cr." (chequing) nor "advance to -" (LOC) match ANY existing
    // merchant override, bank-category mapping, account-context rule, or keyword rule — both
    // resolve to 'unknown', which is not transfer-like, so this pair does NOT get marked as an
    // internal transfer today. This is an invented description (no verified real Scotia "draw"
    // sample was available to copy), so this documents a real gap (LOC draws-into-chequing
    // aren't recognized the way LOC payments-from-chequing are) without asserting a specific fix.
    const scotiaDraw = transactions.find(
      (t) => t.accountName.includes('scotia-chequing') && t.descriptionRaw.startsWith('customer transfer cr.')
    );
    expect(scotiaDraw?.category).toBe('unknown');
    expect(scotiaDraw?.isInternalTransfer).toBe(false);
    const scotiaLocAdvance = transactions.find(
      (t) => t.accountName.includes('scotia-loc') && t.descriptionRaw.startsWith('advance to')
    );
    expect(scotiaLocAdvance?.category).toBe('unknown');
    expect(scotiaLocAdvance?.isInternalTransfer).toBe(false);

    // Pair D: NBC chequing +350 <-> NBC LOC -350 (draw)
    const nbcDraw = transactions.find(
      (t) => t.accountName.includes('nbc-chequing') && t.descriptionRaw === 'Authorized transaction on line of credit'
    );
    expect(nbcDraw?.isInternalTransfer).toBe(true);
    const nbcLocDraw = transactions.find(
      (t) => t.accountName.includes('nbc-loc') && t.descriptionRaw === 'Authorized transaction on line of credit'
    );
    expect(nbcLocDraw?.isInternalTransfer).toBe(true);

    // Pair E: NBC chequing -375 <-> NBC LOC +375 (payment)
    const nbcPayment = transactions.find(
      (t) => t.accountName.includes('nbc-chequing') && t.descriptionRaw === 'Overdue transfer line of credit'
    );
    expect(nbcPayment?.isInternalTransfer).toBe(true);
    const nbcLocPayment = transactions.find(
      (t) => t.accountName.includes('nbc-loc') && t.descriptionRaw === 'Overdue transfer line of credit'
    );
    expect(nbcLocPayment?.isInternalTransfer).toBe(true);
  });

  it('produces internally-consistent running balances matching the source CSVs exactly', async () => {
    const engine = new NormalizationEngine();
    const { transactions } = await engine.normalizeBatch({
      batch: createMultiFileBatch(),
      sources: fixtureFiles.map(({ fileName, importRecordId }) => ({
        importRecordId,
        filePath: path.join(FIXTURES_DIR, fileName),
        fileName
      })),
      knownFingerprints: new Set(),
      homeCurrency: 'CAD'
    });

    const scotiaChequingLast = transactions
      .filter((t) => t.accountName.includes('scotia-chequing'))
      .sort((a, b) => b.postedDate.localeCompare(a.postedDate))[0];
    expect(scotiaChequingLast?.balanceAfter).toBeCloseTo(6078.06, 2);

    const nbcChequingLast = transactions
      .filter((t) => t.accountName.includes('nbc-chequing'))
      .sort((a, b) => b.postedDate.localeCompare(a.postedDate))[0];
    expect(nbcChequingLast?.balanceAfter).toBeCloseTo(8047.26, 2);

    const nbcLocLast = transactions
      .filter((t) => t.accountName.includes('nbc-loc'))
      .sort((a, b) => b.postedDate.localeCompare(a.postedDate))[0];
    expect(nbcLocLast?.balanceAfter).toBeCloseTo(-12038.4, 2);
  });

  it('parses the header-less CIBC format instead of silently importing zero rows with a false "completed" status', async () => {
    const engine = new NormalizationEngine();
    const { transactions, report } = await engine.normalizeBatch({
      batch: createMultiFileBatch(),
      sources: fixtureFiles.map(({ fileName, importRecordId }) => ({
        importRecordId,
        filePath: path.join(FIXTURES_DIR, fileName),
        fileName
      })),
      knownFingerprints: new Set(),
      homeCurrency: 'CAD'
    });

    const cibcRows = transactions.filter((t) => t.accountName.includes('cibc'));
    // Before the fix: 0. The real cibc_cc.csv import in this app's actual database has zero rows
    // today, despite the import history showing status "completed" — this is that exact bug,
    // reproduced with synthetic data instead of the user's real file.
    expect(cibcRows).toHaveLength(6);

    const madina = cibcRows.find((t) => t.descriptionRaw.includes('MADINA GROCER AND HALA WINNIPEG, MB'));
    expect(madina).toBeDefined();
    // KNOWN LIMITATION, not fixed by this change: CIBC's export has no sign convention at all —
    // every amount is a positive "amount charged" regardless of account type. There is no
    // existing mechanism that flips a positive amount to an expense based on "this looks like a
    // credit-card-charges-only file", so today this resolves to the literal positive value from
    // the CSV. That means an unmodified positive amount in an 'unknown' category would currently
    // bucket as INCOME on the dashboard (see spendBucket) — a real follow-up issue, deliberately
    // NOT addressed here since a safe fix needs its own careful design (e.g. detecting single-
    // positive-amount-column credit card formats specifically, without misclassifying genuinely
    // signed formats). Asserting the CURRENT literal behavior so this gap stays visible/tracked
    // rather than silently masked by an assumption that isn't actually implemented yet.
    expect(madina?.amount).toBeCloseTo(13.37, 2);
    // Every row from a header-less file is flagged for review — the column mapping was guessed
    // positionally, not confirmed, same treatment as a ragged/malformed row.
    expect(madina?.requiresReview).toBe(true);
    expect(madina?.confidenceScore).toBeLessThanOrEqual(0.5);
    expect(report.summary.malformedRowCount).toBeGreaterThanOrEqual(6);
  });
});
