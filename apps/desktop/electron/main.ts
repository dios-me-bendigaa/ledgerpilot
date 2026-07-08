import { app, BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { workspaceBlueprint } from '@ledgerpilot/core';

const isDev = !app.isPackaged;

const ensureWorkspace = async () => {
  const root = path.join(app.getPath('appData'), 'LedgerPilot');

  await Promise.all(
    workspaceBlueprint.map((entry) => fs.mkdir(path.join(root, entry), { recursive: true })),
  );
};

const createWindow = async () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1200,
    minHeight: 800,
    backgroundColor: '#020617',
    webPreferences: {
      contextIsolation: true,
      sandbox: true
    }
  });

  if (isDev) {
    await window.loadURL('http://localhost:5173');
    return;
  }

  await window.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
};

app.whenReady().then(() => {
  void ensureWorkspace().then(createWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
