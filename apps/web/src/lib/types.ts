import type { CandidateStatus, DuplicateEntity, PermissionMap, SystemRoleKey } from '@crm/shared';

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
  tasks: { id: string; title: string; subtitle: string }[];
  projects: { id: string; title: string; subtitle: string }[];
  leads: { id: string; title: string; subtitle: string }[];
  deals: { id: string; title: string; subtitle: string }[];
  contacts: { id: string; title: string; subtitle: string }[];
  companies: { id: string; title: string; subtitle: string }[];
  products: { id: string; title: string; subtitle: string }[];
}

// ---------------------------------------------------------------------------
// Fase 3
// ---------------------------------------------------------------------------

export interface PriorityRef {
  id: string;
  name: string;
  color: string;
  icon: string;
  rank: number;
}

export interface StageRef {
  id: string;
  name: string;
  /** Tipo de etapa (prospectos/negociaciones) o categoría de estado (tareas). */
  kind: 'OPEN' | 'WON' | 'LOST' | 'CONVERTED' | 'IN_PROGRESS' | 'REVIEW' | 'DONE' | 'CANCELED';
  color: string;
  probability?: number | null;
}

export interface Line {
  id: string;
  productId: string;
  sku: string;
  description: string;
  quantity: string;
  unitPrice: string;
  currencyCode: string;
  discountType: 'AMOUNT' | 'PERCENT';
  discountValue: string;
  exchangeRate: string;
  exchangeRateDate: string | null;
  rateSource: 'NONE' | 'MASTER' | 'INVERSE' | 'MANUAL';
  rateReason: string | null;
  lineSubtotal: string;
  lineDiscount: string;
  lineTotal: string;
}

interface SalesBase {
  id: string;
  code: string;
  title: string;
  company: CompanyRef | null;
  companyId: string | null;
  pipeline: Ref;
  pipelineId: string;
  stage: StageRef;
  stageId: string;
  stageChangedAt: string;
  owner: Ref | null;
  ownerId: string | null;
  priority: PriorityRef | null;
  priorityId: string | null;
  currencyCode: string;
  estimatedValue: string | null;
  subtotal: string;
  discount: string;
  total: string;
  notes: string | null;
  lossReason: Ref | null;
  lossReasonId: string | null;
  lossNote: string | null;
  customFields: CustomValues;
  version: number;
  createdAt: string;
}

export interface Lead extends SalesBase {
  contact: { id: string; code: string; name: string; email: string | null } | null;
  contactId: string | null;
  phone: string | null;
  email: string | null;
  source: Ref | null;
  sourceId: string | null;
  convertedAt: string | null;
  deal: { id: string; code: string; title: string } | null;
  products?: Line[];
}

export interface Deal extends SalesBase {
  sourceLead: { id: string; code: string; title: string } | null;
  contacts: {
    id: string;
    code: string;
    name: string;
    email: string | null;
    phone: string | null;
    isPrimary: boolean;
  }[];
  finalValue: string | null;
  probability: number | null;
  expectedCloseDate: string | null;
  status: 'OPEN' | 'WON' | 'LOST';
  closedAt: string | null;
  products?: Line[];
}

export interface BoardColumn<T> {
  stage: StageRef;
  count: number;
  sums: { currencyCode: string; amount: string }[];
  items: T[];
}

export interface Board<T> {
  pipeline: Ref;
  truncated: boolean;
  columns: BoardColumn<T>[];
}

export interface CommentItem {
  id: string;
  body: string;
  author: Ref;
  mentions: Ref[];
  editedAt: string | null;
  createdAt: string;
  mine: boolean;
}

// ---------------------------------------------------------------------------
// Fase 4
// ---------------------------------------------------------------------------

export type TaskCrmType = 'CONTACT' | 'COMPANY' | 'LEAD' | 'DEAL';
export type TaskRole = 'RESPONSIBLE' | 'PARTICIPANT' | 'OBSERVER';

export interface Task {
  id: string;
  code: string;
  title: string;
  description: string | null;
  responsible: Ref;
  responsibleId: string;
  participants: Ref[];
  observers: Ref[];
  startAt: string | null;
  dueAt: string | null;
  priority: PriorityRef | null;
  priorityId: string | null;
  status: { id: string; name: string; color: string; category: StageRef['kind'] };
  statusId: string;
  project: { id: string; code: string; name: string } | null;
  projectId: string | null;
  crm: { type: TaskCrmType; id: string; code: string; name: string } | null;
  completedAt: string | null;
  overdue: boolean;
  customFields: CustomValues;
  version: number;
  createdAt: string;
  myRole: TaskRole | null;
  can: { edit: boolean; status: boolean; delete: boolean };
}

export interface Project {
  id: string;
  code: string;
  name: string;
  description: string | null;
  owner: Ref | null;
  ownerId: string | null;
  status: 'PLANNED' | 'ACTIVE' | 'ON_HOLD' | 'CLOSED';
  startDate: string | null;
  endDate: string | null;
  version: number;
  createdAt: string;
  tasks?: { open: number; done: number };
}

export interface ActivityItem {
  id: string;
  type: 'CALL' | 'MEETING' | 'EMAIL' | 'NOTE';
  subject: string;
  notes: string | null;
  occurredAt: string;
  author: Ref;
  editedAt: string | null;
  createdAt: string;
  mine: boolean;
}

// ---------------------------------------------------------------------------
// Fase 5
// ---------------------------------------------------------------------------

export interface DuplicateRule {
  id: string;
  entityType: DuplicateEntity;
  name: string;
  active: boolean;
  action: 'WARN' | 'BLOCK';
  conditions: { field: string; mode: 'EXACT' | 'NORMALIZED' | 'FUZZY'; threshold?: number }[];
}

export interface DuplicateSide {
  id: string;
  code: string | null;
  name: string;
  createdAt: string | null;
  deleted: boolean;
  ownerName?: string | null;
}

export interface DuplicateCandidate {
  id: string;
  entityType: DuplicateEntity;
  status: CandidateStatus;
  score: number;
  source: 'SCAN' | 'SAVE' | 'IMPORT';
  matched: { rule: string; fields: string[]; score: number }[];
  a: DuplicateSide;
  b: DuplicateSide;
  createdAt: string;
  reviewedAt: string | null;
}

export interface DuplicateCompare {
  candidate: DuplicateCandidate;
  entityType: DuplicateEntity;
  a: DuplicateSide;
  b: DuplicateSide;
  fields: {
    key: string;
    label: string;
    long: boolean;
    a: string | null;
    b: string | null;
    differs: boolean;
  }[];
  relations: { key: string; label: string; a: number; b: number }[];
  restrictions: string[];
  suggestedSurvivorId: string;
}

export interface DuplicateHit {
  id: string | null;
  code: string | null;
  name: string | null;
  visible: boolean;
  rules: { name: string; action: 'WARN' | 'BLOCK' }[];
  blocking: boolean;
}
