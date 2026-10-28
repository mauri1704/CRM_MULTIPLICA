import { z } from 'zod';
import { uuid } from './common';

export const DUPLICATE_ENTITIES = [
  'CONTACT',
  'COMPANY',
  'PRODUCT',
  'LEAD',
  'DEAL',
  'PROJECT',
] as const;
export type DuplicateEntity = (typeof DUPLICATE_ENTITIES)[number];
export const DUPLICATE_ENTITY_LABELS: Record<
  DuplicateEntity,
  { singular: string; plural: string }
> = {
  CONTACT: { singular: 'Contacto', plural: 'Contactos' },
  COMPANY: { singular: 'Compañía', plural: 'Compañías' },
  PRODUCT: { singular: 'Producto', plural: 'Productos' },
  LEAD: { singular: 'Prospecto', plural: 'Prospectos' },
  DEAL: { singular: 'Negociación', plural: 'Negociaciones' },
  PROJECT: { singular: 'Proyecto', plural: 'Proyectos' },
};

/** Exacta = valor idéntico; normalizada = sin tildes, signos ni mayúsculas; aproximada = trigram. */
export const MATCH_MODES = ['EXACT', 'NORMALIZED', 'FUZZY'] as const;
export type MatchMode = (typeof MATCH_MODES)[number];
export const MATCH_MODE_LABELS: Record<MatchMode, string> = {
  EXACT: 'Exacta',
  NORMALIZED: 'Normalizada',
  FUZZY: 'Aproximada',
};
export const DUPLICATE_ACTIONS = ['WARN', 'BLOCK'] as const;
export type DuplicateAction = (typeof DUPLICATE_ACTIONS)[number];
export const DUPLICATE_ACTION_LABELS: Record<DuplicateAction, string> = {
  WARN: 'Avisar al guardar',
  BLOCK: 'Impedir guardar',
};

export const DEFAULT_THRESHOLD = 0.85;

interface FieldInfo {
  key: string;
  label: string;
  modes: readonly MatchMode[];
}
const E: readonly MatchMode[] = ['EXACT', 'NORMALIZED'];
const N: readonly MatchMode[] = ['NORMALIZED', 'FUZZY'];
const X: readonly MatchMode[] = ['EXACT'];

/** Campos base que una regla puede comparar (los personalizados se suman como `cf.<clave>`). */
export const DUPLICATE_FIELDS: Record<DuplicateEntity, readonly FieldInfo[]> = {
  CONTACT: [
    { key: 'documentNumber', label: 'Número de documento', modes: E },
    { key: 'email', label: 'Correo', modes: E },
    { key: 'phone', label: 'Teléfono', modes: E },
    { key: 'fullName', label: 'Nombre completo', modes: N },
    { key: 'companyId', label: 'Compañía principal', modes: X },
  ],
  COMPANY: [
    { key: 'taxId', label: 'RUC / identificador', modes: E },
    { key: 'legalName', label: 'Razón social', modes: N },
    { key: 'email', label: 'Correo', modes: E },
    { key: 'phone', label: 'Teléfono', modes: E },
  ],
  PRODUCT: [
    { key: 'sku', label: 'SKU', modes: E },
    { key: 'name', label: 'Nombre', modes: N },
  ],
  LEAD: [
    { key: 'email', label: 'Correo', modes: E },
    { key: 'companyId', label: 'Compañía', modes: X },
    { key: 'contactId', label: 'Contacto', modes: X },
    { key: 'title', label: 'Nombre del prospecto', modes: N },
  ],
  DEAL: [
    { key: 'companyId', label: 'Compañía', modes: X },
    { key: 'title', label: 'Título', modes: N },
  ],
  PROJECT: [{ key: 'name', label: 'Nombre', modes: N }],
};
export const CUSTOM_PREFIX = 'cf.';

export const duplicateCondition = z.object({
  field: z.string().trim().min(1).max(70),
  mode: z.enum(MATCH_MODES),
  threshold: z.number().min(0.5).max(1).optional(),
});
export type DuplicateCondition = z.infer<typeof duplicateCondition>;

/** Valida los campos base y modos; los campos personalizados los valida la API contra su catálogo. */
function conditionsOk(entity: DuplicateEntity, conditions: DuplicateCondition[]): string | null {
  for (const c of conditions) {
    if (c.field.startsWith(CUSTOM_PREFIX)) {
      if (c.mode === 'FUZZY')
        return 'Un campo personalizado solo admite coincidencia exacta o normalizada.';
      continue;
    }
    const f = DUPLICATE_FIELDS[entity].find((x) => x.key === c.field);
    if (!f) return `El campo «${c.field}» no se puede comparar.`;
    if (!f.modes.includes(c.mode))
      return `«${f.label}» no admite coincidencia ${MATCH_MODE_LABELS[c.mode].toLowerCase()}.`;
  }
  return null;
}

const ruleBase = z.object({
  entityType: z.enum(DUPLICATE_ENTITIES),
  name: z.string().trim().min(3, 'Ingrese el nombre de la regla.').max(120),
  active: z.boolean().default(true),
  action: z.enum(DUPLICATE_ACTIONS).default('WARN'),
  conditions: z.array(duplicateCondition).min(1, 'Agregue al menos una condición.').max(5),
});
export const duplicateRuleInput = ruleBase.superRefine((v, ctx) => {
  const err = conditionsOk(v.entityType, v.conditions);
  if (err) ctx.addIssue({ code: 'custom', path: ['conditions'], message: err });
});
export type DuplicateRuleInput = z.infer<typeof duplicateRuleInput>;
export const duplicateRuleUpdate = ruleBase
  .omit({ entityType: true })
  .partial()
  .extend({ entityType: z.enum(DUPLICATE_ENTITIES).optional() });
export type DuplicateRuleUpdate = z.infer<typeof duplicateRuleUpdate>;

/** Reglas iniciales (04-reglas-negocio §6). Todas avisan; ninguna bloquea (D-15). */
export const DEFAULT_DUPLICATE_RULES: readonly DuplicateRuleInput[] = [
  {
    entityType: 'CONTACT',
    name: 'Mismo documento',
    active: true,
    action: 'WARN',
    conditions: [{ field: 'documentNumber', mode: 'NORMALIZED' }],
  },
  {
    entityType: 'CONTACT',
    name: 'Mismo correo',
    active: true,
    action: 'WARN',
    conditions: [{ field: 'email', mode: 'NORMALIZED' }],
  },
  {
    entityType: 'CONTACT',
    name: 'Mismo teléfono',
    active: true,
    action: 'WARN',
    conditions: [{ field: 'phone', mode: 'NORMALIZED' }],
  },
  {
    entityType: 'CONTACT',
    name: 'Nombre muy parecido',
    active: false,
    action: 'WARN',
    conditions: [{ field: 'fullName', mode: 'FUZZY', threshold: 0.9 }],
  },
  {
    entityType: 'COMPANY',
    name: 'Mismo RUC',
    active: true,
    action: 'WARN',
    conditions: [{ field: 'taxId', mode: 'NORMALIZED' }],
  },
  {
    entityType: 'COMPANY',
    name: 'Razón social parecida',
    active: true,
    action: 'WARN',
    conditions: [{ field: 'legalName', mode: 'FUZZY', threshold: DEFAULT_THRESHOLD }],
  },
  {
    entityType: 'PRODUCT',
    name: 'Mismo SKU',
    active: true,
    action: 'WARN',
    conditions: [{ field: 'sku', mode: 'NORMALIZED' }],
  },
  {
    entityType: 'PRODUCT',
    name: 'Nombre parecido',
    active: true,
    action: 'WARN',
    conditions: [{ field: 'name', mode: 'FUZZY', threshold: DEFAULT_THRESHOLD }],
  },
  {
    entityType: 'LEAD',
    name: 'Mismo correo y compañía',
    active: true,
    action: 'WARN',
    conditions: [
      { field: 'email', mode: 'NORMALIZED' },
      { field: 'companyId', mode: 'EXACT' },
    ],
  },
  {
    entityType: 'DEAL',
    name: 'Misma compañía y título',
    active: true,
    action: 'WARN',
    conditions: [
      { field: 'companyId', mode: 'EXACT' },
      { field: 'title', mode: 'NORMALIZED' },
    ],
  },
  {
    entityType: 'PROJECT',
    name: 'Nombre parecido',
    active: true,
    action: 'WARN',
    conditions: [{ field: 'name', mode: 'FUZZY', threshold: DEFAULT_THRESHOLD }],
  },
];

// ---------------------------------------------------------------------------
// Candidatos, comparación y fusión
// ---------------------------------------------------------------------------

export const CANDIDATE_STATUSES = ['OPEN', 'KEPT_BOTH', 'REVIEWED', 'MERGED'] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];
export const CANDIDATE_STATUS_LABELS: Record<CandidateStatus, string> = {
  OPEN: 'Por revisar',
  KEPT_BOTH: 'Se conservan ambos',
  REVIEWED: 'Revisado',
  MERGED: 'Fusionado',
};

export const MERGE_CHOICES = ['SURVIVOR', 'ABSORBED', 'BOTH'] as const;
export type MergeChoice = (typeof MERGE_CHOICES)[number];

export const mergeInput = z.object({
  candidateId: uuid,
  /** Registro que se conserva; el otro se absorbe y va a la papelera. */
  survivorId: uuid,
  /** Por campo: valor del principal (por defecto), del absorbido o ambos (solo texto largo). */
  choices: z.record(z.enum(MERGE_CHOICES)).default({}),
});
export type MergeInput = z.infer<typeof mergeInput>;

export const checkDuplicatesInput = z.object({
  entityType: z.enum(DUPLICATE_ENTITIES),
  /** Valores del formulario; se normalizan en el servidor. */
  values: z.record(z.unknown()),
  /** Al editar: el propio registro no cuenta como duplicado. */
  excludeId: uuid.optional(),
});
export type CheckDuplicatesInput = z.infer<typeof checkDuplicatesInput>;

export const scanInput = z.object({ entityType: z.enum(DUPLICATE_ENTITIES).optional() });
export type ScanInput = z.infer<typeof scanInput>;
