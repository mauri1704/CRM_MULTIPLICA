/**
 * Catálogo de permisos: módulo × acción × alcance.
 *
 * El backend es la única fuente de verdad: cada endpoint declara el permiso que necesita y el
 * guard lo comprueba. La interfaz usa este mismo catálogo solo para ocultar lo que no se puede
 * hacer.
 */

export const PERMISSION_SCOPES = ['NONE', 'OWN', 'TEAM', 'ALL'] as const;
export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

export const SCOPE_LABELS: Record<PermissionScope, string> = {
  NONE: 'Sin acceso',
  OWN: 'Propios',
  TEAM: 'Su equipo',
  ALL: 'Todos',
};

/** Orden de amplitud: un alcance mayor incluye a los menores. */
export const SCOPE_RANK: Record<PermissionScope, number> = { NONE: 0, OWN: 1, TEAM: 2, ALL: 3 };

export const PERMISSION_ACTIONS = [
  'view',
  'create',
  'edit',
  'delete',
  'import',
  'export',
  'restore',
  'purge',
  'merge',
  'manage',
] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export const ACTION_LABELS: Record<PermissionAction, string> = {
  view: 'Ver',
  create: 'Crear',
  edit: 'Editar',
  delete: 'Enviar a papelera',
  import: 'Importar',
  export: 'Exportar',
  restore: 'Restaurar',
  purge: 'Eliminar definitivamente',
  merge: 'Fusionar',
  manage: 'Administrar',
};

const DATA = ['view', 'create', 'edit', 'delete', 'import', 'export'] as const;
const ADMIN = ['view', 'manage'] as const;

/**
 * Módulos y las acciones que tienen sentido en cada uno. `recordScoped` indica que el alcance
 * (propios / equipo / todos) se aplica a registros; en los módulos administrativos solo importa
 * si hay acceso (NONE) o no (ALL).
 */
export const PERMISSION_MODULES = {
  dashboard: { label: 'Dashboard', actions: ['view'], recordScoped: true },
  leads: { label: 'Prospectos', actions: DATA, recordScoped: true },
  deals: { label: 'Negociaciones', actions: DATA, recordScoped: true },
  contacts: { label: 'Contactos', actions: DATA, recordScoped: true },
  companies: { label: 'Compañías', actions: DATA, recordScoped: true },
  products: { label: 'Productos', actions: DATA, recordScoped: false },
  currencies: {
    label: 'Monedas',
    actions: ['view', 'manage', 'import', 'export'],
    recordScoped: false,
  },
  exchange_rates: {
    label: 'Tipos de cambio',
    actions: ['view', 'manage', 'import', 'export'],
    recordScoped: false,
  },
  tasks: { label: 'Tareas', actions: DATA, recordScoped: true },
  projects: { label: 'Proyectos', actions: DATA, recordScoped: true },
  reports: { label: 'Reportes', actions: ['view', 'export'], recordScoped: true },
  duplicates: { label: 'Duplicados', actions: ['view', 'merge', 'manage'], recordScoped: true },
  trash: { label: 'Papelera', actions: ['view', 'restore', 'purge', 'manage'], recordScoped: true },
  users: { label: 'Usuarios', actions: ADMIN, recordScoped: false },
  teams: { label: 'Equipos', actions: [...ADMIN, 'delete'], recordScoped: false },
  roles: { label: 'Roles y permisos', actions: ADMIN, recordScoped: false },
  settings: { label: 'Configuración', actions: ADMIN, recordScoped: false },
  audit: { label: 'Auditoría', actions: ['view'], recordScoped: false },
} as const satisfies Record<
  string,
  { label: string; actions: readonly PermissionAction[]; recordScoped: boolean }
>;

export type PermissionModule = keyof typeof PERMISSION_MODULES;
export const PERMISSION_MODULE_KEYS = Object.keys(PERMISSION_MODULES) as PermissionModule[];

export function isValidPermission(module: string, action: string): boolean {
  const def = (PERMISSION_MODULES as Record<string, { actions: readonly string[] }>)[module];
  return def !== undefined && def.actions.includes(action);
}

/** `permissions[module][action] = scope`. Lo que no aparece vale NONE. */
export type PermissionMap = Partial<
  Record<PermissionModule, Partial<Record<PermissionAction, PermissionScope>>>
>;

export function scopeOf(
  map: PermissionMap,
  module: PermissionModule,
  action: PermissionAction,
): PermissionScope {
  return map[module]?.[action] ?? 'NONE';
}

export function can(
  map: PermissionMap,
  module: PermissionModule,
  action: PermissionAction,
  atLeast: PermissionScope = 'OWN',
): boolean {
  return SCOPE_RANK[scopeOf(map, module, action)] >= SCOPE_RANK[atLeast];
}

// ---------------------------------------------------------------------------
// Roles del sistema (D-08)
// ---------------------------------------------------------------------------

export const SYSTEM_ROLE_KEYS = ['ADMIN', 'SUPERVISOR', 'SALES'] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

export const SYSTEM_ROLE_NAMES: Record<SystemRoleKey, string> = {
  ADMIN: 'Administrador',
  SUPERVISOR: 'Supervisor',
  SALES: 'Comercial',
};

function fill(
  modules: readonly PermissionModule[],
  scope: PermissionScope,
  only?: readonly PermissionAction[],
): PermissionMap {
  const map: PermissionMap = {};
  for (const m of modules) {
    const entry: Partial<Record<PermissionAction, PermissionScope>> = {};
    for (const a of PERMISSION_MODULES[m].actions) {
      if (!only || only.includes(a)) entry[a] = scope;
    }
    map[m] = entry;
  }
  return map;
}

function merge(...maps: PermissionMap[]): PermissionMap {
  const out: PermissionMap = {};
  for (const map of maps) {
    for (const [m, actions] of Object.entries(map) as [
      PermissionModule,
      PermissionMap[PermissionModule],
    ][]) {
      out[m] = { ...out[m], ...actions };
    }
  }
  return out;
}

/** Administrador: todo, sobre todos los registros. No se puede editar. */
export const ADMIN_PERMISSIONS: PermissionMap = fill(PERMISSION_MODULE_KEYS, 'ALL');

/** Matriz inicial aprobada (docs/plan/04-reglas-negocio.md §7). */
export const DEFAULT_ROLE_PERMISSIONS: Record<SystemRoleKey, PermissionMap> = {
  ADMIN: ADMIN_PERMISSIONS,
  SUPERVISOR: merge(
    fill(['dashboard', 'leads', 'deals', 'tasks', 'projects', 'reports'], 'TEAM'),
    fill(['contacts', 'companies'], 'ALL'),
    fill(['products', 'currencies', 'exchange_rates'], 'ALL', ['view', 'export']),
    { duplicates: { view: 'TEAM', merge: 'TEAM' } },
    { trash: { view: 'TEAM', restore: 'TEAM' } },
  ),
  SALES: merge(
    fill(['dashboard', 'leads', 'deals', 'tasks', 'projects', 'reports'], 'OWN', [
      'view',
      'create',
      'edit',
      'delete',
      'export',
    ]),
    { contacts: { view: 'ALL', create: 'OWN', edit: 'OWN', delete: 'OWN', export: 'OWN' } },
    { companies: { view: 'ALL', create: 'OWN', edit: 'OWN', delete: 'OWN', export: 'OWN' } },
    fill(['products', 'currencies', 'exchange_rates'], 'ALL', ['view']),
    { trash: { view: 'OWN', restore: 'OWN' } },
  ),
};
