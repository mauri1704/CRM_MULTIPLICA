/**
 * Datos de demostración para desarrollo. Idempotente: si la organización demo existe, solo agrega
 * lo que falte de fases posteriores (proyectos, tareas, actividades).
 *   admin@multiplica.test      / Admin12345   (Administrador)
 *   supervisor@multiplica.test / Super12345   (Supervisor, equipo Ventas Lima)
 *   comercial@multiplica.test  / Venta12345   (Comercial, equipo Ventas Lima)
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import { normalizeIdentifier, normalizeName, normalizeText } from '@crm/shared';
import { hashPassword } from '../src/modules/auth/password';
import { computeLine } from '../src/modules/sales/line-math';
import { bootstrapOrganization } from '../src/modules/bootstrap/bootstrap-organization';

const DEMO = 'Multiplica Demo';

async function main() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('El seed de demostración no se ejecuta en producción.');
  const db = new PrismaClient();
  try {
    const existing = await db.organization.findFirst({ where: { name: DEMO } });
    if (existing) {
      // Complemento por fase: agrega lo que falte sin tocar lo existente.
      const added = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.organization_id', ${existing.id}, true)`;
        const ops = await seedOperations(tx, existing.id);
        const dups = await seedDuplicates(tx, existing.id);
        return ops || dups;
      });
      console.log(
        added
          ? 'La organización demo ya existía: se agregaron los datos de las fases nuevas.'
          : 'La organización demo ya existe; no se modifica.',
      );
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
              nameNorm: normalizeName(c.legalName),
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
            nameNorm: normalizeName(`${c.firstName} ${c.lastName}`),
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
            nameNorm: normalizeName(l.title),
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
            nameNorm: normalizeName(d.title),
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
      await seedOperations(tx, organizationId);
      await seedDuplicates(tx, organizationId);
    });
    console.log('Organización demo creada.');
  } finally {
    await db.$disconnect();
  }
}

type Tx = Prisma.TransactionClient;

const nextCode = async (tx: Tx, organizationId: string, entity: 'CONTACT' | 'COMPANY') => {
  const prefix = entity === 'CONTACT' ? 'CON' : 'CIA';
  const row = await tx.sequence.findFirst({ where: { organizationId, entityType: entity } });
  const n = row?.nextValue ?? 1;
  await tx.sequence.upsert({
    where: { organizationId_entityType: { organizationId, entityType: entity } },
    update: { nextValue: n + 1 },
    create: { organizationId, entityType: entity, nextValue: n + 1 },
  });
  return `${prefix}-${String(n).padStart(6, '0')}`;
};

/** Fase 5: una compañía y un contacto repetidos a propósito, para probar «Buscar duplicados». */
async function seedDuplicates(tx: Tx, organizationId: string): Promise<boolean> {
  const original = await tx.contact.findFirst({
    where: { organizationId, email: 'lucia.paredes@andes.pe', deletedAt: null },
  });
  const company = await tx.company.findFirst({
    where: { organizationId, legalName: 'Andes Logística S.A.C.', deletedAt: null },
  });
  if (!original || !company) return false;
  const already = await tx.company.findFirst({
    where: { organizationId, legalName: 'Andes Logistica SAC' },
  });
  if (already) return false;
  const code = await nextCode(tx, organizationId, 'COMPANY');
  await tx.company.create({
    data: {
      organizationId,
      code,
      legalName: 'Andes Logistica SAC',
      nameNorm: normalizeName('Andes Logistica SAC'),
      searchNorm: normalizeText(`${code} Andes Logistica SAC`),
      city: 'Lima',
      createdById: original.createdById,
    },
  });
  const contactCode = await nextCode(tx, organizationId, 'CONTACT');
  await tx.contact.create({
    data: {
      organizationId,
      code: contactCode,
      firstName: 'Lucia',
      lastName: 'Paredes',
      email: 'LUCIA.PAREDES@ANDES.PE',
      emailNorm: 'lucia.paredes@andes.pe',
      jobTitle: 'Compras',
      ownerId: original.ownerId,
      nameNorm: normalizeName('Lucia Paredes'),
      searchNorm: normalizeText(`${contactCode} Lucia Paredes LUCIA.PAREDES@ANDES.PE`),
      createdById: original.createdById,
    },
  });
  return true;
}

/** Fase 4: un proyecto, tareas en varios estados y actividades. Devuelve false si ya existían. */
async function seedOperations(tx: Tx, organizationId: string): Promise<boolean> {
  if ((await tx.project.count({ where: { organizationId } })) > 0) return false;
  const user = async (email: string) =>
    (await tx.user.findFirstOrThrow({ where: { organizationId, email } })).id;
  const [admin, supervisor, sales] = await Promise.all([
    user('admin@multiplica.test'),
    user('supervisor@multiplica.test'),
    user('comercial@multiplica.test'),
  ]);
  const statuses = await tx.taskStatus.findMany({
    where: { organizationId },
    orderBy: { position: 'asc' },
  });
  const status = (category: string) => statuses.find((s) => s.category === category)!;
  const prio = async (name: string) =>
    (await tx.priority.findFirst({ where: { organizationId, name } }))?.id ?? null;
  const deal = (title: string) =>
    tx.deal.findFirst({
      where: { organizationId, title, deletedAt: null },
      select: { id: true, code: true },
    });
  const contact = await tx.contact.findFirst({
    where: { organizationId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, code: true },
  });
  const pacifico = await deal('Implementación CRM Pacífico');
  const andes = await deal('Licencias Andes 2026');

  const project = await tx.project.create({
    data: {
      organizationId,
      code: 'PRY-000001',
      name: 'Implementación CRM Pacífico',
      nameNorm: normalizeText('Implementación CRM Pacífico'),
      description:
        'Puesta en marcha del CRM para Pacífico Retail: configuración, migración y capacitación.',
      ownerId: supervisor,
      status: 'ACTIVE',
      startDate: new Date('2026-10-15T00:00:00Z'),
      endDate: new Date('2026-12-15T00:00:00Z'),
      createdById: admin,
    },
  });
  const day = (offset: number, hour: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offset);
    d.setUTCHours(hour + 5, 0, 0, 0); // hora de Lima
    return d;
  };
  const tasks = [
    {
      title: 'Enviar propuesta técnica',
      who: supervisor,
      st: 'IN_PROGRESS',
      due: day(1, 17),
      p: 'Alta',
      dealId: pacifico?.id,
      crm: pacifico?.code,
      project: true,
      members: [[sales, 'PARTICIPANT']],
    },
    {
      title: 'Llamar para confirmar presupuesto',
      who: sales,
      st: 'OPEN',
      due: day(-1, 11),
      p: 'Urgente',
      dealId: andes?.id,
      crm: andes?.code,
      members: [[supervisor, 'OBSERVER']],
    },
    {
      title: 'Preparar migración de contactos',
      who: sales,
      st: 'OPEN',
      start: day(2, 9),
      due: day(4, 18),
      p: 'Media',
      project: true,
      members: [],
    },
    {
      title: 'Capacitación de usuarios clave',
      who: supervisor,
      st: 'REVIEW',
      due: day(7, 10),
      p: 'Media',
      project: true,
      members: [
        [sales, 'PARTICIPANT'],
        [admin, 'OBSERVER'],
      ],
    },
    {
      title: 'Reunión de arranque',
      who: admin,
      st: 'DONE',
      due: day(-5, 10),
      p: 'Baja',
      project: true,
      members: [[supervisor, 'PARTICIPANT']],
    },
    {
      title: 'Actualizar datos del contacto',
      who: sales,
      st: 'OPEN',
      due: day(3, 12),
      p: 'Baja',
      contactId: contact?.id,
      crm: contact?.code,
      members: [],
    },
  ] as const;
  for (const [i, t] of tasks.entries()) {
    const code = `TAR-${String(i + 1).padStart(6, '0')}`;
    const st = status(t.st);
    await tx.task.create({
      data: {
        organizationId,
        code,
        title: t.title,
        responsibleId: t.who,
        startAt: 'start' in t ? t.start : null,
        dueAt: t.due,
        priorityId: await prio(t.p),
        statusId: st.id,
        statusPosition: i * 1000,
        projectId: 'project' in t ? project.id : null,
        dealId: 'dealId' in t ? (t.dealId ?? null) : null,
        contactId: 'contactId' in t ? (t.contactId ?? null) : null,
        completedAt: st.category === 'DONE' ? t.due : null,
        searchNorm: normalizeText(
          [code, t.title, 'crm' in t ? t.crm : null].filter(Boolean).join(' '),
        ),
        createdById: admin,
        members: {
          create: t.members.map(([userId, role]) => ({ organizationId, userId, role })),
        },
      },
    });
  }
  await tx.sequence.createMany({
    data: [
      { organizationId, entityType: 'TASK', nextValue: tasks.length + 1 },
      { organizationId, entityType: 'PROJECT', nextValue: 2 },
    ],
    skipDuplicates: true,
  });
  if (pacifico) {
    await tx.activity.createMany({
      data: [
        {
          type: 'MEETING',
          subject: 'Reunión de descubrimiento',
          notes: 'Necesitan 20 usuarios y reportes por sede.',
          occurredAt: day(-6, 10),
          authorId: supervisor,
        },
        {
          type: 'CALL',
          subject: 'Seguimiento de la propuesta',
          notes: null,
          occurredAt: day(-2, 16),
          authorId: supervisor,
        },
      ].map((a) => ({ ...a, organizationId, dealId: pacifico.id })),
    });
  }
  return true;
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
