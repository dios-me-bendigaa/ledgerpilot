import { Component, type ErrorInfo, type PropsWithChildren, type ReactNode } from 'react';

import { Button, Card } from '@ledgerpilot/ui';

type PageErrorBoundaryProps = PropsWithChildren<{
  /** Changing this key (e.g. the active page name) automatically clears a caught error, so
   * navigating away from a broken page and back gives it a fresh chance to render. */
  resetKey: string;
}>;

type PageErrorBoundaryState = { error?: Error; resetKey: string };

// Scoped to a single page/section, unlike main.tsx's top-level boundary which replaces the ENTIRE
// app. Third-party rendering libraries (charts, etc.) that manipulate the DOM outside React's
// control can throw during unmount/remount; without this, that failure took down every page, not
// just the one that misbehaved.
export class PageErrorBoundary extends Component<PageErrorBoundaryProps, PageErrorBoundaryState> {
  state: PageErrorBoundaryState = { resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<PageErrorBoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(props: PageErrorBoundaryProps, state: PageErrorBoundaryState): Partial<PageErrorBoundaryState> | null {
    if (props.resetKey !== state.resetKey) {
      return { error: undefined, resetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('LedgerPilot page error boundary caught:', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <Card className="border-rose-400/20 bg-rose-400/5 p-8">
          <p className="text-sm uppercase tracking-[0.3em] text-rose-300">This section hit a problem</p>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Your data on disk has not been affected. Try switching to another page and back, or reload the app.
          </p>
          <pre className="mt-4 max-h-48 overflow-auto rounded-2xl bg-slate-950/70 p-4 text-xs text-slate-400">
            {this.state.error.message}
          </pre>
          <Button className="mt-4" variant="secondary" onClick={() => this.setState({ error: undefined })}>
            Try again
          </Button>
        </Card>
      );
    }

    return this.props.children;
  }
}
