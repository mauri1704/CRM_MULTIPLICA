import { z } from 'zod';
import { CUSTOM_FIELD_ENTITIES } from './entities';

/** Tipos de campo personalizado (D-12). */
export const CUSTOM_FIELD_TYPES = [
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'MONEY',
  'DATE',
  'BOOLEAN',
  'SELECT',
  'MULTISELECT',
  'USER',
  'URL',
  'EMAIL',
  'PHONE',
] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  TEXT: 'Texto',
  TEXTAREA: 'Texto largo',
  NUMBER: 'Número',
  MONEY: 'Moneda',
  DATE: 'Fecha',
  BOOLEAN: 'Sí / No',
  SELECT: 'Lista',
  MULTISELECT: 'Lista múltiple',
  USER: 'Usuario',
  URL: 'URL',
  EMAIL: 'Correo',
  PHONE: 'Teléfono',
};

export const MAX_CUSTOM_FIELDS_PER_ENTITY = 50;

const optionSchema = z.object({
  value: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(100),
});

export const customFieldDefinitionInput = z
  .object({
    entityType: z.enum(CUSTOM_FIELD_ENTITIES),
    key: z
      .string()
      .trim()
      .regex(
        /^[a-z][a-z0-9_]{1,39}$/,
        'Use minúsculas, números y guion bajo (2 a 40 caracteres, empieza con letra).',
      ),
    label: z.string().trim().min(1, 'Ingrese la etiqueta.').max(100),
    type: z.enum(CUSTOM_FIELD_TYPES),
    options: z.array(optionSchema).max(200).default([]),
    required: z.boolean().default(false),
    section: z.string().trim().max(60).nullish(),
    helpText: z.string().trim().max(200).nullish(),
    position: z.number().int().min(0).default(0),
  })
  .superRefine((v, ctx) => {
    const needsOptions = v.type === 'SELECT' || v.type === 'MULTISELECT';
    if (needsOptions && v.options.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'Agregue al menos una opción.' });
    }
    if (!needsOptions && v.options.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Este tipo de campo no usa opciones.',
      });
    }
    const values = v.options.map((o) => o.value);
    if (new Set(values).size !== values.length) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'Hay opciones repetidas.' });
    }
  });
export type CustomFieldDefinitionInput = z.infer<typeof customFieldDefinitionInput>;

/** El tipo y la clave no cambian después de crear el campo: protegería los datos ya guardados. */
export const customFieldDefinitionUpdate = z.object({
  label: z.string().trim().min(1).max(100).optional(),
  options: z.array(optionSchema).max(200).optional(),
  required: z.boolean().optional(),
  section: z.string().trim().max(60).nullish(),
  helpText: z.string().trim().max(200).nullish(),
  position: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
});
export type CustomFieldDefinitionUpdate = z.infer<typeof customFieldDefinitionUpdate>;

export interface CustomFieldDefinitionLike {
  key: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  active: boolean;
  options: { value: string; label: string }[];
}

export type CustomFieldValue = string | number | boolean | string[] | null;
export type CustomFieldValues = Record<string, CustomFieldValue>;

export type CustomFieldValidation =
  | { ok: true; values: CustomFieldValues }
  | { ok: false; errors: Record<string, string> };

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const phoneRe = /^\+?[0-9 ()-]{6,20}$/;
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

/**
 * Valida y normaliza los valores de campos personalizados contra sus definiciones.
 * - Ignora (descarta) claves que no correspondan a un campo activo.
 * - Los campos inactivos conservan el valor que ya tenía el registro (`previous`).
 */
export function validateCustomFields(
  defs: readonly CustomFieldDefinitionLike[],
  input: Record<string, unknown> | null | undefined,
  previous: CustomFieldValues = {},
): CustomFieldValidation {
  const errors: Record<string, string> = {};
  const values: CustomFieldValues = {};
  const raw = input ?? {};

  for (const def of defs) {
    if (!def.active) {
      if (def.key in previous) values[def.key] = previous[def.key] ?? null;
      continue;
    }
    const v = raw[def.key];
    if (isEmpty(v)) {
      if (def.required) errors[def.key] = `${def.label} es obligatorio.`;
      continue;
    }
    const fail = (msg: string) => {
      errors[def.key] = `${def.label}: ${msg}`;
    };
    switch (def.type) {
      case 'TEXT':
      case 'TEXTAREA': {
        const max = def.type === 'TEXT' ? 255 : 5000;
        if (typeof v !== 'string') fail('debe ser texto.');
        else if (v.length > max) fail(`máximo ${max} caracteres.`);
        else values[def.key] = v.trim();
        break;
      }
      case 'NUMBER':
      case 'MONEY': {
        const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
        if (typeof n !== 'number' || !Number.isFinite(n)) fail('debe ser un número.');
        else values[def.key] = def.type === 'MONEY' ? Math.round(n * 10000) / 10000 : n;
        break;
      }
      case 'DATE':
        if (typeof v !== 'string' || !dateRe.test(v) || Number.isNaN(Date.parse(v)))
          fail('fecha inválida (aaaa-mm-dd).');
        else values[def.key] = v;
        break;
      case 'BOOLEAN':
        if (typeof v === 'boolean') values[def.key] = v;
        else if (v === 'true' || v === 'false') values[def.key] = v === 'true';
        else fail('debe ser sí o no.');
        break;
      case 'SELECT': {
        const allowed = def.options.map((o) => o.value);
        if (typeof v !== 'string' || !allowed.includes(v)) fail('opción no válida.');
        else values[def.key] = v;
        break;
      }
      case 'MULTISELECT': {
        const allowed = def.options.map((o) => o.value);
        if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !allowed.includes(x)))
          fail('opciones no válidas.');
        else values[def.key] = [...new Set(v as string[])];
        break;
      }
      case 'USER':
        if (typeof v !== 'string' || !uuidRe.test(v)) fail('usuario no válido.');
        else values[def.key] = v;
        break;
      case 'URL':
        if (typeof v !== 'string' || !z.string().url().safeParse(v).success) fail('URL no válida.');
        else values[def.key] = v.trim();
        break;
      case 'EMAIL':
        if (typeof v !== 'string' || !z.string().email().safeParse(v.trim()).success)
          fail('correo no válido.');
        else values[def.key] = v.trim().toLowerCase();
        break;
      case 'PHONE':
        if (typeof v !== 'string' || !phoneRe.test(v.trim())) fail('teléfono no válido.');
        else values[def.key] = v.trim();
        break;
    }
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values };
}
