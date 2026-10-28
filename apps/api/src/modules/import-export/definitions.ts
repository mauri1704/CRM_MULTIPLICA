import type {
  CustomFieldType,
  ImportEntity,
  ImportFieldInfo,
  PermissionAction,
  PermissionModule,
} from '@crm/shared';
import type { AuthUser } from '../../common/auth.types';
import type { ExportColumn } from './spreadsheet';

export type FieldErrors = Record<string, string>;

/** Resultado de interpretar una fila (sin escribir en la base). */
export type ParsedRow<D> =
  | { ok: true; data: D; key: string | null }
  | { ok: false; errors: FieldErrors };

export interface Existing {
  id: string;
  ownerId?: string | null;
}

/**
 * Lo que cada módulo aporta a la importación/exportación transversal. Las escrituras pasan por el
 * service del módulo: mismas validaciones, permisos, historial y auditoría que la pantalla.
 */
export interface ImportExportDefinition<D, R> {
  entity: ImportEntity;
  module: PermissionModule;
  /** Permiso para crear / actualizar registros al importar. */
  createAction: PermissionAction;
  updateAction: PermissionAction;
  sheetName: string;
  /** Campos importables (incluye los personalizados como `cf.<clave>`). */
  fields(): Promise<ImportFieldInfo[]>;
  /** Fila de ejemplo para la plantilla. */
  example(): Record<string, string>;
  /** Interpreta y valida una fila; `existing` = registro que coincide por la clave (si lo hay). */
  parse(values: Record<string, string>, user: AuthUser): Promise<ParsedRow<D>>;
  findExisting(data: D, key: string): Promise<Existing | null>;
  /** Validaciones con consultas (unicidad, relaciones) contra el registro existente si se actualiza. */
  check(data: D, existing: Existing | null): Promise<void>;
  create(user: AuthUser, data: D): Promise<void>;
  update(user: AuthUser, existing: Existing, data: D): Promise<void>;
  /** Exportación */
  exportColumns(): Promise<ExportColumn<R>[]>;
  exportRows(user: AuthUser, query: Record<string, unknown>, limit: number): Promise<R[]>;
}

// ---------------------------------------------------------------------------
// Utilidades para interpretar celdas
// ---------------------------------------------------------------------------

/** Acepta aaaa-mm-dd y dd/mm/aaaa. */
export function parseDateCell(v: string): string | null {
  const s = v.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return null;
}

/**
 * Fecha con hora opcional (dd/mm/aaaa hh:mm o aaaa-mm-dd hh:mm), en hora de Lima (D-21), a ISO.
 * Sin hora = 09:00.
 */
export function parseDateTimeCell(v: string): string | null {
  const m = /^(.+?)(?:[ T](\d{1,2}):(\d{2}))?$/.exec(v.trim());
  if (!m) return null;
  const day = parseDateCell(m[1]!);
  if (!day) return null;
  const hh = Number(m[2] ?? 9);
  const mm = Number(m[3] ?? 0);
  if (hh > 23 || mm > 59) return null;
  const iso = `${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00-05:00`;
  return Number.isNaN(new Date(iso).getTime()) ? null : new Date(iso).toISOString();
}

/** "1.234,56", "1,234.56", "1234.56" → "1234.56". */
export function parseNumberCell(v: string): string | null {
  let s = v.trim().replace(/\s|[A-Za-z$/€]/g, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? s : null;
}

export function parseBoolCell(v: string): boolean | null {
  const s = v.trim().toLowerCase();
  if (['si', 'sí', 'true', '1', 'x', 'activo', 'yes'].includes(s)) return true;
  if (['no', 'false', '0', 'inactivo'].includes(s)) return false;
  return null;
}

/** Convierte el texto de una celda al valor que espera un campo personalizado. */
export function customCellValue(type: CustomFieldType, v: string): unknown {
  const s = v.trim();
  if (s === '') return undefined;
  switch (type) {
    case 'NUMBER':
    case 'MONEY':
      return parseNumberCell(s) ?? s;
    case 'BOOLEAN': {
      const b = parseBoolCell(s);
      return b === null ? s : b;
    }
    case 'DATE':
      return parseDateCell(s) ?? s;
    case 'MULTISELECT':
      return s
        .split(/[;,|]/)
        .map((x) => x.trim())
        .filter(Boolean);
    default:
      return s;
  }
}

export const CF_PREFIX = 'cf.';

export function customFieldInfos(
  defs: { key: string; label: string; required: boolean; type: string }[],
): ImportFieldInfo[] {
  return defs.map((d) => ({
    key: `${CF_PREFIX}${d.key}`,
    label: d.label,
    required: d.required,
    hint: d.type === 'MULTISELECT' ? 'Varias opciones separadas por ;' : undefined,
  }));
}
