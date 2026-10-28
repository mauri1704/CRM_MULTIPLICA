import type { PrismaClient } from '@prisma/client';
import {
  DEFAULT_DUPLICATE_RULES,
  DEFAULT_ORGANIZATION_SETTINGS,
  DEFAULT_ROLE_PERMISSIONS,
  SYSTEM_ROLE_KEYS,
  SYSTEM_ROLE_NAMES,
  type PermissionAction,
  type PermissionScope,
} from '@crm/shared';
import { hashPassword } from '../auth/password';

export interface BootstrapInput {
  name: string;
  admin: { name: string; email: string; password: string };
}

export interface BootstrapResult {
  organizationId: string;
  adminUserId: string;
  roleIds: Record<(typeof SYSTEM_ROLE_KEYS)[number], string>;
}

/**
 * Crea una organización con su configuración inicial: roles del sistema y sus permisos (D-08),
 * catálogos, pipelines, estados de tarea y el primer administrador. Todo en una transacción.
 * No depende de Nest: lo usan el seed, las pruebas y (más adelante) el alta de organizaciones.
 */
export async function bootstrapOrganization(
  db: PrismaClient,
  input: BootstrapInput,
): Promise<BootstrapResult> {
  const passwordHash = await hashPassword(input.admin.password);
  return db.$transaction(
    async (tx) => {
      const org = await tx.organization.create({
        data: { name: input.name, settings: DEFAULT_ORGANIZATION_SETTINGS },
      });
      const organizationId = org.id;
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;

      const roleIds = {} as BootstrapResult['roleIds'];
      for (const key of SYSTEM_ROLE_KEYS) {
        const role = await tx.role.create({
          data: { organizationId, systemKey: key, name: SYSTEM_ROLE_NAMES[key] },
        });
        roleIds[key] = role.id;
        if (key === 'ADMIN') continue; // El administrador tiene todo por definición.
        const rows = Object.entries(DEFAULT_ROLE_PERMISSIONS[key]).flatMap(([module, actions]) =>
          Object.entries(actions ?? {}).map(([action, scope]) => ({
            organizationId,
            roleId: role.id,
            module,
            action: action as PermissionAction,
            scope: scope as PermissionScope,
          })),
        );
        await tx.rolePermission.createMany({ data: rows });
      }

      const admin = await tx.user.create({
        data: {
          organizationId,
          name: input.admin.name,
          email: input.admin.email.toLowerCase(),
          passwordHash,
          roleId: roleIds.ADMIN,
        },
      });

      await tx.priority.createMany({
        data: [
          { name: 'Urgente', color: '#DC2626', icon: 'chevrons-up', rank: 40 },
          { name: 'Alta', color: '#EA580C', icon: 'chevron-up', rank: 30 },
          { name: 'Media', color: '#CA8A04', icon: 'equal', rank: 20, isDefault: true },
          { name: 'Baja', color: '#16A34A', icon: 'chevron-down', rank: 10 },
        ].map((p) => ({ ...p, organizationId })),
      });
      await tx.leadSource.createMany({
        data: ['Sitio web', 'Referido', 'Evento', 'Llamada', 'Redes sociales', 'Otro'].map(
          (name) => ({
            organizationId,
            name,
          }),
        ),
      });
      await tx.lossReason.createMany({
        data: [
          ...['Sin presupuesto', 'No responde', 'No califica', 'Eligió a la competencia'].map(
            (name) => ({
              name,
              entityType: 'LEAD',
            }),
          ),
          ...[
            'Precio',
            'Eligió a la competencia',
            'Sin presupuesto',
            'Proyecto cancelado',
            'Plazo de entrega',
          ].map((name) => ({ name, entityType: 'DEAL' })),
        ].map((r) => ({ ...r, organizationId })),
      });
      await tx.documentType.createMany({
        data: [
          { code: 'DNI', name: 'DNI', pattern: '^\\d{8}$' },
          { code: 'RUC', name: 'RUC', pattern: '^(10|15|16|17|20)\\d{9}$' },
          { code: 'CE', name: 'Carné de extranjería', pattern: '^[A-Za-z0-9]{8,12}$' },
          { code: 'PAS', name: 'Pasaporte', pattern: '^[A-Za-z0-9]{6,12}$' },
        ].map((d) => ({ ...d, organizationId })),
      });
      await tx.economicSector.createMany({
        data: [
          'Agroindustria',
          'Comercio',
          'Construcción',
          'Educación',
          'Energía y minería',
          'Finanzas y seguros',
          'Industria manufacturera',
          'Logística y transporte',
          'Salud',
          'Servicios profesionales',
          'Tecnología',
          'Turismo',
        ].map((name) => ({ organizationId, name })),
      });
      await tx.duplicateRule.createMany({
        data: DEFAULT_DUPLICATE_RULES.map((r) => ({
          organizationId,
          entityType: r.entityType,
          name: r.name,
          active: r.active,
          action: r.action,
          conditions: r.conditions,
        })),
      });
      await tx.taskStatus.createMany({
        data: [
          { name: 'Pendiente', color: '#64748B', category: 'OPEN', position: 0 },
          { name: 'En progreso', color: '#2563EB', category: 'IN_PROGRESS', position: 1 },
          { name: 'En revisión', color: '#9333EA', category: 'REVIEW', position: 2 },
          { name: 'Completada', color: '#16A34A', category: 'DONE', position: 3 },
          { name: 'Cancelada', color: '#DC2626', category: 'CANCELED', position: 4 },
        ].map((s) => ({ ...s, organizationId })),
      });

      await tx.currency.createMany({
        data: [
          { code: 'PEN', name: 'Sol peruano', symbol: 'S/', decimals: 2, isBase: true },
          { code: 'USD', name: 'Dólar estadounidense', symbol: 'US$', decimals: 2 },
        ].map((c) => ({ ...c, organizationId })),
      });
      await tx.productCategory.createMany({
        data: ['Productos', 'Servicios', 'Licencias'].map((name) => ({ organizationId, name })),
      });

      const pipelines = [
        {
          entityType: 'LEAD',
          name: 'Prospección',
          stages: [
            { name: 'Nuevo', color: '#64748B', kind: 'OPEN' },
            { name: 'Contactado', color: '#2563EB', kind: 'OPEN' },
            { name: 'Calificado', color: '#0891B2', kind: 'OPEN' },
            { name: 'Convertido', color: '#16A34A', kind: 'CONVERTED' },
            { name: 'Descartado', color: '#DC2626', kind: 'LOST' },
          ],
        },
        {
          entityType: 'DEAL',
          name: 'Ventas',
          stages: [
            { name: 'Calificación', color: '#64748B', kind: 'OPEN', probability: 10 },
            { name: 'Propuesta', color: '#2563EB', kind: 'OPEN', probability: 40 },
            { name: 'Negociación', color: '#9333EA', kind: 'OPEN', probability: 70 },
            { name: 'Ganada', color: '#16A34A', kind: 'WON', probability: 100 },
            { name: 'Perdida', color: '#DC2626', kind: 'LOST', probability: 0 },
          ],
        },
      ] as const;
      for (const p of pipelines) {
        await tx.pipeline.create({
          data: {
            organizationId,
            entityType: p.entityType,
            name: p.name,
            isDefault: true,
            stages: {
              create: p.stages.map((s, i) => ({
                organizationId,
                name: s.name,
                color: s.color,
                kind: s.kind,
                probability: 'probability' in s ? s.probability : null,
                position: i,
              })),
            },
          },
        });
      }

      return { organizationId, adminUserId: admin.id, roleIds };
    },
    { timeout: 30_000 },
  );
}
