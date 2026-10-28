import { zodResolver } from '@hookform/resolvers/zod';
import { TASK_ROLE_LABELS, type TaskCrmType } from '@crm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { z } from 'zod';
import { CustomFieldInputs, cleanCustom, customDefaults } from '@/components/custom-field-inputs';
import { HistoryButton } from '@/components/history-drawer';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer } from '@/components/ui/dialog';
import { EntityPicker, type PickerOption } from '@/components/ui/entity-picker';
import { Field } from '@/components/ui/field';
import { FormMessage } from '@/components/ui/form-message';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Badge, Spinner } from '@/components/ui/misc';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { CommentsPanel } from '@/features/sales/comments-panel';
import { StageBadge } from '@/features/sales/sales-shared';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useAuth, useUser } from '@/lib/auth';
import { fromLocalInput, toLocalInput } from '@/lib/datetime';
import { formatDateTime } from '@/lib/format';
import { applyServerErrors } from '@/lib/forms';
import { useCatalog, useCustomFields, useUserOptions } from '@/lib/hooks';
import { searchCompanies, searchContacts, searchDeals, searchLeads } from '@/lib/pickers';
import type { Page, Project, Task } from '@/lib/types';

export const CRM_LABELS: Record<TaskCrmType, string> = {
  CONTACT: 'Contacto',
  COMPANY: 'Compañía',
  LEAD: 'Prospecto',
  DEAL: 'Negociación',
};
export const CRM_PATHS: Record<TaskCrmType, string> = {
  CONTACT: '/contactos',
  COMPANY: '/companias',
  LEAD: '/prospectos',
  DEAL: '/negociaciones',
};
const CRM_SEARCH = {
  CONTACT: searchContacts,
  COMPANY: searchCompanies,
  LEAD: searchLeads,
  DEAL: searchDeals,
};

export interface TaskDefaults {
  crm?: { type: TaskCrmType; id: string; name: string };
  projectId?: string;
  startAt?: string;
  dueAt?: string;
}

export const useProjectOptions = () =>
  useQuery({
    queryKey: ['projects', 'options'],
    queryFn: () => api.get<Page<Project>>('/projects', { pageSize: 200, sort: 'name', dir: 'asc' }),
    staleTime: 60_000,
  });

/** Ficha de una tarea (`id` = null para crear). */
export function TaskDrawer({
  id,
  defaults,
  onClose,
}: {
  id: string | null;
  defaults?: TaskDefaults;
  onClose: () => void;
}) {
  const { data: task, error } = useQuery({
    queryKey: ['tasks', 'detail', id],
    queryFn: () => api.get<Task>(`/tasks/${id}`),
    enabled: !!id,
  });
  const defs = useCustomFields('TASK');
  const users = useUserOptions();
  const statuses = useCatalog('task-statuses');
  const ready = !!defs.data && !!users.data && !!statuses.data;
  if (id && error) {
    return (
      <Drawer open onOpenChange={(o) => !o && onClose()} title="Tarea">
        <FormMessage
          error={error instanceof ApiError ? error.message : 'No se pudo cargar la tarea.'}
        />
      </Drawer>
    );
  }
  if ((id && !task) || !ready) {
    return (
      <Drawer open onOpenChange={(o) => !o && onClose()} title="Tarea">
        <Spinner />
      </Drawer>
    );
  }
  return <TaskForm task={task ?? null} defaults={defaults} onClose={onClose} />;
}

const dateTime = z.string();
const formSchema = z
  .object({
    title: z.string().trim().min(2, 'Ingrese el título de la tarea.').max(200),
    description: z.string().max(10000),
    responsibleId: z.string(),
    startAt: dateTime,
    dueAt: dateTime,
    priorityId: z.string(),
    statusId: z.string(),
    projectId: z.string(),
    customFields: z.record(z.unknown()).optional(),
  })
  .refine((v) => !v.startAt || !v.dueAt || v.dueAt >= v.startAt, {
    path: ['dueAt'],
    message: 'El vencimiento no puede ser anterior al inicio.',
  });
type FormValues = z.infer<typeof formSchema>;

function TaskForm({
  task,
  defaults,
  onClose,
}: {
  task: Task | null;
  defaults?: TaskDefaults;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useUser();
  const { can } = useAuth();
  const users = useUserOptions();
  const priorities = useCatalog('priorities');
  const statuses = useCatalog('task-statuses');
  const projects = useProjectOptions();
  const defs = useCustomFields('TASK');
  const [tab, setTab] = useState('datos');
  const [error, setError] = useState<string | null>(null);
  const [crmError, setCrmError] = useState<string | undefined>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [participants, setParticipants] = useState<string[]>(
    task?.participants.map((p) => p.id) ?? [],
  );
  const [observers, setObservers] = useState<string[]>(task?.observers.map((p) => p.id) ?? []);
  const [membersDirty, setMembersDirty] = useState(false);
  const initialCrm = task?.crm ?? defaults?.crm ?? null;
  const [crmType, setCrmType] = useState<TaskCrmType | ''>(initialCrm?.type ?? '');
  const [crm, setCrm] = useState<PickerOption | null>(
    initialCrm ? { id: initialCrm.id, label: initialCrm.name } : null,
  );
  const editable = task ? task.can.edit : can('tasks', 'create');
  const statusOnly = !!task && !task.can.edit && task.can.status;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: task?.title ?? '',
      description: task?.description ?? '',
      responsibleId: task?.responsibleId ?? me.id,
      startAt: toLocalInput(task?.startAt ?? defaults?.startAt),
      dueAt: toLocalInput(task?.dueAt ?? defaults?.dueAt),
      priorityId: task?.priorityId ?? '',
      statusId: task?.statusId ?? '',
      projectId: task?.projectId ?? defaults?.projectId ?? '',
      customFields: customDefaults(defs.data, task?.customFields),
    },
  });
  const e = form.formState.errors;
  const responsibleId = form.watch('responsibleId');

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    setCrmError(undefined);
    const body = {
      title: v.title,
      description: v.description,
      responsibleId: v.responsibleId,
      participantIds: participants.filter((p) => p !== v.responsibleId),
      observerIds: observers.filter((p) => p !== v.responsibleId),
      startAt: fromLocalInput(v.startAt),
      dueAt: fromLocalInput(v.dueAt),
      priorityId: v.priorityId,
      statusId: v.statusId,
      projectId: v.projectId,
      crm: crmType && crm ? { type: crmType, id: crm.id } : null,
      customFields: cleanCustom(v.customFields as Record<string, unknown>),
    };
    try {
      if (task) await api.patch(`/tasks/${task.id}`, { ...body, version: task.version });
      else await api.post('/tasks', body);
      await qc.invalidateQueries({ queryKey: ['tasks'] });
      await qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success(task ? 'Tarea actualizada.' : 'Tarea creada.');
      onClose();
    } catch (err) {
      if (err instanceof ApiError) setCrmError(err.details.crm);
      setError(applyServerErrors(err, form.setError));
    }
  });

  const changeStatus = async (statusId: string) => {
    if (!task) return;
    try {
      await api.put(`/tasks/${task.id}/status`, { statusId, index: 0, version: task.version });
      await qc.invalidateQueries({ queryKey: ['tasks'] });
      toast.success('Estado actualizado.');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const datos = (
    <form id="task-form" onSubmit={onSubmit} noValidate className="space-y-5">
      <FormMessage error={error} />
      {task && !editable && (
        <p className="rounded-md bg-muted p-3 text-sm text-fg-muted">
          {task.myRole === 'OBSERVER'
            ? 'Usted es observador: puede ver la tarea y comentarla, pero no modificarla.'
            : task.myRole === 'PARTICIPANT'
              ? 'Usted es participante: puede cambiar el estado y comentar.'
              : 'Solo lectura.'}
        </p>
      )}
      {statusOnly && (
        <Field label="Estado">
          <Select value={task.statusId} onChange={(ev) => void changeStatus(ev.target.value)}>
            {statuses.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <fieldset disabled={!editable} className="space-y-5">
        <Field label="Título" error={e.title?.message} required>
          <Input autoComplete="off" {...form.register('title')} />
        </Field>
        <Field label="Descripción" error={e.description?.message}>
          <Textarea rows={3} {...form.register('description')} />
        </Field>
        <fieldset className="space-y-4 rounded-md border border-border p-4">
          <legend className="px-1 text-sm font-semibold">Personas</legend>
          <Field label="Responsable" error={e.responsibleId?.message}>
            <Select {...form.register('responsibleId')}>
              {users.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <UserChips
            label="Participantes"
            hint="Pueden cambiar el estado y comentar."
            value={participants}
            exclude={[responsibleId, ...observers]}
            disabled={!editable}
            onChange={(v) => {
              setParticipants(v);
              setMembersDirty(true);
            }}
          />
          <UserChips
            label="Observadores"
            hint="Ven la tarea y comentan; no la modifican."
            value={observers}
            exclude={[responsibleId, ...participants]}
            disabled={!editable}
            onChange={(v) => {
              setObservers(v);
              setMembersDirty(true);
            }}
          />
        </fieldset>
        <fieldset className="space-y-4 rounded-md border border-border p-4">
          <legend className="px-1 text-sm font-semibold">Planificación</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Inicio" error={e.startAt?.message}>
              <Input type="datetime-local" {...form.register('startAt')} />
            </Field>
            <Field label="Vencimiento" error={e.dueAt?.message}>
              <Input type="datetime-local" {...form.register('dueAt')} />
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
            {!statusOnly && (
              <Field label="Estado" error={e.statusId?.message}>
                <Select {...form.register('statusId')}>
                  {!task && <option value="">Primer estado pendiente</option>}
                  {statuses.data?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Proyecto" error={e.projectId?.message}>
              <Select {...form.register('projectId')}>
                <option value="">Sin proyecto</option>
                {task?.project && !projects.data?.items.some((p) => p.id === task.project!.id) && (
                  <option value={task.project.id}>{task.project.name}</option>
                )}
                {projects.data?.items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </fieldset>
        <fieldset className="space-y-4 rounded-md border border-border p-4">
          <legend className="px-1 text-sm font-semibold">Asociada a</legend>
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <Field label="Tipo">
              <Select
                value={crmType}
                onChange={(ev) => {
                  setCrmType(ev.target.value as TaskCrmType | '');
                  setCrm(null);
                }}
              >
                <option value="">Ninguno</option>
                {Object.entries(CRM_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            {crmType && (
              <Field label={CRM_LABELS[crmType]} error={crmError}>
                <EntityPicker
                  value={crm}
                  onChange={setCrm}
                  search={CRM_SEARCH[crmType]}
                  queryKey={`crm-${crmType}`}
                  placeholder="Buscar…"
                  disabled={!editable}
                />
              </Field>
            )}
          </div>
          {task?.crm && (
            <Link
              to={`${CRM_PATHS[task.crm.type]}?id=${task.crm.id}`}
              className="text-sm underline"
            >
              Abrir {CRM_LABELS[task.crm.type].toLowerCase()} {task.crm.code}
            </Link>
          )}
        </fieldset>
        <CustomFieldInputs
          entityType="TASK"
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
      title={task ? task.title : 'Nueva tarea'}
      description={
        task
          ? `${task.code} · Responsable: ${task.responsible.name}${task.myRole ? ` · Usted: ${TASK_ROLE_LABELS[task.myRole].toLowerCase()}` : ''}`
          : undefined
      }
      confirmClose={form.formState.isDirty || membersDirty}
      footer={
        editable &&
        tab === 'datos' && (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" form="task-form" loading={form.formState.isSubmitting}>
              {task ? 'Guardar cambios' : 'Crear tarea'}
            </Button>
          </>
        )
      }
    >
      {task && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <StageBadge stage={{ ...task.status, kind: task.status.category }} />
            {task.overdue && (
              <Badge tone="danger" icon={AlertTriangle}>
                Vencida
              </Badge>
            )}
            {task.completedAt && (
              <span className="text-xs text-fg-muted">
                Completada el {formatDateTime(task.completedAt)}
              </span>
            )}
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            <HistoryButton entityType="TASK" entityId={task.id} title={task.title} />
            {task.can.delete && (
              <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-4 w-4" aria-hidden />
                Enviar a papelera
              </Button>
            )}
          </div>
          <Tabs
            value={tab}
            onValueChange={setTab}
            items={[
              { value: 'datos', label: 'Datos' },
              { value: 'comentarios', label: 'Comentarios' },
            ]}
          >
            <TabPanel value="datos">{datos}</TabPanel>
            <TabPanel value="comentarios">
              {tab === 'comentarios' && <CommentsPanel type="TASK" id={task.id} />}
            </TabPanel>
          </Tabs>
          <ConfirmDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title="Enviar tarea a la papelera"
            confirmLabel="Enviar a papelera"
            danger
            onConfirm={async () => {
              await api.delete(`/tasks/${task.id}`);
              await qc.invalidateQueries({ queryKey: ['tasks'] });
              toast.success('Tarea enviada a la papelera.');
              onClose();
            }}
          >
            «{task.title}» dejará de aparecer en las vistas de tareas. Podrá restaurarla desde la
            papelera.
          </ConfirmDialog>
        </>
      )}
      {!task && datos}
    </Drawer>
  );
}

/** Selección múltiple de usuarios como etiquetas. */
function UserChips({
  label,
  hint,
  value,
  exclude,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  value: string[];
  exclude: string[];
  disabled: boolean;
  onChange: (v: string[]) => void;
}) {
  const users = useUserOptions();
  const name = (id: string) => users.data?.find((u) => u.id === id)?.name ?? '—';
  const options = users.data?.filter((u) => !value.includes(u.id) && !exclude.includes(u.id)) ?? [];
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium">{label}</p>
      {value.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {value.map((id) => (
            <li
              key={id}
              className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs"
            >
              {name(id)}
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Quitar a ${name(id)} de ${label.toLowerCase()}`}
                  onClick={() => onChange(value.filter((v) => v !== id))}
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <Select
          aria-label={`Agregar a ${label.toLowerCase()}`}
          value=""
          onChange={(ev) => ev.target.value && onChange([...value, ev.target.value])}
        >
          <option value="">Agregar…</option>
          {options.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      )}
      <p className="mt-1 text-xs text-fg-muted">{hint}</p>
    </div>
  );
}
