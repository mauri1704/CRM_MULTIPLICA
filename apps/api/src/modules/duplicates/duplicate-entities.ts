import type { DuplicateEntity, PermissionModule } from '@crm/shared';
import {
  normalizeEmail,
  normalizeIdentifier,
  normalizeName,
  normalizePhone,
  normalizeText,
} from '@crm/shared';

/** Cómo se normaliza un valor al compararlo (igual que al guardar en las columnas `*_norm`). */
export type FieldKind = 'ident' | 'email' | 'phone' | 'text' | 'name' | 'id';

export interface FieldColumns {
  /** Columna (o expresión) con el valor tal como se guardó. */
  raw: string;
  /** Columna con el valor normalizado. */
  norm: string;
  kind: FieldKind;
}

export interface EntityMeta {
  table: string;
  module: PermissionModule;
  /** Columna del responsable (null = el registro no tiene responsable). */
  ownerColumn: string | null;
  fields: Record<string, FieldColumns>;
}

const f = (raw: string, norm: string, kind: FieldKind): FieldColumns => ({ raw, norm, kind });
const same = (col: string, kind: FieldKind = 'id') => f(col, col, kind);

/**
 * Lista blanca de tablas y columnas que el motor de duplicados puede consultar. Nada que venga
 * del usuario se interpola en el SQL: solo estos nombres.
 */
export const ENTITIES: Record<DuplicateEntity, EntityMeta> = {
  CONTACT: {
    table: 'contacts',
    module: 'contacts',
    ownerColumn: 'owner_id',
    fields: {
      documentNumber: f('document_number', 'document_norm', 'ident'),
      email: f('email', 'email_norm', 'email'),
      phone: f('phone', 'phone_norm', 'phone'),
      fullName: f("(first_name || ' ' || coalesce(last_name, ''))", 'name_norm', 'name'),
      companyId: same('company_id'),
    },
  },
  COMPANY: {
    table: 'companies',
    module: 'companies',
    ownerColumn: 'owner_id',
    fields: {
      taxId: f('tax_id', 'tax_id_norm', 'ident'),
      legalName: f('legal_name', 'name_norm', 'name'),
      email: f('email', 'email_norm', 'email'),
      phone: f('phone', 'phone_norm', 'phone'),
    },
  },
  PRODUCT: {
    table: 'products',
    module: 'products',
    ownerColumn: null,
    fields: {
      sku: f('sku', 'sku_norm', 'ident'),
      name: f('name', 'name_norm', 'text'),
    },
  },
  LEAD: {
    table: 'leads',
    module: 'leads',
    ownerColumn: 'owner_id',
    fields: {
      email: f('email', 'email_norm', 'email'),
      companyId: same('company_id'),
      contactId: same('contact_id'),
      title: f('title', 'name_norm', 'name'),
    },
  },
  DEAL: {
    table: 'deals',
    module: 'deals',
    ownerColumn: 'owner_id',
    fields: {
      companyId: same('company_id'),
      title: f('title', 'name_norm', 'name'),
    },
  },
  PROJECT: {
    table: 'projects',
    module: 'projects',
    ownerColumn: 'owner_id',
    fields: {
      name: f('name', 'name_norm', 'text'),
    },
  },
};

/** Valor de un campo de regla a partir de los valores de un formulario (sin normalizar). */
export function draftValue(
  entity: DuplicateEntity,
  field: string,
  values: Record<string, unknown>,
): string | null {
  const str = (v: unknown) =>
    typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
  if (entity === 'CONTACT' && field === 'fullName') {
    return [str(values.firstName), str(values.lastName)].filter(Boolean).join(' ') || null;
  }
  return str(values[field]) || null;
}

export function normalizeFor(kind: FieldKind, v: string | null): string | null {
  if (v === null) return null;
  switch (kind) {
    case 'ident':
      return normalizeIdentifier(v);
    case 'email':
      return normalizeEmail(v);
    case 'phone':
      return normalizePhone(v);
    case 'text':
      return normalizeText(v) || null;
    case 'name':
      return normalizeName(v) || null;
    case 'id':
      return v;
  }
}
