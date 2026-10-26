/** Tipos de registro del CRM. Se usan en historial, papelera, campos personalizados y duplicados. */
export const ENTITY_TYPES = [
  'LEAD',
  'DEAL',
  'CONTACT',
  'COMPANY',
  'PRODUCT',
  'TASK',
  'PROJECT',
  'TEAM',
  'USER',
  'ROLE',
  'PIPELINE',
  'STAGE',
  'CATALOG',
  'CUSTOM_FIELD',
  'ORGANIZATION',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const ENTITY_LABELS: Record<EntityType, string> = {
  LEAD: 'Prospecto',
  DEAL: 'Negociación',
  CONTACT: 'Contacto',
  COMPANY: 'Compañía',
  PRODUCT: 'Producto',
  TASK: 'Tarea',
  PROJECT: 'Proyecto',
  TEAM: 'Equipo',
  USER: 'Usuario',
  ROLE: 'Rol',
  PIPELINE: 'Pipeline',
  STAGE: 'Etapa',
  CATALOG: 'Catálogo',
  CUSTOM_FIELD: 'Campo personalizado',
  ORGANIZATION: 'Organización',
};

/** Entidades que admiten campos personalizados. */
export const CUSTOM_FIELD_ENTITIES = [
  'LEAD',
  'DEAL',
  'CONTACT',
  'COMPANY',
  'PRODUCT',
  'TASK',
] as const satisfies readonly EntityType[];
export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number];

/** Entidades que pueden ir a la papelera (crece con cada fase). */
export const TRASHABLE_ENTITIES = [
  'TEAM',
  'LEAD',
  'DEAL',
  'CONTACT',
  'COMPANY',
  'PRODUCT',
  'TASK',
  'PROJECT',
] as const satisfies readonly EntityType[];
export type TrashableEntity = (typeof TRASHABLE_ENTITIES)[number];

/** Códigos correlativos por entidad (D-11). */
export const SEQUENCE_PREFIXES = {
  LEAD: 'PRO',
  DEAL: 'NEG',
  CONTACT: 'CON',
  COMPANY: 'CIA',
  TASK: 'TAR',
  PROJECT: 'PRY',
} as const;
export type SequenceEntity = keyof typeof SEQUENCE_PREFIXES;

export function formatCode(entity: SequenceEntity, value: number): string {
  return `${SEQUENCE_PREFIXES[entity]}-${String(value).padStart(6, '0')}`;
}

export const HISTORY_ACTIONS = [
  'CREATE',
  'UPDATE',
  'STAGE_CHANGE',
  'DELETE',
  'RESTORE',
  'MERGE',
  'CONVERT',
  'IMPORT',
  'ACTIVATE',
  'DEACTIVATE',
] as const;
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

export const HISTORY_ACTION_LABELS: Record<HistoryAction, string> = {
  CREATE: 'Creación',
  UPDATE: 'Edición',
  STAGE_CHANGE: 'Cambio de etapa',
  DELETE: 'Enviado a papelera',
  RESTORE: 'Restaurado',
  MERGE: 'Fusión',
  CONVERT: 'Conversión',
  IMPORT: 'Importación',
  ACTIVATE: 'Activado',
  DEACTIVATE: 'Desactivado',
};

export const AUDIT_EVENTS = [
  'LOGIN',
  'LOGIN_FAILED',
  'LOGIN_LOCKED',
  'LOGOUT',
  'PASSWORD_CHANGED',
  'PASSWORD_RESET_REQUESTED',
  'PASSWORD_RESET',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_ACTIVATED',
  'USER_DEACTIVATED',
  'ROLE_CREATED',
  'ROLE_UPDATED',
  'ROLE_DELETED',
  'PERMISSIONS_CHANGED',
  'SETTINGS_CHANGED',
  'RECORD_RESTORED',
  'RECORD_PURGED',
  'TRASH_AUTO_PURGED',
  'EXPORT',
  'IMPORT',
  'MERGE',
  'EXCHANGE_RATE_CHANGED',
] as const;
export type AuditEvent = (typeof AUDIT_EVENTS)[number];

export const AUDIT_EVENT_LABELS: Record<AuditEvent, string> = {
  LOGIN: 'Inicio de sesión',
  LOGIN_FAILED: 'Inicio de sesión fallido',
  LOGIN_LOCKED: 'Cuenta bloqueada temporalmente',
  LOGOUT: 'Cierre de sesión',
  PASSWORD_CHANGED: 'Cambio de contraseña',
  PASSWORD_RESET_REQUESTED: 'Solicitud de recuperación de contraseña',
  PASSWORD_RESET: 'Contraseña restablecida',
  USER_CREATED: 'Usuario creado',
  USER_UPDATED: 'Usuario editado',
  USER_ACTIVATED: 'Usuario activado',
  USER_DEACTIVATED: 'Usuario desactivado',
  ROLE_CREATED: 'Rol creado',
  ROLE_UPDATED: 'Rol editado',
  ROLE_DELETED: 'Rol eliminado',
  PERMISSIONS_CHANGED: 'Permisos modificados',
  SETTINGS_CHANGED: 'Configuración modificada',
  RECORD_RESTORED: 'Registro restaurado',
  RECORD_PURGED: 'Registro eliminado definitivamente',
  TRASH_AUTO_PURGED: 'Purga automática de papelera',
  EXPORT: 'Exportación',
  IMPORT: 'Importación',
  MERGE: 'Fusión de registros',
  EXCHANGE_RATE_CHANGED: 'Tipo de cambio modificado',
};
