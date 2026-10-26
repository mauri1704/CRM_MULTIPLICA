import type { PermissionAction, PermissionModule } from '@crm/shared';
import {
  Building2,
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
}

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
    title: 'Calidad de datos',
    items: [{ to: '/papelera', label: 'Papelera', icon: Trash2, permission: ['trash', 'view'] }],
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
      {
        to: '/admin/auditoria',
        label: 'Auditoría',
        icon: ScrollText,
        permission: ['audit', 'view'],
      },
    ],
  },
];
