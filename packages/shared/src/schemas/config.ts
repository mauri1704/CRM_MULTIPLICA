import { z } from 'zod';
import { hexColor, uuid } from './common';

// ---------------------------------------------------------------------------
// Catálogos simples (prioridades, orígenes, motivos de pérdida, tipos de documento, sectores,
// estados de tarea). En uso → solo se desactivan.
// ---------------------------------------------------------------------------

export const CATALOG_KINDS = [
  'priorities',
  'lead-sources',
  'loss-reasons',
  'document-types',
  'economic-sectors',
  'task-statuses',
] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

export const CATALOG_LABELS: Record<CatalogKind, { plural: string; singular: string }> = {
  priorities: { plural: 'Prioridades', singular: 'Prioridad' },
  'lead-sources': { plural: 'Orígenes de prospecto', singular: 'Origen' },
  'loss-reasons': { plural: 'Motivos de pérdida', singular: 'Motivo de pérdida' },
  'document-types': { plural: 'Tipos de documento', singular: 'Tipo de documento' },
  'economic-sectors': { plural: 'Sectores económicos', singular: 'Sector' },
  'task-statuses': { plural: 'Estados de tarea', singular: 'Estado de tarea' },
};

export const PRIORITY_ICONS = [
  'chevrons-up',
  'chevron-up',
  'equal',
  'chevron-down',
  'flag',
] as const;
export const TASK_STATUS_CATEGORIES = [
  'OPEN',
  'IN_PROGRESS',
  'REVIEW',
  'DONE',
  'CANCELED',
] as const;
export const TASK_STATUS_CATEGORY_LABELS: Record<(typeof TASK_STATUS_CATEGORIES)[number], string> =
  {
    OPEN: 'Pendiente',
    IN_PROGRESS: 'En progreso',
    REVIEW: 'En revisión',
    DONE: 'Completada',
    CANCELED: 'Cancelada',
  };
export const LOSS_REASON_ENTITIES = ['LEAD', 'DEAL'] as const;

const name = z.string().trim().min(1, 'Ingrese el nombre.').max(100);

export const catalogInputs = {
  priorities: z.object({
    name,
    color: hexColor,
    icon: z.enum(PRIORITY_ICONS),
    rank: z.number().int().min(0).max(1000),
    isDefault: z.boolean().default(false),
  }),
  'lead-sources': z.object({ name }),
  'loss-reasons': z.object({ name, entityType: z.enum(LOSS_REASON_ENTITIES) }),
  'document-types': z.object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_]{1,10}$/, 'Código de 1 a 10 caracteres.'),
    name,
    pattern: z
      .string()
      .trim()
      .max(200)
      .refine((p) => {
        try {
          new RegExp(p);
          return true;
        } catch {
          return false;
        }
      }, 'Expresión regular no válida.')
      .nullish(),
  }),
  'economic-sectors': z.object({ name }),
  'task-statuses': z.object({
    name,
    color: hexColor,
    category: z.enum(TASK_STATUS_CATEGORIES),
    position: z.number().int().min(0).max(1000),
  }),
} satisfies Record<CatalogKind, z.ZodTypeAny>;

export type CatalogInput<K extends CatalogKind> = z.infer<(typeof catalogInputs)[K]>;

export const catalogActiveInput = z.object({ active: z.boolean() });

// ---------------------------------------------------------------------------
// Pipelines y etapas
// ---------------------------------------------------------------------------

export const PIPELINE_ENTITIES = ['LEAD', 'DEAL'] as const;
export type PipelineEntity = (typeof PIPELINE_ENTITIES)[number];

export const STAGE_KINDS = ['OPEN', 'WON', 'LOST', 'CONVERTED'] as const;
export type StageKind = (typeof STAGE_KINDS)[number];
export const STAGE_KIND_LABELS: Record<StageKind, string> = {
  OPEN: 'En curso',
  WON: 'Ganada',
  LOST: 'Perdida',
  CONVERTED: 'Convertido',
};
/** Tipos de etapa válidos por entidad: los prospectos no se "ganan", se convierten. */
export const STAGE_KINDS_BY_ENTITY: Record<PipelineEntity, readonly StageKind[]> = {
  LEAD: ['OPEN', 'LOST', 'CONVERTED'],
  DEAL: ['OPEN', 'WON', 'LOST'],
};

export const stageInput = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1, 'Ingrese el nombre de la etapa.').max(60),
  color: hexColor,
  kind: z.enum(STAGE_KINDS),
  probability: z.number().int().min(0).max(100).nullish(),
  active: z.boolean().default(true),
});
export type StageInput = z.infer<typeof stageInput>;

export const pipelineInput = z
  .object({
    entityType: z.enum(PIPELINE_ENTITIES),
    name: z.string().trim().min(2, 'Ingrese el nombre del pipeline.').max(80),
    isDefault: z.boolean().default(false),
    stages: z.array(stageInput).min(2, 'Defina al menos dos etapas.').max(30),
  })
  .superRefine((p, ctx) => {
    const allowed = STAGE_KINDS_BY_ENTITY[p.entityType];
    p.stages.forEach((s, i) => {
      if (!allowed.includes(s.kind)) {
        ctx.addIssue({
          code: 'custom',
          path: ['stages', i, 'kind'],
          message: `Tipo de etapa no válido para ${p.entityType === 'LEAD' ? 'prospectos' : 'negociaciones'}.`,
        });
      }
    });
    const active = p.stages.filter((s) => s.active);
    if (!active.some((s) => s.kind === 'OPEN')) {
      ctx.addIssue({
        code: 'custom',
        path: ['stages'],
        message: 'Debe haber al menos una etapa en curso.',
      });
    }
    const closing = p.entityType === 'LEAD' ? 'CONVERTED' : 'WON';
    if (!active.some((s) => s.kind === closing)) {
      ctx.addIssue({
        code: 'custom',
        path: ['stages'],
        message:
          p.entityType === 'LEAD'
            ? 'Debe haber una etapa de tipo "Convertido".'
            : 'Debe haber una etapa de tipo "Ganada".',
      });
    }
    if (!active.some((s) => s.kind === 'LOST')) {
      ctx.addIssue({
        code: 'custom',
        path: ['stages'],
        message: 'Debe haber una etapa de tipo "Perdida".',
      });
    }
    const names = p.stages.map((s) => s.name.toLowerCase());
    if (new Set(names).size !== names.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['stages'],
        message: 'Hay etapas con el mismo nombre.',
      });
    }
  });
export type PipelineInput = z.infer<typeof pipelineInput>;
