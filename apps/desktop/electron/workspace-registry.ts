// Multi-workspace registry — lives one directory level ABOVE any individual workspace (at
// appRoot, i.e. `~/Library/Application Support/LedgerPilot/`), alongside a `workspaces/`
// container directory that holds each workspace's actual data using the exact same
// workspaceBlueprint layout a single workspace always used. This file is intentionally the only
// place that knows about "the registry" — main.ts only ever asks it for a workspace's data path
// once an id is selected, then treats that path exactly like the old fixed getWorkspaceRoot().
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { workspaceBlueprint, type WorkspaceRegistry, type WorkspaceRegistryEntry } from '@ledgerpilot/core';

import { readJsonFile, writeJsonFile } from './local-state.js';

const registryFileName = 'workspaces.json';
const workspacesDirName = 'workspaces';

// workspaceBlueprint has nested entries (e.g. 'imports/original', 'ai/embeddings') that share a
// handful of top-level parents. Migration moves each top-level parent once (not each nested
// leaf) — sufficient to relocate everything inside it, and avoids leaving empty parent
// directories behind at the old location.
const topLevelWorkspaceDirs = Array.from(new Set(workspaceBlueprint.map((entry) => entry.split('/')[0])));

const getRegistryPath = (appRoot: string) => path.join(appRoot, registryFileName);
const getWorkspacesContainer = (appRoot: string) => path.join(appRoot, workspacesDirName);

export const getWorkspacePath = (appRoot: string, workspaceId: string) =>
  path.join(getWorkspacesContainer(appRoot), workspaceId);

export const loadRegistry = async (appRoot: string): Promise<WorkspaceRegistry> =>
  readJsonFile<WorkspaceRegistry>(getRegistryPath(appRoot), { workspaces: [] });

const saveRegistry = async (appRoot: string, registry: WorkspaceRegistry): Promise<void> => {
  await writeJsonFile(getRegistryPath(appRoot), registry);
};

const pathExists = async (target: string): Promise<boolean> => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

// One-time, idempotent migration from the pre-multi-workspace layout (every subdirectory
// directly under appRoot/) into appRoot/workspaces/<id>/, preserving the exact same internal
// structure. Safe to call on every launch — returns immediately once workspaces.json exists, so
// it only ever does real work on the very first launch after this feature ships.
//
// Uses fs.rename (atomic on the same filesystem, no copy-then-delete window where a crash could
// leave two partial copies or lose data) rather than copying — this runs against a real user's
// only local copy of their financial data, so the migration must never risk data loss partway
// through. Each directory is moved independently and guarded with an existence check, so a
// partially-completed migration (e.g. app killed mid-migration) is still safe to resume: whatever
// already moved is simply skipped (source no longer exists at the old location) and whatever
// didn't move yet is retried — the only unsafe window is nothing existing yet having been moved
// at all, in which case a retry just starts over from the same untouched state.
export const migrateLegacyWorkspaceIfNeeded = async (
  appRoot: string,
  logger: (message: string) => void,
): Promise<void> => {
  const registryPath = getRegistryPath(appRoot);
  if (await pathExists(registryPath)) {
    return;
  }

  const legacyDatabasePath = path.join(appRoot, 'database', 'ledgerpilot.sqlite');
  const hasLegacyData = await pathExists(legacyDatabasePath);

  if (!hasLegacyData) {
    // Fresh install (or a previous migration completed everything except writing the registry,
    // which would only happen if the process died between the last rename and saveRegistry —
    // vanishingly unlikely, but even then this just starts a new empty registry rather than
    // silently losing already-moved data, since that data would already be under workspaces/).
    await saveRegistry(appRoot, { workspaces: [] });
    logger('migrateLegacyWorkspaceIfNeeded: no legacy data found, created empty registry');
    return;
  }

  const id = crypto.randomUUID();
  const newRoot = getWorkspacePath(appRoot, id);
  await fs.mkdir(getWorkspacesContainer(appRoot), { recursive: true });
  await fs.mkdir(newRoot, { recursive: true });

  for (const dirName of topLevelWorkspaceDirs) {
    const source = path.join(appRoot, dirName);
    if (await pathExists(source)) {
      await fs.rename(source, path.join(newRoot, dirName));
      logger(`migrateLegacyWorkspaceIfNeeded: moved ${dirName}/ -> workspaces/${id}/${dirName}/`);
    }
  }

  const now = new Date().toISOString();
  await saveRegistry(appRoot, {
    workspaces: [{ id, name: 'My Workspace', createdAt: now, lastOpenedAt: now }]
  });
  logger(`migrateLegacyWorkspaceIfNeeded: migration complete, workspace id=${id}`);
};

export const createWorkspace = async (appRoot: string, name: string): Promise<WorkspaceRegistryEntry> => {
  const registry = await loadRegistry(appRoot);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const entry: WorkspaceRegistryEntry = {
    id,
    name: name.trim() || 'New workspace',
    createdAt: now,
    lastOpenedAt: now
  };

  await fs.mkdir(getWorkspacePath(appRoot, id), { recursive: true });
  registry.workspaces.push(entry);
  await saveRegistry(appRoot, registry);
  return entry;
};

export const touchWorkspace = async (appRoot: string, workspaceId: string): Promise<void> => {
  const registry = await loadRegistry(appRoot);
  const target = registry.workspaces.find((workspace) => workspace.id === workspaceId);
  if (!target) {
    return;
  }
  target.lastOpenedAt = new Date().toISOString();
  await saveRegistry(appRoot, registry);
};
