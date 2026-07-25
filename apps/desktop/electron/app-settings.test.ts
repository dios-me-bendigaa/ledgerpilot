import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { AppSettings } from '@ledgerpilot/core';
import { afterEach, describe, expect, it } from 'vitest';

import { loadSettings, saveSettings, settingsFileExists } from './local-state.js';

const tempDirs: string[] = [];

const createRoot = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ledgerpilot-app-settings-'));
  tempDirs.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('app-level AI settings persistence', () => {
  it('starts unconfigured and persists Local Rules as a completed setup without an API key', async () => {
    const root = await createRoot();
    expect(await settingsFileExists(root)).toBe(false);

    const defaults = (await loadSettings(root)).settings;
    expect(defaults.aiSetupCompleted).toBe(false);

    const configured: AppSettings = {
      ...defaults,
      aiProvider: 'local-rules',
      cloudAiEnabled: false,
      aiSetupCompleted: true
    };
    await saveSettings(root, { settings: configured });

    expect(await settingsFileExists(root)).toBe(true);
    const reloaded = (await loadSettings(root)).settings;
    expect(reloaded.aiProvider).toBe('local-rules');
    expect(reloaded.aiSetupCompleted).toBe(true);
  });
});
