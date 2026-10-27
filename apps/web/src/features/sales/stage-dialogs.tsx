import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { FormMessage } from '@/components/ui/form-message';
import { Input, Select, Textarea } from '@/components/ui/input';
import { useCatalog } from '@/lib/hooks';

/** Motivo de pérdida (obligatorio, D-17). Devuelve null si se cancela. */
export function LossDialog({
  entity,
  onDone,
}: {
  entity: 'LEAD' | 'DEAL';
  onDone: (v: { lossReasonId: string; lossNote: string } | null) => void;
}) {
  const reasons = useCatalog('loss-reasons');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const options = reasons.data?.filter((r) => r.entityType === entity) ?? [];
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onDone(null)}
      title={entity === 'LEAD' ? 'Descartar prospecto' : 'Marcar negociación como perdida'}
      footer={
        <>
          <Button variant="secondary" onClick={() => onDone(null)}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            disabled={!reason}
            onClick={() => onDone({ lossReasonId: reason, lossNote: note })}
          >
            Confirmar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Motivo de pérdida" required>
          <Select value={reason} onChange={(e) => setReason(e.target.value)} autoFocus>
            <option value="">Seleccione…</option>
            {options.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Detalle (opcional)">
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

/** Ganar una negociación: valor final (por defecto el total) y fecha de cierre. */
export function WinDialog({
  defaultValue,
  currencyCode,
  today,
  onDone,
}: {
  defaultValue: string;
  currencyCode: string;
  today: string;
  onDone: (v: { finalValue: string; closedAt: string } | null) => void;
}) {
  const [value, setValue] = useState(String(Number(defaultValue)));
  const [date, setDate] = useState(today);
  const valid = /^\d+(\.\d{1,4})?$/.test(value) && /^\d{4}-\d{2}-\d{2}$/.test(date);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onDone(null)}
      title="Marcar negociación como ganada"
      description="Los importes y tasas quedarán congelados. Reabrirla requerirá autorización."
      footer={
        <>
          <Button variant="secondary" onClick={() => onDone(null)}>
            Cancelar
          </Button>
          <Button disabled={!valid} onClick={() => onDone({ finalValue: value, closedAt: date })}>
            Confirmar venta
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`Valor final (${currencyCode})`} required>
          <Input
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(',', '.'))}
            autoFocus
          />
        </Field>
        <Field label="Fecha de cierre" required>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {!valid && <FormMessage error="Revise el valor y la fecha." className="sm:col-span-2" />}
      </div>
    </Dialog>
  );
}

export const todayLima = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
