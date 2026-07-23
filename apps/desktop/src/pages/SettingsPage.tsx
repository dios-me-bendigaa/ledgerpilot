import { useState } from 'react';
import { AlertTriangle, Bot, CheckCircle2, DatabaseBackup, Download, KeyRound, Shield, Trash2, XCircle } from 'lucide-react';

import type { AppSettings } from '@ledgerpilot/core';
import { Badge, Button, Card, EmptyState, Input, Select, Switch } from '@ledgerpilot/ui';

import { PageHeader } from '../components/PageHeader';
import { useWorkspace } from '../context/WorkspaceContext';
import { formatBytes } from '../lib/format';

export const SettingsPage = () => {
  const {
    settings,
    setSettings,
    apiKeyInput,
    setApiKeyInput,
    isWorking,
    handleSaveSettings,
    backups,
    exportRecord,
    clearConfirm,
    restoreConfirmId,
    handleCreateBackup,
    handleRestoreBackup,
    handleExport,
    handleClearAllData
  } = useWorkspace();

  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | undefined>();

  const runTest = async () => {
    setIsTesting(true);
    setTestResult(undefined);
    try {
      const modelValue =
        settings.aiProvider === 'ollama' ? settings.providerSettings.ollamaModel : settings.providerSettings.cloudModel;
      const result = await window.ledgerPilot.settings.testProvider({
        provider: settings.aiProvider,
        model: modelValue,
        baseUrl: settings.providerSettings.apiBaseUrl,
        apiKey: apiKeyInput || undefined
      });
      setTestResult({ success: result.success, message: result.message });
    } catch (error) {
      setTestResult({ success: false, message: error instanceof Error ? error.message : 'Connection test failed.' });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div>
      <PageHeader eyebrow="Settings" title="Configuration &amp; data" description="AI provider, currency, backups, export, and your privacy controls." />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="bg-slate-900/70 p-7">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-amber-400" />
            <p className="text-sm uppercase tracking-[0.2em] text-amber-300">AI &amp; currency</p>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Select
              label="AI provider"
              value={settings.aiProvider}
              onChange={(event) => {
                setSettings({ ...settings, aiProvider: event.target.value as AppSettings['aiProvider'] });
                setTestResult(undefined);
              }}
            >
              <option value="local-rules">Local rules (fully private, no AI model)</option>
              <option value="claude">Claude (Anthropic)</option>
              <option value="openai-compatible">OpenAI-compatible</option>
              <option value="ollama">Ollama (local, free)</option>
            </Select>
            <Input
              label="Home currency"
              className="uppercase"
              value={settings.homeCurrency}
              maxLength={3}
              placeholder="CAD"
              title="3-letter ISO 4217 code (e.g. CAD, USD, INR). Amounts are not converted across currencies."
              onChange={(event) => setSettings({ ...settings, homeCurrency: event.target.value.toUpperCase().slice(0, 3) })}
            />

            {settings.aiProvider !== 'local-rules' ? (
              <>
                <Input
                  label={settings.aiProvider === 'ollama' ? 'Ollama model' : 'Model'}
                  value={(settings.aiProvider === 'ollama' ? settings.providerSettings.ollamaModel : settings.providerSettings.cloudModel) ?? ''}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      providerSettings:
                        settings.aiProvider === 'ollama'
                          ? { ...settings.providerSettings, ollamaModel: event.target.value }
                          : { ...settings.providerSettings, cloudModel: event.target.value }
                    })
                  }
                />
                {settings.aiProvider === 'ollama' || settings.aiProvider === 'openai-compatible' ? (
                  <Input
                    label="Base URL"
                    value={settings.providerSettings.apiBaseUrl ?? ''}
                    onChange={(event) => setSettings({ ...settings, providerSettings: { ...settings.providerSettings, apiBaseUrl: event.target.value } })}
                  />
                ) : null}
                {settings.aiProvider === 'claude' || settings.aiProvider === 'openai-compatible' ? (
                  <Input
                    label="API key"
                    type="password"
                    containerClassName="sm:col-span-2"
                    placeholder={settings.providerSettings.apiKeyConfigured ? 'Stored in Keychain — leave blank to keep it' : 'Enter API key'}
                    value={apiKeyInput}
                    onChange={(event) => setApiKeyInput(event.target.value)}
                  />
                ) : null}
              </>
            ) : null}
          </div>

          {settings.aiProvider !== 'local-rules' ? (
            <div className="mt-4">
              <Button size="sm" variant="secondary" disabled={isTesting} onClick={() => void runTest()} icon={<Bot />}>
                {isTesting ? 'Testing…' : 'Test connection'}
              </Button>
              {testResult ? (
                <div
                  className={[
                    'mt-3 flex items-start gap-2 rounded-xl p-3 text-xs',
                    testResult.success ? 'bg-emerald-500/10 text-emerald-200' : 'bg-rose-500/10 text-rose-200'
                  ].join(' ')}
                >
                  {testResult.success ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                  <span>{testResult.message}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-5 space-y-2.5">
            <Switch
              label="Cloud AI"
              description="Allow sending data to Claude/OpenAI-compatible providers"
              checked={settings.cloudAiEnabled}
              onChange={(checked) => setSettings({ ...settings, cloudAiEnabled: checked })}
            />
            <Switch
              label="Notifications"
              checked={settings.notificationsEnabled}
              onChange={(checked) => setSettings({ ...settings, notificationsEnabled: checked })}
            />
            <Switch
              label="Telemetry"
              description="Off by default — never enabled without your explicit choice"
              checked={settings.telemetryEnabled}
              onChange={(checked) => setSettings({ ...settings, telemetryEnabled: checked })}
            />
          </div>

          <Button className="mt-5" disabled={isWorking} onClick={() => void handleSaveSettings()}>
            Save settings
          </Button>
        </Card>

        <div className="space-y-5">
          <Card className="bg-slate-900/70 p-7">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-emerald-400" />
              <p className="text-sm uppercase tracking-[0.2em] text-emerald-300">Privacy by default</p>
            </div>
            <ul className="mt-4 space-y-2 text-sm text-slate-400">
              <li>Raw financial data stays on this Mac unless you explicitly enable cloud AI.</li>
              <li>Backups are encrypted (AES-256-GCM) with a key stored in macOS Keychain.</li>
              <li>Telemetry is off by default and never silently enabled.</li>
            </ul>
          </Card>

          <Card className="bg-slate-900/70 p-7">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DatabaseBackup className="h-4 w-4 text-sky-400" />
                <p className="text-sm uppercase tracking-[0.2em] text-sky-300">Backups &amp; export</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={isWorking} onClick={() => void handleCreateBackup()}>
                  Create backup
                </Button>
                <Button size="sm" variant="secondary" disabled={isWorking} onClick={() => void handleExport()} icon={<Download />}>
                  Export
                </Button>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {backups.backups.length === 0 ? (
                <EmptyState title="No backups yet" description="Create an encrypted backup to protect your data." />
              ) : (
                backups.backups.map((backup) => (
                  <div key={backup.id} className="rounded-2xl bg-slate-950/70 p-4 text-sm">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-slate-300">{new Date(backup.createdAt).toLocaleString()}</span>
                      <Badge tone="neutral">{formatBytes(backup.sizeBytes)}</Badge>
                    </div>
                    <p className="mt-1.5 truncate text-xs text-slate-500">{backup.archivePath}</p>
                    <div className="mt-3 flex items-center justify-between gap-4">
                      {restoreConfirmId === backup.id ? (
                        <p className="text-xs text-amber-300">Overwrites all current data. A safety backup is taken first.</p>
                      ) : (
                        <span />
                      )}
                      <Button
                        size="sm"
                        variant={restoreConfirmId === backup.id ? 'danger' : 'secondary'}
                        disabled={isWorking}
                        onClick={() => void handleRestoreBackup(backup.id)}
                      >
                        {restoreConfirmId === backup.id ? 'Confirm restore' : 'Restore'}
                      </Button>
                    </div>
                  </div>
                ))
              )}

              {exportRecord ? (
                <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/5 p-4 text-sm">
                  <p className="font-medium text-emerald-300">Latest export</p>
                  <p className="mt-1.5 truncate text-slate-300">{exportRecord.filePath}</p>
                  <p className="mt-1 text-xs text-slate-500">{new Date(exportRecord.generatedAt).toLocaleString()}</p>
                </div>
              ) : null}
            </div>
          </Card>

          <Card className="border-rose-500/20 bg-rose-500/5 p-7">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-400" />
              <p className="text-sm uppercase tracking-[0.2em] text-rose-300">Danger zone</p>
            </div>
            <p className="mt-3 text-sm text-slate-400">
              Permanently deletes all imported transactions, history, reports, and settings from this workspace.
            </p>
            <Button
              className="mt-4"
              variant={clearConfirm ? 'danger' : 'secondary'}
              disabled={isWorking}
              onClick={() => void handleClearAllData()}
              icon={<Trash2 />}
            >
              {clearConfirm ? 'Confirm — delete everything' : 'Clear all data'}
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
};
