import { Check, CreditCard, Pencil, Plus, Target, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge, Button, Card, EmptyState, Input, Meter } from '@ledgerpilot/ui';
import type { DashboardData, Goal } from '@ledgerpilot/core';

import { PageHeader } from '../components/PageHeader';
import { useWorkspace } from '../context/WorkspaceContext';
import { daysUntil, defaultGoalDraft, formatCurrencyWithCode, type NewGoalInput } from '../lib/format';

const verdictStyle: Record<string, { tone: 'success' | 'warning' | 'danger' | 'neutral'; label: string }> = {
  on_track: { tone: 'success', label: 'On track' },
  achievable_with_cuts: { tone: 'warning', label: 'Achievable with cuts' },
  shortfall: { tone: 'warning', label: 'Shortfall' },
  needs_income_boost: { tone: 'danger', label: 'Needs income boost' }
};

const severityStyle: Record<string, { bar: string; badge: 'success' | 'warning' | 'danger' }> = {
  good: { bar: 'bg-emerald-400', badge: 'success' },
  warning: { bar: 'bg-amber-400', badge: 'warning' },
  alert: { bar: 'bg-red-400', badge: 'danger' }
};

export const GoalsPage = () => {
  const {
    goals,
    settings,
    savingsPlan,
    savingsPlanStale,
    isWorking,
    dashboardData,
    deleteGoalConfirmId,
    handleCreateGoal,
    handleGoalChange,
    handleDeleteGoal,
    handleGenerateSavingsPlan
  } = useWorkspace();
  const formatCurrency = (value: number) => formatCurrencyWithCode(value, settings.homeCurrency || 'CAD');

  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState<NewGoalInput>(defaultGoalDraft());

  const openCreateForm = (prefill?: Partial<NewGoalInput>) => {
    setDraft({ ...defaultGoalDraft(), ...prefill });
    setIsCreating(true);
  };

  const submitCreate = async () => {
    await handleCreateGoal(draft);
    setIsCreating(false);
  };

  const hasPlan = savingsPlan.recommendations.length > 0 || savingsPlan.goalForecasts.length > 0 || savingsPlan.financialSummary.length > 0;

  return (
    <div>
      <PageHeader
        eyebrow="Goals"
        title="Savings goals &amp; debt payoff"
        description="Set a target, and the optimizer proposes real cuts from your actual spending to help you get there."
        actions={
          <>
            <Button variant="secondary" onClick={() => openCreateForm()} icon={<Plus />}>
              Add goal
            </Button>
            {goals.goals.length > 0 ? (
              <Button disabled={isWorking} onClick={() => void handleGenerateSavingsPlan()} icon={<Target />}>
                Run optimizer
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <Card className="bg-slate-900/70 p-7">
            <p className="text-sm uppercase tracking-[0.2em] text-violet-300">Your goals</p>
            <div className="mt-5 space-y-4">
              {isCreating ? (
                <NewGoalForm draft={draft} onChange={setDraft} onCancel={() => setIsCreating(false)} onSubmit={submitCreate} isWorking={isWorking} />
              ) : null}

              {goals.goals.length === 0 && !isCreating ? (
                <EmptyState
                  icon={<Target />}
                  title="No goals yet"
                  description="Create your first goal to unlock optimizer forecasts."
                  action={
                    <Button size="sm" onClick={() => openCreateForm()} icon={<Plus />}>
                      Add goal
                    </Button>
                  }
                />
              ) : (
                goals.goals.map((goal) => (
                  <GoalCard
                    key={goal.id}
                    goal={goal}
                    onChange={handleGoalChange}
                    onDelete={handleDeleteGoal}
                    confirmingDelete={deleteGoalConfirmId === goal.id}
                    formatCurrency={formatCurrency}
                  />
                ))
              )}
            </div>
          </Card>

          <DebtPayoffCard debtSummary={dashboardData.debtSummary} formatCurrency={formatCurrency} onCreatePayoffGoal={openCreateForm} />
        </div>

        <div className="space-y-5">
          {savingsPlanStale && hasPlan ? (
            <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-sm text-amber-200">
              Goals changed since this plan was generated — click "Run optimizer" to refresh recommendations and forecasts.
            </div>
          ) : null}

          {savingsPlan.recommendations.length > 0 ? (
            <Card className="bg-slate-900/70 p-7">
              <div className="flex items-baseline justify-between gap-4">
                <p className="text-sm uppercase tracking-[0.2em] text-emerald-300">Where to cut</p>
                <p className="text-xl font-semibold text-emerald-300">
                  {formatCurrency(savingsPlan.totalMonthlySavings)}
                  <span className="text-sm font-normal text-slate-400"> / month freed</span>
                </p>
              </div>
              <ul className="mt-4 space-y-3">
                {savingsPlan.recommendations.map((recommendation) => (
                  <li key={recommendation.title} className="rounded-2xl bg-slate-950/70 p-4 text-sm">
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-medium text-slate-100">{recommendation.title}</span>
                      <span className="shrink-0 text-emerald-300">{formatCurrency(recommendation.monthlySavings)}/mo</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">{recommendation.rationale}</p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {savingsPlan.goalForecasts.length > 0 ? (
            <Card className="bg-slate-900/70 p-7">
              <p className="text-sm uppercase tracking-[0.2em] text-violet-300">Goal feasibility</p>
              <ul className="mt-4 space-y-4">
                {savingsPlan.goalForecasts.map((forecast) => {
                  const style = verdictStyle[forecast.verdict] ?? { tone: 'neutral' as const, label: forecast.verdict };
                  const matchingGoal = goals.goals.find((goal) => goal.id === forecast.goalId);
                  const targetAmount = matchingGoal?.targetAmount ?? 1;
                  const savedPct = matchingGoal ? Math.min(100, Math.round((matchingGoal.currentAmount / targetAmount) * 100)) : null;
                  const reachPct = Math.min(100, Math.round((forecast.maxReachableByDeadline / targetAmount) * 100));
                  return (
                    <li key={forecast.goalId} className="rounded-2xl bg-slate-950/70 p-4 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <span className="font-medium text-slate-100">{forecast.goalName}</span>
                        <Badge tone={style.tone}>{style.label}</Badge>
                      </div>
                      <p className="mt-2 leading-6 text-slate-300">{forecast.message}</p>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-400">
                        <div>
                          <p className="text-slate-500">Required / mo</p>
                          <p className="mt-0.5 font-medium text-slate-200">{formatCurrency(forecast.requiredMonthlySavings)}</p>
                        </div>
                        <div>
                          <p className="text-slate-500">Max reachable</p>
                          <p className="mt-0.5 font-medium text-slate-200">{formatCurrency(forecast.maxReachableByDeadline)}</p>
                        </div>
                        <div>
                          <p className="text-slate-500">Completion</p>
                          <p className="mt-0.5 font-medium text-slate-200">{forecast.projectedCompletionDate}</p>
                        </div>
                      </div>
                      {savedPct !== null ? (
                        <div className="mt-3">
                          <div className="mb-1 flex justify-between text-xs text-slate-500">
                            <span>Actually saved so far</span>
                            <span>{savedPct}%</span>
                          </div>
                          <Meter value={savedPct} tone={savedPct >= 100 ? 'success' : 'brand'} />
                        </div>
                      ) : null}
                      <div className="mt-3">
                        <div className="mb-1 flex justify-between text-xs text-slate-500">
                          <span>Projected progress by deadline</span>
                          <span>{reachPct}%</span>
                        </div>
                        <Meter value={reachPct} tone={reachPct >= 100 ? 'success' : reachPct >= 60 ? 'warning' : 'danger'} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}

          {savingsPlan.financialSummary.length > 0 ? (
            <Card className="bg-slate-900/70 p-7">
              <p className="text-sm uppercase tracking-[0.2em] text-sky-300">Financial health summary</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {savingsPlan.financialSummary.map((insight) => {
                  const style = severityStyle[insight.severity] ?? { bar: 'bg-slate-400', badge: 'neutral' as const };
                  return (
                    <div key={insight.title} className="rounded-2xl bg-slate-950/70 p-4">
                      <div className={`mb-3 h-0.5 w-10 rounded-full ${style.bar}`} />
                      <div className="flex items-start gap-2">
                        <Badge tone={style.badge} dot>
                          {insight.title}
                        </Badge>
                      </div>
                      <p className="mt-2 font-mono text-xs text-slate-400">{insight.metric}</p>
                      <p className="mt-3 text-sm leading-6 text-slate-300">{insight.recommendation}</p>
                    </div>
                  );
                })}
              </div>
            </Card>
          ) : null}

          {!hasPlan ? (
            <Card className="bg-slate-900/70 p-7">
              <EmptyState
                icon={<Target />}
                title="No optimizer plan yet"
                description={
                  goals.goals.length > 0
                    ? 'Click "Run optimizer" to get savings recommendations, goal feasibility forecasts, and a financial health summary.'
                    : 'Add a goal first, then run the optimizer to see recommendations tailored to it.'
                }
              />
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
};

const NewGoalForm = ({
  draft,
  onChange,
  onCancel,
  onSubmit,
  isWorking
}: {
  draft: NewGoalInput;
  onChange: (next: NewGoalInput) => void;
  onCancel: () => void;
  onSubmit: () => Promise<void>;
  isWorking: boolean;
}) => {
  const canSubmit = draft.name.trim().length > 0 && draft.targetAmount > 0 && draft.deadline.length > 0;

  return (
    <div className="rounded-2xl border border-sky-400/30 bg-slate-950/70 p-4">
      <p className="text-sm font-medium text-slate-100">New goal</p>
      <Input
        className="mt-3"
        label="Name"
        placeholder="e.g. Emergency fund, Pay off Visa, New car"
        value={draft.name}
        onChange={(event) => onChange({ ...draft, name: event.target.value })}
      />
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Input
          label="Target amount"
          type="number"
          min={0}
          value={draft.targetAmount}
          onChange={(event) => onChange({ ...draft, targetAmount: Number(event.target.value) })}
        />
        <Input
          label="Already saved"
          type="number"
          min={0}
          value={draft.currentAmount}
          onChange={(event) => onChange({ ...draft, currentAmount: Number(event.target.value) })}
        />
        <Input
          label="Monthly target"
          type="number"
          min={0}
          value={draft.monthlyContributionTarget}
          onChange={(event) => onChange({ ...draft, monthlyContributionTarget: Number(event.target.value) })}
        />
      </div>
      <Input className="mt-3" label="Deadline" type="date" value={draft.deadline} onChange={(event) => onChange({ ...draft, deadline: event.target.value })} />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} icon={<X />}>
          Cancel
        </Button>
        <Button size="sm" disabled={!canSubmit || isWorking} onClick={() => void onSubmit()} icon={<Plus />}>
          Create goal
        </Button>
      </div>
    </div>
  );
};

const GoalCard = ({
  goal,
  onChange,
  onDelete,
  confirmingDelete,
  formatCurrency
}: {
  goal: Goal;
  onChange: (goal: Goal) => Promise<void>;
  onDelete: (goalId: string) => Promise<void>;
  confirmingDelete: boolean;
  formatCurrency: (value: number) => string;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(goal);

  // Keeps the edit-form draft in sync with fresh data (e.g. after a re-import or another edit)
  // while the user isn't actively editing, without clobbering in-progress edits.
  useEffect(() => {
    if (!isEditing) {
      setDraft(goal);
    }
  }, [goal, isEditing]);

  const isCompleted = goal.targetAmount > 0 && goal.currentAmount >= goal.targetAmount;
  const pct = goal.targetAmount > 0 ? Math.min(100, Math.round((goal.currentAmount / goal.targetAmount) * 100)) : 0;
  const remainingDays = daysUntil(goal.deadline);

  const save = async () => {
    await onChange(draft);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="rounded-2xl border border-sky-400/30 bg-slate-950/70 p-4">
        <Input label="Name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Input label="Target" type="number" value={draft.targetAmount} onChange={(event) => setDraft({ ...draft, targetAmount: Number(event.target.value) })} />
          <Input
            label="Current"
            type="number"
            value={draft.currentAmount}
            onChange={(event) => setDraft({ ...draft, currentAmount: Number(event.target.value) })}
          />
          <Input
            label="Monthly target"
            type="number"
            value={draft.monthlyContributionTarget}
            onChange={(event) => setDraft({ ...draft, monthlyContributionTarget: Number(event.target.value) })}
          />
        </div>
        <Input className="mt-3" label="Deadline" type="date" value={draft.deadline} onChange={(event) => setDraft({ ...draft, deadline: event.target.value })} />
        <div className="mt-3 flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft(goal);
              setIsEditing(false);
            }}
            icon={<X />}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={() => void save()} icon={<Check />}>
            Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl bg-slate-950/70 p-4 ${isCompleted ? 'ring-1 ring-emerald-400/30' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium text-slate-100">{goal.name}</p>
            {isCompleted ? (
              <Badge tone="success" dot>
                Complete
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {formatCurrency(goal.currentAmount)} of {formatCurrency(goal.targetAmount)} &middot;{' '}
            {remainingDays >= 0 ? `${remainingDays} day${remainingDays === 1 ? '' : 's'} left` : 'Past deadline'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)} icon={<Pencil />} title="Edit goal" />
          <Button
            variant={confirmingDelete ? 'danger' : 'ghost'}
            size="sm"
            className={confirmingDelete ? '' : 'text-rose-300 hover:bg-rose-500/10'}
            onClick={() => void onDelete(goal.id)}
            icon={<Trash2 />}
            title={confirmingDelete ? 'Click again to confirm' : 'Delete goal'}
          >
            {confirmingDelete ? 'Confirm' : undefined}
          </Button>
        </div>
      </div>
      <div className="mt-3">
        <Meter value={pct} tone={isCompleted ? 'success' : pct >= 60 ? 'brand' : pct >= 25 ? 'warning' : 'danger'} />
        <p className="mt-1 text-right text-xs text-slate-500">{pct}% saved</p>
      </div>
    </div>
  );
};

const DebtPayoffCard = ({
  debtSummary,
  formatCurrency,
  onCreatePayoffGoal
}: {
  debtSummary: DashboardData['debtSummary'];
  formatCurrency: (value: number) => string;
  onCreatePayoffGoal: (prefill: Partial<NewGoalInput>) => void;
}) => {
  if (!debtSummary.hasBalanceData || debtSummary.accounts.length === 0) {
    return null;
  }

  return (
    <Card className="border-amber-500/10 bg-slate-900/70 p-7">
      <div className="flex items-center gap-2">
        <CreditCard className="h-4 w-4 text-amber-400" />
        <p className="text-sm uppercase tracking-[0.2em] text-amber-300">Debt payoff</p>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Real outstanding balances from your imports. Turn any of these into a goal to track payoff progress and bring it into the
        optimizer above.
      </p>
      <div className="mt-4 space-y-3">
        {debtSummary.accounts.map((account) => (
          <div key={account.accountName} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-950/70 p-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-200">{account.accountName}</p>
              <p className="mt-1 text-lg font-semibold text-amber-200">{formatCurrency(account.outstandingBalance)}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                owed as of {account.asOfDate ? new Date(account.asOfDate).toLocaleDateString() : 'unknown'}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                onCreatePayoffGoal({
                  name: `Pay off ${account.accountName}`,
                  targetAmount: account.outstandingBalance,
                  currentAmount: 0,
                  deadline: new Date(new Date().getFullYear(), new Date().getMonth() + 12, 1).toISOString().slice(0, 10)
                })
              }
            >
              Create payoff goal
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
};
