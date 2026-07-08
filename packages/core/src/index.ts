export const workspaceBlueprint = [
  'database',
  'imports/original',
  'imports/processed',
  'ai/memory',
  'ai/embeddings',
  'rules',
  'reports',
  'logs',
  'settings',
  'cache',
  'backups'
] as const;

export type WorkspaceEntry = (typeof workspaceBlueprint)[number];
