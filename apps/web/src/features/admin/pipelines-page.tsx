import {
  STAGE_KINDS_BY_ENTITY,
  STAGE_KIND_LABELS,
  type PipelineEntity,
  type StageKind,
} from '@crm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, GitBranch, Pencil, Plus, Star } from 'lucide-react';
import { useState } from 'react';
import { HistoryButton } from '@/components/history-drawer';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { FormMessage } from '@/components/ui/form-message';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { Badge, Card, ColorDot, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Pipeline } from '@/lib/types';

const ENTITY_TABS: { value: PipelineEntity; label: string }[] = [
  { value: 'LEAD', label: 'Prospectos' },
  { value: 'DEAL', label: 'Negociaciones' },
];

export function PipelinesPage() {
  const { can } = useAuth();
  const manage = can('settings', 'manage');
  const [tab, setTab] = useState<PipelineEntity>('LEAD');
  const [editing, setEditing] = useState<Pipeline | 'new' | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ['pipelines', 'admin'],
    queryFn: () => api.get<Pipeline[]>('/pipelines', { includeInactive: true }),
  });

  const toggle = async (p: Pipeline) => {
    try {
      await api.put(`/pipelines/${p.id}/active`, { active: !p.active });
      await qc.invalidateQueries({ queryKey: ['pipelines'] });
      toast.success(p.active ? 'Pipeline desactivado.' : 'Pipeline activado.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Pipelines y etapas"
        description="Cada pipeline agrupa las etapas por las que avanza un prospecto o una negociación."
        actions={
          manage && (
            <Button onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" aria-hidden />
              Nuevo pipeline
            </Button>
          )
        }
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as PipelineEntity)} items={ENTITY_TABS}>
        {ENTITY_TABS.map((t) => (
          <TabPanel key={t.value} value={t.value} className="space-y-4">
            {isLoading && <Spinner />}
            {data?.filter((p) => p.entityType === t.value).length === 0 && (
              <EmptyState icon={GitBranch} title="Sin pipelines" />
            )}
            {data
              ?.filter((p) => p.entityType === t.value)
              .map((p) => (
                <Card key={p.id} className={p.active ? 'p-4' : 'p-4 opacity-60'}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">{p.name}</h2>
                      {p.isDefault && (
                        <Badge tone="primary" icon={Star}>
                          Por defecto
                        </Badge>
                      )}
                      {!p.active && <Badge>Inactivo</Badge>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <HistoryButton entityType="PIPELINE" entityId={p.id} title={p.name} />
                      {manage && (
                        <>
                          <Button variant="secondary" size="sm" onClick={() => setEditing(p)}>
                            <Pencil className="h-4 w-4" aria-hidden />
                            Editar
                          </Button>
                          {!p.isDefault && (
                            <Button variant="secondary" size="sm" onClick={() => void toggle(p)}>
                              {p.active ? 'Desactivar' : 'Activar'}
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <ol className="flex flex-wrap gap-2" aria-label={`Etapas de ${p.name}`}>
                    {p.stages.map((s, i) => (
                      <li
                        key={s.id}
                        className={`flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm ${s.active ? '' : 'line-through opacity-50'}`}
                      >
                        <span className="text-xs text-fg-muted">{i + 1}.</span>
                        <ColorDot color={s.color} />
                        {s.name}
                        <span className="text-xs text-fg-muted">
                          · {STAGE_KIND_LABELS[s.kind]}
                          {s.probability !== null ? ` · ${s.probability}%` : ''}
                        </span>
                      </li>
                    ))}
                  </ol>
                </Card>
              ))}
          </TabPanel>
        ))}
      </Tabs>
      {editing && (
        <PipelineDialog
          pipeline={editing === 'new' ? null : editing}
          entityType={editing === 'new' ? tab : editing.entityType}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface StageDraft {
  id?: string;
  name: string;
  color: string;
  kind: StageKind;
  probability: string;
  active: boolean;
}

function PipelineDialog({
  pipeline,
  entityType,
  onClose,
}: {
  pipeline: Pipeline | null;
  entityType: PipelineEntity;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(pipeline?.name ?? '');
  const [isDefault, setIsDefault] = useState(pipeline?.isDefault ?? false);
  const [stages, setStages] = useState<StageDraft[]>(
    pipeline?.stages.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      kind: s.kind,
      probability: s.probability === null ? '' : String(s.probability),
      active: s.active,
    })) ??
      (entityType === 'LEAD'
        ? [
            { name: 'Nuevo', color: '#64748B', kind: 'OPEN', probability: '', active: true },
            {
              name: 'Convertido',
              color: '#16A34A',
              kind: 'CONVERTED',
              probability: '',
              active: true,
            },
            { name: 'Descartado', color: '#DC2626', kind: 'LOST', probability: '', active: true },
          ]
        : [
            {
              name: 'Calificación',
              color: '#64748B',
              kind: 'OPEN',
              probability: '10',
              active: true,
            },
            { name: 'Ganada', color: '#16A34A', kind: 'WON', probability: '100', active: true },
            { name: 'Perdida', color: '#DC2626', kind: 'LOST', probability: '0', active: true },
          ]),
  );
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const kinds = STAGE_KINDS_BY_ENTITY[entityType];

  const update = (i: number, patch: Partial<StageDraft>) =>
    setStages((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, dir: -1 | 1) =>
    setStages((prev) => {
      const next = [...prev];
      const [item] = next.splice(i, 1);
      if (item) next.splice(i + dir, 0, item);
      return next;
    });

  const save = async () => {
    setBusy(true);
    setError(null);
    setDetails({});
    const body = {
      entityType,
      name,
      isDefault,
      stages: stages.map((s) => ({
        ...(s.id ? { id: s.id } : {}),
        name: s.name,
        color: s.color,
        kind: s.kind,
        probability: entityType === 'DEAL' && s.probability !== '' ? Number(s.probability) : null,
        active: s.active,
      })),
    };
    try {
      if (pipeline) await api.put(`/pipelines/${pipeline.id}`, body);
      else await api.post('/pipelines', body);
      await qc.invalidateQueries({ queryKey: ['pipelines'] });
      toast.success('Pipeline guardado.');
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setDetails(e.details);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const stageErrors = Object.entries(details).filter(([k]) => k.startsWith('stages'));

  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={
        pipeline
          ? `Editar ${pipeline.name}`
          : `Nuevo pipeline de ${entityType === 'LEAD' ? 'prospectos' : 'negociaciones'}`
      }
      description="Las etapas no se eliminan: desactívelas para que no se usen en registros nuevos."
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
        {stageErrors.length > 0 && (
          <ul className="list-inside list-disc text-sm text-danger">
            {stageErrors.map(([k, v]) => (
              <li key={k}>{v}</li>
            ))}
          </ul>
        )}
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Nombre" error={details.name} required>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <label className="flex h-10 items-center gap-2 text-sm">
            <Checkbox
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              disabled={pipeline?.isDefault}
            />
            Pipeline por defecto
          </label>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Etapas (en orden)</legend>
          <ol className="space-y-2">
            {stages.map((s, i) => (
              <li
                key={s.id ?? `new-${i}`}
                className="grid grid-cols-[auto_1fr] gap-2 rounded-md border border-border p-2 sm:grid-cols-[auto_1fr_120px_auto_auto_auto]"
              >
                <div className="flex flex-col">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    aria-label={`Subir ${s.name}`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    aria-label={`Bajar ${s.name}`}
                    disabled={i === stages.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
                <Input
                  aria-label="Nombre de la etapa"
                  value={s.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                />
                <Select
                  aria-label="Tipo de etapa"
                  value={s.kind}
                  onChange={(e) => update(i, { kind: e.target.value as StageKind })}
                >
                  {kinds.map((k) => (
                    <option key={k} value={k}>
                      {STAGE_KIND_LABELS[k]}
                    </option>
                  ))}
                </Select>
                <input
                  type="color"
                  aria-label="Color"
                  value={s.color}
                  onChange={(e) => update(i, { color: e.target.value.toUpperCase() })}
                  className="h-10 w-12 cursor-pointer rounded-md border border-border bg-surface"
                />
                {entityType === 'DEAL' ? (
                  <Input
                    aria-label="Probabilidad (%)"
                    type="number"
                    min={0}
                    max={100}
                    placeholder="%"
                    value={s.probability}
                    onChange={(e) => update(i, { probability: e.target.value })}
                    className="w-20"
                  />
                ) : (
                  <span />
                )}
                <label className="flex items-center gap-1.5 text-xs">
                  <Checkbox
                    checked={s.active}
                    onChange={(e) => update(i, { active: e.target.checked })}
                  />
                  Activa
                </label>
              </li>
            ))}
          </ol>
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={() =>
              setStages((prev) => [
                ...prev.slice(0, -2),
                { name: '', color: '#2563EB', kind: 'OPEN', probability: '', active: true },
                ...prev.slice(-2),
              ])
            }
          >
            <Plus className="h-4 w-4" aria-hidden />
            Agregar etapa
          </Button>
        </fieldset>
      </div>
    </Dialog>
  );
}
