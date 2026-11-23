import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  title?: string;
  message: string;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
}

interface ErpFeedbackContextValue {
  toast: (message: string, variant?: ToastVariant, title?: string) => void;
  success: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
  warning: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ErpFeedbackContext = createContext<ErpFeedbackContextValue | null>(null);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<{
    options: ConfirmOptions;
    resolve: (value: boolean) => void;
  } | null>(null);
  const seqRef = useRef(1);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback((message: string, variant: ToastVariant = 'info', title?: string) => {
    const id = `toast-${seqRef.current++}`;
    setToasts(prev => [...prev.slice(-3), { id, variant, title, message }]);
    window.setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, variant === 'error' ? 5500 : 3800);
  }, []);

  const success = useCallback((message: string, title?: string) => toast(message, 'success', title), [toast]);
  const error = useCallback((message: string, title?: string) => toast(message, 'error', title), [toast]);
  const warning = useCallback((message: string, title?: string) => toast(message, 'warning', title), [toast]);
  const info = useCallback((message: string, title?: string) => toast(message, 'info', title), [toast]);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>(resolve => {
      setConfirmState({ options, resolve });
    });
  }, []);

  const handleConfirmChoice = useCallback((accepted: boolean) => {
    setConfirmState(prev => {
      if (prev) prev.resolve(accepted);
      return null;
    });
  }, []);

  const value = useMemo<ErpFeedbackContextValue>(
    () => ({ toast, success, error, warning, info, confirm }),
    [toast, success, error, warning, info, confirm]
  );

  return (
    <ErpFeedbackContext.Provider value={value}>
      {children}

      {/* Toast Stack (Bottom-Left in RTL so it never covers header or primary CTAs) */}
      <div
        dir="rtl"
        aria-live="polite"
        className="fixed bottom-4 left-4 z-[120] flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)] pointer-events-none"
      >
        {toasts.map(item => {
          const iconMap = {
            success: <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />,
            error: <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />,
            warning: <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />,
            info: <Info className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />,
          };
          const borderMap = {
            success: 'border-emerald-200 dark:border-emerald-500/30',
            error: 'border-rose-200 dark:border-rose-500/30',
            warning: 'border-amber-200 dark:border-amber-500/30',
            info: 'border-slate-200 dark:border-zinc-700',
          };
          return (
            <div
              key={item.id}
              className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-white dark:bg-zinc-900 px-3.5 py-3 shadow-lg text-slate-800 dark:text-zinc-100 ${borderMap[item.variant]}`}
            >
              {iconMap[item.variant]}
              <div className="flex-1 min-w-0 text-right">
                {item.title && <div className="text-xs font-bold mb-0.5">{item.title}</div>}
                <div className="text-xs leading-5 text-slate-600 dark:text-zinc-300 break-words">
                  {item.message}
                </div>
              </div>
              <button
                type="button"
                onClick={() => dismissToast(item.id)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors shrink-0"
                aria-label="بستن اعلان"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Unified Confirm Dialog */}
      {confirmState && (
        <div
          dir="rtl"
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/55 backdrop-blur-[2px] p-4"
          onClick={() => handleConfirmChoice(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-zinc-800">
              <div className="flex items-center gap-2.5">
                {confirmState.options.variant === 'danger' ? (
                  <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
                ) : (
                  <Info className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                )}
                <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100">
                  {confirmState.options.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => handleConfirmChoice(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
                aria-label="بستن"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 text-sm leading-6 text-slate-600 dark:text-zinc-300 whitespace-pre-line">
              {confirmState.options.message}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-950/60">
              <button
                type="button"
                onClick={() => handleConfirmChoice(false)}
                className="min-h-[40px] px-4 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
              >
                {confirmState.options.cancelLabel || 'انصراف'}
              </button>
              <button
                type="button"
                onClick={() => handleConfirmChoice(true)}
                className={`min-h-[40px] px-4 rounded-lg text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 ${
                  confirmState.options.variant === 'danger'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {confirmState.options.confirmLabel || (confirmState.options.variant === 'danger' ? 'حذف' : 'تایید')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ErpFeedbackContext.Provider>
  );
};

export function useErpFeedback(): ErpFeedbackContextValue {
  const ctx = useContext(ErpFeedbackContext);
  if (!ctx) {
    return {
      toast: () => undefined,
      success: () => undefined,
      error: () => undefined,
      warning: () => undefined,
      info: () => undefined,
      confirm: async () => true,
    };
  }
  return ctx;
}
