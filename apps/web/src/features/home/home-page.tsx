import type { PermissionAction, PermissionModule } from '@crm/shared';
import {
  ArrowRightLeft,
  Building,
  Building2,
  Contact,
  GitBranch,
  KeyRound,
  ListChecks,
  Package,
  Trash2,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router';
import { Card, PageHeader } from '@/components/ui/misc';
import { useAuth, useUser } from '@/lib/auth';

interface Shortcut {
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
  permission: [PermissionModule, PermissionAction];
}

const SHORTCUTS: Shortcut[] = [
  {
    to: '/contactos',
    label: 'Contactos',
    description: 'Personas y su relación con compañías',
    icon: Contact,
    permission: ['contacts', 'view'],
  },
  {
    to: '/companias',
    label: 'Compañías',
    description: 'Clientes y prospectos con su RUC',
    icon: Building,
    permission: ['companies', 'view'],
  },
  {
    to: '/productos',
    label: 'Productos',
    description: 'Catálogo con precios y monedas',
    icon: Package,
    permission: ['products', 'view'],
  },
  {
    to: '/admin/tipos-de-cambio',
    label: 'Tipos de cambio',
    description: 'Maestro diario y tasa aplicable',
    icon: ArrowRightLeft,
    permission: ['exchange_rates', 'view'],
  },
  {
    to: '/admin/usuarios',
    label: 'Usuarios',
    description: 'Altas, roles, equipos y acceso',
    icon: Users,
    permission: ['users', 'view'],
  },
  {
    to: '/admin/equipos',
    label: 'Equipos',
    description: 'Equipos comerciales y supervisores',
    icon: UsersRound,
    permission: ['teams', 'view'],
  },
  {
    to: '/admin/roles',
    label: 'Roles y permisos',
    description: 'Qué puede hacer cada rol',
    icon: KeyRound,
    permission: ['roles', 'view'],
  },
  {
    to: '/admin/pipelines',
    label: 'Pipelines',
    description: 'Etapas de prospectos y negociaciones',
    icon: GitBranch,
    permission: ['settings', 'view'],
  },
  {
    to: '/admin/catalogos',
    label: 'Catálogos',
    description: 'Prioridades, orígenes, categorías…',
    icon: ListChecks,
    permission: ['settings', 'view'],
  },
  {
    to: '/admin/organizacion',
    label: 'Organización',
    description: 'Datos y parámetros generales',
    icon: Building2,
    permission: ['settings', 'view'],
  },
  {
    to: '/papelera',
    label: 'Papelera',
    description: 'Recuperar registros eliminados',
    icon: Trash2,
    permission: ['trash', 'view'],
  },
];

export function HomePage() {
  const user = useUser();
  const { can } = useAuth();
  const shortcuts = SHORTCUTS.filter((s) => can(...s.permission));
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={`Hola, ${user.name.split(' ')[0]}`}
        description={`${user.organization.name} · ${user.roleName}`}
      />
      <Card className="mb-6 p-5">
        <h2 className="font-semibold">Contactos, compañías y catálogo disponibles</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Ya puede registrar contactos, compañías y productos, administrar monedas y tipos de
          cambio, e importar o exportar en Excel y CSV. Prospectos, negociaciones, tareas y el
          dashboard con indicadores llegan en las siguientes fases. Use la búsqueda de arriba
          (Ctrl+K) para encontrar cualquier registro.
        </p>
      </Card>
      {shortcuts.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shortcuts.map((s) => (
            <li key={s.to}>
              <Link
                to={s.to}
                className="flex h-full items-start gap-3 rounded-lg border border-border bg-surface p-4 hover:border-primary/50 hover:bg-muted/40"
              >
                <s.icon className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
                <span>
                  <span className="block font-medium">{s.label}</span>
                  <span className="block text-sm text-fg-muted">{s.description}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
