import { HISTORY_ACTION_LABELS, type EntityType, type HistoryAction } from '@crm/shared';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/dialog';
import { EmptyState, Spinner } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { HistoryEntry } from '@/lib/types';

const FIELD_LABELS: Record<string, string> = {
  name: 'Nombre',
  email: 'Correo',
  roleId: 'Rol',
  teamIds: 'Equipos',
  memberIds: 'Miembros',
  supervisorId: 'Supervisor',
  description: 'Descripción',
  active: 'Activo',
  legalName: 'Razón social',
  taxId: 'RUC',
  baseCurrencyCode: 'Moneda principal',
  stages: 'Etapas',
  isDefault: 'Por defecto',
  label: 'Etiqueta',
  options: 'Opciones',
  required: 'Obligatorio',
};

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (Array.isArray(v))
    return v.length === 0
      ? '—'
      : v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function label(field: string): string {
  if (field.startsWith('settings.')) return `Parámetro ${field.slice(9)}`;
  if (field.startsWith('permiso.')) return `Permiso ${field.slice(8)}`;
  return FIELD_LABELS[field] ?? field;
}

function isChange(v: unknown): v is { from: unknown; to: unknown } {
  return typeof v === 'object' && v !== null && 'from' in v && 'to' in v;
}

/** Botón + panel con el historial de cambios de un registro. */
export function HistoryButton({
  entityType,
  entityId,
  title,
}: {
  entityType: EntityType;
  entityId: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['history', entityType, entityId],
    queryFn: () => api.get<HistoryEntry[]>(`/history/${entityType}/${entityId}`),
    enabled: open,
  });
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <History className="h-4 w-4" aria-hidden />
        Historial
      </Button>
      <Drawer open={open} onOpenChange={setOpen} title={`Historial — ${title}`}>
        {isLoading && <Spinner />}
        {data && data.length === 0 && <EmptyState icon={History} title="Sin cambios registrados" />}
        <ol className="space-y-4">
          {data?.map((h) => (
            <li key={h.id} className="border-l-2 border-border pl-3">
              <p className="text-sm font-medium">
                {HISTORY_ACTION_LABELS[h.action as HistoryAction] ?? h.action}
              </p>
              <p className="text-xs text-fg-muted">
                {formatDateTime(h.createdAt)} · {h.userName ?? 'Sistema'}
              </p>
              {Object.keys(h.changes).length > 0 && (
                <dl className="mt-1 space-y-0.5 text-xs">
                  {Object.entries(h.changes).map(([field, v]) => (
                    <div key={field} className="flex flex-wrap gap-1">
                      <dt className="font-medium">{label(field)}:</dt>
                      <dd className="text-fg-muted">
                        {isChange(v) ? `${show(v.from)} → ${show(v.to)}` : show(v)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          ))}
        </ol>
      </Drawer>
    </>
  );
}
