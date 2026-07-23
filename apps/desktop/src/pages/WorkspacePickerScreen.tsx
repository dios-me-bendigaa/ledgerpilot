import { useState } from 'react';
import { FolderOpen, Plus, Sparkles } from 'lucide-react';

import { Button, Card, EmptyState, Input } from '@ledgerpilot/ui';

import { useWorkspace } from '../context/WorkspaceContext';
import { relativeTime } from '../lib/format';

// Shown once per launch, before anything else (even the AI-setup gate) — workspaces are never
// auto-resumed, by design: the user always sees and confirms which set of financial data they're
// opening. Existing workspaces persist locally forever; there is deliberately no delete/remove
// action here (or anywhere yet) — only creation and selection.
export const WorkspacePickerScreen = () => {
  const { workspaces, handleSelectWorkspace, handleCreateWorkspace, isWorking } = useWorkspace();
  const [isCreating, setIsCreating] = useState(workspaces.length === 0);
  const [newName, setNewName] = useState('');
  const [pendingId, setPendingId] = useState<string>();

  const openWorkspace = async (id: string) => {
    setPendingId(id);
    await handleSelectWorkspace(id);
  };

  const submitCreate = async () => {
    if (!newName.trim()) return;
    await handleCreateWorkspace(newName.trim());
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-12 text-slate-100">
      <Card className="w-full max-w-xl border-sky-500/10 bg-slate-900/80 p-9">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-gradient shadow-glow">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-sky-400">LedgerPilot</p>
            <h1 className="text-2xl font-semibold text-white">Choose a workspace</h1>
          </div>
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-400">
          Each workspace keeps its own transactions, goals, and settings completely separate — useful for personal vs.
          family finances, or simply testing something without touching your real data.
        </p>

        {workspaces.length > 0 ? (
          <div className="mt-6 space-y-2.5">
            {workspaces.map((workspace) => (
              <button
                key={workspace.id}
                disabled={isWorking}
                onClick={() => void openWorkspace(workspace.id)}
                className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/5 bg-slate-950/60 p-4 text-left transition-colors hover:border-sky-400/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-slate-500">
                    <FolderOpen className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-medium text-slate-100">{workspace.name}</p>
                    <p className="text-xs text-slate-500">Last opened {relativeTime(workspace.lastOpenedAt)}</p>
                  </div>
                </div>
                <span className="shrink-0 text-xs text-sky-400">{pendingId === workspace.id && isWorking ? 'Opening…' : 'Open'}</span>
              </button>
            ))}
          </div>
        ) : null}

        {isCreating ? (
          <div className="mt-6 rounded-2xl border border-sky-400/30 bg-slate-950/70 p-4">
            <Input
              label="New workspace name"
              placeholder="e.g. Personal, Family, Test"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
            <div className="mt-3 flex justify-end gap-2">
              {workspaces.length > 0 ? (
                <Button variant="ghost" size="sm" onClick={() => setIsCreating(false)}>
                  Cancel
                </Button>
              ) : null}
              <Button size="sm" disabled={!newName.trim() || isWorking} onClick={() => void submitCreate()} icon={<Plus />}>
                {isWorking ? 'Creating…' : 'Create workspace'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-6">
            <Button variant="secondary" onClick={() => setIsCreating(true)} icon={<Plus />}>
              Create new workspace
            </Button>
          </div>
        )}

        {workspaces.length === 0 && !isCreating ? (
          <EmptyState className="mt-6" title="No workspaces yet" description="Create your first workspace to get started." />
        ) : null}
      </Card>
    </div>
  );
};
