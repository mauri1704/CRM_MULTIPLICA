import { zodResolver } from '@hookform/resolvers/zod';
import { leadInput } from '@crm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowRightCircle, Repeat, Target, Trash2, UserPlus } from 'lucide-react';
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
import { ActivitiesPanel } from '@/features/activities/activities-panel';
import { RelatedTasks } from '@/features/tasks/related-tasks';
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
import type { Board, Lead, Page, StageRef } from '@/lib/types';
import { useRecordParam } from '@/lib/use-record-param';
import { ConvertDialog } from './convert-dialog';

const PAGE_SIZE = 25;
const STATUS_LABEL = { OPEN: 'Abierto', LOST: 'Descartado', CONVERTED: 'Convertido' } as const;

const leadStatus = (l: Lead): keyof typeof STATUS_LABEL =>
  l.stage.kind === 'LOST' ? 'LOST' : l.stage.kind === 'CONVERTED' ? 'CONVERTED' : 'OPEN';

/** Importe a mostrar: el total de productos si hay; si no, el valor estimado. */
const leadAmount = (l: Lead) => (Number(l.total) > 0 ? l.total : l.estimatedValue);

export function LeadsPage() {
  const { can } = useAuth();
  const me = useUser();
  const qc = useQueryClient();
  const toast = useToast();
  const money = useMoney();
  const pipelines = usePipelines('LEAD');
  const [savedPipeline, setSavedPipeline] = useLocalPref('leads.pipeline', '');
  const [view, setView] = useLocalPref<SalesView>('leads.view', 'kanban');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [priorityId, setPriorityId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ sort: 'createdAt', dir: 'desc' as 'asc' | 'desc' });
  const [openId, setOpenId] = useRecordParam();
  const [converting, setConverting] = useState<Lead | null>(null);
  const { askLoss, dialog } = useCloseDialogs();
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
    queryKey: ['leads', 'board', filters],
    queryFn: () => api.get<Board<Lead>>('/leads/board', filters),
    enabled: view === 'kanban' && !!pipeline,
  });
  const list = useQuery({
    queryKey: ['leads', 'list', filters, page, sort],
    queryFn: () =>
      api.get<Page<Lead>>('/leads', { ...filters, ...sort, page, pageSize: PAGE_SIZE }),
    enabled: view === 'list' && !!pipeline,
    placeholderData: (prev) => prev,
  });

  const canEdit = (l: Lead) =>
    leadStatus(l) !== 'CONVERTED' && can('leads', 'edit', l.ownerId === me.id ? 'OWN' : 'TEAM');

  const onMove = async (lead: Lead, to: StageRef, index: number) => {
    if (to.kind === 'CONVERTED') {
      if (!can('deals', 'create')) {
        toast.error('No tiene permiso para crear negociaciones.');
        return false;
      }
      setConverting(lead);
      return false;
    }
    let extra = {};
    if (to.kind === 'LOST' && lead.stageId !== to.id) {
      const loss = await askLoss('LEAD');
      if (!loss) return false;
      extra = loss;
    }
    try {
      await api.put(`/leads/${lead.id}/stage`, {
        stageId: to.id,
        index,
        version: lead.version,
        ...extra,
      });
      await qc.invalidateQueries({ queryKey: ['leads'] });
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      await qc.invalidateQueries({ queryKey: ['leads'] });
      return false;
    }
  };

  const columns = useMemo<ColumnDef<Lead, unknown>[]>(
    () => [
      {
        id: 'title',
        header: 'Prospecto',
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.title}</p>
            <p className="text-xs text-fg-muted">{row.original.code}</p>
          </div>
        ),
      },
      {
        id: 'contact',
        header: 'Contacto / compañía',
        enableSorting: false,
        cell: ({ row }) =>
          [row.original.contact?.name, row.original.company?.legalName]
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
        id: 'estimatedValue',
        header: 'Valor',
        cell: ({ row }) => money(leadAmount(row.original), row.original.currencyCode),
      },
      {
        id: 'owner',
        header: 'Responsable',
        enableSorting: false,
        cell: ({ row }) => row.original.owner?.name ?? '—',
      },
      {
        id: 'createdAt',
        header: 'Creación',
        cell: ({ row }) => formatDate(row.original.createdAt),
      },
    ],
    [money],
  );

  return (
    <div className="mx-auto max-w-[1600px]">
      <PageHeader
        title="Prospectos"
        description="Oportunidades en evaluación. Al calificarlas se convierten en negociaciones."
        actions={
          <>
            <DataActions entity="leads" module="leads" filters={filters} />
            {can('leads', 'create') && (
              <Button onClick={() => setOpenId('nuevo')}>
                <UserPlus className="h-4 w-4" aria-hidden />
                Nuevo prospecto
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
            placeholder="Buscar por nombre, código, correo…"
            aria-label="Buscar prospectos"
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
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
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
              <FormMessage error="Se muestran los primeros 1.000 prospectos. Use los filtros para acotar." />
            )}
            <KanbanBoard
              columns={board.data.columns}
              onOpen={(l) => setOpenId(l.id)}
              canMove={canEdit}
              onMove={onMove}
              renderCard={(l) => (
                <LeadCard lead={l} amount={money(leadAmount(l), l.currencyCode)} />
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
              empty={<EmptyState icon={Target} title="No hay prospectos con esos filtros" />}
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
        <LeadDrawer
          id={openId === 'nuevo' ? null : openId}
          pipelineId={pipeline?.id}
          onClose={() => setOpenId(null)}
          onConvert={setConverting}
        />
      )}
      {converting && <ConvertDialog lead={converting} onClose={() => setConverting(null)} />}
      {dialog}
    </div>
  );
}

function LeadCard({ lead, amount }: { lead: Lead; amount: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium leading-snug">{lead.title}</p>
        <span className="shrink-0 text-xs text-fg-muted">{lead.code}</span>
      </div>
      {(lead.contact || lead.company) && (
        <p className="truncate text-xs text-fg-muted">
          {[lead.contact?.name, lead.company?.legalName].filter(Boolean).join(' · ')}
        </p>
      )}
      <p className="text-sm font-semibold">{amount}</p>
      <div className="flex items-center justify-between gap-2">
        <Priority p={lead.priority} />
        <span className="truncate text-xs text-fg-muted">{lead.owner?.name}</span>
      </div>
    </div>
  );
}

function LeadDrawer({
  id,
  pipelineId,
  onClose,
  onConvert,
}: {
  id: string | null;
  pipelineId?: string;
  onClose: () => void;
  onConvert: (l: Lead) => void;
}) {
  const { data: lead, error: loadError } = useQuery({
    queryKey: ['leads', 'detail', id],
    queryFn: () => api.get<Lead>(`/leads/${id}`),
    enabled: !!id,
  });
  const defs = useCustomFields('LEAD');
  const users = useUserOptions();
  const currencies = useCurrencies();
  const ready = !!defs.data && !!users.data && !!currencies.data;
  if (id && loadError) {
    return (
      <Drawer open onOpenChange={(o) => !o && onClose()} title="Prospecto">
        <FormMessage
          error={
            loadError instanceof ApiError ? loadError.message : 'No se pudo cargar el prospecto.'
          }
        />
      </Drawer>
    );
  }
  if ((id && !lead) || !ready) {
    return (
      <Drawer open onOpenChange={(o) => !o && onClose()} title="Prospecto">
        <Spinner />
      </Drawer>
    );
  }
  return (
    <LeadForm lead={lead ?? null} pipelineId={pipelineId} onClose={onClose} onConvert={onConvert} />
  );
}

type FormIn = z.input<typeof leadInput>;
type FormOut = z.output<typeof leadInput>;

function LeadForm({
  lead,
  pipelineId,
  onClose,
  onConvert,
}: {
  lead: Lead | null;
  pipelineId?: string;
  onClose: () => void;
  onConvert: (l: Lead) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useUser();
  const { can } = useAuth();
  const users = useUserOptions();
  const sources = useCatalog('lead-sources');
  const priorities = useCatalog('priorities');
  const currencies = useCurrencies();
  const defs = useCustomFields('LEAD');
  const [tab, setTab] = useState('datos');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [contact, setContact] = useState<PickerOption | null>(
    lead?.contact ? { id: lead.contact.id, label: lead.contact.name } : null,
  );
  const [company, setCompany] = useState<PickerOption | null>(
    lead?.company ? { id: lead.company.id, label: lead.company.legalName } : null,
  );
  const converted = lead ? leadStatus(lead) === 'CONVERTED' : false;
  const editable = lead
    ? !converted && can('leads', 'edit', lead.ownerId === me.id ? 'OWN' : 'TEAM')
    : true;

  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(leadInput),
    defaultValues: {
      title: lead?.title ?? '',
      email: lead?.email ?? '',
      phone: lead?.phone ?? '',
      sourceId: lead?.sourceId ?? '',
      ownerId: lead?.ownerId ?? me.id,
      priorityId: lead?.priorityId ?? '',
      currencyCode: lead?.currencyCode ?? currencies.data?.find((c) => c.isBase)?.code,
      estimatedValue: lead?.estimatedValue ? String(Number(lead.estimatedValue)) : '',
      notes: lead?.notes ?? '',
      customFields: customDefaults(defs.data, lead?.customFields),
    },
  });
  const e = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const body = {
      ...values,
      contactId: contact?.id ?? null,
      companyId: company?.id ?? null,
      customFields: cleanCustom(values.customFields as Record<string, unknown>),
    };
    try {
      if (lead) await api.patch(`/leads/${lead.id}`, { ...body, version: lead.version });
      else await api.post('/leads', { ...body, pipelineId });
      await qc.invalidateQueries({ queryKey: ['leads'] });
      toast.success(lead ? 'Prospecto actualizado.' : 'Prospecto creado.');
      onClose();
    } catch (err) {
      setError(applyServerErrors(err, form.setError));
    }
  });

  const datos = (
    <form id="lead-form" onSubmit={onSubmit} noValidate className="space-y-5">
      <FormMessage error={error} />
      <fieldset disabled={!editable} className="space-y-5">
        <fieldset className="space-y-4 rounded-md border border-border p-4">
          <legend className="px-1 text-sm font-semibold">Prospecto</legend>
          <Field label="Nombre del prospecto" error={e.title?.message} required>
            <Input autoComplete="off" {...form.register('title')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contacto" error={e.contactId?.message}>
              <EntityPicker
                value={contact}
                onChange={setContact}
                search={searchContacts}
                queryKey="contacts"
                placeholder="Buscar contacto…"
                disabled={!editable}
              />
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
            <Field label="Correo" error={e.email?.message}>
              <Input type="email" autoComplete="off" {...form.register('email')} />
            </Field>
            <Field label="Teléfono" error={e.phone?.message}>
              <Input type="tel" autoComplete="off" {...form.register('phone')} />
            </Field>
          </div>
        </fieldset>
        <fieldset className="space-y-4 rounded-md border border-border p-4">
          <legend className="px-1 text-sm font-semibold">Gestión</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Origen" error={e.sourceId?.message}>
              <Select {...form.register('sourceId')}>
                <option value="">—</option>
                {sources.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
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
            <Field label="Responsable" error={e.ownerId?.message}>
              <Select {...form.register('ownerId')}>
                {users.data?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Moneda"
              error={e.currencyCode?.message}
              hint={
                (lead?.products?.length ?? 0) > 0
                  ? 'Con productos, la moneda no se cambia aquí.'
                  : undefined
              }
            >
              <Select
                {...form.register('currencyCode')}
                disabled={(lead?.products?.length ?? 0) > 0}
              >
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
          </div>
          <Field label="Observaciones" error={e.notes?.message}>
            <Textarea rows={3} {...form.register('notes')} />
          </Field>
          {lead?.lossReason && (
            <p className="text-sm">
              <span className="font-medium">Motivo de descarte:</span> {lead.lossReason.name}
              {lead.lossNote ? ` — ${lead.lossNote}` : ''}
            </p>
          )}
        </fieldset>
        <CustomFieldInputs
          entityType="LEAD"
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
      title={lead ? lead.title : 'Nuevo prospecto'}
      description={
        lead
          ? `${lead.code} · ${lead.stage.name}${lead.owner ? ` · Responsable: ${lead.owner.name}` : ''}`
          : undefined
      }
      confirmClose={form.formState.isDirty}
      footer={
        editable &&
        tab === 'datos' && (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" form="lead-form" loading={form.formState.isSubmitting}>
              {lead ? 'Guardar cambios' : 'Crear prospecto'}
            </Button>
          </>
        )
      }
    >
      {lead && converted && lead.deal && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-success/40 bg-success/10 p-3 text-sm">
          <Repeat className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            Convertido el {formatDate(lead.convertedAt ?? lead.stageChangedAt)} en la negociación{' '}
            <Link to={`/negociaciones?id=${lead.deal.id}`} className="font-medium underline">
              {lead.deal.code} — {lead.deal.title}
            </Link>
            . Queda como registro de solo lectura.
          </span>
        </div>
      )}
      {lead && (
        <div className="mb-4 flex flex-wrap gap-2">
          {editable && can('deals', 'create') && (
            <Button size="sm" onClick={() => onConvert(lead)}>
              <ArrowRightCircle className="h-4 w-4" aria-hidden />
              Convertir en negociación
            </Button>
          )}
          <HistoryButton entityType="LEAD" entityId={lead.id} title={lead.title} />
          {can('leads', 'delete') && editable && (
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" aria-hidden />
              Enviar a papelera
            </Button>
          )}
        </div>
      )}
      {lead ? (
        <Tabs
          value={tab}
          onValueChange={setTab}
          items={[
            { value: 'datos', label: 'Datos' },
            { value: 'productos', label: `Productos (${lead.products?.length ?? 0})` },
            { value: 'tareas', label: 'Tareas' },
            { value: 'actividad', label: 'Actividad' },
            { value: 'comentarios', label: 'Comentarios' },
          ]}
        >
          <TabPanel value="datos">{datos}</TabPanel>
          <TabPanel value="productos">
            <LinesEditor
              basePath={`/leads/${lead.id}`}
              currencyCode={lead.currencyCode}
              lines={lead.products ?? []}
              totals={lead}
              editable={editable}
              lockedReason={
                converted
                  ? 'El prospecto ya fue convertido: sus productos no se modifican.'
                  : undefined
              }
              invalidate={[['leads']]}
            />
          </TabPanel>
          <TabPanel value="tareas">
            {tab === 'tareas' && (
              <RelatedTasks target={{ type: 'LEAD', id: lead.id, name: lead.title }} />
            )}
          </TabPanel>
          <TabPanel value="actividad">
            {tab === 'actividad' && <ActivitiesPanel type="LEAD" id={lead.id} />}
          </TabPanel>
          <TabPanel value="comentarios">
            {tab === 'comentarios' && <CommentsPanel type="LEAD" id={lead.id} />}
          </TabPanel>
        </Tabs>
      ) : (
        datos
      )}
      {lead && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Enviar prospecto a la papelera"
          confirmLabel="Enviar a papelera"
          danger
          onConfirm={async () => {
            await api.delete(`/leads/${lead.id}`);
            await qc.invalidateQueries({ queryKey: ['leads'] });
            toast.success('Prospecto enviado a la papelera.');
            onClose();
          }}
        >
          «{lead.title}» dejará de aparecer en el tablero y las búsquedas. Podrá restaurarlo desde
          la papelera.
        </ConfirmDialog>
      )}
    </Drawer>
  );
}
