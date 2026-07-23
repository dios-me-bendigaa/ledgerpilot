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

// Defense-in-depth for render-time/lifecycle errors thrown *inside* the React tree (e.g. a bad
// computed value throwing while rendering a chart or table). Without this, such an error would
// only ever be caught by the window-level 'error' listener below, which wipes the entire app to a
// raw, non-recoverable HTML crash page. This boundary keeps the failure scoped to a recoverable
// inline card with a one-click reload, instead of losing the user's place in the app entirely.
// Note: error boundaries do NOT catch errors thrown inside async event handlers/promises — those
// are handled individually with try/catch in App.tsx, and as a last resort by the
// 'unhandledrejection' listener below.
type ErrorBoundaryState = { error?: Error };

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('LedgerPilot renderer error boundary caught:', error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ error: undefined });
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      const details = this.state.error.stack ?? this.state.error.message;
      return (
        <main style={{ minHeight: '100vh', background: '#020617', color: '#e2e8f0', padding: 32, fontFamily: 'system-ui, sans-serif' }}>
          <div style={{ maxWidth: 960, margin: '0 auto' }}>
            <p style={{ fontSize: 12, letterSpacing: '0.3em', textTransform: 'uppercase', color: '#7dd3fc' }}>
              LedgerPilot ran into a problem
            </p>
            <h1 style={{ margin: '16px 0 12px', fontSize: 32 }}>Something went wrong in the app</h1>
            <p style={{ margin: '0 0 16px', lineHeight: 1.6, color: '#cbd5e1' }}>
              Your data on disk has not been affected. Reload to continue — if this keeps happening,
              copy the details below when reporting it.
            </p>
            <button
              onClick={this.handleReload}
              style={{
                marginBottom: 16,
                borderRadius: 12,
                border: '1px solid #38bdf8',
                background: '#0ea5e9',
                color: '#020617',
                padding: '10px 20px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Reload LedgerPilot
            </button>
            <pre style={{ whiteSpace: 'pre-wrap', background: '#0f172a', border: '1px solid #334155', borderRadius: 16, padding: 16, lineHeight: 1.5, color: '#f8fafc' }}>
              {details}
            </pre>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}

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
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>,
    );
  } catch (error) {
    renderFatalError(
      'React bootstrap failed',
      error instanceof Error ? error.stack ?? error.message : String(error),
    );
  }
}
