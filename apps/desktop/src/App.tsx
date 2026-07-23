import { ToastProvider } from '@ledgerpilot/ui';

import { WorkspaceProvider } from './context/WorkspaceContext';
import { AppShell } from './layout/AppShell';

export const App = () => {
  return (
    <ToastProvider>
      <WorkspaceProvider>
        <AppShell />
      </WorkspaceProvider>
    </ToastProvider>
  );
};
