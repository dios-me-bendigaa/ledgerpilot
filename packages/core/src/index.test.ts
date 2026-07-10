import { describe, expect, it } from 'vitest';

import { spendBucket, workspaceBlueprint } from './index';

describe('workspace blueprint', () => {
  it('stays local-first', () => {
    expect(workspaceBlueprint).toEqual(
      expect.arrayContaining(['database', 'imports/original', 'backups']),
    );
  });
});

describe('spendBucket', () => {
  it('counts salary and interest as income regardless of sign convention', () => {
    expect(spendBucket('salary', 3500)).toBe('income');
    expect(spendBucket('interest_income', 12.5)).toBe('income');
    expect(spendBucket('refunds', 40)).toBe('income');
  });

  it('excludes own-account and debt movements from spend and income', () => {
    expect(spendBucket('internal_transfers', -600)).toBe('transfer');
    expect(spendBucket('interac_e_transfers', -800)).toBe('transfer');
    expect(spendBucket('credit_card_payments', -105)).toBe('transfer');
    expect(spendBucket('line_of_credit_payments', -418)).toBe('transfer');
    expect(spendBucket('investments', -1000)).toBe('transfer');
  });

  it('treats real spend categories as expense', () => {
    expect(spendBucket('groceries', -82.5)).toBe('expense');
    expect(spendBucket('mortgage_payments', -1400)).toBe('expense');
    expect(spendBucket('india_expenses', -1100)).toBe('expense');
  });

  it('falls back to sign for unknown', () => {
    expect(spendBucket('unknown', -50)).toBe('expense');
    expect(spendBucket('unknown', 50)).toBe('income');
  });
});
