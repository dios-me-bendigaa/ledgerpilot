import { useState } from 'react';
import { Bot, CheckCircle2, Sparkles, XCircle } from 'lucide-react';

import type { AiProvider, AppSettings } from '@ledgerpilot/core';
import { Button, Card, Input } from '@ledgerpilot/ui';

import { useWorkspace } from '../context/WorkspaceContext';
import { providerRequiresConnectionTest } from '../lib/startup';

type ProviderOption = {
  id: AiProvider;
  label: string;
  description: string;
  needsApiKey: boolean;
  needsBaseUrl: boolean;
  defaultModel: string;
  defaultBaseUrl?: string;
};

const providerOptions: ProviderOption[] = [
  {
    id: 'local-rules',
    label: 'Local rules',
    description: 'Private and offline. Uses LedgerPilot’s built-in finance rules without an AI model or API key.',
    needsApiKey: false,
    needsBaseUrl: false,
    defaultModel: 'rule-engine'
  },
  {
    id: 'ollama',
    label: 'Local LLM (Ollama)',
    description: 'Uses a model running on this Mac. Requires Ollama and the selected model to be installed.',
    needsApiKey: false,
    needsBaseUrl: true,
    defaultModel: 'llama3.1',
    defaultBaseUrl: 'http://127.0.0.1:11434'
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI or compatible API',
    description: 'Uses an OpenAI API key or a compatible chat-completions endpoint. ChatGPT subscriptions do not include API usage.',
    needsApiKey: true,
    needsBaseUrl: true,
    defaultModel: 'gpt-5',
    defaultBaseUrl: 'https://api.openai.com'
  },
  {
    id: 'claude',
    label: 'Claude (Anthropic API)',
    description: 'Uses an Anthropic API key. A Claude consumer subscription does not include API usage.',
    needsApiKey: true,
    needsBaseUrl: true,
    defaultModel: 'claude-sonnet-4-20250514',
    defaultBaseUrl: 'https://api.anthropic.com'
  }
];

const optionFor = (provider: AiProvider) =>
  providerOptions.find((option) => option.id === provider) ?? providerOptions[0] as ProviderOption;

const modelFor = (settings: AppSettings, option: ProviderOption) => {
  if (option.id === 'local-rules') return settings.providerSettings.localModel || option.defaultModel;
  if (option.id === 'ollama') return settings.providerSettings.ollamaModel || option.defaultModel;
  return settings.providerSettings.cloudModel || option.defaultModel;
};

export const AiSetupScreen = () => {
  const { appSettings, handleCompleteAiSetup } = useWorkspace();
  const initialOption = optionFor(appSettings.aiProvider);
  const [selected, setSelected] = useState<ProviderOption>(initialOption);
  const [model, setModel] = useState(modelFor(appSettings, initialOption));
  const [baseUrl, setBaseUrl] = useState(appSettings.providerSettings.apiBaseUrl || initialOption.defaultBaseUrl || '');
  const [apiKey, setApiKey] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string }>();
  const [isSaving, setIsSaving] = useState(false);
  const [isSavedConfigurationUnchanged, setIsSavedConfigurationUnchanged] = useState(true);

  const requiresConnectionTest = providerRequiresConnectionTest(selected.id);
  const canTest =
    !isTesting &&
    model.trim().length > 0 &&
    (!selected.needsBaseUrl || baseUrl.trim().length > 0) &&
    (!selected.needsApiKey || apiKey.trim().length > 0);
  const canContinue =
    selected.id === 'local-rules' ||
    testResult?.success === true ||
    // On later launches the saved provider configuration has already passed setup. The user can
    // confirm it and continue without exposing/retyping the Keychain-stored API key.
    (appSettings.aiSetupCompleted && selected.id === appSettings.aiProvider && isSavedConfigurationUnchanged);

  const invalidateTest = () => setTestResult(undefined);

  const selectProvider = (option: ProviderOption) => {
    setSelected(option);
    setModel(option.defaultModel);
    setBaseUrl(option.defaultBaseUrl ?? '');
    setApiKey('');
    setTestResult(undefined);
    setIsSavedConfigurationUnchanged(false);
  };

  const runTest = async () => {
    if (!canTest) return;
    setIsTesting(true);
    setTestResult(undefined);
    try {
      const result = await window.ledgerPilot.settings.testProvider({
        provider: selected.id,
        model: model.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() || undefined
      });
      setTestResult({ success: result.success, message: result.message });
    } catch (error) {
      setTestResult({ success: false, message: error instanceof Error ? error.message : 'Connection test failed.' });
    } finally {
      setIsTesting(false);
    }
  };

  const finishSetup = async () => {
    if (!canContinue) return;
    setIsSaving(true);
    try {
      const nextSettings: AppSettings = {
        ...appSettings,
        aiProvider: selected.id,
        providerSettings: {
          ...appSettings.providerSettings,
          localModel: selected.id === 'local-rules' ? model.trim() || 'rule-engine' : appSettings.providerSettings.localModel,
          ollamaModel: selected.id === 'ollama' ? model.trim() : appSettings.providerSettings.ollamaModel,
          cloudModel:
            selected.id === 'openai-compatible' || selected.id === 'claude'
              ? model.trim()
              : appSettings.providerSettings.cloudModel,
          apiBaseUrl: selected.needsBaseUrl ? baseUrl.trim() : undefined
        },
        cloudAiEnabled: selected.id === 'openai-compatible' || selected.id === 'claude',
        aiSetupCompleted: true
      };
      await handleCompleteAiSetup(nextSettings, apiKey);
    } catch (error) {
      setTestResult({ success: false, message: error instanceof Error ? error.message : 'Could not save AI settings.' });
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
            <h1 className="text-2xl font-semibold text-white">Choose how LedgerPilot analyzes your data</h1>
          </div>
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-400">
          Start fully offline with built-in rules, connect a model running on this Mac, or use a cloud API.
          You’ll choose or create a financial workspace next.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {providerOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => selectProvider(option)}
              className={[
                'rounded-2xl border p-4 text-left transition-colors',
                selected.id === option.id
                  ? 'border-sky-400/50 bg-sky-400/5'
                  : 'border-white/5 bg-slate-950/60 hover:border-white/15'
              ].join(' ')}
            >
              <div className="flex items-center justify-between">
                <p className="font-medium text-slate-100">{option.label}</p>
                {selected.id === option.id ? <CheckCircle2 className="h-4 w-4 text-sky-400" /> : null}
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-500">{option.description}</p>
            </button>
          ))}
        </div>

        {selected.id === 'local-rules' ? (
          <div className="mt-6 rounded-2xl bg-emerald-500/10 p-4 text-sm text-emerald-200">
            No connection test is needed. Your imported financial data stays on this Mac.
          </div>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Input
              label="Model name"
              value={model}
              onChange={(event) => {
                setModel(event.target.value);
                invalidateTest();
                setIsSavedConfigurationUnchanged(false);
              }}
            />
            {selected.needsBaseUrl ? (
              <Input
                label="Base URL"
                value={baseUrl}
                onChange={(event) => {
                  setBaseUrl(event.target.value);
                  invalidateTest();
                  setIsSavedConfigurationUnchanged(false);
                }}
              />
            ) : null}
            {selected.needsApiKey ? (
              <Input
                label="API key"
                type="password"
                containerClassName="sm:col-span-2"
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  invalidateTest();
                  setIsSavedConfigurationUnchanged(false);
                }}
                placeholder={`Paste your ${selected.label} key`}
              />
            ) : null}
          </div>
        )}

        {testResult ? (
          <div
            className={[
              'mt-5 flex items-start gap-2.5 rounded-2xl p-4 text-sm',
              testResult.success ? 'bg-emerald-500/10 text-emerald-200' : 'bg-rose-500/10 text-rose-200'
            ].join(' ')}
          >
            {testResult.success ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span>{testResult.message}</span>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {requiresConnectionTest ? (
            <Button variant="secondary" disabled={!canTest} onClick={() => void runTest()} icon={<Bot />}>
              {isTesting ? 'Testing…' : 'Test connection'}
            </Button>
          ) : null}
          <Button disabled={!canContinue || isSaving} onClick={() => void finishSetup()}>
            {isSaving ? 'Saving…' : selected.id === 'local-rules' ? 'Continue with Local Rules' : 'Continue to workspaces'}
          </Button>
        </div>
        <p className="mt-4 text-xs leading-5 text-slate-600">
          API keys are stored in macOS Keychain, never in workspace files. Provider settings can be changed later.
        </p>
      </Card>
    </div>
  );
};
