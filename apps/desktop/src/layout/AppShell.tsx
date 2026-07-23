import { Card, SkeletonText } from '@ledgerpilot/ui';

import { PageErrorBoundary } from '../components/PageErrorBoundary';
import { useWorkspace } from '../context/WorkspaceContext';
import { AdvisorPage } from '../pages/AdvisorPage';
import { AiSetupScreen } from '../pages/AiSetupScreen';
import { CategorizePage } from '../pages/CategorizePage';
import { GoalsPage } from '../pages/GoalsPage';
import { ImportPage } from '../pages/ImportPage';
import { OverviewPage } from '../pages/OverviewPage';
import { SettingsPage } from '../pages/SettingsPage';
import { TransactionsPage } from '../pages/TransactionsPage';
import { WorkspacePickerScreen } from '../pages/WorkspacePickerScreen';
import { Sidebar } from './Sidebar';

const pages = {
  overview: OverviewPage,
  transactions: TransactionsPage,
  categorize: CategorizePage,
  import: ImportPage,
  goals: GoalsPage,
  advisor: AdvisorPage,
  settings: SettingsPage
} as const;

export const AppShell = () => {
  const { activeView, fatalError, isLoadingWorkspaces, activeWorkspaceId, isLoadingWorkspace, settings } = useWorkspace();

  if (fatalError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-8 py-10 text-slate-100">
        <div className="mx-auto max-w-3xl">
          <Card className="border-rose-400/20 bg-rose-400/10 p-8">
            <p className="text-sm uppercase tracking-[0.32em] text-rose-200">LedgerPilot startup error</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight">The app failed while loading local data</h1>
            <p className="mt-4 text-sm leading-7 text-rose-100">
              Copy the details below. This is the exact renderer startup error instead of a blank screen.
            </p>
            <pre className="mt-6 max-h-96 overflow-auto rounded-3xl bg-slate-950/80 p-5 text-xs leading-6 text-slate-200">
              {fatalError}
            </pre>
          </Card>
        </div>
      </main>
    );
  }

  // The workspace list itself is still loading — distinct from isLoadingWorkspace below, which
  // only starts once a specific workspace has been selected. No sidebar yet: we don't know which
  // workspace's data (or even whether AI setup is complete) applies until one is chosen.
  if (isLoadingWorkspaces) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6">
        <div className="w-full max-w-xl space-y-4">
          <div className="h-8 w-48 animate-pulse rounded-xl bg-slate-800/60" />
          <div className="h-40 animate-pulse rounded-3xl bg-slate-900/60" />
        </div>
      </div>
    );
  }

  // Never auto-resumes the last-used workspace — always shown until the user explicitly picks or
  // creates one, every single launch.
  if (!activeWorkspaceId) {
    return <WorkspacePickerScreen />;
  }

  if (isLoadingWorkspace) {
    return (
      <div className="flex h-screen bg-slate-950">
        <div className="h-screen w-64 shrink-0 border-r border-white/5 bg-slate-950/60 p-5">
          <SkeletonText lines={6} />
        </div>
        <main className="flex-1 overflow-y-auto px-10 py-10">
          <div className="mx-auto max-w-6xl space-y-6">
            <div className="h-8 w-64 animate-pulse rounded-xl bg-slate-800/60" />
            <div className="grid gap-6 lg:grid-cols-3">
              {[0, 1, 2].map((index) => (
                <div key={index} className="h-32 animate-pulse rounded-3xl bg-slate-900/60" />
              ))}
            </div>
            <div className="h-72 animate-pulse rounded-3xl bg-slate-900/60" />
          </div>
        </main>
      </div>
    );
  }

  const ActivePage = pages[activeView];

  if (!settings.aiSetupCompleted) {
    return <AiSetupScreen />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-slate-100">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-10 py-10 animate-fade-in" key={activeView}>
          <PageErrorBoundary resetKey={activeView}>
            <ActivePage />
          </PageErrorBoundary>
        </div>
      </main>
    </div>
  );
};
