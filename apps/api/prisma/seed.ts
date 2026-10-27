/**
 * Datos de demostración para desarrollo. Idempotente: si la organización demo existe, no hace nada.
 *   admin@multiplica.test      / Admin12345   (Administrador)
 *   supervisor@multiplica.test / Super12345   (Supervisor, equipo Ventas Lima)
 *   comercial@multiplica.test  / Venta12345   (Comercial, equipo Ventas Lima)
 */
import { PrismaClient } from '@prisma/client';
import { normalizeIdentifier, normalizeText } from '@crm/shared';
import { hashPassword } from '../src/modules/auth/password';
import { computeLine } from '../src/modules/sales/line-math';
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

      // --- Fase 3: prospectos y negociaciones de ejemplo ---
      const priorities = await tx.priority.findMany({ where: { organizationId } });
      const prio = (name: string) => priorities.find((p) => p.name === name)!.id;
      const leadPipe = await tx.pipeline.findFirstOrThrow({
        where: { organizationId, entityType: 'LEAD' },
        include: { stages: { orderBy: { position: 'asc' } } },
      });
      const dealPipe = await tx.pipeline.findFirstOrThrow({
        where: { organizationId, entityType: 'DEAL' },
        include: { stages: { orderBy: { position: 'asc' } } },
      });
      const allProducts = await tx.product.findMany({ where: { organizationId } });
      const prod = (sku: string) => allProducts.find((p) => p.sku === sku)!;
      const usdRate = await tx.exchangeRate.findFirstOrThrow({
        where: { organizationId, fromCurrency: 'USD', toCurrency: 'PEN' },
        orderBy: { rateDate: 'desc' },
      });
      const [andes, pacifico] = createdCompanies;
      const leads = [
        {
          title: 'Renovación de licencias 2027',
          companyId: andes!.id,
          stage: 0,
          priority: 'Urgente',
          ownerId: sales.id,
          value: '15000',
        },
        {
          title: 'Capacitación equipo comercial',
          companyId: pacifico!.id,
          stage: 1,
          priority: 'Alta',
          ownerId: supervisor.id,
          value: '3600',
        },
        {
          title: 'Consulta web: CRM para 20 usuarios',
          companyId: null,
          stage: 0,
          priority: 'Media',
          ownerId: sales.id,
          value: null,
        },
        {
          title: 'Ampliación a sede norte',
          companyId: andes!.id,
          stage: 2,
          priority: 'Baja',
          ownerId: sales.id,
          value: '9000',
        },
      ];
      for (const [i, l] of leads.entries()) {
        const code = `PRO-${String(i + 1).padStart(6, '0')}`;
        const lead = await tx.lead.create({
          data: {
            organizationId,
            code,
            title: l.title,
            companyId: l.companyId,
            pipelineId: leadPipe.id,
            stageId: leadPipe.stages[l.stage]!.id,
            stagePosition: i * 1000,
            ownerId: l.ownerId,
            priorityId: prio(l.priority),
            currencyCode: 'PEN',
            estimatedValue: l.value,
            searchNorm: normalizeText(`${code} ${l.title}`),
            createdById: adminUserId,
          },
        });
        if (i === 0) {
          // Producto en USD convertido a PEN con la tasa del día, como lo hace la API.
          const p = prod('LIC-CRM-01');
          const a = computeLine({
            quantity: '10',
            unitPrice: p.price,
            discountType: 'PERCENT',
            discountValue: '5',
            rate: usdRate.rate,
            decimals: 2,
          });
          await tx.leadProduct.create({
            data: {
              organizationId,
              leadId: lead.id,
              productId: p.id,
              sku: p.sku,
              description: p.name,
              quantity: '10',
              unitPrice: p.price,
              currencyCode: 'USD',
              discountType: 'PERCENT',
              discountValue: '5',
              exchangeRate: usdRate.rate,
              exchangeRateDate: usdRate.rateDate,
              exchangeRateId: usdRate.id,
              rateSource: 'MASTER',
              lineSubtotal: a.subtotal,
              lineDiscount: a.discount,
              lineTotal: a.total,
            },
          });
          await tx.lead.update({
            where: { id: lead.id },
            data: { subtotal: a.subtotal, discount: a.discount, total: a.total },
          });
        }
      }
      const deals = [
        {
          title: 'Implementación CRM Pacífico',
          companyId: pacifico!.id,
          stage: 1,
          priority: 'Alta',
          ownerId: supervisor.id,
          sku: 'SRV-IMPL-01',
          qty: '1',
        },
        {
          title: 'Licencias Andes 2026',
          companyId: andes!.id,
          stage: 2,
          priority: 'Urgente',
          ownerId: sales.id,
          sku: 'SRV-CAP-01',
          qty: '20',
        },
        {
          title: 'Soporte anual Andes',
          companyId: andes!.id,
          stage: 0,
          priority: 'Media',
          ownerId: sales.id,
          sku: 'SRV-CAP-01',
          qty: '8',
        },
      ];
      for (const [i, d] of deals.entries()) {
        const code = `NEG-${String(i + 1).padStart(6, '0')}`;
        const stage = dealPipe.stages[d.stage]!;
        const p = prod(d.sku);
        const a = computeLine({
          quantity: d.qty,
          unitPrice: p.price,
          discountType: 'PERCENT',
          discountValue: '0',
          rate: '1',
          decimals: 2,
        });
        const deal = await tx.deal.create({
          data: {
            organizationId,
            code,
            title: d.title,
            companyId: d.companyId,
            pipelineId: dealPipe.id,
            stageId: stage.id,
            stagePosition: i * 1000,
            ownerId: d.ownerId,
            priorityId: prio(d.priority),
            currencyCode: 'PEN',
            probability: stage.probability,
            subtotal: a.subtotal,
            discount: a.discount,
            total: a.total,
            searchNorm: normalizeText(`${code} ${d.title}`),
            createdById: adminUserId,
          },
        });
        await tx.dealProduct.create({
          data: {
            organizationId,
            dealId: deal.id,
            productId: p.id,
            sku: p.sku,
            description: p.name,
            quantity: d.qty,
            unitPrice: p.price,
            currencyCode: 'PEN',
            lineSubtotal: a.subtotal,
            lineDiscount: a.discount,
            lineTotal: a.total,
          },
        });
      }
      await tx.sequence.createMany({
        data: [
          { organizationId, entityType: 'LEAD', nextValue: leads.length + 1 },
          { organizationId, entityType: 'DEAL', nextValue: deals.length + 1 },
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
