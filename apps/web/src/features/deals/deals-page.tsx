import { zodResolver } from '@hookform/resolvers/zod';
import { DEAL_STATUS_LABELS, dealInput } from '@crm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { CheckCircle2, Handshake, Plus, RotateCcw, Star, Trash2, X, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import type { z } from 'zod';
import { CustomFieldInputs, cleanCustom, customDefaults } from '@/components/custom-field-inputs';
import { HistoryButton } from '@/components/history-drawer';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/ui/data-table';
import { Drawer } from '@/components/ui/dialog';
import { EntityPicker, type PickerOption } from '@/components/ui/entity-picker';
import { Field } from '@/components/ui/field';
import { FormMessage } from '@/components/ui/form-message';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Card, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { DataActions } from '@/features/import-export/data-actions';
import { CommentsPanel } from '@/features/sales/comments-panel';
import { KanbanBoard } from '@/features/sales/kanban-board';
import { LinesEditor } from '@/features/sales/lines-editor';
import {
  OwnerPriorityFilters,
  Priority,
  StageBadge,
  ViewToggle,
  pickPipeline,
  useCloseDialogs,
  usePipelines,
  type SalesView,
} from '@/features/sales/sales-shared';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useAuth, useUser } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { applyServerErrors } from '@/lib/forms';
import {
  useCatalog,
  useCurrencies,
  useCustomFields,
  useLocalPref,
  useUserOptions,
} from '@/lib/hooks';
import { useMoney } from '@/lib/money';
import { searchCompanies, searchContacts } from '@/lib/pickers';
import type { Board, Deal, Page, StageRef } from '@/lib/types';
import { useRecordParam } from '@/lib/use-record-param';

const PAGE_SIZE = 25;

/** Importe a mostrar: valor final si se ganó; si no, el total de productos o el estimado. */
const dealAmount = (d: Deal) =>
  d.status === 'WON' && d.finalValue
    ? d.finalValue
    : Number(d.total) > 0
      ? d.total
      : d.estimatedValue;

const dateOnly = (v: string | null) => (v ? formatDate(`${v.slice(0, 10)}T12:00:00`) : '—');

/** Mover a etapa preguntando lo necesario para cerrar. Devuelve true si se movió. */
function useDealMove() {
  const qc = useQueryClient();
  const toast = useToast();
  const { askLoss, askWin, dialog } = useCloseDialogs();
  const move = async (deal: Deal, to: StageRef, index = 0) => {
    let extra = {};
    if (deal.stageId !== to.id && to.kind === 'LOST') {
      const loss = await askLoss('DEAL');
      if (!loss) return false;
      extra = loss;
    }
    if (deal.stageId !== to.id && to.kind === 'WON') {
      const win = await askWin(
        Number(deal.total) > 0 ? deal.total : (deal.estimatedValue ?? '0'),
        deal.currencyCode,
      );
      if (!win) return false;
      extra = win;
    }
    try {
      await api.put(`/deals/${deal.id}/stage`, {
        stageId: to.id,
        index,
        version: deal.version,
        ...extra,
      });
      await qc.invalidateQueries({ queryKey: ['deals'] });
      if (to.kind === 'WON') toast.success('¡Negociación ganada!');
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      await qc.invalidateQueries({ queryKey: ['deals'] });
      return false;
    }
  };
  return { move, dialog };
}

export function DealsPage() {
  const { can } = useAuth();
  const me = useUser();
  const money = useMoney();
  const pipelines = usePipelines('DEAL');
  const [savedPipeline, setSavedPipeline] = useLocalPref('deals.pipeline', '');
  const [view, setView] = useLocalPref<SalesView>('deals.view', 'kanban');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [priorityId, setPriorityId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ sort: 'createdAt', dir: 'desc' as 'asc' | 'desc' });
  const [openId, setOpenId] = useRecordParam();
  const { move, dialog } = useDealMove();
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const pipeline = pickPipeline(pipelines.data, savedPipeline);
  const filters = {
    q: debounced,
    ownerId,
    priorityId,
    pipelineId: pipeline?.id,
    status: view === 'list' ? status : undefined,
  };
  const board = useQuery({
    queryKey: ['deals', 'board', filters],
    queryFn: () => api.get<Board<Deal>>('/deals/board', filters),
    enabled: view === 'kanban' && !!pipeline,
  });
  const list = useQuery({
    queryKey: ['deals', 'list', filters, page, sort],
    queryFn: () =>
      api.get<Page<Deal>>('/deals', { ...filters, ...sort, page, pageSize: PAGE_SIZE }),
    enabled: view === 'list' && !!pipeline,
    placeholderData: (prev) => prev,
  });

  // Mover una negociación cerrada es reabrirla: lo decide la API según el permiso.
  const canMove = (d: Deal) => can('deals', 'edit', d.ownerId === me.id ? 'OWN' : 'TEAM');

  const columns = useMemo<ColumnDef<Deal, unknown>[]>(
    () => [
      {
        id: 'title',
        header: 'Negociación',
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.title}</p>
            <p className="text-xs text-fg-muted">{row.original.code}</p>
          </div>
        ),
      },
      {
        id: 'company',
        header: 'Compañía / contacto',
        enableSorting: false,
        cell: ({ row }) =>
          [row.original.company?.legalName, row.original.contacts.find((c) => c.isPrimary)?.name]
            .filter(Boolean)
            .join(' · ') || '—',
      },
      {
        id: 'stage',
        header: 'Etapa',
        enableSorting: false,
        cell: ({ row }) => <StageBadge stage={row.original.stage} />,
      },
      {
        id: 'priority',
        header: 'Prioridad',
        enableSorting: false,
        cell: ({ row }) => <Priority p={row.original.priority} />,
      },
      {
        id: 'total',
        header: 'Importe',
        cell: ({ row }) => money(dealAmount(row.original), row.original.currencyCode),
      },
      {
        id: 'expectedCloseDate',
        header: 'Cierre estimado',
        cell: ({ row }) => dateOnly(row.original.expectedCloseDate),
      },
      {
        id: 'owner',
        header: 'Responsable',
        enableSorting: false,
        cell: ({ row }) => row.original.owner?.name ?? '—',
      },
    ],
    [money],
  );

  return (
    <div className="mx-auto max-w-[1600px]">
      <PageHeader
        title="Negociaciones"
        description="Oportunidades calificadas en curso hasta su cierre como ganadas o perdidas."
        actions={
          <>
            <DataActions entity="deals" module="deals" filters={filters} />
            {can('deals', 'create') && (
              <Button onClick={() => setOpenId('nuevo')}>
                <Plus className="h-4 w-4" aria-hidden />
                Nueva negociación
              </Button>
            )}
          </>
        }
      />
      <Card className="mb-4">
        <div className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center">
          {(pipelines.data?.length ?? 0) > 1 && (
            <Select
              aria-label="Pipeline"
              value={pipeline?.id ?? ''}
              onChange={(e) => setSavedPipeline(e.target.value)}
              className="lg:w-48"
            >
              {pipelines.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
          <Input
            type="search"
            placeholder="Buscar por título, código, compañía…"
            aria-label="Buscar negociaciones"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="lg:max-w-xs"
          />
          <OwnerPriorityFilters
            ownerId={ownerId}
            priorityId={priorityId}
            onOwner={(v) => {
              setOwnerId(v);
              setPage(1);
            }}
            onPriority={(v) => {
              setPriorityId(v);
              setPage(1);
            }}
          />
          {view === 'list' && (
            <Select
              aria-label="Estado"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="lg:w-40"
            >
              <option value="">Todos los estados</option>
              {Object.entries(DEAL_STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          )}
          <div className="lg:ml-auto">
            <ViewToggle value={view} onChange={setView} />
          </div>
        </div>
      </Card>
      {view === 'kanban' ? (
        board.isLoading || !board.data ? (
          <Spinner />
        ) : (
          <>
            {board.data.truncated && (
              <FormMessage error="Se muestran las primeras 1.000 negociaciones. Use los filtros para acotar." />
            )}
            <KanbanBoard
              columns={board.data.columns}
              onOpen={(d) => setOpenId(d.id)}
              canMove={canMove}
              onMove={(d, to, index) => move(d, to, index)}
              renderCard={(d) => (
                <DealCard deal={d} amount={money(dealAmount(d), d.currencyCode)} />
              )}
            />
          </>
        )
      ) : (
        <Card>
          {list.isLoading ? (
            <Spinner />
          ) : (
            <DataTable
              data={list.data?.items ?? []}
              columns={columns}
              rowKey={(r) => r.id}
              onRowClick={(r) => setOpenId(r.id)}
              serverSort={{ ...sort, onChange: (s, d) => setSort({ sort: s, dir: d }) }}
              empty={<EmptyState icon={Handshake} title="No hay negociaciones con esos filtros" />}
              pagination={
                list.data
                  ? { page, pageSize: PAGE_SIZE, total: list.data.total, onPageChange: setPage }
                  : undefined
              }
            />
          )}
        </Card>
      )}
      {openId && (
        <DealDrawer
          id={openId === 'nuevo' ? null : openId}
          pipelineId={pipeline?.id}
          onClose={() => setOpenId(null)}
        />
      )}
      {dialog}
    </div>
  );
}

function DealCard({ deal, amount }: { deal: Deal; amount: string }) {
  const primary = deal.contacts.find((c) => c.isPrimary);
  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium leading-snug">{deal.title}</p>
        <span className="shrink-0 text-xs text-fg-muted">{deal.code}</span>
      </div>
      {(deal.company || primary) && (
        <p className="truncate text-xs text-fg-muted">
          {[deal.company?.legalName, primary?.name].filter(Boolean).join(' · ')}
        </p>
      )}
      <p className="text-sm font-semibold">{amount}</p>
      {deal.expectedCloseDate && deal.status === 'OPEN' && (
        <p className="text-xs text-fg-muted">Cierre estimado: {dateOnly(deal.expectedCloseDate)}</p>
      )}
      <div className="flex items-center justify-between gap-2">
        <Priority p={deal.priority} />
        <span className="truncate text-xs text-fg-muted">{deal.owner?.name}</span>
      </div>
    </div>
  );
}

function DealDrawer({
  id,
  pipelineId,
  onClose,
}: {
  id: string | null;
  pipelineId?: string;
  onClose: () => void;
}) {
  const { data: deal, error: loadError } = useQuery({
    queryKey: ['deals', 'detail', id],
    queryFn: () => api.get<Deal>(`/deals/${id}`),
    enabled: !!id,
  });
  const defs = useCustomFields('DEAL');
  const users = useUserOptions();
  const currencies = useCurrencies();
  const ready = !!defs.data && !!users.data && !!currencies.data;
  if (id && loadError) {
    return (
      <Drawer open onOpenChange={(o) => !o && onClose()} title="Negociación">
        <FormMessage
          error={
            loadError instanceof ApiError ? loadError.message : 'No se pudo cargar la negociación.'
          }
        />
      </Drawer>
    );
  }
  if ((id && !deal) || !ready) {
    return (
      <Drawer open onOpenChange={(o) => !o && onClose()} title="Negociación">
        <Spinner />
      </Drawer>
    );
  }
  return <DealForm deal={deal ?? null} pipelineId={pipelineId} onClose={onClose} />;
}

type FormIn = z.input<typeof dealInput>;
type FormOut = z.output<typeof dealInput>;
type ContactChip = PickerOption & { primary: boolean };

function DealForm({
  deal,
  pipelineId,
  onClose,
}: {
  deal: Deal | null;
  pipelineId?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useUser();
  const { can } = useAuth();
  const money = useMoney();
  const users = useUserOptions();
  const priorities = useCatalog('priorities');
  const currencies = useCurrencies();
  const defs = useCustomFields('DEAL');
  const pipelines = usePipelines('DEAL');
  const { move, dialog } = useDealMove();
  const [tab, setTab] = useState('datos');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [company, setCompany] = useState<PickerOption | null>(
    deal?.company ? { id: deal.company.id, label: deal.company.legalName } : null,
  );
  const [contacts, setContacts] = useState<ContactChip[]>(
    deal?.contacts.map((c) => ({ id: c.id, label: c.name, primary: c.isPrimary })) ?? [],
  );
  const [contactsDirty, setContactsDirty] = useState(false);
  const closed = deal ? deal.status !== 'OPEN' : false;
  const canEdit = deal ? can('deals', 'edit', deal.ownerId === me.id ? 'OWN' : 'TEAM') : true;
  const editable = canEdit && !closed;
  const stages =
    pipelines.data?.find((p) => p.id === deal?.pipelineId)?.stages.filter((s) => s.active) ?? [];
  const wonStage = stages.find((s) => s.kind === 'WON');
  const lostStage = stages.find((s) => s.kind === 'LOST');
  const firstOpen = stages.find((s) => s.kind === 'OPEN');
  const hasLines = (deal?.products?.length ?? 0) > 0;

  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(dealInput),
    defaultValues: {
      title: deal?.title ?? '',
      ownerId: deal?.ownerId ?? me.id,
      priorityId: deal?.priorityId ?? '',
      currencyCode: deal?.currencyCode ?? currencies.data?.find((c) => c.isBase)?.code,
      estimatedValue: deal?.estimatedValue ? String(Number(deal.estimatedValue)) : '',
      probability: deal?.probability ?? '',
      expectedCloseDate: deal?.expectedCloseDate?.slice(0, 10) ?? '',
      notes: deal?.notes ?? '',
      customFields: customDefaults(defs.data, deal?.customFields),
    },
  });
  const e = form.formState.errors;

  const setContactList = (next: ContactChip[]) => {
    // Siempre hay un principal si hay contactos.
    if (next.length > 0 && !next.some((c) => c.primary))
      next = next.map((c, i) => ({ ...c, primary: i === 0 }));
    setContacts(next);
    setContactsDirty(true);
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const body = {
      ...values,
      companyId: company?.id ?? null,
      contactIds: contacts.map((c) => c.id),
      primaryContactId: contacts.find((c) => c.primary)?.id ?? null,
      customFields: cleanCustom(values.customFields as Record<string, unknown>),
    };
    try {
      if (deal) await api.patch(`/deals/${deal.id}`, { ...body, version: deal.version });
      else await api.post('/deals', { ...body, pipelineId });
      await qc.invalidateQueries({ queryKey: ['deals'] });
      toast.success(deal ? 'Negociación actualizada.' : 'Negociación creada.');
      onClose();
    } catch (err) {
      setError(applyServerErrors(err, form.setError));
    }
  });

  const datos = (
    <form id="deal-form" onSubmit={onSubmit} noValidate className="space-y-5">
      <FormMessage error={error} />
      <fieldset disabled={!editable} className="space-y-5">
        <fieldset className="space-y-4 rounded-md border border-border p-4">
          <legend className="px-1 text-sm font-semibold">Negociación</legend>
          <Field label="Título" error={e.title?.message} required>
            <Input autoComplete="off" {...form.register('title')} />
          </Field>
          <Field label="Compañía" error={e.companyId?.message}>
            <EntityPicker
              value={company}
              onChange={setCompany}
              search={searchCompanies}
              queryKey="companies"
              placeholder="Buscar compañía…"
              disabled={!editable}
            />
          </Field>
          <div>
            <p className="mb-1.5 text-sm font-medium">Contactos</p>
            {contacts.length > 0 && (
              <ul className="mb-2 space-y-1">
                {contacts.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center gap-2 rounded-md bg-muted px-2.5 py-1.5 text-sm"
                  >
                    <Link to={`/contactos?id=${c.id}`} className="flex-1 truncate hover:underline">
                      {c.label}
                    </Link>
                    {c.primary ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                        <Star className="h-3 w-3" aria-hidden /> Principal
                      </span>
                    ) : (
                      editable && (
                        <button
                          type="button"
                          className="text-xs text-fg-muted hover:underline"
                          onClick={() =>
                            setContactList(contacts.map((x) => ({ ...x, primary: x.id === c.id })))
                          }
                        >
                          Marcar principal
                        </button>
                      )
                    )}
                    {editable && (
                      <button
                        type="button"
                        aria-label={`Quitar ${c.label}`}
                        onClick={() => setContactList(contacts.filter((x) => x.id !== c.id))}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {editable && (
              <EntityPicker
                value={null}
                onChange={(c) =>
                  c &&
                  !contacts.some((x) => x.id === c.id) &&
                  setContactList([...contacts, { ...c, primary: contacts.length === 0 }])
                }
                search={searchContacts}
                queryKey="contacts"
                placeholder="Agregar contacto…"
              />
            )}
          </div>
        </fieldset>
        <fieldset className="space-y-4 rounded-md border border-border p-4">
          <legend className="px-1 text-sm font-semibold">Gestión</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Responsable" error={e.ownerId?.message}>
              <Select {...form.register('ownerId')}>
                {users.data?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Prioridad" error={e.priorityId?.message}>
              <Select {...form.register('priorityId')}>
                <option value="">Por defecto</option>
                {priorities.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Moneda"
              error={e.currencyCode?.message}
              hint={hasLines ? 'Con productos, la moneda no se cambia aquí.' : undefined}
            >
              <Select {...form.register('currencyCode')} disabled={hasLines}>
                {currencies.data?.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Valor estimado"
              error={e.estimatedValue?.message}
              hint="Se usa mientras no haya productos asociados."
            >
              <Input inputMode="decimal" autoComplete="off" {...form.register('estimatedValue')} />
            </Field>
            <Field
              label="Probabilidad (%)"
              error={e.probability?.message}
              hint="Vacío = la de la etapa."
            >
              <Input
                type="number"
                min={0}
                max={100}
                {...form.register('probability', {
                  setValueAs: (v: string | number) => (v === '' || v === null ? '' : Number(v)),
                })}
              />
            </Field>
            <Field label="Cierre estimado" error={e.expectedCloseDate?.message}>
              <Input type="date" {...form.register('expectedCloseDate')} />
            </Field>
          </div>
          <Field label="Observaciones" error={e.notes?.message}>
            <Textarea rows={3} {...form.register('notes')} />
          </Field>
        </fieldset>
        <CustomFieldInputs
          entityType="DEAL"
          register={form.register}
          errors={form.formState.errors}
        />
      </fieldset>
    </form>
  );

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={deal ? deal.title : 'Nueva negociación'}
      description={
        deal
          ? `${deal.code} · ${deal.stage.name}${deal.owner ? ` · Responsable: ${deal.owner.name}` : ''}`
          : undefined
      }
      confirmClose={form.formState.isDirty || contactsDirty}
      footer={
        editable &&
        tab === 'datos' && (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" form="deal-form" loading={form.formState.isSubmitting}>
              {deal ? 'Guardar cambios' : 'Crear negociación'}
            </Button>
          </>
        )
      }
    >
      {deal && (
        <>
          <dl className="mb-4 grid grid-cols-2 gap-3 rounded-md border border-border p-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-fg-muted">Estado</dt>
              <dd className="mt-0.5">
                <StageBadge stage={deal.stage} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">
                {deal.status === 'WON' ? 'Valor final' : 'Total'}
              </dt>
              <dd className="mt-0.5 font-semibold">{money(dealAmount(deal), deal.currencyCode)}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">Probabilidad</dt>
              <dd className="mt-0.5">{deal.probability ?? deal.stage.probability ?? '—'}%</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">{closed ? 'Cerrada el' : 'Cierre estimado'}</dt>
              <dd className="mt-0.5">
                {closed ? dateOnly(deal.closedAt) : dateOnly(deal.expectedCloseDate)}
              </dd>
            </div>
            {deal.sourceLead && (
              <div className="col-span-2 sm:col-span-4">
                <dt className="text-xs text-fg-muted">Origen</dt>
                <dd className="mt-0.5">
                  <Link to={`/prospectos?id=${deal.sourceLead.id}`} className="underline">
                    Prospecto {deal.sourceLead.code} — {deal.sourceLead.title}
                  </Link>
                </dd>
              </div>
            )}
            {deal.status === 'LOST' && deal.lossReason && (
              <div className="col-span-2 sm:col-span-4">
                <dt className="text-xs text-fg-muted">Motivo de pérdida</dt>
                <dd className="mt-0.5">
                  {deal.lossReason.name}
                  {deal.lossNote ? ` — ${deal.lossNote}` : ''}
                </dd>
              </div>
            )}
          </dl>
          <div className="mb-4 flex flex-wrap gap-2">
            {editable && wonStage && (
              <Button
                size="sm"
                onClick={() => void move(deal, wonStage).then((ok) => ok && onClose())}
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                Ganar
              </Button>
            )}
            {editable && lostStage && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void move(deal, lostStage).then((ok) => ok && onClose())}
              >
                <XCircle className="h-4 w-4" aria-hidden />
                Perder
              </Button>
            )}
            {closed && canEdit && can('deals', 'edit', 'TEAM') && firstOpen && (
              <Button size="sm" variant="secondary" onClick={() => setConfirmReopen(true)}>
                <RotateCcw className="h-4 w-4" aria-hidden />
                Reabrir
              </Button>
            )}
            <HistoryButton entityType="DEAL" entityId={deal.id} title={deal.title} />
            {can('deals', 'delete') && canEdit && (
              <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-4 w-4" aria-hidden />
                Enviar a papelera
              </Button>
            )}
          </div>
        </>
      )}
      {deal ? (
        <Tabs
          value={tab}
          onValueChange={setTab}
          items={[
            { value: 'datos', label: 'Datos' },
            { value: 'productos', label: `Productos (${deal.products?.length ?? 0})` },
            { value: 'comentarios', label: 'Comentarios' },
          ]}
        >
          <TabPanel value="datos">
            {closed && (
              <FormMessage
                className="mb-4"
                error="La negociación está cerrada: sus datos e importes quedan congelados. Reábrala para modificarla."
              />
            )}
            {datos}
          </TabPanel>
          <TabPanel value="productos">
            <LinesEditor
              basePath={`/deals/${deal.id}`}
              currencyCode={deal.currencyCode}
              lines={deal.products ?? []}
              totals={deal}
              editable={editable}
              lockedReason={
                closed
                  ? 'La negociación está cerrada: sus importes y tasas quedan congelados.'
                  : undefined
              }
              invalidate={[['deals']]}
              onRefreshRates={async () => {
                try {
                  await api.post(`/deals/${deal.id}/refresh-rates`, {});
                  await qc.invalidateQueries({ queryKey: ['deals'] });
                  toast.success('Tasas actualizadas con el tipo de cambio vigente.');
                } catch (err) {
                  toast.error(errorMessage(err));
                }
              }}
            />
          </TabPanel>
          <TabPanel value="comentarios">
            {tab === 'comentarios' && <CommentsPanel type="DEAL" id={deal.id} />}
          </TabPanel>
        </Tabs>
      ) : (
        datos
      )}
      {deal && (
        <>
          <ConfirmDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title="Enviar negociación a la papelera"
            confirmLabel="Enviar a papelera"
            danger
            onConfirm={async () => {
              await api.delete(`/deals/${deal.id}`);
              await qc.invalidateQueries({ queryKey: ['deals'] });
              toast.success('Negociación enviada a la papelera.');
              onClose();
            }}
          >
            «{deal.title}» dejará de aparecer en el tablero y las búsquedas. Podrá restaurarla desde
            la papelera.
          </ConfirmDialog>
          <ConfirmDialog
            open={confirmReopen}
            onOpenChange={setConfirmReopen}
            title="Reabrir negociación"
            confirmLabel="Reabrir"
            onConfirm={async () => {
              if (firstOpen && (await move(deal, firstOpen)))
                toast.success('Negociación reabierta.');
            }}
          >
            Volverá a la etapa «{firstOpen?.name}» y podrá editar sus importes. La reapertura queda
            registrada en la auditoría.
          </ConfirmDialog>
        </>
      )}
      {dialog}
    </Drawer>
  );
}
