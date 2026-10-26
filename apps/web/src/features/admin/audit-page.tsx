import {
  AUDIT_EVENTS,
  AUDIT_EVENT_LABELS,
  ENTITY_LABELS,
  type AuditEvent,
  type EntityType,
} from '@crm/shared';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { ScrollText } from 'lucide-react';
import { useState } from 'react';
import { DataTable } from '@/components/ui/data-table';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { AuditEntry, Page } from '@/lib/types';

const PAGE_SIZE = 50;
const DANGER: AuditEvent[] = [
  'LOGIN_FAILED',
  'LOGIN_LOCKED',
  'RECORD_PURGED',
  'USER_DEACTIVATED',
  'ROLE_DELETED',
];

const columns: ColumnDef<AuditEntry, unknown>[] = [
  {
    accessorKey: 'createdAt',
    header: 'Fecha',
    cell: ({ row }) => (
      <span className="whitespace-nowrap">{formatDateTime(row.original.createdAt)}</span>
    ),
  },
  {
    accessorKey: 'event',
    header: 'Evento',
    cell: ({ row }) => (
      <Badge tone={DANGER.includes(row.original.event as AuditEvent) ? 'danger' : 'neutral'}>
        {AUDIT_EVENT_LABELS[row.original.event as AuditEvent] ?? row.original.event}
      </Badge>
    ),
  },
  {
    accessorKey: 'userName',
    header: 'Usuario',
    cell: ({ row }) => row.original.userName ?? 'Sistema',
  },
  {
    accessorKey: 'entityType',
    header: 'Registro',
    cell: ({ row }) =>
      row.original.entityType
        ? (ENTITY_LABELS[row.original.entityType as EntityType] ?? row.original.entityType)
        : '—',
  },
  { accessorKey: 'ip', header: 'IP', cell: ({ row }) => row.original.ip ?? '—' },
  {
    id: 'details',
    header: 'Detalle',
    enableSorting: false,
    cell: ({ row }) => {
      const d = row.original.details;
      return Object.keys(d).length === 0 ? (
        '—'
      ) : (
        <code className="block max-w-md truncate text-xs" title={JSON.stringify(d)}>
          {JSON.stringify(d)}
        </code>
      );
    },
  },
];

export function AuditPage() {
  const [event, setEvent] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['audit', event, from, to, page],
    queryFn: () =>
      api.get<Page<AuditEntry>>('/audit', {
        event,
        from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
        to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: (prev) => prev,
  });

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Auditoría"
        description="Accesos, cambios de permisos y acciones sensibles. Este registro no se puede modificar ni borrar."
      />
      <Card>
        <div className="grid gap-3 border-b border-border p-3 sm:grid-cols-3">
          <Field label="Evento">
            <Select
              value={event}
              onChange={(e) => {
                setEvent(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              {AUDIT_EVENTS.map((ev) => (
                <option key={ev} value={ev}>
                  {AUDIT_EVENT_LABELS[ev]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Desde">
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
          </Field>
          <Field label="Hasta">
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
          </Field>
        </div>
        {isLoading ? (
          <Spinner />
        ) : (
          <DataTable
            data={data?.items ?? []}
            columns={columns}
            rowKey={(r) => r.id}
            empty={<EmptyState icon={ScrollText} title="Sin eventos para esos filtros" />}
            pagination={
              data
                ? { page, pageSize: PAGE_SIZE, total: data.total, onPageChange: setPage }
                : undefined
            }
          />
        )}
      </Card>
    </div>
  );
}
