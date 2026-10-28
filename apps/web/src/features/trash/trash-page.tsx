import { ENTITY_LABELS, TRASHABLE_ENTITIES, type EntityType } from '@crm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, GitMerge, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/ui/data-table';
import { Drawer } from '@/components/ui/dialog';
import { FormMessage } from '@/components/ui/form-message';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/format';
import type { Page, TrashDetail, TrashEntry } from '@/lib/types';

const PAGE_SIZE = 25;
const STATUS_LABELS: Record<TrashEntry['status'], string> = {
  IN_TRASH: 'En papelera',
  RESTORED: 'Restaurados',
  PURGED: 'Eliminados definitivamente',
};

interface RestoreResult {
  restored: { id: string; displayName: string }[];
  conflicts: { id: string; displayName: string; reasons: string[] }[];
}

export function TrashPage() {
  const { can } = useAuth();
  const canRestore = can('trash', 'restore');
  const qc = useQueryClient();
  const toast = useToast();
  const [entityType, setEntityType] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<TrashEntry['status']>('IN_TRASH');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<RestoreResult['conflicts']>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['trash', entityType, q, status, page],
    queryFn: () =>
      api.get<Page<TrashEntry>>('/trash', { entityType, q, status, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  });

  const restore = async (ids: string[]) => {
    const res = await api.post<RestoreResult>('/trash/restore', { ids });
    await qc.invalidateQueries();
    setSelected(new Set());
    setConflicts(res.conflicts);
    if (res.restored.length > 0) toast.success(`${res.restored.length} registro(s) restaurado(s).`);
    if (res.conflicts.length > 0)
      toast.error(
        `${res.conflicts.length} registro(s) no se pudieron restaurar. Revise los conflictos.`,
      );
    return res;
  };

  const items = data?.items ?? [];
  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)));

  const columns: ColumnDef<TrashEntry, unknown>[] = [
    ...(status === 'IN_TRASH' && canRestore
      ? [
          {
            id: 'select',
            enableSorting: false,
            header: () => (
              <Checkbox aria-label="Seleccionar todos" checked={allSelected} onChange={toggleAll} />
            ),
            cell: ({ row }) => (
              <span onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  aria-label={`Seleccionar ${row.original.displayName}`}
                  checked={selected.has(row.original.id)}
                  onChange={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(row.original.id)) next.delete(row.original.id);
                      else next.add(row.original.id);
                      return next;
                    })
                  }
                />
              </span>
            ),
          } satisfies ColumnDef<TrashEntry, unknown>,
        ]
      : []),
    {
      accessorKey: 'displayName',
      header: 'Registro',
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.displayName}</p>
          {row.original.code && <p className="text-xs text-fg-muted">{row.original.code}</p>}
          {row.original.relations.fusionado === true && (
            <Badge tone="primary" icon={GitMerge}>
              Fusionado en {String(row.original.relations.fusionadoEn ?? 'otro registro')}
            </Badge>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'entityType',
      header: 'Módulo',
      cell: ({ row }) =>
        ENTITY_LABELS[row.original.entityType as EntityType] ?? row.original.entityType,
    },
    {
      accessorKey: 'deletedByName',
      header: 'Eliminado por',
      cell: ({ row }) => row.original.deletedByName ?? '—',
    },
    {
      accessorKey: 'deletedAt',
      header: 'Fecha',
      cell: ({ row }) => formatDateTime(row.original.deletedAt),
    },
    status === 'IN_TRASH'
      ? {
          accessorKey: 'purgeAfter',
          header: 'Se elimina el',
          cell: ({ row }) => formatDate(row.original.purgeAfter),
        }
      : {
          accessorKey: 'resolvedAt',
          header: status === 'RESTORED' ? 'Restaurado' : 'Eliminado',
          cell: ({ row }) =>
            `${formatDateTime(row.original.resolvedAt)} · ${row.original.resolvedByName ?? 'Sistema'}`,
        },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Papelera"
        description="Registros eliminados. Puede revisarlos y restaurarlos antes de que se eliminen definitivamente."
        actions={
          status === 'IN_TRASH' &&
          canRestore &&
          selected.size > 0 && (
            <Button onClick={() => void restore([...selected])}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              Restaurar {selected.size}
            </Button>
          )
        }
      />
      {conflicts.length > 0 && (
        <Card className="mb-4 border-warning/50 p-4">
          <p className="mb-2 flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
            No se restauraron por conflictos
          </p>
          <ul className="space-y-1 text-sm">
            {conflicts.map((c) => (
              <li key={c.id}>
                <strong>{c.displayName}:</strong> {c.reasons.join(' ')}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-3 sm:flex-row">
          <Input
            type="search"
            placeholder="Buscar por nombre o código…"
            aria-label="Buscar en la papelera"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            className="sm:max-w-xs"
          />
          <Select
            aria-label="Módulo"
            value={entityType}
            onChange={(e) => {
              setEntityType(e.target.value);
              setPage(1);
            }}
            className="sm:w-48"
          >
            <option value="">Todos los módulos</option>
            {TRASHABLE_ENTITIES.map((t) => (
              <option key={t} value={t}>
                {ENTITY_LABELS[t]}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Estado"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as TrashEntry['status']);
              setSelected(new Set());
              setPage(1);
            }}
            className="sm:w-60"
          >
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        {isLoading ? (
          <Spinner />
        ) : (
          <DataTable
            data={items}
            columns={columns}
            rowKey={(r) => r.id}
            onRowClick={(r) => setDetailId(r.id)}
            empty={<EmptyState icon={Trash2} title="La papelera está vacía" />}
            pagination={
              data
                ? { page, pageSize: PAGE_SIZE, total: data.total, onPageChange: setPage }
                : undefined
            }
          />
        )}
      </Card>
      {detailId && (
        <TrashDetailDrawer id={detailId} onClose={() => setDetailId(null)} onRestore={restore} />
      )}
    </div>
  );
}

function TrashDetailDrawer({
  id,
  onClose,
  onRestore,
}: {
  id: string;
  onClose: () => void;
  onRestore: (ids: string[]) => Promise<RestoreResult>;
}) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [purging, setPurging] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data } = useQuery({
    queryKey: ['trash', 'detail', id],
    queryFn: () => api.get<TrashDetail>(`/trash/${id}`),
  });

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={data?.displayName ?? 'Detalle'}
      description={data ? ENTITY_LABELS[data.entityType as EntityType] : undefined}
    >
      {!data ? (
        <Spinner />
      ) : (
        <div className="space-y-5 text-sm">
          <dl className="grid grid-cols-[140px_1fr] gap-y-2">
            {data.code && (
              <>
                <dt className="text-fg-muted">Código</dt>
                <dd>{data.code}</dd>
              </>
            )}
            <dt className="text-fg-muted">Estado</dt>
            <dd>
              <Badge
                tone={
                  data.status === 'IN_TRASH'
                    ? 'warning'
                    : data.status === 'RESTORED'
                      ? 'success'
                      : 'danger'
                }
              >
                {STATUS_LABELS[data.status]}
              </Badge>
            </dd>
            <dt className="text-fg-muted">Eliminado por</dt>
            <dd>
              {data.deletedByName ?? '—'} · {formatDateTime(data.deletedAt)}
            </dd>
            {data.status === 'IN_TRASH' && (
              <>
                <dt className="text-fg-muted">Eliminación definitiva</dt>
                <dd>{formatDate(data.purgeAfter)}</dd>
              </>
            )}
            {Object.entries(data.relations)
              .filter(([k]) => k !== 'fusionado' && k !== 'fusionadoEn')
              .map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-fg-muted">
                    Relacionados ({k === 'members' ? 'miembros' : k})
                  </dt>
                  <dd>{String(v)}</dd>
                </div>
              ))}
          </dl>
          {data.relations.fusionado === true && (
            <p className="flex items-start gap-2 rounded-md bg-muted p-3 text-sm">
              <GitMerge className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                Este registro se fusionó en <strong>{String(data.relations.fusionadoEn)}</strong>:
                sus relaciones ya pasaron a ese registro. Restaurarlo creará un duplicado y no
                deshace la fusión.
              </span>
            </p>
          )}
          {data.restoreConflicts.length > 0 && (
            <FormMessage
              error={`No se puede restaurar todavía: ${data.restoreConflicts.join(' ')}`}
            />
          )}
          {data.status === 'IN_TRASH' && (
            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              {can('trash', 'restore') && (
                <Button
                  loading={busy}
                  disabled={data.restoreConflicts.length > 0}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const res = await onRestore([data.id]);
                      if (res.restored.length > 0) onClose();
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <RotateCcw className="h-4 w-4" aria-hidden />
                  Restaurar
                </Button>
              )}
              {can('trash', 'purge', 'ALL') && (
                <Button
                  variant="danger"
                  onClick={() => setPurging(true)}
                  disabled={data.purgeBlockers.length > 0}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                  Eliminar definitivamente
                </Button>
              )}
            </div>
          )}
          {data.purgeBlockers.length > 0 && (
            <p className="text-xs text-fg-muted">
              No se puede eliminar definitivamente: {data.purgeBlockers.join(' ')}
            </p>
          )}
          <ConfirmDialog
            open={purging}
            onOpenChange={setPurging}
            title="Eliminar definitivamente"
            confirmLabel="Eliminar definitivamente"
            danger
            typeToConfirm={data.code ?? data.displayName}
            onConfirm={async (typed) => {
              await api.delete(`/trash/${data.id}`, { confirmation: typed });
              await qc.invalidateQueries({ queryKey: ['trash'] });
              toast.success('Registro eliminado definitivamente.');
              onClose();
            }}
          >
            Esta acción <strong>no se puede deshacer</strong>. El registro se borra de la base de
            datos; su historial y la auditoría se conservan.
          </ConfirmDialog>
        </div>
      )}
    </Drawer>
  );
}
