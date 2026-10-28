import { zodResolver } from '@hookform/resolvers/zod';
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, projectInput } from '@crm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  CheckCircle2,
  CircleDashed,
  FolderKanban,
  FolderPlus,
  PauseCircle,
  PlayCircle,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { HistoryButton } from '@/components/history-drawer';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/ui/data-table';
import { Drawer } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { FormMessage } from '@/components/ui/form-message';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { DataActions } from '@/features/import-export/data-actions';
import { RelatedTasks } from '@/features/tasks/related-tasks';
import { ApiError, api } from '@/lib/api';
import { useAuth, useUser } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { applyServerErrors } from '@/lib/forms';
import { useUserOptions } from '@/lib/hooks';
import type { Page, Project } from '@/lib/types';
import { useRecordParam } from '@/lib/use-record-param';

const PAGE_SIZE = 25;
const STATUS_STYLE: Record<
  Project['status'],
  { icon: LucideIcon; tone: 'neutral' | 'primary' | 'warning' | 'success' }
> = {
  PLANNED: { icon: CircleDashed, tone: 'neutral' },
  ACTIVE: { icon: PlayCircle, tone: 'primary' },
  ON_HOLD: { icon: PauseCircle, tone: 'warning' },
  CLOSED: { icon: CheckCircle2, tone: 'success' },
};
const day = (v: string | null) => (v ? formatDate(`${v}T12:00:00`) : '—');

export function ProjectStatus({ status }: { status: Project['status'] }) {
  const s = STATUS_STYLE[status];
  return (
    <Badge tone={s.tone} icon={s.icon}>
      {PROJECT_STATUS_LABELS[status]}
    </Badge>
  );
}

export function ProjectsPage() {
  const { can } = useAuth();
  const users = useUserOptions();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ sort: 'createdAt', dir: 'desc' as 'asc' | 'desc' });
  const [openId, setOpenId] = useRecordParam();
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const filters = { q: debounced, status, ownerId };
  const { data, isLoading } = useQuery({
    queryKey: ['projects', filters, page, sort],
    queryFn: () =>
      api.get<Page<Project>>('/projects', { ...filters, ...sort, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  });

  const columns = useMemo<ColumnDef<Project, unknown>[]>(
    () => [
      {
        id: 'name',
        header: 'Proyecto',
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.name}</p>
            <p className="text-xs text-fg-muted">{row.original.code}</p>
          </div>
        ),
      },
      {
        id: 'status',
        header: 'Estado',
        enableSorting: false,
        cell: ({ row }) => <ProjectStatus status={row.original.status} />,
      },
      {
        id: 'owner',
        header: 'Responsable',
        enableSorting: false,
        cell: ({ row }) => row.original.owner?.name ?? '—',
      },
      {
        id: 'tasks',
        header: 'Tareas',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.tasks
            ? `${row.original.tasks.open} abiertas · ${row.original.tasks.done} completadas`
            : '—',
      },
      {
        id: 'startDate',
        header: 'Inicio',
        enableSorting: false,
        cell: ({ row }) => day(row.original.startDate),
      },
      { id: 'endDate', header: 'Fin', cell: ({ row }) => day(row.original.endDate) },
    ],
    [],
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Proyectos"
        description="Agrupan tareas de un mismo objetivo, con responsable, estado y fechas."
        actions={
          <>
            <DataActions entity="projects" module="projects" filters={filters} />
            {can('projects', 'create') && (
              <Button onClick={() => setOpenId('nuevo')}>
                <FolderPlus className="h-4 w-4" aria-hidden />
                Nuevo proyecto
              </Button>
            )}
          </>
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-3 lg:flex-row lg:items-center">
          <Input
            type="search"
            placeholder="Buscar por nombre o código…"
            aria-label="Buscar proyectos"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="lg:max-w-sm"
          />
          <Select
            aria-label="Estado"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="lg:w-48"
          >
            <option value="">Todos los estados</option>
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PROJECT_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Responsable"
            value={ownerId}
            onChange={(e) => {
              setOwnerId(e.target.value);
              setPage(1);
            }}
            className="lg:w-56"
          >
            <option value="">Todos los responsables</option>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
        {isLoading ? (
          <Spinner />
        ) : (
          <DataTable
            data={data?.items ?? []}
            columns={columns}
            rowKey={(r) => r.id}
            onRowClick={(r) => setOpenId(r.id)}
            serverSort={{ ...sort, onChange: (s, d) => setSort({ sort: s, dir: d }) }}
            empty={<EmptyState icon={FolderKanban} title="No hay proyectos con esos filtros" />}
            pagination={
              data
                ? { page, pageSize: PAGE_SIZE, total: data.total, onPageChange: setPage }
                : undefined
            }
          />
        )}
      </Card>
      {openId && (
        <ProjectDrawer id={openId === 'nuevo' ? null : openId} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}

function ProjectDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: project, error } = useQuery({
    queryKey: ['projects', 'detail', id],
    queryFn: () => api.get<Project>(`/projects/${id}`),
    enabled: !!id,
  });
  const users = useUserOptions();
  if (id && error) {
    return (
      <Drawer open onOpenChange={(o) => !o && onClose()} title="Proyecto">
        <FormMessage
          error={error instanceof ApiError ? error.message : 'No se pudo cargar el proyecto.'}
        />
      </Drawer>
    );
  }
  if ((id && !project) || !users.data) {
    return (
      <Drawer open onOpenChange={(o) => !o && onClose()} title="Proyecto">
        <Spinner />
      </Drawer>
    );
  }
  return <ProjectForm project={project ?? null} onClose={onClose} />;
}

type FormIn = z.input<typeof projectInput>;
type FormOut = z.output<typeof projectInput>;

function ProjectForm({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useUser();
  const { can } = useAuth();
  const users = useUserOptions();
  const [tab, setTab] = useState(project ? 'tareas' : 'datos');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editable = project
    ? can('projects', 'edit', project.ownerId === me.id ? 'OWN' : 'TEAM')
    : true;

  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(projectInput),
    defaultValues: {
      name: project?.name ?? '',
      description: project?.description ?? '',
      ownerId: project?.ownerId ?? me.id,
      status: project?.status ?? 'PLANNED',
      startDate: project?.startDate ?? '',
      endDate: project?.endDate ?? '',
    },
  });
  const e = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      if (project)
        await api.patch(`/projects/${project.id}`, { ...values, version: project.version });
      else await api.post('/projects', values);
      await qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success(project ? 'Proyecto actualizado.' : 'Proyecto creado.');
      onClose();
    } catch (err) {
      setError(applyServerErrors(err, form.setError));
    }
  });

  const datos = (
    <form id="project-form" onSubmit={onSubmit} noValidate className="space-y-4">
      <FormMessage error={error} />
      <fieldset disabled={!editable} className="space-y-4">
        <Field label="Nombre" error={e.name?.message} required>
          <Input autoComplete="off" {...form.register('name')} />
        </Field>
        <Field label="Descripción" error={e.description?.message}>
          <Textarea rows={3} {...form.register('description')} />
        </Field>
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
          <Field label="Estado" error={e.status?.message}>
            <Select {...form.register('status')}>
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PROJECT_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Inicio" error={e.startDate?.message}>
            <Input type="date" {...form.register('startDate')} />
          </Field>
          <Field label="Fin" error={e.endDate?.message}>
            <Input type="date" {...form.register('endDate')} />
          </Field>
        </div>
      </fieldset>
    </form>
  );

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={project ? project.name : 'Nuevo proyecto'}
      description={
        project
          ? `${project.code}${project.owner ? ` · Responsable: ${project.owner.name}` : ''}`
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
            <Button type="submit" form="project-form" loading={form.formState.isSubmitting}>
              {project ? 'Guardar cambios' : 'Crear proyecto'}
            </Button>
          </>
        )
      }
    >
      {project ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <ProjectStatus status={project.status} />
            <span className="text-sm text-fg-muted">
              {day(project.startDate)} → {day(project.endDate)}
            </span>
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            <HistoryButton entityType="PROJECT" entityId={project.id} title={project.name} />
            {can('projects', 'delete') && editable && (
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
              {
                value: 'tareas',
                label: `Tareas (${(project.tasks?.open ?? 0) + (project.tasks?.done ?? 0)})`,
              },
              { value: 'datos', label: 'Datos' },
            ]}
          >
            <TabPanel value="tareas">
              {tab === 'tareas' && (
                <RelatedTasks target={{ type: 'PROJECT', id: project.id, name: project.name }} />
              )}
            </TabPanel>
            <TabPanel value="datos">{datos}</TabPanel>
          </Tabs>
          <ConfirmDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title="Enviar proyecto a la papelera"
            confirmLabel="Enviar a papelera"
            danger
            onConfirm={async () => {
              await api.delete(`/projects/${project.id}`);
              await qc.invalidateQueries({ queryKey: ['projects'] });
              toast.success('Proyecto enviado a la papelera.');
              onClose();
            }}
          >
            «{project.name}» dejará de aparecer en la lista. Sus tareas se conservan. Podrá
            restaurarlo desde la papelera.
          </ConfirmDialog>
        </>
      ) : (
        datos
      )}
    </Drawer>
  );
}
