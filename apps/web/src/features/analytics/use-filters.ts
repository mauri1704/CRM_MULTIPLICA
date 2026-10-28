import type { ConversionCriterion } from '@crm/shared';
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { todayLima } from '@/features/sales/stage-dialogs';

export interface AnalyticsFilters {
  from: string;
  to: string;
  pipelineId: string;
  teamId: string;
  ownerId: string;
  currency: string;
  criterion: ConversionCriterion;
}

const KEYS = ['from', 'to', 'pipelineId', 'teamId', 'ownerId', 'currency', 'criterion'] as const;

export const addDays = (day: string, n: number) =>
  new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Filtros de dashboard y reportes en la URL (se pueden compartir y sobreviven a recargar). El
 * dashboard arranca con los últimos 30 días; los reportes, sin rango.
 */
export function useAnalyticsFilters(defaultRange: boolean) {
  const [params, setParams] = useSearchParams();
  const defaults = useMemo(
    () =>
      defaultRange ? { from: addDays(todayLima(), -29), to: todayLima() } : { from: '', to: '' },
    [defaultRange],
  );
  const value: AnalyticsFilters = {
    from: params.get('from') ?? defaults.from,
    to: params.get('to') ?? defaults.to,
    pipelineId: params.get('pipelineId') ?? '',
    teamId: params.get('teamId') ?? '',
    ownerId: params.get('ownerId') ?? '',
    currency: params.get('currency') ?? '',
    criterion: params.get('criterion') === 'CLOSE' ? 'CLOSE' : 'CUTOFF',
  };
  const set = useCallback(
    (patch: Partial<AnalyticsFilters>) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          for (const k of KEYS) {
            if (!(k in patch)) continue;
            const v = patch[k] ?? '';
            // Un valor vacío se guarda explícitamente solo si anula el rango por omisión.
            if (v === '' && !(defaultRange && (k === 'from' || k === 'to'))) p.delete(k);
            else p.set(k, v);
          }
          return p;
        },
        { replace: true },
      );
    },
    [setParams, defaultRange],
  );
  const reset = () => setParams({}, { replace: true });
  /** Parámetros para la API (sin los vacíos). */
  const query = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== ''));
  return { value, set, reset, query };
}
