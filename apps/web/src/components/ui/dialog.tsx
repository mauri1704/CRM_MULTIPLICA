import * as RD from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface BaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Pregunta antes de cerrar (cambios sin guardar). */
  confirmClose?: boolean;
}

function useGuardedChange(onOpenChange: (o: boolean) => void, confirmClose?: boolean) {
  return (open: boolean) => {
    if (!open && confirmClose && !window.confirm('Hay cambios sin guardar. ¿Desea descartarlos?'))
      return;
    onOpenChange(open);
  };
}

/** Ventana modal centrada. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  confirmClose,
  wide,
}: BaseProps & { wide?: boolean }) {
  const change = useGuardedChange(onOpenChange, confirmClose);
  return (
    <RD.Root open={open} onOpenChange={change}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <RD.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-surface shadow-xl',
            wide ? 'max-w-3xl' : 'max-w-lg',
          )}
          aria-describedby={description ? undefined : undefined}
        >
          <Header title={title} description={description} />
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>
          )}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

/** Panel lateral derecho (detalle y edición). Ocupa toda la pantalla en móvil. */
export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  confirmClose,
}: BaseProps) {
  const change = useGuardedChange(onOpenChange, confirmClose);
  return (
    <RD.Root open={open} onOpenChange={change}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <RD.Content className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-surface shadow-xl sm:max-w-xl">
          <Header title={title} description={description} />
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>
          )}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

function Header({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
      <div>
        <RD.Title className="text-base font-semibold">{title}</RD.Title>
        {description ? (
          <RD.Description className="mt-1 text-sm text-fg-muted">{description}</RD.Description>
        ) : (
          <RD.Description className="sr-only">{title}</RD.Description>
        )}
      </div>
      <RD.Close className="rounded-md p-1 text-fg-muted hover:bg-muted" aria-label="Cerrar">
        <X className="h-5 w-5" aria-hidden />
      </RD.Close>
    </div>
  );
}
