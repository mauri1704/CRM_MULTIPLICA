import { useState, type ReactNode } from 'react';
import { Button } from './button';
import { Dialog } from './dialog';
import { FormMessage } from './form-message';
import { Field } from './field';
import { Input } from './input';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** Si se indica, el usuario debe escribir exactamente este texto para confirmar. */
  typeToConfirm?: string;
  onConfirm: (typed: string) => Promise<void> | void;
}

/** Confirmación de acciones importantes; describe la consecuencia antes de ejecutar. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  danger,
  typeToConfirm,
  onConfirm,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = typeToConfirm === undefined || typed.trim() === typeToConfirm;

  const close = (o: boolean) => {
    if (!o) {
      setTyped('');
      setError(null);
    }
    onOpenChange(o);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={busy}
            disabled={!ready}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm(typed.trim());
                close(false);
              } catch (e) {
                setError(e instanceof Error ? e.message : 'No se pudo completar la acción.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="text-fg-muted">{children}</div>
        {typeToConfirm !== undefined && (
          <Field label={`Para confirmar, escriba: ${typeToConfirm}`}>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </Field>
        )}
        <FormMessage error={error} />
      </div>
    </Dialog>
  );
}
