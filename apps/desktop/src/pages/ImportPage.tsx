import { FileWarning, RefreshCw, UploadCloud } from 'lucide-react';

import { Badge, Button, Card, EmptyState, Meter } from '@ledgerpilot/ui';

import { PageHeader } from '../components/PageHeader';
import { useWorkspace } from '../context/WorkspaceContext';
import { formatBytes, summarizeBatch } from '../lib/format';

export const ImportPage = () => {
  const {
    selectedFiles,
    history,
    isImporting,
    isDragging,
    setIsDragging,
    handleSelectFiles,
    handleImport,
    handleResume,
    handleRerunNormalization,
    onDropFiles
  } = useWorkspace();

  return (
    <div>
      <PageHeader
        eyebrow="Import"
        title="Bring in your data"
        description="Drag and drop CSV files, or use the file picker. Everything is copied into your local workspace, normalized, and stored on-device — nothing leaves this Mac."
        actions={
          <>
            <Button variant="secondary" onClick={() => void handleSelectFiles()}>
              Choose CSV files
            </Button>
            <Button disabled={isImporting || selectedFiles.length === 0} onClick={() => void handleImport()} icon={<UploadCloud />}>
              {isImporting ? 'Importing…' : 'Start import'}
            </Button>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <Card className="bg-slate-900/70 p-7">
          <div
            className={[
              'rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors duration-200',
              isDragging ? 'border-sky-400 bg-sky-400/5' : 'border-slate-800 bg-slate-950/40'
            ].join(' ')}
            onDragEnter={() => setIsDragging(true)}
            onDragLeave={() => setIsDragging(false)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => void onDropFiles(event)}
          >
            <UploadCloud className={`mx-auto h-10 w-10 ${isDragging ? 'text-sky-300' : 'text-slate-600'}`} />
            <p className="mt-4 text-base font-medium text-slate-100">Drop CSV files here</p>
            <p className="mt-1.5 text-sm text-slate-500">Batch limit: 10 files per import. Original files stay untouched on disk.</p>

            {selectedFiles.length > 0 ? (
              <ul className="mt-6 grid gap-2.5 text-left">
                {selectedFiles.map((file) => (
                  <li key={file.path} className="flex items-center justify-between rounded-xl bg-slate-900/80 px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-100">{file.name}</p>
                      <p className="truncate text-xs text-slate-500">{file.path}</p>
                    </div>
                    <span className="shrink-0 text-xs text-slate-400">{formatBytes(file.size)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </Card>

        <Card className="bg-slate-900/70 p-7">
          <p className="text-sm uppercase tracking-[0.2em] text-emerald-300">Import history</p>
          <div className="mt-5 space-y-4">
            {history.batches.length === 0 ? (
              <EmptyState title="No imports yet" description="Your import batches will appear here." />
            ) : (
              history.batches.map((batch) => {
                const hasRetryableFailures = batch.files.some((file) => file.status === 'failed' && file.errorCode !== 'DUPLICATE_FILE');
                const hasCompletedFiles = batch.files.some((file) => file.status === 'completed');

                return (
                  <div key={batch.id} className="rounded-2xl bg-slate-950/70 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-slate-100">{summarizeBatch(batch)}</p>
                        <p className="mt-1 text-xs text-slate-500">{new Date(batch.createdAt).toLocaleString()}</p>
                      </div>
                      <div className="flex gap-2">
                        {hasCompletedFiles ? (
                          <Button size="sm" variant="secondary" disabled={isImporting} onClick={() => void handleRerunNormalization(batch.id)} icon={<RefreshCw />}>
                            Re-process
                          </Button>
                        ) : null}
                        {hasRetryableFailures ? (
                          <Button size="sm" variant="secondary" disabled={isImporting} onClick={() => void handleResume(batch.id)}>
                            Resume failed
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    <ul className="mt-3 space-y-2">
                      {batch.files.map((file) => (
                        <li key={file.id} className="rounded-xl border border-white/5 bg-slate-900/70 px-3 py-2.5">
                          <div className="flex items-center justify-between gap-4 text-sm">
                            <span className="min-w-0 truncate font-medium text-slate-100">{file.fileName}</span>
                            <Badge tone={file.status === 'completed' ? 'success' : file.status === 'failed' ? 'danger' : 'neutral'}>{file.stage}</Badge>
                          </div>
                          <Meter className="mt-2.5" value={file.progress} tone={file.status === 'failed' ? 'danger' : 'success'} />
                          {file.errorMessage ? (
                            <p className="mt-2 flex items-center gap-1.5 text-xs text-rose-300">
                              <FileWarning className="h-3 w-3" /> {file.errorMessage}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};
