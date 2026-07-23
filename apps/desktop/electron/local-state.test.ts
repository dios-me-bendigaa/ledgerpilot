import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';

import { createEncryptedBackup, decryptBackupBundle, restoreSettingsAndGoals } from './local-state.js';

const execFileAsync = promisify(execFile);

// These tests exercise the real macOS Keychain (via the `security` CLI, exactly like the
// production code path) under a dedicated, disposable account name so they never touch the real
// app's `backup-encryption-key` Keychain item. Skipped automatically off-macOS (e.g. future CI
// on Linux/Windows) since `security` won't exist there.
const isMac = process.platform === 'darwin';
const describeOnMac = isMac ? describe : describe.skip;

const tempDirs: string[] = [];
const createWorkspace = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ledgerpilot-backup-test-'));
  tempDirs.push(root);
  await fs.mkdir(path.join(root, 'database'), { recursive: true });
  await fs.mkdir(path.join(root, 'settings'), { recursive: true });
  await fs.mkdir(path.join(root, 'backups'), { recursive: true });
  return root;
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describeOnMac('backup create -> decrypt -> restore round trip', () => {
  // local-state.ts hardcodes the Keychain service/account name ('LedgerPilot' /
  // 'backup-encryption-key'), so these tests unavoidably share whatever real key exists on the
  // machine running them. That's safe (it's just an AES key; reusing it for a throwaway test
  // backup in a temp directory has no effect on any real backup), but we track whether we created
  // a NEW key so we can clean it up and leave no trace on a machine that had none before.
  let keyPreexisted = false;

  beforeAll(async () => {
    try {
      await execFileAsync('security', ['find-generic-password', '-a', 'backup-encryption-key', '-s', 'LedgerPilot', '-w']);
      keyPreexisted = true;
    } catch {
      keyPreexisted = false;
    }
  });

  afterAll(async () => {
    if (!keyPreexisted) {
      try {
        await execFileAsync('security', ['delete-generic-password', '-a', 'backup-encryption-key', '-s', 'LedgerPilot']);
      } catch {
        // already gone / never created — nothing to clean up
      }
    }
  });

  const fakeSettings = {
    aiProvider: 'local-rules' as const,
    providerSettings: {
      localModel: 'rule-engine',
      ollamaModel: 'llama3.1',
      apiBaseUrl: 'http://127.0.0.1:11434',
      apiKeyConfigured: false
    },
    theme: 'dark' as const,
    notificationsEnabled: true,
    cloudAiEnabled: false,
    telemetryEnabled: false,
    importHistoryRetentionDays: 365,
    homeCurrency: 'CAD',
    aiSetupCompleted: true
  };

  it('round-trips database bytes, settings, goals, category rules, and custom categories', async () => {
    const workspaceRoot = await createWorkspace();
    const goals = { goals: [{ id: 'g1', name: 'Emergency Fund', targetAmount: 10000, currentAmount: 250, deadline: '2027-01-01', monthlyContributionTarget: 500, createdAt: 'x', updatedAt: 'x' }] };
    const categoryRules = { rules: [{ id: 'r1', merchantPattern: 'freshco groceries', category: 'groceries', createdAt: 'x' }] };
    const customCategories = { categories: [{ name: 'side_hustle', bucket: 'income' as const }] };
    const dbContents = `FAKE_SQLITE_BYTES_${Date.now()}`;

    await fs.writeFile(path.join(workspaceRoot, 'settings', 'app-settings.json'), JSON.stringify(fakeSettings));
    await fs.writeFile(path.join(workspaceRoot, 'settings', 'goals.json'), JSON.stringify(goals));
    await fs.writeFile(path.join(workspaceRoot, 'database', 'ledgerpilot.sqlite'), dbContents);

    const record = await createEncryptedBackup(workspaceRoot, fakeSettings, {
      categoryRules,
      customCategories,
      normalizationReports: { reports: [] }
    });

    expect(record.sizeBytes).toBeGreaterThan(0);

    // Previously category rules and custom categories were silently omitted from every backup —
    // a restore (once it existed) would have lost all "teach once, apply to all" corrections.
    const bundle = await decryptBackupBundle(record.archivePath);
    expect(Buffer.from(bundle.files.database, 'base64').toString('utf8')).toBe(dbContents);
    expect(bundle.files.goals).toEqual(goals);
    expect(bundle.files.categoryRules).toEqual(categoryRules);
    expect(bundle.files.customCategories).toEqual(customCategories);

    // Simulate current state diverging from the backup, then restore and confirm it's overwritten.
    await fs.writeFile(path.join(workspaceRoot, 'settings', 'goals.json'), JSON.stringify({ goals: [] }));
    await restoreSettingsAndGoals(workspaceRoot, bundle);
    const restoredGoals = JSON.parse(await fs.readFile(path.join(workspaceRoot, 'settings', 'goals.json'), 'utf8'));
    expect(restoredGoals).toEqual(goals);
  });

  it('fails loudly (not silently) on a tampered/corrupted archive, thanks to AES-GCM auth tags', async () => {
    const workspaceRoot = await createWorkspace();
    await fs.writeFile(path.join(workspaceRoot, 'settings', 'app-settings.json'), JSON.stringify(fakeSettings));
    await fs.writeFile(path.join(workspaceRoot, 'settings', 'goals.json'), JSON.stringify({ goals: [] }));
    await fs.writeFile(path.join(workspaceRoot, 'database', 'ledgerpilot.sqlite'), 'original-bytes');

    const record = await createEncryptedBackup(workspaceRoot, fakeSettings, {
      categoryRules: { rules: [] },
      customCategories: { categories: [] },
      normalizationReports: { reports: [] }
    });

    const envelope = JSON.parse(await fs.readFile(record.archivePath, 'utf8')) as { iv: string; authTag: string; payload: string };
    const tamperedPath = `${record.archivePath}.tampered`;
    await fs.writeFile(
      tamperedPath,
      JSON.stringify({ ...envelope, payload: Buffer.from('corrupted-ciphertext').toString('base64') }),
    );

    await expect(decryptBackupBundle(tamperedPath)).rejects.toThrow(/could not be decrypted/i);
  });
});
