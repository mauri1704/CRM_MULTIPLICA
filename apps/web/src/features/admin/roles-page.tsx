import {
  ACTION_LABELS,
  PERMISSION_ACTIONS,
  PERMISSION_MODULES,
  PERMISSION_MODULE_KEYS,
  SCOPE_LABELS,
  type PermissionScope,
} from '@crm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Lock, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { HistoryButton } from '@/components/history-drawer';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { FormMessage } from '@/components/ui/form-message';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Badge, Card, PageHeader, Spinner } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import type { RoleRow } from '@/lib/types';

type Matrix = Record<string, PermissionScope>;
const key = (module: string, action: string) => `${module}.${action}`;
const toMatrix = (role: RoleRow): Matrix =>
  Object.fromEntries(
    role.permissions.map((p) => [key(p.module, p.action), p.scope as PermissionScope]),
  );
const toEntries = (m: Matrix) =>
  Object.entries(m)
    .filter(([, scope]) => scope !== 'NONE')
    .map(([k, scope]) => {
      const [module = '', action = ''] = k.split('.');
      return { module, action, scope };
    });

export function RolesPage() {
  const { can } = useAuth();
  const manage = can('roles', 'manage');
  const qc = useQueryClient();
  const toast = useToast();
  const { data: roles, isLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get<RoleRow[]>('/roles'),
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [matrix, setMatrix] = useState<Matrix>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const selected = roles?.find((r) => r.id === selectedId) ?? roles?.[0];
  useEffect(() => {
    if (selected) {
      setMatrix(toMatrix(selected));
      setError(null);
    }
  }, [selected]);
  const dirty = useMemo(
    () =>
      !!selected &&
      JSON.stringify(
        toEntries(matrix).sort((a, b) =>
          key(a.module, a.action).localeCompare(key(b.module, b.action)),
        ),
      ) !==
        JSON.stringify(
          toEntries(toMatrix(selected)).sort((a, b) =>
            key(a.module, a.action).localeCompare(key(b.module, b.action)),
          ),
        ),
    [matrix, selected],
  );

  if (isLoading || !roles || !selected) return <Spinner />;
  const editable = manage && selected.editable;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/roles/${selected.id}`, { permissions: toEntries(matrix) });
      await qc.invalidateQueries({ queryKey: ['roles'] });
      toast.success('Permisos guardados. Se aplican desde la próxima acción de cada usuario.');
    } catch (e) {
      setError(
        e instanceof ApiError && Object.keys(e.details).length > 0
          ? Object.values(e.details).join(' ')
          : errorMessage(e),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Roles y permisos"
        description="Qué puede hacer cada rol y sobre qué registros: propios, de su equipo o todos."
        actions={
          manage && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              Nuevo rol
            </Button>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card className="h-fit p-2">
          <ul role="listbox" aria-label="Roles" className="space-y-1">
            {roles.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={r.id === selected.id}
                  onClick={() => {
                    if (dirty && !window.confirm('Hay cambios sin guardar. ¿Desea descartarlos?'))
                      return;
                    setSelectedId(r.id);
                  }}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm',
                    r.id === selected.id
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'hover:bg-muted',
                  )}
                >
                  <span className="flex items-center gap-2">
                    {r.systemKey ? (
                      <Lock className="h-3.5 w-3.5" aria-label="Rol del sistema" />
                    ) : (
                      <KeyRound className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {r.name}
                  </span>
                  <span className="text-xs text-fg-muted">{r.userCount} usuario(s)</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="min-w-0">
          <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold">{selected.name}</h2>
              <p className="text-sm text-fg-muted">
                {selected.description ??
                  (selected.systemKey === 'ADMIN'
                    ? 'Tiene todos los permisos; no se puede modificar.'
                    : 'Rol de la organización.')}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <HistoryButton entityType="ROLE" entityId={selected.id} title={selected.name} />
              {manage && selected.deletable && (
                <Button variant="danger" size="sm" onClick={() => setDeleting(true)}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                  Eliminar rol
                </Button>
              )}
            </div>
          </div>
          <div className="p-4">
            <FormMessage error={error} className="mb-3" />
            <PermissionMatrix matrix={matrix} onChange={setMatrix} editable={editable} />
          </div>
          {editable && (
            <div className="flex justify-end gap-2 border-t border-border p-4">
              <Button
                variant="secondary"
                disabled={!dirty}
                onClick={() => setMatrix(toMatrix(selected))}
              >
                Descartar
              </Button>
              <Button loading={saving} disabled={!dirty} onClick={save}>
                Guardar permisos
              </Button>
            </div>
          )}
        </Card>
      </div>

      <CreateRoleDialog
        open={creating}
        onOpenChange={setCreating}
        roles={roles}
        onCreated={(id) => setSelectedId(id)}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Eliminar rol"
        confirmLabel="Eliminar"
        danger
        onConfirm={async () => {
          await api.delete(`/roles/${selected.id}`);
          await qc.invalidateQueries({ queryKey: ['roles'] });
          setSelectedId(null);
          toast.success('Rol eliminado.');
        }}
      >
        Se eliminará el rol «{selected.name}». Solo es posible si ningún usuario lo tiene asignado.
      </ConfirmDialog>
    </div>
  );
}

function PermissionMatrix({
  matrix,
  onChange,
  editable,
}: {
  matrix: Matrix;
  onChange: (m: Matrix) => void;
  editable: boolean;
}) {
  const actions = PERMISSION_ACTIONS;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <caption className="sr-only">Permisos por módulo y acción</caption>
        <thead>
          <tr className="border-b border-border text-xs text-fg-muted">
            <th scope="col" className="py-2 pr-3 text-left font-medium">
              Módulo
            </th>
            {actions.map((a) => (
              <th key={a} scope="col" className="px-1 py-2 text-left font-medium">
                {ACTION_LABELS[a]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {PERMISSION_MODULE_KEYS.map((m) => {
            const def = PERMISSION_MODULES[m];
            const scopes: PermissionScope[] = def.recordScoped
              ? ['NONE', 'OWN', 'TEAM', 'ALL']
              : ['NONE', 'ALL'];
            return (
              <tr key={m}>
                <th scope="row" className="py-1.5 pr-3 text-left font-medium">
                  {def.label}
                </th>
                {actions.map((a) => {
                  if (!(def.actions as readonly string[]).includes(a)) {
                    return (
                      <td key={a} className="px-1 py-1.5 text-fg-muted" aria-label="No aplica">
                        —
                      </td>
                    );
                  }
                  const value = matrix[key(m, a)] ?? 'NONE';
                  return (
                    <td key={a} className="px-1 py-1.5">
                      {editable ? (
                        <Select
                          aria-label={`${def.label}: ${ACTION_LABELS[a]}`}
                          value={value}
                          onChange={(e) =>
                            onChange({ ...matrix, [key(m, a)]: e.target.value as PermissionScope })
                          }
                          className={cn(
                            'h-8 min-w-[118px] px-2 text-xs',
                            value === 'NONE' && 'text-fg-muted',
                          )}
                        >
                          {scopes.map((s) => (
                            <option key={s} value={s}>
                              {SCOPE_LABELS[s]}
                            </option>
                          ))}
                        </Select>
                      ) : value === 'NONE' ? (
                        <span className="text-xs text-fg-muted">{SCOPE_LABELS.NONE}</span>
                      ) : (
                        <Badge tone={value === 'ALL' ? 'success' : 'primary'}>
                          {SCOPE_LABELS[value]}
                        </Badge>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CreateRoleDialog({
  open,
  onOpenChange,
  roles,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  roles: RoleRow[];
  onCreated: (id: string) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [copyFrom, setCopyFrom] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setDetails({});
    const base = roles.find((r) => r.id === copyFrom);
    // Desde Administrador solo se copian alcances válidos para un rol editable (todos lo son).
    const permissions = base ? base.permissions : [];
    try {
      const role = await api.post<RoleRow>('/roles', {
        name,
        description: description || null,
        permissions,
      });
      await qc.invalidateQueries({ queryKey: ['roles'] });
      toast.success('Rol creado. Ajuste sus permisos en la matriz.');
      onCreated(role.id);
      setName('');
      setDescription('');
      setCopyFrom('');
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError) setDetails(e.details);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Nuevo rol"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button loading={busy} onClick={submit} disabled={name.trim().length < 2}>
            Crear rol
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormMessage error={error} />
        <Field label="Nombre" error={details.name} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Descripción">
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Copiar permisos de" hint="Opcional: parte de los permisos de otro rol.">
          <Select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
            <option value="">Sin permisos (empezar de cero)</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}
