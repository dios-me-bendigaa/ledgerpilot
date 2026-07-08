import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App';
import './styles.css';

const rootElement = document.getElementById('root');

const renderFatalError = (title: string, details: string) => {
  if (!rootElement) {
    return;
  }

  rootElement.innerHTML = `
    <main style="min-height:100vh;background:#020617;color:#e2e8f0;padding:32px;font-family:system-ui,sans-serif;">
      <div style="max-width:960px;margin:0 auto;">
        <p style="font-size:12px;letter-spacing:.3em;text-transform:uppercase;color:#7dd3fc;">LedgerPilot startup error</p>
        <h1 style="margin:16px 0 12px;font-size:32px;">${title}</h1>
        <p style="margin:0 0 16px;line-height:1.6;color:#cbd5e1;">The desktop renderer failed during startup. Copy the details below and send them back for diagnosis.</p>
        <pre style="white-space:pre-wrap;background:#0f172a;border:1px solid #334155;border-radius:16px;padding:16px;line-height:1.5;color:#f8fafc;">${details}</pre>
      </div>
    </main>
  `;
};

window.addEventListener('error', (event) => {
  renderFatalError('Unhandled renderer error', event.error?.stack ?? event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  renderFatalError('Unhandled promise rejection', String(event.reason));
});

if (rootElement) {
  try {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  } catch (error) {
    renderFatalError(
      'React bootstrap failed',
      error instanceof Error ? error.stack ?? error.message : String(error),
    );
  }
}
