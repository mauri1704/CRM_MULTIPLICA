import { CONVERSION_CRITERIA_LABELS } from '@crm/shared';
import { useQuery } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { Card } from '@/components/ui/misc';
import { usePipelines } from '@/features/sales/sales-shared';
import { api } from '@/lib/api';
import { useCurrencies, useUserOptions } from '@/lib/hooks';
import type { Page, TeamRow } from '@/lib/types';
import type { AnalyticsFilters } from './use-filters';

/** Rango de fechas, pipeline, equipo, responsable, moneda y criterio de conversión (D-14). */
export function FiltersBar({
  value,
  onChange,
  onReset,
  showCriterion = true,
}: {
  value: AnalyticsFilters;
  onChange: (patch: Partial<AnalyticsFilters>) => void;
  onReset: () => void;
  showCriterion?: boolean;
}) {
  const leadPipes = usePipelines('LEAD');
  const dealPipes = usePipelines('DEAL');
  const users = useUserOptions();
  const currencies = useCurrencies();
  // Los equipos solo los lista quien puede verlos; sin permiso, el filtro no aparece.
  const teams = useQuery({
    queryKey: ['teams', 'filter'],
    queryFn: () => api.get<Page<TeamRow>>('/teams', { pageSize: 200 }),
    retry: false,
    staleTime: 300_000,
  });
  return (
    <Card className="mb-4 p-3">
      <form
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => e.preventDefault()}
        aria-label="Filtros"
      >
        <Field label="Desde">
          <Input
            type="date"
            value={value.from}
            max={value.to || undefined}
            onChange={(e) => onChange({ from: e.target.value })}
          />
        </Field>
        <Field label="Hasta">
          <Input
            type="date"
            value={value.to}
            min={value.from || undefined}
            onChange={(e) => onChange({ to: e.target.value })}
          />
        </Field>
        <Field label="Pipeline">
          <Select
            value={value.pipelineId}
            onChange={(e) => onChange({ pipelineId: e.target.value })}
          >
            <option value="">Todos</option>
            <optgroup label="Prospectos">
              {leadPipes.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Negociaciones">
              {dealPipes.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          </Select>
        </Field>
        {teams.data && (
          <Field label="Equipo">
            <Select value={value.teamId} onChange={(e) => onChange({ teamId: e.target.value })}>
              <option value="">Todos</option>
              {teams.data.items.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Responsable">
          <Select value={value.ownerId} onChange={(e) => onChange({ ownerId: e.target.value })}>
            <option value="">Todos</option>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Moneda">
          <Select value={value.currency} onChange={(e) => onChange({ currency: e.target.value })}>
            <option value="">Principal</option>
            {currencies.data?.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </Select>
        </Field>
        {showCriterion && (
          <Field label="Tipo de cambio">
            <Select
              value={value.criterion}
              onChange={(e) =>
                onChange({ criterion: e.target.value as AnalyticsFilters['criterion'] })
              }
            >
              {Object.entries(CONVERSION_CRITERIA_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="flex items-end">
          <Button type="button" variant="secondary" onClick={onReset}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            Restablecer
          </Button>
        </div>
      </form>
    </Card>
  );
}
