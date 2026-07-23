import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  maxImportFilesPerBatch,
  type ImportBatch,
  type ImportFailureCode,
  type ImportFileDescriptor,
  type ImportHistory,
  type ImportWorkflowResult,
  type NormalizationReport,
  type NormalizedTransaction,
  type ImportRecord,
  type ResumeImportResult
} from '@ledgerpilot/core';
import { NormalizationEngine } from '@ledgerpilot/normalization-engine';

type ImportEngineOptions = {
  workspaceRoot: string;
  logger?: (message: string) => void;
  onBatchImported?: (payload: {
    batch: ImportBatch;
    report: NormalizationReport;
    transactions: NormalizedTransaction[];
    history: ImportHistory;
  }) => Promise<void>;
  // Supplies fingerprints of transactions already persisted in OTHER batches, so the
  // normalization engine's own duplicate detection can catch a transaction reappearing across
  // separate import batches (previously this was always an empty Set, so cross-batch duplicate
  // *reporting* silently under-counted — SQLite's UNIQUE(fingerprint) + INSERT OR IGNORE still
  // protected the actual persisted totals, but the app's own "duplicates found" stats were wrong).
  // Must exclude the batch currently being (re-)normalized, since re-processing a batch will
  // legitimately regenerate the same fingerprints it already wrote on a prior run.
  getKnownFingerprints?: (excludeBatchId: string) => Promise<Set<string>> | Set<string>;
  // Current home-currency setting, read fresh at normalize time (like getKnownFingerprints above)
  // so a settings change takes effect on the next import without recreating the ImportEngine.
  getHomeCurrency?: () => Promise<string> | string;
};

const historyFileName = 'import-history.json';

const createId = () => crypto.randomUUID();

const nowIso = () => new Date().toISOString();

const getHistoryPath = (workspaceRoot: string) =>
  path.join(workspaceRoot, 'settings', historyFileName);

const hashFile = async (filePath: string) => {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
};

const createFailureRecord = (
  batchId: string,
  file: ImportFileDescriptor,
  code: ImportFailureCode,
  message: string,
): ImportRecord => {
  const timestamp = nowIso();

  return {
    id: createId(),
    batchId,
    fileName: file.name,
    originalPath: file.path,
    fileSize: file.size,
    status: 'failed',
    stage: 'failed',
    progress: 100,
    errorCode: code,
    errorMessage: message,
    createdAt: timestamp,
    updatedAt: timestamp
  };
};

const updateBatchCounts = (batch: ImportBatch): ImportBatch => {
  const completedFiles = batch.files.filter((file) => file.status === 'completed').length;
  const failedFiles = batch.files.filter((file) => file.status === 'failed').length;
  const status = failedFiles === batch.totalFiles ? 'failed' : failedFiles > 0 ? 'failed' : 'completed';

  return {
    ...batch,
    completedFiles,
    failedFiles,
    status,
    updatedAt: nowIso()
  };
};

export class ImportEngine {
  private readonly workspaceRoot: string;
  private readonly normalizationEngine: NormalizationEngine;
  private readonly logger?: (message: string) => void;
  private readonly onBatchImported?: ImportEngineOptions['onBatchImported'];
  private readonly getKnownFingerprints?: ImportEngineOptions['getKnownFingerprints'];
  private readonly getHomeCurrency?: ImportEngineOptions['getHomeCurrency'];

  constructor(options: ImportEngineOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.normalizationEngine = new NormalizationEngine();
    this.logger = options.logger;
    this.onBatchImported = options.onBatchImported;
    this.getKnownFingerprints = options.getKnownFingerprints;
    this.getHomeCurrency = options.getHomeCurrency;
  }

  async getHistory(): Promise<ImportHistory> {
    const historyPath = getHistoryPath(this.workspaceRoot);

    try {
      const content = await fs.readFile(historyPath, 'utf8');
      return JSON.parse(content) as ImportHistory;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return { batches: [] };
      }

      throw error;
    }
  }

  async importFiles(files: ImportFileDescriptor[]): Promise<ImportWorkflowResult> {
    const batchId = createId();
    const history = await this.getHistory();
    const timestamp = nowIso();
    const batch: ImportBatch = {
      id: batchId,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: 'pending',
      totalFiles: files.length,
      completedFiles: 0,
      failedFiles: 0,
      files: []
    };

    if (files.length > maxImportFilesPerBatch) {
      batch.files = files.map((file) =>
        createFailureRecord(
          batchId,
          file,
          'LIMIT_EXCEEDED',
          `A batch can contain at most ${maxImportFilesPerBatch} CSV files.`,
        ),
      );

      const finalBatch = updateBatchCounts(batch);
      await this.writeHistory({ batches: [finalBatch, ...history.batches] });
      return { batch: finalBatch };
    }

    const knownHashes = new Set(
      history.batches.flatMap((existingBatch) =>
        existingBatch.files
          .map((file) => file.fileHash)
          .filter((fileHash): fileHash is string => Boolean(fileHash)),
      ),
    );
    const seenPaths = new Set<string>();

    for (const file of files) {
      if (!file.name.toLowerCase().endsWith('.csv')) {
        batch.files.push(
          createFailureRecord(
            batchId,
            file,
            'INVALID_EXTENSION',
            'Only CSV files are supported during Phase 2.',
          ),
        );
        continue;
      }

      if (file.size === 0) {
        batch.files.push(
          createFailureRecord(batchId, file, 'EMPTY_FILE', 'The CSV file is empty.'),
        );
        continue;
      }

      if (seenPaths.has(file.path)) {
        batch.files.push(
          createFailureRecord(
            batchId,
            file,
            'DUPLICATE_FILE',
            'This file was already selected in the current batch.',
          ),
        );
        continue;
      }

      seenPaths.add(file.path);

      const createdAt = nowIso();
      const record: ImportRecord = {
        id: createId(),
        batchId,
        fileName: file.name,
        originalPath: file.path,
        fileSize: file.size,
        status: 'pending',
        stage: 'validating',
        progress: 15,
        createdAt,
        updatedAt: createdAt
      };

      try {
        const fileHash = await hashFile(file.path);
        record.fileHash = fileHash;

        if (knownHashes.has(fileHash)) {
          batch.files.push({
            ...record,
            status: 'failed',
            stage: 'failed',
            progress: 100,
            errorCode: 'DUPLICATE_FILE',
            errorMessage: 'This file was imported previously.',
            updatedAt: nowIso()
          });
          continue;
        }

        record.stage = 'deduplicating';
        record.progress = 40;
        record.updatedAt = nowIso();

        const originalTarget = path.join(
          this.workspaceRoot,
          'imports',
          'original',
          `${record.id}-${file.name}`,
        );
        const processedTarget = path.join(
          this.workspaceRoot,
          'imports',
          'processed',
          `${record.id}-${file.name}`,
        );

        await fs.copyFile(file.path, originalTarget);
        record.stage = 'copying';
        record.progress = 75;
        record.storedOriginalPath = originalTarget;
        record.updatedAt = nowIso();

        await fs.copyFile(file.path, processedTarget);
        record.storedProcessedPath = processedTarget;
        record.stage = 'completed';
        record.status = 'completed';
        record.progress = 100;
        record.updatedAt = nowIso();
        knownHashes.add(fileHash);
        batch.files.push(record);
      } catch (error) {
        batch.files.push({
          ...record,
          status: 'failed',
          stage: 'failed',
          progress: 100,
          errorCode: 'COPY_FAILED',
          errorMessage:
            error instanceof Error ? error.message : 'Failed to store the imported file.',
          updatedAt: nowIso()
        });
      }
    }

    const finalBatch = updateBatchCounts(batch);
    const nextHistory = { batches: [finalBatch, ...history.batches] };
    await this.writeHistory(nextHistory);

    const normalizationResult = await this.normalizeImportedBatch(finalBatch);

    if (normalizationResult && this.onBatchImported) {
      await this.onBatchImported({
        batch: finalBatch,
        report: normalizationResult.report,
        transactions: normalizationResult.transactions,
        history: nextHistory
      });
    }

    return { batch: finalBatch, normalizationReport: normalizationResult?.report };
  }

  async resumeFailedBatch(batchId: string): Promise<ResumeImportResult> {
    const history = await this.getHistory();
    const batch = history.batches.find((entry) => entry.id === batchId);

    if (!batch) {
      throw new Error('Import batch not found.');
    }

    const retryableFiles = batch.files
      .filter((file) => file.status === 'failed' && file.errorCode !== 'DUPLICATE_FILE')
      .map<ImportFileDescriptor>((file) => ({
        name: file.fileName,
        path: file.originalPath,
        size: file.fileSize,
        lastModifiedMs: Date.now()
      }));

    if (retryableFiles.length === 0) {
      return { batch };
    }

    return this.importFiles(retryableFiles);
  }

  async renormalizeBatch(batchId: string): Promise<NormalizationReport | undefined> {
    const history = await this.getHistory();
    const batch = history.batches.find((entry) => entry.id === batchId);
    if (!batch) {
      throw new Error('Import batch not found.');
    }
    const result = await this.normalizeImportedBatch(batch);
    if (result && this.onBatchImported) {
      await this.onBatchImported({
        batch,
        report: result.report,
        transactions: result.transactions,
        history
      });
    }
    return result?.report;
  }

  private async normalizeImportedBatch(batch: ImportBatch) {
    const successfulSources = batch.files
      .filter((file) => file.status === 'completed' && file.storedProcessedPath)
      .map((file) => ({
        importRecordId: file.id,
        filePath: file.storedProcessedPath ?? file.originalPath,
        fileName: file.fileName
      }));

    if (successfulSources.length === 0) {
      return undefined;
    }

    this.logger?.(`normalizeImportedBatch batchId=${batch.id} sources=${successfulSources.map((s) => s.fileName).join(', ')}`);
    const knownFingerprints = this.getKnownFingerprints
      ? await this.getKnownFingerprints(batch.id)
      : new Set<string>();
    const homeCurrency = this.getHomeCurrency ? await this.getHomeCurrency() : 'CAD';
    const result = await this.normalizationEngine.normalizeBatch({
      batch,
      sources: successfulSources,
      knownFingerprints,
      homeCurrency,
      logger: this.logger
    });

    const reportPath = path.join(this.workspaceRoot, 'reports', `${batch.id}.json`);
    await fs.writeFile(reportPath, JSON.stringify(result.report, null, 2), 'utf8');
    return result;
  }

  private async writeHistory(history: ImportHistory) {
    const historyPath = getHistoryPath(this.workspaceRoot);
    await fs.mkdir(path.dirname(historyPath), { recursive: true });
    await fs.writeFile(historyPath, JSON.stringify(history, null, 2), 'utf8');
  }
}
