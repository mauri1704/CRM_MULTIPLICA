import {
  CUSTOM_PREFIX,
  DEFAULT_THRESHOLD,
  DUPLICATE_ACTIONS,
  DUPLICATE_ACTION_LABELS,
  DUPLICATE_ENTITIES,
  DUPLICATE_ENTITY_LABELS,
  DUPLICATE_FIELDS,
  MATCH_MODE_LABELS,
  type DuplicateEntity,
  type MatchMode,
} from '@crm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { FormMessage } from '@/components/ui/form-message';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { Badge, Card, PageHeader, Spinner } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { ApiError, api, errorMessage } from '@/lib/api';
import type { CustomFieldDef, DuplicateRule } from '@/lib/types';

type Cond = DuplicateRule['conditions'][number];
const NO_CUSTOM = new Set<DuplicateEntity>(['PROJECT']);

function useFieldOptions(entity: DuplicateEntity) {
  const custom = useQuery({
    queryKey: ['custom-fields', entity],
    queryFn: () => api.get<CustomFieldDef[]>('/custom-fields', { entityType: entity }),
    enabled: !NO_CUSTOM.has(entity),
    staleTime: 60_000,
  });
  return [
    ...DUPLICATE_FIELDS[entity].map((f) => ({
      key: f.key,
      label: f.label,
      modes: [...f.modes] as MatchMode[],
    })),
    ...(custom.data ?? []).map((d) => ({
      key: `${CUSTOM_PREFIX}${d.key}`,
      label: `${d.label} (personalizado)`,
      modes: ['EXACT', 'NORMALIZED'] as MatchMode[],
    })),
  ];
}

/** Reglas de duplicados por módulo (Q-01). Solo quien administra. */
export function DuplicateRulesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [entity, setEntity] = useState<DuplicateEntity>('CONTACT');
  const [editing, setEditing] = useState<DuplicateRule | 'new' | null>(null);
  const [removing, setRemoving] = useState<DuplicateRule | null>(null);
  const options = useFieldOptions(entity);
  const { data, isLoading } = useQuery({
    queryKey: ['duplicates', 'rules', entity],
    queryFn: () => api.get<DuplicateRule[]>('/duplicates/rules', { entityType: entity }),
  });
  const label = (field: string) => options.find((o) => o.key === field)?.label ?? field;

  const toggle = async (r: DuplicateRule) => {
    try {
      await api.patch(`/duplicates/rules/${r.id}`, { active: !r.active });
      await qc.invalidateQueries({ queryKey: ['duplicates', 'rules'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Reglas de duplicados"
        description="Qué campos se comparan y cómo. Una regla puede avisar al guardar o impedirlo."
        actions={
          <>
            <Link to="/duplicados">
              <Button variant="secondary">
                <ArrowLeft className="h-4 w-4" aria-hidden />
                Volver
              </Button>
            </Link>
            <Button onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" aria-hidden />
              Nueva regla
            </Button>
          </>
        }
      />
      <div role="tablist" aria-label="Módulo" className="mb-3 flex flex-wrap gap-1">
        {DUPLICATE_ENTITIES.map((e) => (
          <Button
            key={e}
            role="tab"
            aria-selected={entity === e}
            size="sm"
            variant={entity === e ? 'primary' : 'secondary'}
            onClick={() => setEntity(e)}
          >
            {DUPLICATE_ENTITY_LABELS[e].plural}
          </Button>
        ))}
      </div>
      <Card>
        {isLoading ? (
          <Spinner />
        ) : (
          <ul className="divide-y divide-border">
            {(data ?? []).map((r) => (
              <li
                key={r.id}
                className={`flex flex-wrap items-center gap-3 p-4 ${r.active ? '' : 'opacity-60'}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {r.name}
                    <Badge tone={r.action === 'BLOCK' ? 'danger' : 'neutral'}>
                      {DUPLICATE_ACTION_LABELS[r.action]}
                    </Badge>
                    {!r.active && <Badge>Inactiva</Badge>}
                  </p>
                  <p className="text-sm text-fg-muted">
                    {r.conditions
                      .map(
                        (c) =>
                          `${label(c.field)}: ${MATCH_MODE_LABELS[c.mode].toLowerCase()}${c.mode === 'FUZZY' ? ` (≥ ${Math.round((c.threshold ?? DEFAULT_THRESHOLD) * 100)} %)` : ''}`,
                      )
                      .join(' y ')}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={r.active}
                    onChange={() => void toggle(r)}
                    aria-label={`Regla «${r.name}» activa`}
                  />
                  Activa
                </label>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Editar ${r.name}`}
                  onClick={() => setEditing(r)}
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Eliminar ${r.name}`}
                  onClick={() => setRemoving(r)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </li>
            ))}
            {data?.length === 0 && (
              <li className="p-4 text-sm text-fg-muted">Este módulo no tiene reglas.</li>
            )}
          </ul>
        )}
      </Card>
      {editing && (
        <RuleDialog
          entity={entity}
          rule={editing === 'new' ? null : editing}
          options={options}
          onClose={() => setEditing(null)}
        />
      )}
      {removing && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setRemoving(null)}
          title="Eliminar regla"
          confirmLabel="Eliminar"
          danger
          onConfirm={async () => {
            await api.delete(`/duplicates/rules/${removing.id}`);
            await qc.invalidateQueries({ queryKey: ['duplicates'] });
            toast.success('Regla eliminada.');
          }}
        >
          Dejará de usarse para detectar duplicados en{' '}
          {DUPLICATE_ENTITY_LABELS[entity].plural.toLowerCase()}. Las coincidencias ya registradas
          se conservan hasta la próxima búsqueda.
        </ConfirmDialog>
      )}
    </div>
  );
}

function RuleDialog({
  entity,
  rule,
  options,
  onClose,
}: {
  entity: DuplicateEntity;
  rule: DuplicateRule | null;
  options: { key: string; label: string; modes: MatchMode[] }[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(rule?.name ?? '');
  const [active, setActive] = useState(rule?.active ?? true);
  const [action, setAction] = useState<'WARN' | 'BLOCK'>(rule?.action ?? 'WARN');
  const [conditions, setConditions] = useState<Cond[]>(
    rule?.conditions ?? [{ field: options[0]!.key, mode: options[0]!.modes[0]! }],
  );
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const setCond = (i: number, patch: Partial<Cond>) =>
    setConditions(conditions.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  const changeField = (i: number, field: string) => {
    const o = options.find((x) => x.key === field)!;
    const keep = o.modes.includes(conditions[i]!.mode);
    setCond(i, { field, mode: keep ? conditions[i]!.mode : o.modes[0]!, threshold: undefined });
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setDetails({});
    const body = {
      entityType: entity,
      name,
      active,
      action,
      conditions: conditions.map((c) => ({
        field: c.field,
        mode: c.mode,
        ...(c.mode === 'FUZZY' ? { threshold: c.threshold ?? DEFAULT_THRESHOLD } : {}),
      })),
    };
    try {
      if (rule) await api.patch(`/duplicates/rules/${rule.id}`, body);
      else await api.post('/duplicates/rules', body);
      await qc.invalidateQueries({ queryKey: ['duplicates'] });
      toast.success('Regla guardada.');
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
      wide
      onOpenChange={(o) => !o && onClose()}
      title={rule ? 'Editar regla' : 'Nueva regla'}
      description={DUPLICATE_ENTITY_LABELS[entity].plural}
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
        <Field label="Nombre" error={details.name} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Al guardar">
            <Select value={action} onChange={(e) => setAction(e.target.value as 'WARN' | 'BLOCK')}>
              {DUPLICATE_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {DUPLICATE_ACTION_LABELS[a]}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} />
            Regla activa
          </label>
        </div>
        <fieldset className="space-y-3 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-semibold">
            Condiciones (deben cumplirse todas)
          </legend>
          {conditions.map((c, i) => {
            const o = options.find((x) => x.key === c.field);
            return (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_9rem_6rem_auto]">
                <Select
                  aria-label={`Campo de la condición ${i + 1}`}
                  value={c.field}
                  onChange={(e) => changeField(i, e.target.value)}
                >
                  {options.map((x) => (
                    <option key={x.key} value={x.key}>
                      {x.label}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label={`Coincidencia de la condición ${i + 1}`}
                  value={c.mode}
                  onChange={(e) => setCond(i, { mode: e.target.value as MatchMode })}
                >
                  {(o?.modes ?? []).map((m) => (
                    <option key={m} value={m}>
                      {MATCH_MODE_LABELS[m]}
                    </option>
                  ))}
                </Select>
                {c.mode === 'FUZZY' ? (
                  <Input
                    aria-label={`Parecido mínimo (%) de la condición ${i + 1}`}
                    type="number"
                    min={50}
                    max={100}
                    value={Math.round((c.threshold ?? DEFAULT_THRESHOLD) * 100)}
                    onChange={(e) => setCond(i, { threshold: Number(e.target.value) / 100 })}
                  />
                ) : (
                  <span />
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Quitar condición ${i + 1}`}
                  disabled={conditions.length === 1}
                  onClick={() => setConditions(conditions.filter((_, k) => k !== i))}
                >
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            );
          })}
          {details.conditions && <FormMessage error={details.conditions} />}
          {conditions.length < 5 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setConditions([
                  ...conditions,
                  { field: options[0]!.key, mode: options[0]!.modes[0]! },
                ])
              }
            >
              <Plus className="h-4 w-4" aria-hidden />
              Agregar condición
            </Button>
          )}
          <p className="text-xs text-fg-muted">
            Exacta: valor idéntico. Normalizada: sin tildes, mayúsculas ni signos. Aproximada:
            nombres parecidos (parecido mínimo en %).
          </p>
        </fieldset>
      </div>
    </Dialog>
  );
}
