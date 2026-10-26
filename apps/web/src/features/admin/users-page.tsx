import { zodResolver } from '@hookform/resolvers/zod';
import { email, password } from '@crm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { CheckCircle2, KeyRound, Lock, UserPlus, Users, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { HistoryButton } from '@/components/history-drawer';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, Drawer } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { FormMessage } from '@/components/ui/form-message';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useAuth, useUser } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { applyServerErrors } from '@/lib/forms';
import type { Page, RoleRow, TeamRow, UserRow } from '@/lib/types';

const PAGE_SIZE = 25;

export function UsersPage() {
  const { can } = useAuth();
  const manage = can('users', 'manage');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | 'true' | 'false'>('true');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['users', q, status, page],
    queryFn: () =>
      api.get<Page<UserRow>>('/users', {
        q,
        active: status === 'all' ? undefined : status,
        page,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: (prev) => prev,
  });

  const columns = useMemo<ColumnDef<UserRow, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Nombre',
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.name}</p>
            <p className="text-xs text-fg-muted">{row.original.email}</p>
          </div>
        ),
      },
      { accessorFn: (r) => r.role.name, id: 'role', header: 'Rol' },
      {
        id: 'teams',
        header: 'Equipos',
        enableSorting: false,
        cell: ({ row }) => row.original.teams.map((t) => t.name).join(', ') || '—',
      },
      {
        accessorKey: 'active',
        header: 'Estado',
        cell: ({ row }) =>
          !row.original.active ? (
            <Badge tone="neutral" icon={XCircle}>
              Inactivo
            </Badge>
          ) : row.original.lockedUntil && new Date(row.original.lockedUntil) > new Date() ? (
            <Badge tone="warning" icon={Lock}>
              Bloqueado
            </Badge>
          ) : (
            <Badge tone="success" icon={CheckCircle2}>
              Activo
            </Badge>
          ),
      },
      {
        accessorKey: 'lastLoginAt',
        header: 'Último acceso',
        cell: ({ row }) => formatDateTime(row.original.lastLoginAt),
      },
    ],
    [],
  );

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Usuarios"
        description="Personas con acceso al CRM, su rol y sus equipos."
        actions={
          manage && (
            <Button onClick={() => setEditing('new')}>
              <UserPlus className="h-4 w-4" aria-hidden />
              Nuevo usuario
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-3 sm:flex-row">
          <Input
            type="search"
            placeholder="Buscar por nombre o correo…"
            aria-label="Buscar usuarios"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            className="sm:max-w-xs"
          />
          <Select
            aria-label="Estado"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as typeof status);
              setPage(1);
            }}
            className="sm:w-44"
          >
            <option value="true">Activos</option>
            <option value="false">Inactivos</option>
            <option value="all">Todos</option>
          </Select>
        </div>
        {isLoading ? (
          <Spinner />
        ) : (
          <DataTable
            data={data?.items ?? []}
            columns={columns}
            rowKey={(r) => r.id}
            onRowClick={(r) => setEditing(r)}
            rowClassName={(r) => (r.active ? undefined : 'opacity-60')}
            empty={<EmptyState icon={Users} title="No hay usuarios con esos filtros" />}
            pagination={
              data
                ? { page, pageSize: PAGE_SIZE, total: data.total, onPageChange: setPage }
                : undefined
            }
          />
        )}
      </Card>
      {editing && (
        <UserDrawer
          user={editing === 'new' ? null : editing}
          editable={manage}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** Al editar no se pide contraseña (se cambia con "Definir contraseña"). */
const userSchema = (isNew: boolean) =>
  z.object({
    name: z.string().trim().min(2, 'Ingrese el nombre.').max(120),
    email,
    roleId: z.string().min(1, 'Seleccione un rol.'),
    teamIds: z.array(z.string()),
    password: isNew ? password : z.string(),
  });
type UserForm = z.infer<ReturnType<typeof userSchema>>;

function UserDrawer({
  user,
  editable,
  onClose,
}: {
  user: UserRow | null;
  editable: boolean;
  onClose: () => void;
}) {
  const me = useUser();
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [confirmActive, setConfirmActive] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<RoleRow[]>('/roles') });
  const teams = useQuery({
    queryKey: ['teams', 'all'],
    queryFn: () => api.get<Page<TeamRow>>('/teams', { pageSize: 200 }),
  });
  const form = useForm<UserForm>({
    resolver: zodResolver(userSchema(!user)),
    defaultValues: user
      ? {
          name: user.name,
          email: user.email,
          roleId: user.roleId,
          teamIds: user.teams.map((t) => t.id),
          password: '',
        }
      : { name: '', email: '', roleId: '', teamIds: [], password: '' },
  });
  const e = form.formState.errors;

  const toggleActive = useMutation({
    mutationFn: () => api.put(`/users/${user?.id}/active`, { active: !user?.active }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['users'] });
      toast.success(
        user?.active ? 'Usuario desactivado. Sus sesiones se cerraron.' : 'Usuario activado.',
      );
      onClose();
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      if (user) {
        const { password: _p, ...rest } = values;
        await api.patch(`/users/${user.id}`, rest);
        toast.success('Usuario actualizado.');
      } else {
        await api.post('/users', values);
        toast.success('Usuario creado.');
      }
      await qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    } catch (err) {
      setError(applyServerErrors(err, form.setError));
    }
  });

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={user ? user.name : 'Nuevo usuario'}
      description={user ? user.email : 'El usuario podrá ingresar con este correo y contraseña.'}
      confirmClose={form.formState.isDirty}
      footer={
        editable && (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" form="user-form" loading={form.formState.isSubmitting}>
              {user ? 'Guardar cambios' : 'Crear usuario'}
            </Button>
          </>
        )
      }
    >
      {user && (
        <div className="mb-4 flex flex-wrap gap-2">
          <HistoryButton entityType="USER" entityId={user.id} title={user.name} />
          {editable && (
            <>
              <Button variant="secondary" size="sm" onClick={() => setPwdOpen(true)}>
                <KeyRound className="h-4 w-4" aria-hidden />
                Definir contraseña
              </Button>
              {user.id !== me.id && (
                <Button
                  variant={user.active ? 'danger' : 'secondary'}
                  size="sm"
                  onClick={() => setConfirmActive(true)}
                >
                  {user.active ? 'Desactivar' : 'Activar'}
                </Button>
              )}
            </>
          )}
        </div>
      )}
      {/* El formulario se monta cuando ya están las opciones: así los selects muestran el valor actual. */}
      {!roles.data || !teams.data ? (
        <Spinner />
      ) : (
        <form id="user-form" onSubmit={onSubmit} noValidate className="space-y-4">
          <FormMessage error={error ?? (toggleActive.error ? toggleActive.error.message : null)} />
          <fieldset disabled={!editable} className="space-y-4">
            <Field label="Nombre completo" error={e.name?.message} required>
              <Input autoComplete="off" {...form.register('name')} />
            </Field>
            <Field label="Correo" error={e.email?.message} required>
              <Input type="email" autoComplete="off" {...form.register('email')} />
            </Field>
            <Field label="Rol" error={e.roleId?.message} required>
              <Select {...form.register('roleId')}>
                <option value="">Seleccione…</option>
                {roles.data?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
            {!user && (
              <Field
                label="Contraseña inicial"
                hint="Mínimo 10 caracteres, con letras y números. Comuníquela al usuario de forma segura."
                error={e.password?.message}
                required
              >
                <Input type="password" autoComplete="new-password" {...form.register('password')} />
              </Field>
            )}
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">Equipos</legend>
              {teams.data?.items.length === 0 && (
                <p className="text-sm text-fg-muted">No hay equipos creados.</p>
              )}
              <div className="grid gap-1.5 sm:grid-cols-2">
                {teams.data?.items.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm">
                    <Checkbox value={t.id} {...form.register('teamIds')} />
                    {t.name}
                  </label>
                ))}
              </div>
            </fieldset>
          </fieldset>
        </form>
      )}
      {user && (
        <>
          <ConfirmDialog
            open={confirmActive}
            onOpenChange={setConfirmActive}
            title={user.active ? 'Desactivar usuario' : 'Activar usuario'}
            confirmLabel={user.active ? 'Desactivar' : 'Activar'}
            danger={user.active}
            onConfirm={async () => {
              await toggleActive.mutateAsync();
            }}
          >
            {user.active
              ? `${user.name} no podrá ingresar y se cerrarán sus sesiones abiertas. Sus registros se conservan.`
              : `${user.name} podrá volver a ingresar al CRM.`}
          </ConfirmDialog>
          <SetPasswordDialog userId={user.id} open={pwdOpen} onOpenChange={setPwdOpen} />
        </>
      )}
    </Drawer>
  );
}

function SetPasswordDialog({
  userId,
  open,
  onOpenChange,
}: {
  userId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<{ password: string }>({
    resolver: zodResolver(z.object({ password })),
    defaultValues: { password: '' },
  });
  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await api.put(`/users/${userId}/password`, values);
      toast.success('Contraseña definida. Se cerraron las sesiones del usuario.');
      form.reset();
      onOpenChange(false);
    } catch (err) {
      setError(applyServerErrors(err, form.setError));
    }
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Definir contraseña"
      description="Útil si el usuario no puede recuperar su contraseña por correo."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="set-password" loading={form.formState.isSubmitting}>
            Guardar
          </Button>
        </>
      }
    >
      <form id="set-password" onSubmit={onSubmit} noValidate className="space-y-4">
        <FormMessage error={error} />
        <Field label="Nueva contraseña" error={form.formState.errors.password?.message} required>
          <Input type="password" autoComplete="new-password" {...form.register('password')} />
        </Field>
      </form>
    </Dialog>
  );
}
