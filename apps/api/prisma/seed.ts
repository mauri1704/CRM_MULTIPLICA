/**
 * Datos de demostración para desarrollo. Idempotente: si la organización demo existe, no hace nada.
 *   admin@multiplica.test      / Admin12345   (Administrador)
 *   supervisor@multiplica.test / Super12345   (Supervisor, equipo Ventas Lima)
 *   comercial@multiplica.test  / Venta12345   (Comercial, equipo Ventas Lima)
 */
import { PrismaClient } from '@prisma/client';
import { normalizeIdentifier, normalizeText } from '@crm/shared';
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

      // --- Fase 2: tipos de cambio de los últimos días, productos, compañías y contactos ---
      const today = new Date();
      for (let d = 0; d < 5; d++) {
        const date = new Date(
          Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - d),
        );
        await tx.exchangeRate.create({
          data: {
            organizationId,
            rateDate: date,
            fromCurrency: 'USD',
            toCurrency: 'PEN',
            rate: (3.75 - d * 0.004).toFixed(4),
            createdById: adminUserId,
            updatedById: adminUserId,
          },
        });
      }
      const [licencias, servicios] = await Promise.all([
        tx.productCategory.findFirstOrThrow({ where: { organizationId, name: 'Licencias' } }),
        tx.productCategory.findFirstOrThrow({ where: { organizationId, name: 'Servicios' } }),
      ]);
      const products = [
        {
          sku: 'LIC-CRM-01',
          name: 'Licencia CRM anual',
          categoryId: licencias.id,
          price: '1200',
          currencyCode: 'USD',
          maxDiscountPct: '10',
        },
        {
          sku: 'SRV-IMPL-01',
          name: 'Implementación estándar',
          categoryId: servicios.id,
          price: '8500',
          currencyCode: 'PEN',
          maxDiscountPct: '15',
        },
        {
          sku: 'SRV-CAP-01',
          name: 'Capacitación por hora',
          categoryId: servicios.id,
          price: '180',
          currencyCode: 'PEN',
          maxDiscountPct: '0',
        },
      ];
      for (const p of products) {
        await tx.product.create({
          data: {
            ...p,
            organizationId,
            skuNorm: normalizeIdentifier(p.sku) ?? '',
            nameNorm: normalizeText(p.name),
            createdById: adminUserId,
          },
        });
      }
      const ruc = await tx.documentType.findFirstOrThrow({
        where: { organizationId, code: 'RUC' },
      });
      const dni = await tx.documentType.findFirstOrThrow({
        where: { organizationId, code: 'DNI' },
      });
      const companies = [
        {
          code: 'CIA-000001',
          legalName: 'Andes Logística S.A.C.',
          taxId: '20100047218',
          city: 'Lima',
          ownerId: sales.id,
        },
        {
          code: 'CIA-000002',
          legalName: 'Pacífico Retail E.I.R.L.',
          taxId: '20131312955',
          city: 'Arequipa',
          ownerId: supervisor.id,
        },
      ];
      const createdCompanies = [];
      for (const c of companies) {
        createdCompanies.push(
          await tx.company.create({
            data: {
              ...c,
              organizationId,
              taxIdTypeId: ruc.id,
              taxIdNorm: c.taxId,
              searchNorm: normalizeText(`${c.code} ${c.legalName} ${c.taxId}`),
              createdById: adminUserId,
            },
          }),
        );
      }
      const contacts = [
        {
          code: 'CON-000001',
          firstName: 'Lucía',
          lastName: 'Paredes',
          email: 'lucia.paredes@andes.pe',
          documentNumber: '45879632',
          companyId: createdCompanies[0]!.id,
          ownerId: sales.id,
          jobTitle: 'Jefa de Compras',
        },
        {
          code: 'CON-000002',
          firstName: 'Jorge',
          lastName: 'Salas',
          email: 'jsalas@pacifico.pe',
          documentNumber: '41236985',
          companyId: createdCompanies[1]!.id,
          ownerId: supervisor.id,
          jobTitle: 'Gerente General',
        },
      ];
      for (const c of contacts) {
        await tx.contact.create({
          data: {
            ...c,
            organizationId,
            documentTypeId: dni.id,
            documentNorm: c.documentNumber,
            emailNorm: c.email,
            searchNorm: normalizeText(
              `${c.code} ${c.firstName} ${c.lastName} ${c.email} ${c.documentNumber}`,
            ),
            createdById: adminUserId,
          },
        });
      }
      await tx.sequence.createMany({
        data: [
          { organizationId, entityType: 'COMPANY', nextValue: 3 },
          { organizationId, entityType: 'CONTACT', nextValue: 3 },
        ],
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
