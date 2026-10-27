import type { PermissionMap, SystemRoleKey } from '@crm/shared';

/** Tipos de las respuestas de la API usados en la interfaz. */

export interface Me {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  roleId: string;
  roleName: string;
  roleKey: SystemRoleKey | null;
  permissions: PermissionMap;
  teamIds: string[];
  theme: 'light' | 'dark' | 'system';
  organization: { id: string; name: string; baseCurrencyCode: string };
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  active: boolean;
  roleId: string;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
  role: { id: string; name: string; systemKey: string | null };
  teams: { id: string; name: string }[];
}

export interface UserOption {
  id: string;
  name: string;
  email: string;
}

export interface TeamRow {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  supervisor: { id: string; name: string } | null;
  members: { id: string; name: string; email: string; active: boolean }[];
}

export interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  systemKey: SystemRoleKey | null;
  editable: boolean;
  deletable: boolean;
  userCount: number;
  permissions: { module: string; action: string; scope: string }[];
}

export interface Stage {
  id: string;
  name: string;
  color: string;
  kind: 'OPEN' | 'WON' | 'LOST' | 'CONVERTED';
  probability: number | null;
  active: boolean;
  position: number;
}

export interface Pipeline {
  id: string;
  entityType: 'LEAD' | 'DEAL';
  name: string;
  isDefault: boolean;
  active: boolean;
  stages: Stage[];
}

export interface CatalogItem {
  id: string;
  name: string;
  active: boolean;
  color?: string;
  icon?: string;
  rank?: number;
  isDefault?: boolean;
  entityType?: string;
  code?: string;
  pattern?: string | null;
  category?: string;
  position?: number;
}

export interface CustomFieldDef {
  id: string;
  entityType: string;
  key: string;
  label: string;
  type: string;
  options: { value: string; label: string }[];
  required: boolean;
  section: string | null;
  helpText: string | null;
  position: number;
  active: boolean;
}

export interface HistoryEntry {
  id: string;
  action: string;
  changes: Record<string, unknown>;
  userName: string | null;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  event: string;
  userName: string | null;
  entityType: string | null;
  entityId: string | null;
  ip: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface TrashEntry {
  id: string;
  entityType: string;
  entityId: string;
  displayName: string;
  code: string | null;
  deletedByName: string | null;
  deletedAt: string;
  status: 'IN_TRASH' | 'RESTORED' | 'PURGED';
  relations: Record<string, unknown>;
  purgeAfter: string;
  resolvedByName: string | null;
  resolvedAt: string | null;
}

export interface TrashDetail extends TrashEntry {
  restoreConflicts: string[];
  purgeBlockers: string[];
}

export interface Organization {
  id: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  baseCurrencyCode: string;
  settings: import('@crm/shared').OrganizationSettings;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Fase 2
// ---------------------------------------------------------------------------

export type CustomValues = Record<string, unknown>;

export interface Currency {
  id: string;
  code: string;
  name: string;
  symbol: string;
  decimals: number;
  symbolPosition: 'BEFORE' | 'AFTER';
  isBase: boolean;
  active: boolean;
}

export interface ExchangeRate {
  id: string;
  rateDate: string;
  fromCurrency: string;
  toCurrency: string;
  rate: string;
  status: 'ACTIVE' | 'INACTIVE';
  source: 'MANUAL' | 'IMPORT';
  updatedByName: string | null;
  updatedAt: string;
}

export interface ExchangeRateHistoryEntry {
  id: string;
  oldRate: string | null;
  newRate: string | null;
  oldStatus: string | null;
  newStatus: string | null;
  reason: string;
  userName: string | null;
  createdAt: string;
}

export interface Ref {
  id: string;
  name: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category: Ref | null;
  categoryId: string | null;
  price: string;
  currencyCode: string;
  maxDiscountPct: string;
  active: boolean;
  customFields: CustomValues;
  version: number;
}

export interface CompanyRef {
  id: string;
  code: string;
  legalName: string;
}

export interface Company {
  id: string;
  code: string;
  legalName: string;
  tradeName: string | null;
  taxIdType: { id: string; code: string; name: string } | null;
  taxIdTypeId: string | null;
  taxId: string | null;
  sector: Ref | null;
  sectorId: string | null;
  address: string | null;
  city: string | null;
  country: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  owner: Ref | null;
  ownerId: string | null;
  notes: string | null;
  customFields: CustomValues;
  contactCount: number;
  version: number;
  createdAt: string;
}

export interface ContactBrief {
  id: string;
  code: string;
  firstName: string;
  lastName: string | null;
  jobTitle?: string | null;
  email: string | null;
  phone: string | null;
}

export interface CompanyDetail extends Company {
  contacts: ContactBrief[];
  relatedContacts: ContactBrief[];
}

export interface Contact {
  id: string;
  code: string;
  firstName: string;
  lastName: string | null;
  fullName: string;
  documentType: { id: string; code: string; name: string } | null;
  documentTypeId: string | null;
  documentNumber: string | null;
  phone: string | null;
  email: string | null;
  jobTitle: string | null;
  company: CompanyRef | null;
  companyId: string | null;
  relatedCompanies: (CompanyRef & { jobTitle: string | null })[];
  owner: Ref | null;
  ownerId: string | null;
  notes: string | null;
  customFields: CustomValues;
  version: number;
  createdAt: string;
}

export interface ImportJob {
  id: string;
  entityType: string;
  entityLabel: string;
  fileName: string;
  format: string;
  status: 'UPLOADED' | 'COMPLETED' | 'FAILED';
  totalRows: number;
  validRows: number;
  invalidRows: number;
  createdRows: number;
  updatedRows: number;
  skippedRows: number;
  createdByName: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface SearchResult {
  contacts: { id: string; title: string; subtitle: string }[];
  companies: { id: string; title: string; subtitle: string }[];
  products: { id: string; title: string; subtitle: string }[];
}
