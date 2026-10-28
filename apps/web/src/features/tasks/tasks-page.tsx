import { TASK_RELATIONS, type TaskRelation } from '@crm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, ListTodo, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { FormMessage } from '@/components/ui/form-message';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { DataActions } from '@/features/import-export/data-actions';
import { KanbanBoard } from '@/features/sales/kanban-board';
import { Priority, StageBadge, ViewToggle, type WorkView } from '@/features/sales/sales-shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { useCatalog, useLocalPref } from '@/lib/hooks';
import type { Board, Page, StageRef, Task } from '@/lib/types';
import { useRecordParam } from '@/lib/use-record-param';
import { TaskCalendar } from './task-calendar';
import { CRM_LABELS, TaskDrawer, useProjectOptions, type TaskDefaults } from './task-drawer';

const PAGE_SIZE = 25;
const REL_LABELS: Record<TaskRelation, string> = {
  mine: 'Mis tareas',
  participant: 'Participo',
  observer: 'Observo',
  all: 'Todas',
};

export function TaskDue({ task }: { task: Task }) {
  if (!task.dueAt) return <span className="text-fg-muted">Sin vencimiento</span>;
  return task.overdue ? (
    <span className="inline-flex items-center gap-1 font-medium text-danger">
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
      Vencida · {formatDateTime(task.dueAt)}
    </span>
  ) : (
    <span>{formatDateTime(task.dueAt)}</span>
  );
}

export function TasksPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const priorities = useCatalog('priorities');
  const projects = useProjectOptions();
  const [view, setView] = useLocalPref<WorkView>('tasks.view', 'kanban');
  const [rel, setRel] = useLocalPref<TaskRelation>('tasks.rel', 'mine');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [priorityId, setPriorityId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ sort: 'dueAt', dir: 'asc' as 'asc' | 'desc' });
  const [openId, setOpenId] = useRecordParam();
  const [defaults, setDefaults] = useState<TaskDefaults | undefined>();
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const filters = {
    rel,
    q: debounced,
    priorityId,
    projectId,
    open: open ? 'true' : undefined,
  };
  const board = useQuery({
    queryKey: ['tasks', 'board', filters],
    queryFn: () => api.get<Board<Task>>('/tasks/board', filters),
    enabled: view === 'kanban',
  });
  const list = useQuery({
    queryKey: ['tasks', 'list', filters, page, sort],
    queryFn: () =>
      api.get<Page<Task>>('/tasks', { ...filters, ...sort, page, pageSize: PAGE_SIZE }),
    enabled: view === 'list',
    placeholderData: (prev) => prev,
  });

  const onMove = async (task: Task, to: StageRef, index: number) => {
    try {
      await api.put(`/tasks/${task.id}/status`, { statusId: to.id, index, version: task.version });
      await qc.invalidateQueries({ queryKey: ['tasks'] });
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      await qc.invalidateQueries({ queryKey: ['tasks'] });
      return false;
    }
  };

  const newTask = (d?: TaskDefaults) => {
    setDefaults({ ...(projectId ? { projectId } : {}), ...d });
    setOpenId('nuevo');
  };

  const columns = useMemo<ColumnDef<Task, unknown>[]>(
    () => [
      {
        id: 'title',
        header: 'Tarea',
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.title}</p>
            <p className="text-xs text-fg-muted">{row.original.code}</p>
          </div>
        ),
      },
      {
        id: 'status',
        header: 'Estado',
        enableSorting: false,
        cell: ({ row }) => (
          <StageBadge stage={{ ...row.original.status, kind: row.original.status.category }} />
        ),
      },
      {
        id: 'dueAt',
        header: 'Vencimiento',
        cell: ({ row }) => <TaskDue task={row.original} />,
      },
      {
        id: 'priority',
        header: 'Prioridad',
        enableSorting: false,
        cell: ({ row }) => <Priority p={row.original.priority} />,
      },
      {
        id: 'responsible',
        header: 'Responsable',
        enableSorting: false,
        cell: ({ row }) => row.original.responsible.name,
      },
      {
        id: 'crm',
        header: 'Asociada a',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.crm
            ? `${CRM_LABELS[row.original.crm.type]}: ${row.original.crm.name}`
            : (row.original.project?.name ?? '—'),
      },
    ],
    [],
  );

  return (
    <div className="mx-auto max-w-[1600px]">
      <PageHeader
        title="Tareas"
        description="Pendientes del equipo, asociadas a clientes, oportunidades o proyectos."
        actions={
          <>
            <DataActions entity="tasks" module="tasks" filters={filters} />
            {can('tasks', 'create') && (
              <Button onClick={() => newTask()}>
                <Plus className="h-4 w-4" aria-hidden />
                Nueva tarea
              </Button>
            )}
          </>
        }
      />
      <div role="tablist" aria-label="Relación con la tarea" className="mb-3 flex flex-wrap gap-1">
        {TASK_RELATIONS.map((r) => (
          <Button
            key={r}
            role="tab"
            aria-selected={rel === r}
            size="sm"
            variant={rel === r ? 'primary' : 'secondary'}
            onClick={() => {
              setRel(r);
              setPage(1);
            }}
          >
            {REL_LABELS[r]}
          </Button>
        ))}
      </div>
      <Card className="mb-4">
        <div className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center">
          <Input
            type="search"
            placeholder="Buscar por título o código…"
            aria-label="Buscar tareas"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="lg:max-w-xs"
          />
          <Select
            aria-label="Prioridad"
            value={priorityId}
            onChange={(e) => {
              setPriorityId(e.target.value);
              setPage(1);
            }}
            className="lg:w-52"
          >
            <option value="">Todas las prioridades</option>
            {priorities.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Proyecto"
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setPage(1);
            }}
            className="lg:w-60"
          >
            <option value="">Todos los proyectos</option>
            {projects.data?.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={open}
              onChange={(e) => {
                setOpen(e.target.checked);
                setPage(1);
              }}
            />
            Solo abiertas
          </label>
          <div className="lg:ml-auto">
            <ViewToggle value={view} onChange={setView} views={['kanban', 'list', 'calendar']} />
          </div>
        </div>
      </Card>
      {view === 'kanban' &&
        (board.isLoading || !board.data ? (
          <Spinner />
        ) : (
          <>
            {board.data.truncated && (
              <FormMessage error="Se muestran las primeras 1.000 tareas. Use los filtros para acotar." />
            )}
            <KanbanBoard
              columns={board.data.columns}
              onOpen={(t) => setOpenId(t.id)}
              canMove={(t) => t.can.status}
              onMove={onMove}
              showSums={false}
              renderCard={(t) => <TaskCard task={t} />}
            />
          </>
        ))}
      {view === 'list' && (
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
              empty={<EmptyState icon={ListTodo} title="No hay tareas con esos filtros" />}
              pagination={
                list.data
                  ? { page, pageSize: PAGE_SIZE, total: list.data.total, onPageChange: setPage }
                  : undefined
              }
            />
          )}
        </Card>
      )}
      {view === 'calendar' && (
        <TaskCalendar
          filters={filters}
          onOpen={setOpenId}
          onCreate={
            can('tasks', 'create') ? (startAt, dueAt) => newTask({ startAt, dueAt }) : undefined
          }
        />
      )}
      {openId && (
        <TaskDrawer
          id={openId === 'nuevo' ? null : openId}
          defaults={defaults}
          onClose={() => {
            setOpenId(null);
            setDefaults(undefined);
          }}
        />
      )}
    </div>
  );
}

function TaskCard({ task }: { task: Task }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium leading-snug">{task.title}</p>
        <span className="shrink-0 text-xs text-fg-muted">{task.code}</span>
      </div>
      {(task.crm || task.project) && (
        <p className="truncate text-xs text-fg-muted">
          {task.crm ? `${CRM_LABELS[task.crm.type]}: ${task.crm.name}` : task.project?.name}
        </p>
      )}
      <p className="text-xs">
        <TaskDue task={task} />
      </p>
      <div className="flex items-center justify-between gap-2">
        <Priority p={task.priority} />
        <span className="truncate text-xs text-fg-muted">{task.responsible.name}</span>
      </div>
      {task.myRole && task.myRole !== 'RESPONSIBLE' && (
        <Badge>{task.myRole === 'PARTICIPANT' ? 'Participo' : 'Observo'}</Badge>
      )}
    </div>
  );
}
