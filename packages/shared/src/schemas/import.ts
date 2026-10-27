import { z } from 'zod';

/** Entidades con importación/exportación en la Fase 2 (se suman las demás en sus fases). */
export const IMPORT_ENTITIES = [
  'leads',
  'deals',
  'contacts',
  'companies',
  'products',
  'currencies',
  'exchange-rates',
] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

export const IMPORT_ENTITY_LABELS: Record<ImportEntity, string> = {
  leads: 'Prospectos',
  deals: 'Negociaciones',
  contacts: 'Contactos',
  companies: 'Compañías',
  products: 'Productos',
  currencies: 'Monedas',
  'exchange-rates': 'Tipos de cambio',
};

export const FILE_FORMATS = ['xlsx', 'csv'] as const;
export type FileFormat = (typeof FILE_FORMATS)[number];

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_EXPORT_ROWS = 50_000;

/** Qué hacer con filas que coinciden con un registro existente por la clave de correspondencia. */
export const DUPLICATE_MODES = ['SKIP', 'UPDATE'] as const;
export type DuplicateMode = (typeof DUPLICATE_MODES)[number];

export const importRunInput = z.object({
  /** columna del archivo → campo del CRM (o '' para ignorarla) */
  mapping: z.record(z.string()),
  duplicateMode: z.enum(DUPLICATE_MODES).default('SKIP'),
});
export type ImportRunInput = z.infer<typeof importRunInput>;

export interface ImportFieldInfo {
  key: string;
  label: string;
  required: boolean;
  hint?: string;
}

export interface ImportRowError {
  row: number;
  field: string;
  message: string;
}

export interface ImportSummary {
  total: number;
  valid: number;
  invalid: number;
  duplicates: number;
  toCreate: number;
  toUpdate: number;
  toSkip: number;
  errors: ImportRowError[];
}
