import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, Trash2, UsersRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { HistoryButton } from '@/components/history-drawer';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/ui/data-table';
import { Drawer } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { FormMessage } from '@/components/ui/form-message';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { Card, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { applyServerErrors } from '@/lib/forms';
import type { Page, TeamRow, UserOption } from '@/lib/types';

export function TeamsPage() {
  const { can } = useAuth();
  const manage = can('teams', 'manage');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<TeamRow | 'new' | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['teams', 'list', q],
    queryFn: () => api.get<Page<TeamRow>>('/teams', { q, pageSize: 200 }),
    placeholderData: (prev) => prev,
  });

  const columns = useMemo<ColumnDef<TeamRow, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Equipo',
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.name}</p>
            {row.original.description && (
              <p className="text-xs text-fg-muted">{row.original.description}</p>
            )}
          </div>
        ),
      },
      { id: 'supervisor', accessorFn: (r) => r.supervisor?.name ?? '—', header: 'Supervisor' },
      { id: 'members', accessorFn: (r) => r.members.length, header: 'Miembros' },
    ],
    [],
  );

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Equipos"
        description="Equipos comerciales. El supervisor ve los registros de los miembros de sus equipos."
        actions={
          manage && (
            <Button onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" aria-hidden />
              Nuevo equipo
            </Button>
          )
        }
      />
      <Card>
        <div className="border-b border-border p-3">
          <Input
            type="search"
            placeholder="Buscar equipo…"
            aria-label="Buscar equipos"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="sm:max-w-xs"
          />
        </div>
        {isLoading ? (
          <Spinner />
        ) : (
          <DataTable
            data={data?.items ?? []}
            columns={columns}
            rowKey={(r) => r.id}
            onRowClick={(r) => setEditing(r)}
            empty={<EmptyState icon={UsersRound} title="Aún no hay equipos" />}
          />
        )}
      </Card>
      {editing && (
        <TeamDrawer
          team={editing === 'new' ? null : editing}
          editable={manage}
          deletable={can('teams', 'delete')}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

const schema = z.object({
  name: z.string().trim().min(2, 'Ingrese el nombre del equipo.').max(100),
  description: z.string().trim().max(500),
  supervisorId: z.string(),
  memberIds: z.array(z.string()),
});
type TeamForm = z.infer<typeof schema>;

function TeamDrawer({
  team,
  editable,
  deletable,
  onClose,
}: {
  team: TeamRow | null;
  editable: boolean;
  deletable: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const users = useQuery({
    queryKey: ['users', 'options'],
    queryFn: () => api.get<UserOption[]>('/users/options'),
  });
  const form = useForm<TeamForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: team?.name ?? '',
      description: team?.description ?? '',
      supervisorId: team?.supervisor?.id ?? '',
      memberIds: team?.members.map((m) => m.id) ?? [],
    },
  });
  const e = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const body = {
      ...values,
      description: values.description || null,
      supervisorId: values.supervisorId || null,
    };
    try {
      if (team) await api.patch(`/teams/${team.id}`, body);
      else await api.post('/teams', body);
      await qc.invalidateQueries({ queryKey: ['teams'] });
      toast.success(team ? 'Equipo actualizado.' : 'Equipo creado.');
      onClose();
    } catch (err) {
      setError(applyServerErrors(err, form.setError));
    }
  });

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={team ? team.name : 'Nuevo equipo'}
      confirmClose={form.formState.isDirty}
      footer={
        editable && (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" form="team-form" loading={form.formState.isSubmitting}>
              {team ? 'Guardar cambios' : 'Crear equipo'}
            </Button>
          </>
        )
      }
    >
      {team && (
        <div className="mb-4 flex flex-wrap gap-2">
          <HistoryButton entityType="TEAM" entityId={team.id} title={team.name} />
          {deletable && (
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" aria-hidden />
              Enviar a papelera
            </Button>
          )}
        </div>
      )}
      {!users.data ? (
        <Spinner />
      ) : (
        <form id="team-form" onSubmit={onSubmit} noValidate className="space-y-4">
          <FormMessage error={error} />
          <fieldset disabled={!editable} className="space-y-4">
            <Field label="Nombre" error={e.name?.message} required>
              <Input {...form.register('name')} />
            </Field>
            <Field label="Descripción" error={e.description?.message}>
              <Textarea rows={2} {...form.register('description')} />
            </Field>
            <Field label="Supervisor" error={e.supervisorId?.message}>
              <Select {...form.register('supervisorId')}>
                <option value="">Sin supervisor</option>
                {users.data?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">Miembros</legend>
              <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-md border border-border p-3">
                {users.data?.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm">
                    <Checkbox value={u.id} {...form.register('memberIds')} />
                    <span>
                      {u.name} <span className="text-fg-muted">· {u.email}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </fieldset>
        </form>
      )}
      {team && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Enviar equipo a la papelera"
          confirmLabel="Enviar a papelera"
          danger
          onConfirm={async () => {
            await api.delete(`/teams/${team.id}`);
            await qc.invalidateQueries({ queryKey: ['teams'] });
            toast.success('Equipo enviado a la papelera. Puede restaurarlo desde allí.');
            onClose();
          }}
        >
          «{team.name}» dejará de aparecer en las listas. Podrá restaurarlo desde la papelera
          mientras no se elimine definitivamente.
        </ConfirmDialog>
      )}
    </Drawer>
  );
}
