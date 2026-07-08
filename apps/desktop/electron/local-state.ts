import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import type {
  AppSettings,
  BackupHistory,
  BackupRecord,
  ExportPayload,
  ExportRecord,
  Goal,
  GoalsPayload,
  SettingsPayload
} from '@ledgerpilot/core';

const execFileAsync = promisify(execFile);

const keychainServiceName = 'LedgerPilot';
const apiKeyAccount = 'openai-compatible-api-key';
const backupKeyAccount = 'backup-encryption-key';

const defaultSettings: AppSettings = {
  aiProvider: 'local-rules',
  providerSettings: {
    localModel: 'rule-engine',
    ollamaModel: 'llama3.1',
    apiBaseUrl: 'http://127.0.0.1:11434',
    apiKeyConfigured: false
  },
  theme: 'dark',
  notificationsEnabled: true,
  cloudAiEnabled: false,
  telemetryEnabled: false,
  importHistoryRetentionDays: 365
};

const settingsFileName = 'app-settings.json';
const goalsFileName = 'goals.json';
const backupHistoryFileName = 'backup-history.json';

const readJsonFile = async <T>(filePath: string, fallback: T): Promise<T> => {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content) as T;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') {
      return fallback;
    }

    throw error;
  }
};

const writeJsonFile = async (filePath: string, payload: unknown) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
};

const getSettingsPath = (workspaceRoot: string) => path.join(workspaceRoot, 'settings', settingsFileName);
const getGoalsPath = (workspaceRoot: string) => path.join(workspaceRoot, 'settings', goalsFileName);
const getBackupHistoryPath = (workspaceRoot: string) =>
  path.join(workspaceRoot, 'settings', backupHistoryFileName);

const getKeychainPassword = async (account: string) => {
  try {
    const { stdout } = await execFileAsync('security', [
      'find-generic-password',
      '-a',
      account,
      '-s',
      keychainServiceName,
      '-w'
    ]);
    return stdout.trim();
  } catch (error) {
    return undefined;
  }
};

const setKeychainPassword = async (account: string, password: string) => {
  await execFileAsync('security', [
    'add-generic-password',
    '-a',
    account,
    '-s',
    keychainServiceName,
    '-w',
    password,
    '-U'
  ]);
};

const getOrCreateBackupKey = async () => {
  const existing = await getKeychainPassword(backupKeyAccount);
  if (existing) {
    return Buffer.from(existing, 'hex');
  }

  const generated = crypto.randomBytes(32);
  await setKeychainPassword(backupKeyAccount, generated.toString('hex'));
  return generated;
};

export const loadSettings = async (workspaceRoot: string): Promise<SettingsPayload> => {
  const fileSettings = await readJsonFile<AppSettings>(getSettingsPath(workspaceRoot), defaultSettings);
  const apiKeyConfigured = Boolean(await getKeychainPassword(apiKeyAccount));

  return {
    settings: {
      ...defaultSettings,
      ...fileSettings,
      providerSettings: {
        ...defaultSettings.providerSettings,
        ...fileSettings.providerSettings,
        apiKeyConfigured
      }
    }
  };
};

export const saveSettings = async (
  workspaceRoot: string,
  payload: SettingsPayload & { apiKey?: string },
): Promise<SettingsPayload> => {
  const nextSettings = payload.settings;

  if (payload.apiKey) {
    await setKeychainPassword(apiKeyAccount, payload.apiKey);
  }

  await writeJsonFile(getSettingsPath(workspaceRoot), {
    ...nextSettings,
    providerSettings: {
      ...nextSettings.providerSettings,
      apiKeyConfigured: undefined
    }
  });

  return loadSettings(workspaceRoot);
};

export const loadGoals = async (workspaceRoot: string): Promise<GoalsPayload> => {
  return readJsonFile<GoalsPayload>(getGoalsPath(workspaceRoot), { goals: [] });
};

export const upsertGoal = async (workspaceRoot: string, goal: Goal): Promise<GoalsPayload> => {
  const current = await loadGoals(workspaceRoot);
  const nextGoals = current.goals.some((entry) => entry.id === goal.id)
    ? current.goals.map((entry) => (entry.id === goal.id ? goal : entry))
    : [...current.goals, goal];

  const payload = { goals: nextGoals.sort((left, right) => left.deadline.localeCompare(right.deadline)) };
  await writeJsonFile(getGoalsPath(workspaceRoot), payload);
  return payload;
};

export const deleteGoal = async (workspaceRoot: string, goalId: string): Promise<GoalsPayload> => {
  const current = await loadGoals(workspaceRoot);
  const payload = { goals: current.goals.filter((goal) => goal.id !== goalId) };
  await writeJsonFile(getGoalsPath(workspaceRoot), payload);
  return payload;
};

export const loadBackupHistory = async (workspaceRoot: string): Promise<BackupHistory> => {
  return readJsonFile<BackupHistory>(getBackupHistoryPath(workspaceRoot), { backups: [] });
};

export const createEncryptedBackup = async (
  workspaceRoot: string,
  settings: AppSettings,
): Promise<BackupRecord> => {
  const backupRoot = settings.backupDirectory ?? path.join(workspaceRoot, 'backups');
  await fs.mkdir(backupRoot, { recursive: true });

  const key = await getOrCreateBackupKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const databasePath = path.join(workspaceRoot, 'database', 'ledgerpilot.sqlite');
  const settingsPath = getSettingsPath(workspaceRoot);
  const goalsPath = getGoalsPath(workspaceRoot);

  const bundle = JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      files: {
        database: (await fs.readFile(databasePath)).toString('base64'),
        settings: await readJsonFile(settingsPath, {}),
        goals: await readJsonFile(goalsPath, { goals: [] }),
        reports: await readJsonFile(path.join(workspaceRoot, 'reports', 'index.json'), {})
      }
    },
    null,
    2,
  );

  const encrypted = Buffer.concat([cipher.update(bundle, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const fileName = `ledgerpilot-backup-${Date.now()}.lpbak`;
  const archivePath = path.join(backupRoot, fileName);

  await fs.writeFile(
    archivePath,
    JSON.stringify(
      {
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex'),
        payload: encrypted.toString('base64')
      },
      null,
      2,
    ),
    'utf8',
  );

  const stats = await fs.stat(archivePath);
  const record: BackupRecord = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    archivePath,
    sizeBytes: stats.size
  };

  const history = await loadBackupHistory(workspaceRoot);
  await writeJsonFile(getBackupHistoryPath(workspaceRoot), { backups: [record, ...history.backups] });
  return record;
};

export const exportWorkspaceData = async (
  workspaceRoot: string,
  payload: unknown,
): Promise<ExportPayload> => {
  const exportDirectory = path.join(workspaceRoot, 'reports', 'exports');
  await fs.mkdir(exportDirectory, { recursive: true });
  const filePath = path.join(exportDirectory, `ledgerpilot-export-${Date.now()}.json`);
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');

  const record: ExportRecord = {
    generatedAt: new Date().toISOString(),
    filePath,
    format: 'json'
  };

  return { record };
};
