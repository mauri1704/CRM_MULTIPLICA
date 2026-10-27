import type { PermissionAction, PermissionModule } from '@crm/shared';
import {
  ArrowRightLeft,
  Building,
  Building2,
  Coins,
  Contact,
  FileSpreadsheet,
  Package,
  GitBranch,
  Home,
  KeyRound,
  ListChecks,
  ScrollText,
  SlidersHorizontal,
  Trash2,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Permiso necesario para ver el elemento; sin permiso, no se muestra. */
  permission?: [PermissionModule, PermissionAction];
  /** Alternativa: basta con uno de estos permisos. */
  anyPermission?: [PermissionModule, PermissionAction][];
}

export const IMPORT_PERMISSIONS: [PermissionModule, PermissionAction][] = [
  ['contacts', 'import'],
  ['companies', 'import'],
  ['products', 'import'],
  ['currencies', 'import'],
  ['exchange_rates', 'import'],
];

export interface NavSection {
  title?: string;
  items: NavItem[];
}

/**
 * Menú lateral. Solo aparecen los módulos ya construidos (Fase 1); los comerciales se suman en
 * las fases siguientes.
 */
export const NAV: NavSection[] = [
  { items: [{ to: '/', label: 'Inicio', icon: Home }] },
  {
    title: 'Comercial',
    items: [
      { to: '/contactos', label: 'Contactos', icon: Contact, permission: ['contacts', 'view'] },
      { to: '/companias', label: 'Compañías', icon: Building, permission: ['companies', 'view'] },
    ],
  },
  {
    title: 'Catálogo',
    items: [
      { to: '/productos', label: 'Productos', icon: Package, permission: ['products', 'view'] },
    ],
  },
  {
    title: 'Calidad de datos',
    items: [
      {
        to: '/importaciones',
        label: 'Importaciones',
        icon: FileSpreadsheet,
        anyPermission: IMPORT_PERMISSIONS,
      },
      { to: '/papelera', label: 'Papelera', icon: Trash2, permission: ['trash', 'view'] },
    ],
  },
  {
    title: 'Administración',
    items: [
      {
        to: '/admin/organizacion',
        label: 'Organización',
        icon: Building2,
        permission: ['settings', 'view'],
      },
      { to: '/admin/usuarios', label: 'Usuarios', icon: Users, permission: ['users', 'view'] },
      { to: '/admin/equipos', label: 'Equipos', icon: UsersRound, permission: ['teams', 'view'] },
      {
        to: '/admin/roles',
        label: 'Roles y permisos',
        icon: KeyRound,
        permission: ['roles', 'view'],
      },
      {
        to: '/admin/pipelines',
        label: 'Pipelines y etapas',
        icon: GitBranch,
        permission: ['settings', 'view'],
      },
      {
        to: '/admin/catalogos',
        label: 'Catálogos',
        icon: ListChecks,
        permission: ['settings', 'view'],
      },
      {
        to: '/admin/campos',
        label: 'Campos personalizados',
        icon: SlidersHorizontal,
        permission: ['settings', 'view'],
      },
      { to: '/admin/monedas', label: 'Monedas', icon: Coins, permission: ['currencies', 'view'] },
      {
        to: '/admin/tipos-de-cambio',
        label: 'Tipos de cambio',
        icon: ArrowRightLeft,
        permission: ['exchange_rates', 'view'],
      },
      {
        to: '/admin/auditoria',
        label: 'Auditoría',
        icon: ScrollText,
        permission: ['audit', 'view'],
      },
    ],
  },
];
