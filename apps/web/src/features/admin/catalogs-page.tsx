import {
  CATALOG_KINDS,
  CATALOG_LABELS,
  PRIORITY_ICONS,
  TASK_STATUS_CATEGORIES,
  TASK_STATUS_CATEGORY_LABELS,
  type CatalogKind,
} from '@crm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  ChevronDown,
  ChevronUp,
  ChevronsUp,
  Equal,
  Flag,
  ListChecks,
  Plus,
  Star,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { HistoryButton } from '@/components/history-drawer';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { FormMessage } from '@/components/ui/form-message';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { Badge, Card, ColorDot, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { CatalogItem } from '@/lib/types';

export const PRIORITY_ICON: Record<string, LucideIcon> = {
  'chevrons-up': ChevronsUp,
  'chevron-up': ChevronUp,
  equal: Equal,
  'chevron-down': ChevronDown,
  flag: Flag,
};
const PRIORITY_ICON_LABELS: Record<string, string> = {
  'chevrons-up': 'Doble flecha arriba',
  'chevron-up': 'Flecha arriba',
  equal: 'Igual',
  'chevron-down': 'Flecha abajo',
  flag: 'Bandera',
};

/** Distintivo de prioridad: ícono + texto + color (nunca solo color). */
export function PriorityBadge({
  name,
  color,
  icon,
}: {
  name: string;
  color: string;
  icon: string;
}) {
  const Icon = PRIORITY_ICON[icon] ?? Flag;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold"
      style={{ borderColor: color, color }}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {name}
    </span>
  );
}

export function CatalogsPage() {
  const [kind, setKind] = useState<CatalogKind>('priorities');
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Catálogos"
        description="Valores que se eligen en los formularios. Un valor en uso no se borra: se desactiva y los registros antiguos lo conservan."
      />
      <Tabs
        value={kind}
        onValueChange={(v) => setKind(v as CatalogKind)}
        items={CATALOG_KINDS.map((k) => ({ value: k, label: CATALOG_LABELS[k].plural }))}
      >
        {CATALOG_KINDS.map((k) => (
          <TabPanel key={k} value={k}>
            {k === kind && <CatalogTable kind={k} />}
          </TabPanel>
        ))}
      </Tabs>
    </div>
  );
}

function CatalogTable({ kind }: { kind: CatalogKind }) {
  const { can } = useAuth();
  const manage = can('settings', 'manage');
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<CatalogItem | 'new' | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['catalogs', kind, 'all'],
    queryFn: () => api.get<CatalogItem[]>(`/catalogs/${kind}`, { includeInactive: true }),
  });

  const toggle = async (item: CatalogItem) => {
    try {
      await api.put(`/catalogs/${kind}/${item.id}/active`, { active: !item.active });
      await qc.invalidateQueries({ queryKey: ['catalogs', kind] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const columns = ((): ColumnDef<CatalogItem, unknown>[] => {
    const cols: ColumnDef<CatalogItem, unknown>[] = [];
    if (kind === 'document-types') cols.push({ accessorKey: 'code', header: 'Código' });
    cols.push({
      accessorKey: 'name',
      header: 'Nombre',
      cell: ({ row }) => {
        const r = row.original;
        if (kind === 'priorities') {
          return (
            <span className="flex items-center gap-2">
              <PriorityBadge name={r.name} color={r.color ?? '#64748B'} icon={r.icon ?? 'flag'} />
              {r.isDefault && (
                <Badge tone="primary" icon={Star}>
                  Por defecto
                </Badge>
              )}
            </span>
          );
        }
        return (
          <span className="flex items-center gap-2">
            {r.color && <ColorDot color={r.color} />}
            {r.name}
          </span>
        );
      },
    });
    if (kind === 'priorities') cols.push({ accessorKey: 'rank', header: 'Peso' });
    if (kind === 'loss-reasons')
      cols.push({
        accessorKey: 'entityType',
        header: 'Aplica a',
        cell: ({ row }) => (row.original.entityType === 'LEAD' ? 'Prospectos' : 'Negociaciones'),
      });
    if (kind === 'document-types')
      cols.push({
        accessorKey: 'pattern',
        header: 'Validación',
        cell: ({ row }) => <code className="text-xs">{row.original.pattern ?? '—'}</code>,
      });
    if (kind === 'task-statuses')
      cols.push({
        accessorKey: 'category',
        header: 'Tipo',
        cell: ({ row }) =>
          TASK_STATUS_CATEGORY_LABELS[
            row.original.category as keyof typeof TASK_STATUS_CATEGORY_LABELS
          ] ?? row.original.category,
      });
    cols.push({
      accessorKey: 'active',
      header: 'Estado',
      cell: ({ row }) =>
        row.original.active ? <Badge tone="success">Activo</Badge> : <Badge>Inactivo</Badge>,
    });
    cols.push({
      id: 'actions',
      header: () => <span className="sr-only">Acciones</span>,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <HistoryButton
            entityType="CATALOG"
            entityId={row.original.id}
            title={row.original.name}
          />
          {manage && (
            <Button variant="secondary" size="sm" onClick={() => void toggle(row.original)}>
              {row.original.active ? 'Desactivar' : 'Activar'}
            </Button>
          )}
        </div>
      ),
    });
    return cols;
  })();

  return (
    <Card>
      {manage && (
        <div className="flex justify-end border-b border-border p-3">
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" aria-hidden />
            Agregar {CATALOG_LABELS[kind].singular.toLowerCase()}
          </Button>
        </div>
      )}
      {isLoading ? (
        <Spinner />
      ) : (
        <DataTable
          data={data ?? []}
          columns={columns}
          rowKey={(r) => r.id}
          onRowClick={manage ? (r) => setEditing(r) : undefined}
          rowClassName={(r) => (r.active ? undefined : 'opacity-60')}
          empty={<EmptyState icon={ListChecks} title="Sin valores" />}
        />
      )}
      {editing && (
        <CatalogDialog
          kind={kind}
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

function CatalogDialog({
  kind,
  item,
  onClose,
}: {
  kind: CatalogKind;
  item: CatalogItem | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState({
    name: item?.name ?? '',
    color: item?.color ?? '#2563EB',
    icon: item?.icon ?? 'flag',
    rank: String(item?.rank ?? 0),
    isDefault: item?.isDefault ?? false,
    entityType: item?.entityType ?? 'DEAL',
    code: item?.code ?? '',
    pattern: item?.pattern ?? '',
    category: item?.category ?? 'OPEN',
    position: String(item?.position ?? 0),
  });
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof v>) => setV((prev) => ({ ...prev, ...patch }));

  const body = (): Record<string, unknown> => {
    switch (kind) {
      case 'priorities':
        return {
          name: v.name,
          color: v.color.toUpperCase(),
          icon: v.icon,
          rank: Number(v.rank),
          isDefault: v.isDefault,
        };
      case 'loss-reasons':
        return { name: v.name, entityType: v.entityType };
      case 'document-types':
        return { code: v.code, name: v.name, pattern: v.pattern || null };
      case 'task-statuses':
        return {
          name: v.name,
          color: v.color.toUpperCase(),
          category: v.category,
          position: Number(v.position),
        };
      default:
        return { name: v.name };
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setDetails({});
    try {
      if (item) await api.patch(`/catalogs/${kind}/${item.id}`, body());
      else await api.post(`/catalogs/${kind}`, body());
      await qc.invalidateQueries({ queryKey: ['catalogs', kind] });
      toast.success('Guardado.');
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setDetails(e.details);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${item ? 'Editar' : 'Agregar'} ${CATALOG_LABELS[kind].singular.toLowerCase()}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} onClick={save}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormMessage error={error} />
        {kind === 'document-types' && (
          <Field label="Código" error={details.code} required>
            <Input
              value={v.code}
              onChange={(e) => set({ code: e.target.value })}
              disabled={!!item}
            />
          </Field>
        )}
        <Field label="Nombre" error={details.name} required>
          <Input value={v.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        {(kind === 'priorities' || kind === 'task-statuses') && (
          <Field label="Color" error={details.color} hint="Se acompaña siempre de texto e ícono.">
            <input
              type="color"
              value={v.color}
              onChange={(e) => set({ color: e.target.value })}
              className="h-10 w-16 cursor-pointer rounded-md border border-border bg-surface"
            />
          </Field>
        )}
        {kind === 'priorities' && (
          <>
            <Field label="Ícono" error={details.icon}>
              <Select value={v.icon} onChange={(e) => set({ icon: e.target.value })}>
                {PRIORITY_ICONS.map((i) => (
                  <option key={i} value={i}>
                    {PRIORITY_ICON_LABELS[i]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Peso"
              hint="Mayor peso = más urgente (define el orden)."
              error={details.rank}
            >
              <Input type="number" value={v.rank} onChange={(e) => set({ rank: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={v.isDefault}
                onChange={(e) => set({ isDefault: e.target.checked })}
              />
              Prioridad por defecto para registros nuevos
            </label>
            <div>
              <p className="mb-1 text-sm font-medium">Vista previa</p>
              <PriorityBadge name={v.name || 'Prioridad'} color={v.color} icon={v.icon} />
            </div>
          </>
        )}
        {kind === 'loss-reasons' && (
          <Field label="Aplica a" error={details.entityType}>
            <Select
              value={v.entityType}
              onChange={(e) => set({ entityType: e.target.value })}
              disabled={!!item}
            >
              <option value="LEAD">Prospectos</option>
              <option value="DEAL">Negociaciones</option>
            </Select>
          </Field>
        )}
        {kind === 'document-types' && (
          <Field
            label="Validación (expresión regular)"
            hint="Ejemplo: ^\d{8}$ para 8 dígitos. Vacío = sin validación."
            error={details.pattern}
          >
            <Input value={v.pattern} onChange={(e) => set({ pattern: e.target.value })} />
          </Field>
        )}
        {kind === 'task-statuses' && (
          <>
            <Field label="Tipo" error={details.category}>
              <Select value={v.category} onChange={(e) => set({ category: e.target.value })}>
                {TASK_STATUS_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {TASK_STATUS_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Orden" error={details.position}>
              <Input
                type="number"
                value={v.position}
                onChange={(e) => set({ position: e.target.value })}
              />
            </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}
