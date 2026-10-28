import { z } from 'zod';
import { currencyCode } from './crm';
import { uuid } from './common';

export const REPORT_KEYS = [
  'leads-by-stage',
  'deals-by-stage',
  'lead-conversion',
  'won-sales',
  'lost-sales',
  'loss-reasons',
  'owner-performance',
  'pending-tasks',
  'overdue-tasks',
  'products-sold',
  'pipeline-value',
  'duplicates',
  'trash',
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export const REPORT_INFO: Record<ReportKey, { title: string; description: string; group: string }> =
  {
    'leads-by-stage': {
      title: 'Prospectos por etapa',
      description: 'Cuántos prospectos hay en cada etapa y su valor estimado.',
      group: 'Prospectos',
    },
    'deals-by-stage': {
      title: 'Negociaciones por etapa',
      description: 'Cuántas negociaciones hay en cada etapa y su importe.',
      group: 'Negociaciones',
    },
    'lead-conversion': {
      title: 'Conversión de prospectos',
      description: 'Prospectos creados que ya son negociación, por responsable.',
      group: 'Prospectos',
    },
    'won-sales': {
      title: 'Ventas ganadas',
      description: 'Negociaciones ganadas en el período, con su valor final.',
      group: 'Negociaciones',
    },
    'lost-sales': {
      title: 'Ventas perdidas',
      description: 'Negociaciones perdidas en el período y su motivo.',
      group: 'Negociaciones',
    },
    'loss-reasons': {
      title: 'Motivos de pérdida',
      description: 'Por qué se pierden prospectos y negociaciones.',
      group: 'Negociaciones',
    },
    'owner-performance': {
      title: 'Desempeño por responsable',
      description: 'Prospectos, ventas, pipeline y tareas de cada persona.',
      group: 'Equipo',
    },
    'pending-tasks': {
      title: 'Tareas pendientes',
      description: 'Tareas abiertas por responsable y vencimiento.',
      group: 'Tareas',
    },
    'overdue-tasks': {
      title: 'Tareas vencidas',
      description: 'Tareas abiertas cuyo vencimiento ya pasó.',
      group: 'Tareas',
    },
    'products-sold': {
      title: 'Productos vendidos',
      description: 'Cantidad e importe por producto en ventas ganadas.',
      group: 'Negociaciones',
    },
    'pipeline-value': {
      title: 'Valor de pipeline',
      description: 'Importe de negociaciones abiertas, total y ponderado por probabilidad.',
      group: 'Negociaciones',
    },
    duplicates: {
      title: 'Registros duplicados detectados',
      description: 'Coincidencias detectadas, resueltas y fusiones realizadas.',
      group: 'Calidad de datos',
    },
    trash: {
      title: 'Registros eliminados y restaurados',
      description: 'Movimiento de la papelera por módulo.',
      group: 'Calidad de datos',
    },
  };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato aaaa-mm-dd.');
const empty = z.literal('').transform(() => undefined);
const optional = <T extends z.ZodTypeAny>(s: T) => z.union([s, empty]).optional();

/** Criterio de conversión multimoneda (D-14). */
export const CONVERSION_CRITERIA = ['CUTOFF', 'CLOSE'] as const;
export type ConversionCriterion = (typeof CONVERSION_CRITERIA)[number];
export const CONVERSION_CRITERIA_LABELS: Record<ConversionCriterion, string> = {
  CUTOFF: 'Tasa de la fecha de corte del reporte',
  CLOSE: 'Tasa de la fecha de cierre de cada negociación',
};

export const reportFilter = z
  .object({
    from: optional(isoDate),
    to: optional(isoDate),
    pipelineId: optional(uuid),
    teamId: optional(uuid),
    ownerId: optional(uuid),
    /** Moneda de presentación; por defecto la moneda principal. */
    currency: optional(currencyCode),
    criterion: z.enum(CONVERSION_CRITERIA).default('CUTOFF'),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    path: ['to'],
    message: 'La fecha final no puede ser anterior a la inicial.',
  });
export type ReportFilter = z.infer<typeof reportFilter>;

export const exportReportQuery = z.object({ format: z.enum(['xlsx', 'csv']).default('xlsx') });

export type ReportColumnType = 'text' | 'number' | 'money' | 'percent' | 'date';
export interface ReportColumn {
  key: string;
  label: string;
  type: ReportColumnType;
}
export type ReportCell = string | number | null;
export interface ReportMeta {
  currency: string;
  criterion: ConversionCriterion;
  /** Fecha cuya tasa se usa para consolidar (criterio «fecha de corte»). */
  cutoffDate: string;
  from: string | null;
  to: string | null;
  /** Importes que no se pudieron convertir por falta de tipo de cambio: se excluyen (D-14). */
  excluded: { currency: string; count: number; amount: string }[];
  truncated: boolean;
  /** Cómo se calcula el indicador, cuando no es obvio (p. ej. conversión). */
  note: string | null;
}
export interface ReportResult {
  key: ReportKey;
  title: string;
  meta: ReportMeta;
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  /** Fila de totales (mismas claves que las columnas). */
  totals: Record<string, ReportCell> | null;
  chart: {
    type: 'bar' | 'pie';
    /** Clave de las etiquetas dentro de `data`. */
    x: string;
    series: { key: string; label: string }[];
    /** Datos del gráfico (puede ser una agregación distinta de las filas de la tabla). */
    data: Record<string, ReportCell>[];
  } | null;
}
