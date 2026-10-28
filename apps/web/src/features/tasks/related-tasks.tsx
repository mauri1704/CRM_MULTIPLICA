import type { TaskCrmType } from '@crm/shared';
import { useQuery } from '@tanstack/react-query';
import { ListTodo, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/input';
import { EmptyState, Spinner } from '@/components/ui/misc';
import { Priority, StageBadge } from '@/features/sales/sales-shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Page, Task } from '@/lib/types';
import { TaskDrawer, type TaskDefaults } from './task-drawer';
import { TaskDue } from './tasks-page';

const FILTER = {
  CONTACT: 'contactId',
  COMPANY: 'companyId',
  LEAD: 'leadId',
  DEAL: 'dealId',
  PROJECT: 'projectId',
} as const;

/** Tareas de una ficha (elemento CRM o proyecto), con alta rápida ya asociada (T-03). */
export function RelatedTasks({
  target,
}: {
  target: { type: TaskCrmType | 'PROJECT'; id: string; name: string };
}) {
  const { can } = useAuth();
  const [openOnly, setOpenOnly] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const filters = {
    [FILTER[target.type]]: target.id,
    rel: 'all',
    open: openOnly ? 'true' : undefined,
  };
  const { data, isLoading } = useQuery({
    queryKey: ['tasks', 'related', filters],
    queryFn: () => api.get<Page<Task>>('/tasks', { ...filters, pageSize: 100 }),
    enabled: can('tasks', 'view'),
  });
  if (!can('tasks', 'view'))
    return <p className="text-sm text-fg-muted">No tiene acceso a tareas.</p>;
  const defaults: TaskDefaults =
    target.type === 'PROJECT'
      ? { projectId: target.id }
      : { crm: { type: target.type, id: target.id, name: target.name } };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
          Solo abiertas
        </label>
        {can('tasks', 'create') && (
          <Button size="sm" onClick={() => setOpenId('nuevo')}>
            <Plus className="h-4 w-4" aria-hidden />
            Nueva tarea
          </Button>
        )}
      </div>
      {isLoading ? (
        <Spinner />
      ) : !data?.items.length ? (
        <EmptyState icon={ListTodo} title={openOnly ? 'Sin tareas abiertas' : 'Sin tareas'} />
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {data.items.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setOpenId(t.id)}
                className="flex w-full flex-col gap-1 px-3 py-2 text-left text-sm hover:bg-muted/50"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">{t.title}</span>
                  <StageBadge stage={{ ...t.status, kind: t.status.category }} />
                </span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                  <span>{t.code}</span>
                  <TaskDue task={t} />
                  <span>{t.responsible.name}</span>
                  <Priority p={t.priority} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {openId && (
        <TaskDrawer
          id={openId === 'nuevo' ? null : openId}
          defaults={defaults}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
