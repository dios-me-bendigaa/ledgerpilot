import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';

type ToastTone = 'success' | 'error' | 'info';
type ToastItem = { id: string; tone: ToastTone; message: string };

type ToastContextValue = {
  show: (tone: ToastTone, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const toneStyles: Record<ToastTone, { border: string; icon: string; iconBg: string }> = {
  success: { border: 'border-emerald-400/30', icon: '✓', iconBg: 'bg-emerald-500/20 text-emerald-300' },
  error: { border: 'border-rose-400/30', icon: '!', iconBg: 'bg-rose-500/20 text-rose-300' },
  info: { border: 'border-sky-400/30', icon: 'i', iconBg: 'bg-sky-500/20 text-sky-300' }
};

// Previously the app's only feedback mechanism for async actions was a single shared inline error
// string rendered in two unrelated places on the page, with no success feedback at all and no way
// to tell which action produced which message. This gives every action a scoped, dismissible,
// auto-expiring notification instead.
export const ToastProvider = ({ children }: PropsWithChildren) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (tone: ToastTone, message: string) => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev, { id, tone, message }]);
      setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 4000);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      success: (message: string) => show('success', message),
      error: (message: string) => show('error', message),
      info: (message: string) => show('info', message)
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-6 right-6 z-[100] flex w-full max-w-sm flex-col gap-2.5">
        {toasts.map((toast) => {
          const style = toneStyles[toast.tone];
          return (
            <div
              key={toast.id}
              className={`animate-slide-in-right pointer-events-auto flex items-start gap-3 rounded-2xl border ${style.border} bg-slate-900/95 p-4 text-sm text-slate-100 shadow-2xl shadow-slate-950/50 backdrop-blur`}
            >
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${style.iconBg}`}>
                {style.icon}
              </span>
              <p className="min-w-0 flex-1 leading-5">{toast.message}</p>
              <button
                className="shrink-0 text-slate-500 transition-colors hover:text-slate-300"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss notification"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextValue => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
