import type { DashboardData, ImportBatch } from '@ledgerpilot/core';

export const formatBytes = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// Formats a value using a specific currency code. Aggregates are NOT converted across currencies
// (no fabricated FX rate is applied anywhere) — this only controls the symbol/formatting used to
// display already-computed totals, which are assumed to be in `code` (the workspace's home
// currency by default).
export const formatCurrencyWithCode = (value: number, code: string) => {
  try {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: code || 'CAD',
      maximumFractionDigits: 0
    }).format(value);
  } catch {
    // Intl throws on an invalid/unrecognized currency code (e.g. mid-typing in the settings
    // field) — fall back to CAD rather than crashing the whole dashboard render.
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(value);
  }
};

export const summarizeBatch = (batch: ImportBatch) => `${batch.completedFiles}/${batch.totalFiles} completed`;

export const maxCategoryTotal = (totals: DashboardData['topExpenseCategories']) =>
  totals.reduce((current, entry) => Math.max(current, entry.total), 0);

// Fields a user fills in when creating a goal — deliberately excludes id/createdAt/updatedAt,
// which are only assigned once the goal is actually persisted (see handleCreateGoal in
// WorkspaceContext.tsx), not while it's still a draft the user might cancel.
export type NewGoalInput = {
  name: string;
  targetAmount: number;
  currentAmount: number;
  deadline: string;
  monthlyContributionTarget: number;
};

export const defaultGoalDraft = (): NewGoalInput => ({
  name: '',
  targetAmount: 5000,
  currentAmount: 0,
  deadline: new Date(new Date().getFullYear(), new Date().getMonth() + 6, 1).toISOString().slice(0, 10),
  monthlyContributionTarget: 400
});

export type DroppedFile = File & { path?: string };

// Whole days between now and an ISO date string — negative once the deadline has passed. Used for
// both goal-deadline countdowns and anywhere else a plain "N days left" figure is needed.
export const daysUntil = (isoDate: string): number => {
  const target = new Date(isoDate).getTime();
  if (Number.isNaN(target)) return 0;
  return Math.ceil((target - Date.now()) / (1000 * 60 * 60 * 24));
};

export const relativeTime = (isoDate: string) => {
  if (!isoDate) return '';
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return isoDate;
  const diffMs = Date.now() - then;
  const diffMins = Math.round(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.round(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(isoDate).toLocaleDateString();
};
