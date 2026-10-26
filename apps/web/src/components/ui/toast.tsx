import * as RT from '@radix-ui/react-toast';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface ToastItem {
  id: number;
  kind: 'success' | 'error';
  message: string;
}

const ToastContext = createContext<(kind: ToastItem['kind'], message: string) => void>(
  () => undefined,
);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((kind: ToastItem['kind'], message: string) => {
    setItems((prev) => [...prev, { id: Date.now() + Math.random(), kind, message }]);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      <RT.Provider swipeDirection="right" duration={4500} label="Notificación">
        {children}
        {items.map((t) => (
          <RT.Root
            key={t.id}
            type={t.kind === 'error' ? 'foreground' : 'background'}
            onOpenChange={(open) => !open && setItems((prev) => prev.filter((x) => x.id !== t.id))}
            className={cn(
              'flex items-start gap-3 rounded-lg border bg-surface p-3 pr-2 text-sm shadow-lg',
              t.kind === 'error' ? 'border-danger/50' : 'border-success/50',
            )}
          >
            {t.kind === 'error' ? (
              <AlertCircle className="h-5 w-5 shrink-0 text-danger" aria-hidden />
            ) : (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden />
            )}
            <RT.Description className="flex-1">{t.message}</RT.Description>
            <RT.Close aria-label="Cerrar" className="rounded p-0.5 text-fg-muted hover:bg-muted">
              <X className="h-4 w-4" aria-hidden />
            </RT.Close>
          </RT.Root>
        ))}
        <RT.Viewport className="fixed bottom-4 right-4 z-[100] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2" />
      </RT.Provider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  return { success: (m: string) => push('success', m), error: (m: string) => push('error', m) };
}
