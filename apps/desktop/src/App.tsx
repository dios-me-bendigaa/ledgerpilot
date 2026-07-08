import { workspaceBlueprint } from '@ledgerpilot/core';
import { Card } from '@ledgerpilot/ui';

const metrics = [
  { label: 'Workspace folders', value: workspaceBlueprint.length.toString() },
  { label: 'CSV imports supported', value: '10 / batch' },
  { label: 'Processing mode', value: 'Local first' },
  { label: 'AI providers', value: 'Ollama + OpenAI API' }
];

const phaseItems = [
  'Encrypted local workspace bootstrap',
  'Desktop shell and release pipeline',
  'FastAPI sidecar for AI workflows',
  'Shared domain model for imports and analytics'
];

export const App = () => {
  return (
    <main className="min-h-screen bg-slate-950 px-8 py-10 text-slate-100">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <section className="grid gap-8 lg:grid-cols-[1.6fr_1fr]">
          <Card className="border-sky-500/20 bg-slate-900/80 p-8">
            <p className="text-sm uppercase tracking-[0.32em] text-sky-300">
              Phase 1 foundation
            </p>
            <h1 className="mt-4 text-5xl font-semibold tracking-tight">
              LedgerPilot
            </h1>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-300">
              Local-first personal finance intelligence for macOS. Imports,
              storage, processing, and AI workflows stay on-device by default.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {metrics.map((metric) => (
                <Card key={metric.label} className="bg-slate-950/80 p-4">
                  <p className="text-sm text-slate-400">{metric.label}</p>
                  <p className="mt-2 text-2xl font-semibold">{metric.value}</p>
                </Card>
              ))}
            </div>
          </Card>

          <Card className="bg-slate-900/60 p-8">
            <p className="text-sm uppercase tracking-[0.3em] text-emerald-300">
              Workspace blueprint
            </p>
            <ul className="mt-6 space-y-3 text-sm text-slate-300">
              {workspaceBlueprint.map((entry) => (
                <li key={entry} className="rounded-xl bg-slate-950/80 px-4 py-3">
                  {entry}
                </li>
              ))}
            </ul>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          {phaseItems.map((item, index) => (
            <Card key={item} className="bg-slate-900/60 p-6">
              <p className="text-sm text-sky-300">0{index + 1}</p>
              <h2 className="mt-3 text-xl font-semibold">{item}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                Production-focused scaffolding to support import pipelines,
                analytics, and offline AI features without redesign.
              </p>
            </Card>
          ))}
        </section>
      </div>
    </main>
  );
};
