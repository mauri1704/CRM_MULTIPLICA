/**
 * Datos de demostración para desarrollo. Idempotente: si la organización demo existe, no hace nada.
 *   admin@multiplica.test      / Admin12345   (Administrador)
 *   supervisor@multiplica.test / Super12345   (Supervisor, equipo Ventas Lima)
 *   comercial@multiplica.test  / Venta12345   (Comercial, equipo Ventas Lima)
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/modules/auth/password';
import { bootstrapOrganization } from '../src/modules/bootstrap/bootstrap-organization';

const DEMO = 'Multiplica Demo';

async function main() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('El seed de demostración no se ejecuta en producción.');
  const db = new PrismaClient();
  try {
    if (await db.organization.findFirst({ where: { name: DEMO } })) {
      console.log('La organización demo ya existe; no se modifica.');
      return;
    }
    const { organizationId, adminUserId, roleIds } = await bootstrapOrganization(db, {
      name: DEMO,
      admin: { name: 'Admin Multiplica', email: 'admin@multiplica.test', password: 'Admin12345' },
    });
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
      await tx.organization.update({
        where: { id: organizationId },
        data: { legalName: 'Multiplica Demo S.A.C.', taxId: '20123456789' },
      });
      const supervisor = await tx.user.create({
        data: {
          organizationId,
          name: 'Sofía Supervisora',
          email: 'supervisor@multiplica.test',
          passwordHash: await hashPassword('Super12345'),
          roleId: roleIds.SUPERVISOR,
          createdById: adminUserId,
        },
      });
      const sales = await tx.user.create({
        data: {
          organizationId,
          name: 'Carlos Comercial',
          email: 'comercial@multiplica.test',
          passwordHash: await hashPassword('Venta12345'),
          roleId: roleIds.SALES,
          createdById: adminUserId,
        },
      });
      await tx.team.create({
        data: {
          organizationId,
          name: 'Ventas Lima',
          description: 'Equipo comercial de Lima',
          supervisorId: supervisor.id,
          createdById: adminUserId,
          members: {
            create: [supervisor.id, sales.id].map((userId) => ({ organizationId, userId })),
          },
        },
      });
    });
    console.log('Organización demo creada.');
  } finally {
    await db.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
