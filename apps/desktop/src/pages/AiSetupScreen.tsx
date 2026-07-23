import { useState } from 'react';
import { Bot, CheckCircle2, Sparkles, XCircle } from 'lucide-react';

import type { AiProvider } from '@ledgerpilot/core';
import { Button, Card, Input } from '@ledgerpilot/ui';

import { useWorkspace } from '../context/WorkspaceContext';

type ProviderOption = {
  id: Exclude<AiProvider, 'local-rules'>;
  label: string;
  description: string;
  needsApiKey: boolean;
  needsBaseUrl: boolean;
  defaultModel: string;
  defaultBaseUrl?: string;
};

const providerOptions: ProviderOption[] = [
  {
    id: 'claude',
    label: 'Claude (Anthropic)',
    description: 'Cloud. Requires an Anthropic API key.',
    needsApiKey: true,
    needsBaseUrl: false,
    defaultModel: 'claude-3-5-sonnet-20241022'
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI-compatible',
    description: 'Cloud. OpenAI, or any OpenAI-compatible endpoint (Azure, GitHub Models, local proxies, etc.).',
    needsApiKey: true,
    needsBaseUrl: true,
    defaultModel: 'gpt-4o-mini',
    defaultBaseUrl: 'https://api.openai.com'
  },
  {
    id: 'ollama',
    label: 'Ollama',
    description: 'Runs fully on this Mac — no subscription, no data leaves your machine. Requires Ollama installed and running.',
    needsApiKey: false,
    needsBaseUrl: true,
    defaultModel: 'llama3.1',
    defaultBaseUrl: 'http://127.0.0.1:11434'
  }
];

// Shown once, blocking, before the main app is reachable — LedgerPilot requires a real,
// verified AI backend (Claude, an OpenAI-compatible endpoint, or a local Ollama install) rather
// than silently defaulting to the free rule-based engine. This is a deliberate product decision:
// the app is positioned as AI-powered, and the setup step makes sure that's actually true for
// every install rather than something a user might never notice they hadn't configured.
export const AiSetupScreen = () => {
  const { settings, setSettings, handleSaveSettings } = useWorkspace();
  const [selected, setSelected] = useState<ProviderOption>(providerOptions[0] as ProviderOption);
  const [model, setModel] = useState(selected.defaultModel);
  const [baseUrl, setBaseUrl] = useState(selected.defaultBaseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | undefined>();
  const [isSaving, setIsSaving] = useState(false);

  const selectProvider = (option: ProviderOption) => {
    setSelected(option);
    setModel(option.defaultModel);
    setBaseUrl(option.defaultBaseUrl ?? '');
    setApiKey('');
    setTestResult(undefined);
  };

  const runTest = async () => {
    setIsTesting(true);
    setTestResult(undefined);
    try {
      const result = await window.ledgerPilot.settings.testProvider({
        provider: selected.id,
        model,
        baseUrl,
        apiKey
      });
      setTestResult({ success: result.success, message: result.message });
    } catch (error) {
      setTestResult({ success: false, message: error instanceof Error ? error.message : 'Connection test failed.' });
    } finally {
      setIsTesting(false);
    }
  };

  const canContinue = testResult?.success === true;

  const finishSetup = async () => {
    if (!canContinue) return;
    setIsSaving(true);
    try {
      setSettings({
        ...settings,
        aiProvider: selected.id,
        providerSettings: {
          ...settings.providerSettings,
          ollamaModel: selected.id === 'ollama' ? model : settings.providerSettings.ollamaModel,
          cloudModel: selected.id !== 'ollama' ? model : settings.providerSettings.cloudModel,
          apiBaseUrl: baseUrl || undefined
        },
        cloudAiEnabled: selected.id !== 'ollama',
        aiSetupCompleted: true
      });
      // handleSaveSettings reads from `settings` state, which won't have flushed yet from the
      // setSettings call above in this same tick — save explicitly with the values we just chose.
      await window.ledgerPilot.settings.save({
        settings: {
          ...settings,
          aiProvider: selected.id,
          providerSettings: {
            ...settings.providerSettings,
            ollamaModel: selected.id === 'ollama' ? model : settings.providerSettings.ollamaModel,
            cloudModel: selected.id !== 'ollama' ? model : settings.providerSettings.cloudModel,
            apiBaseUrl: baseUrl || undefined
          },
          cloudAiEnabled: selected.id !== 'ollama',
          aiSetupCompleted: true
        },
        apiKey: apiKey || undefined
      });
      await window.ledgerPilot.imports.history(); // cheap no-op call to confirm IPC is alive before reload
      window.location.reload();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-12 text-slate-100">
      <Card className="w-full max-w-2xl border-sky-500/10 bg-slate-900/80 p-9">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-gradient shadow-glow">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-sky-400">Welcome to LedgerPilot</p>
            <h1 className="text-2xl font-semibold text-white">Connect an AI provider to continue</h1>
          </div>
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-400">
          LedgerPilot is an AI-powered finance copilot — categorization, the advisor, and savings planning all run
          through a real model. Choose a provider and verify the connection before continuing.
        </p>

        <div className="mt-6 grid gap-3">
          {providerOptions.map((option) => (
            <button
              key={option.id}
              onClick={() => selectProvider(option)}
              className={[
                'rounded-2xl border p-4 text-left transition-colors',
                selected.id === option.id ? 'border-sky-400/50 bg-sky-400/5' : 'border-white/5 bg-slate-950/60 hover:border-white/15'
              ].join(' ')}
            >
              <div className="flex items-center justify-between">
                <p className="font-medium text-slate-100">{option.label}</p>
                {selected.id === option.id ? <CheckCircle2 className="h-4 w-4 text-sky-400" /> : null}
              </div>
              <p className="mt-1 text-xs text-slate-500">{option.description}</p>
            </button>
          ))}
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Input label="Model" value={model} onChange={(event) => setModel(event.target.value)} />
          {selected.needsBaseUrl ? (
            <Input label="Base URL" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
          ) : null}
          {selected.needsApiKey ? (
            <Input
              label="API key"
              type="password"
              containerClassName="sm:col-span-2"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={`Paste your ${selected.label} API key`}
            />
          ) : null}
        </div>

        {testResult ? (
          <div
            className={[
              'mt-5 flex items-start gap-2.5 rounded-2xl p-4 text-sm',
              testResult.success ? 'bg-emerald-500/10 text-emerald-200' : 'bg-rose-500/10 text-rose-200'
            ].join(' ')}
          >
            {testResult.success ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{testResult.message}</span>
          </div>
        ) : null}

        <div className="mt-6 flex items-center gap-3">
          <Button
            variant="secondary"
            disabled={isTesting || (selected.needsApiKey && !apiKey.trim())}
            onClick={() => void runTest()}
            icon={<Bot />}
          >
            {isTesting ? 'Testing…' : 'Test connection'}
          </Button>
          <Button disabled={!canContinue || isSaving} onClick={() => void finishSetup()}>
            {isSaving ? 'Saving…' : 'Continue to LedgerPilot'}
          </Button>
        </div>
        <p className="mt-4 text-xs text-slate-600">
          You can change providers any time from Settings. Your API key is stored in macOS Keychain, never in plain text.
        </p>
      </Card>
    </div>
  );
};
