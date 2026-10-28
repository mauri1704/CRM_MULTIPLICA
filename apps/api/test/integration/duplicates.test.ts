import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, createOrg, login, ownerDb, type Agent, type TestOrg } from './helpers';

let app: INestApplication;
let db: PrismaClient;
let org: TestOrg;
let admin: Agent;
let sup: Agent;
let sales: Agent;
const ids: Record<string, string> = {};

beforeAll(async () => {
  db = ownerDb();
  app = await createApp();
  org = await createOrg(db, 'Duplicados');
  admin = await login(app, org.adminEmail);
  const supUser = await org.addUser('SUPERVISOR');
  const salesUser = await org.addUser('SALES');
  sup = await login(app, supUser.email);
  sales = await login(app, salesUser.email);
  ids.sales = salesUser.id;
  ids.sup = supUser.id;
  await admin.post('/exchange-rates', {
    date: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date()),
    fromCurrency: 'USD',
    toCurrency: 'PEN',
    rate: '3.75',
  });
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

const openCandidates = async (entityType: string, agent: Agent = admin) =>
  (await agent.get(`/duplicates/candidates?entityType=${entityType}&status=OPEN&pageSize=100`))
    .body;
const rule = async (entityType: string, name: string) =>
  (
    (await admin.get(`/duplicates/rules?entityType=${entityType}`)).body as {
      id: string;
      name: string;
    }[]
  ).find((r) => r.name === name)!;

describe('reglas de duplicados', () => {
  it('vienen reglas iniciales por módulo y solo el administrador las gestiona', async () => {
    const all = (await admin.get('/duplicates/rules')).body as {
      entityType: string;
      name: string;
      active: boolean;
      action: string;
    }[];
    expect(
      all
        .filter((r) => r.entityType === 'CONTACT')
        .map((r) => r.name)
        .sort(),
    ).toEqual(['Mismo correo', 'Mismo documento', 'Mismo teléfono', 'Nombre muy parecido']);
    expect(all.every((r) => r.action === 'WARN')).toBe(true);
    expect((await sup.get('/duplicates/rules')).status).toBe(200);
    expect((await sales.get('/duplicates/rules')).status).toBe(403);
    expect(
      (
        await sup.post('/duplicates/rules', {
          entityType: 'CONTACT',
          name: 'X regla',
          conditions: [{ field: 'email', mode: 'EXACT' }],
        })
      ).status,
    ).toBe(403);
  });

  it('valida campos, modos y campos personalizados', async () => {
    const bad = await admin.post('/duplicates/rules', {
      entityType: 'CONTACT',
      name: 'Correo aproximado',
      conditions: [{ field: 'email', mode: 'FUZZY' }],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.details.conditions).toMatch(/no admite coincidencia aproximada/);
    const nofield = await admin.post('/duplicates/rules', {
      entityType: 'CONTACT',
      name: 'Campo inventado',
      conditions: [{ field: 'inventado', mode: 'EXACT' }],
    });
    expect(nofield.status).toBe(400);
    const nocustom = await admin.post('/duplicates/rules', {
      entityType: 'CONTACT',
      name: 'Personalizado inexistente',
      conditions: [{ field: 'cf.no_existe', mode: 'EXACT' }],
    });
    expect(nocustom.status).toBe(400);
    await admin.post('/custom-fields', {
      entityType: 'CONTACT',
      key: 'carnet',
      label: 'Carnet',
      type: 'TEXT',
    });
    const ok = await admin.post('/duplicates/rules', {
      entityType: 'CONTACT',
      name: 'Mismo carnet',
      conditions: [{ field: 'cf.carnet', mode: 'NORMALIZED' }],
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const dup = await admin.post('/duplicates/rules', {
      entityType: 'CONTACT',
      name: 'Mismo carnet',
      conditions: [{ field: 'cf.carnet', mode: 'EXACT' }],
    });
    expect(dup.status).toBe(400);
    const audit = await db.auditLog.count({
      where: { organizationId: org.organizationId, event: 'DUPLICATE_RULE_CHANGED' },
    });
    expect(audit).toBeGreaterThanOrEqual(1);
  });
});

describe('detección', () => {
  it('al guardar registra candidatos (correo normalizado) y la búsqueda no duplica pares', async () => {
    const a = (
      await admin.post('/contacts', {
        firstName: 'Ana',
        lastName: 'Torres',
        email: 'ana.torres@x.pe',
      })
    ).body;
    const b = (
      await admin.post('/contacts', {
        firstName: 'Ana M.',
        lastName: 'Torres',
        email: 'ANA.TORRES@X.PE',
      })
    ).body;
    const found = (await openCandidates('CONTACT')).items as {
      a: { id: string };
      b: { id: string };
      matched: { rule: string }[];
      source: string;
      score: number;
    }[];
    expect(found).toHaveLength(1);
    expect([found[0]!.a.id, found[0]!.b.id].sort()).toEqual([a.id, b.id].sort());
    expect(found[0]).toMatchObject({ source: 'SAVE', score: 1 });
    expect(found[0]!.matched[0]!.rule).toBe('Mismo correo');
    ids.contactA = a.id;
    ids.contactB = b.id;

    const scan = await admin.post('/duplicates/scan', { entityType: 'CONTACT' });
    expect(scan.status).toBe(200);
    expect(scan.body[0]).toMatchObject({ entityType: 'CONTACT', found: 1, created: 0 });
    expect((await openCandidates('CONTACT')).total).toBe(1);
  });

  it('coincidencia aproximada por razón social (pg_trgm)', async () => {
    await admin.post('/companies', { legalName: 'Distribuidora Andina del Sur SAC' });
    await admin.post('/companies', { legalName: 'Distribuidora Andina del Sud SAC' });
    await admin.post('/companies', { legalName: 'Constructora Norte EIRL' });
    const r = await openCandidates('COMPANY');
    expect(r.total).toBe(1);
    expect(r.items[0].score).toBeGreaterThan(0.8);
    expect(r.items[0].score).toBeLessThan(1);
    expect(r.items[0].matched[0].rule).toBe('Razón social parecida');
  });

  it('editar un registro retira la coincidencia que ya no existe', async () => {
    await admin.patch(`/contacts/${ids.contactB}`, { email: 'otra.persona@x.pe' });
    expect((await openCandidates('CONTACT')).total).toBe(0);
    await admin.patch(`/contacts/${ids.contactB}`, { email: 'ana.torres@x.pe' });
    expect((await openCandidates('CONTACT')).total).toBe(1);
  });

  it('el aviso al guardar muestra el registro solo a quien puede verlo', async () => {
    const lead = (
      await admin.post('/leads', { title: 'Prospecto del admin', email: 'compras@cliente.pe' })
    ).body;
    const asAdmin = await admin.post('/duplicates/check', {
      entityType: 'LEAD',
      values: { email: 'COMPRAS@cliente.pe', title: 'Otro' },
    });
    // La regla de prospectos pide correo + compañía: sin compañía en el formulario no se evalúa.
    expect(asAdmin.body).toEqual([]);
    const company = (await admin.post('/companies', { legalName: 'Cliente Aviso SAC' })).body;
    await admin.patch(`/leads/${lead.id}`, { companyId: company.id });
    const values = { email: 'compras@cliente.pe', companyId: company.id };
    const seen = (await admin.post('/duplicates/check', { entityType: 'LEAD', values })).body;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      id: lead.id,
      visible: true,
      name: 'Prospecto del admin',
      blocking: false,
    });
    // Un comercial no ve prospectos ajenos: solo se le avisa que existe.
    const hidden = (await sales.post('/duplicates/check', { entityType: 'LEAD', values })).body;
    expect(hidden).toHaveLength(1);
    expect(hidden[0]).toMatchObject({ id: null, name: null, code: null, visible: false });
    // Editar el propio registro no cuenta como duplicado de sí mismo.
    expect(
      (await admin.post('/duplicates/check', { entityType: 'LEAD', values, excludeId: lead.id }))
        .body,
    ).toEqual([]);
  });

  it('una regla «Impedir guardar» rechaza el duplicado sin revelar el registro existente', async () => {
    const r = await rule('PRODUCT', 'Mismo SKU');
    await admin.post('/products', {
      sku: 'LIC-001',
      name: 'Licencia',
      price: '10',
      currencyCode: 'PEN',
    });
    // El SKU repetido ya lo impide la base de datos; probamos con una regla propia sobre el nombre.
    const custom = (
      await admin.post('/duplicates/rules', {
        entityType: 'PRODUCT',
        name: 'Mismo nombre exacto',
        action: 'BLOCK',
        conditions: [{ field: 'name', mode: 'NORMALIZED' }],
      })
    ).body;
    const res = await admin.post('/products', {
      sku: 'LIC-002',
      name: 'LICENCIA',
      price: '10',
      currencyCode: 'PEN',
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_BLOCKED');
    expect(res.body.message).not.toMatch(/LIC-001/);
    expect(
      (
        await admin.post('/products', {
          sku: 'LIC-003',
          name: 'Otro nombre distinto',
          price: '10',
          currencyCode: 'PEN',
        })
      ).status,
    ).toBe(201);
    await admin.patch(`/duplicates/rules/${custom.id}`, { active: false });
    expect(
      (
        await admin.post('/products', {
          sku: 'LIC-002',
          name: 'LICENCIA',
          price: '10',
          currencyCode: 'PEN',
        })
      ).status,
    ).toBe(201);
    expect(r.id).toBeTruthy();
  });

  it('«conservar ambos» y «revisado» cierran el par: no vuelve a aparecer', async () => {
    const c = (await openCandidates('CONTACT')).items[0];
    expect((await sales.post(`/duplicates/candidates/${c.id}/reviewed`)).status).toBe(403);
    const kept = await admin.post(`/duplicates/candidates/${c.id}/keep-both`);
    expect(kept.body.status).toBe('KEPT_BOTH');
    expect((await admin.post(`/duplicates/candidates/${c.id}/reviewed`)).status).toBe(400);
    await admin.post('/duplicates/scan', { entityType: 'CONTACT' });
    await admin.patch(`/contacts/${ids.contactA}`, { jobTitle: 'Gerente' });
    expect((await openCandidates('CONTACT')).total).toBe(0);
    expect(
      (await admin.get('/duplicates/candidates?status=KEPT_BOTH&entityType=CONTACT')).body.total,
    ).toBe(1);
  });
});

describe('fusión de contactos', () => {
  let candidate: string;
  const setup = async () => {
    const survivor = (
      await admin.post('/contacts', {
        firstName: 'Luis',
        lastName: 'Ramos',
        email: 'luis.r@m.pe',
        phone: '999111222',
      })
    ).body;
    const absorbed = (
      await admin.post('/contacts', {
        firstName: 'Luis A.',
        lastName: 'Ramos',
        email: 'LUIS.R@m.pe',
        jobTitle: 'Jefe de compras',
        notes: 'Prefiere llamadas por la tarde.',
      })
    ).body;
    const company = (
      await admin.post('/companies', { legalName: `Empresa de ${absorbed.code} SAC` })
    ).body;
    await admin.patch(`/contacts/${absorbed.id}`, { companyId: company.id });
    const lead = (
      await admin.post('/leads', { title: 'Prospecto de Luis', contactId: absorbed.id })
    ).body;
    const deal = (
      await admin.post('/deals', {
        title: `Negociación ${absorbed.code}`,
        contactIds: [absorbed.id],
        primaryContactId: absorbed.id,
      })
    ).body;
    const task = (
      await admin.post('/tasks', {
        title: 'Llamar a Luis',
        crm: { type: 'CONTACT', id: absorbed.id },
      })
    ).body;
    await admin.post(`/comments/contact/${absorbed.id}`, { body: 'Comentario del absorbido' });
    await admin.post(`/activities/contact/${absorbed.id}`, {
      type: 'CALL',
      subject: 'Llamada previa',
      occurredAt: new Date().toISOString(),
    });
    const cands = (await openCandidates('CONTACT')).items as {
      id: string;
      a: { id: string };
      b: { id: string };
    }[];
    candidate = cands.find((c) => [c.a.id, c.b.id].includes(absorbed.id))!.id;
    return { survivor, absorbed, company, lead, deal, task };
  };

  it('la comparación muestra diferencias y las relaciones que se moverán', async () => {
    const s = await setup();
    const cmp = (await admin.get(`/duplicates/candidates/${candidate}`)).body;
    expect(cmp.restrictions).toEqual([]);
    const byKey = Object.fromEntries(cmp.fields.map((f: { key: string }) => [f.key, f]));
    expect(byKey.firstName.differs).toBe(true);
    expect(byKey.email.differs).toBe(false);
    expect(byKey.jobTitle).toMatchObject({ differs: true });
    const rel = Object.fromEntries(cmp.relations.map((r: { key: string }) => [r.key, r]));
    const absorbedIsB = cmp.b.id === s.absorbed.id;
    const side = absorbedIsB ? 'b' : 'a';
    expect(rel.leads[side]).toBe(1);
    expect(rel.deals[side]).toBe(1);
    expect(rel.tasks[side]).toBe(1);
    expect(rel.comments[side]).toBe(1);
    expect(rel.activities[side]).toBe(1);
    // Una persona sin permiso no ve la comparación.
    expect((await sales.get(`/duplicates/candidates/${candidate}`)).status).toBe(403);
    Object.assign(ids, {
      mSurvivor: s.survivor.id,
      mAbsorbed: s.absorbed.id,
      mCompany: s.company.id,
      mLead: s.lead.id,
      mDeal: s.deal.id,
      mTask: s.task.id,
    });
  });

  it('fusiona en una transacción: campos elegidos, relaciones, papelera, historial y auditoría', async () => {
    const res = await admin.post('/duplicates/merge', {
      candidateId: candidate,
      survivorId: ids.mSurvivor,
      choices: { jobTitle: 'ABSORBED', notes: 'BOTH', firstName: 'ABSORBED' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.moved).toMatchObject({
      leads: 1,
      deals: 1,
      tasks: 1,
      comments: 1,
      activities: 1,
    });

    const survivor = (await admin.get(`/contacts/${ids.mSurvivor}`)).body;
    expect(survivor).toMatchObject({
      firstName: 'Luis A.',
      jobTitle: 'Jefe de compras',
      phone: '999111222',
    });
    expect(survivor.notes).toBe('Prefiere llamadas por la tarde.');
    // La compañía del absorbido pasa a ser una compañía relacionada del conservado.
    expect(survivor.relatedCompanies.map((c: { id: string }) => c.id)).toContain(ids.mCompany);

    expect((await admin.get(`/contacts/${ids.mAbsorbed}`)).status).toBe(404);
    expect((await admin.get(`/leads/${ids.mLead}`)).body.contact.id).toBe(ids.mSurvivor);
    expect(
      (await admin.get(`/deals/${ids.mDeal}`)).body.contacts.map(
        (c: { id: string; isPrimary: boolean }) => [c.id, c.isPrimary],
      ),
    ).toEqual([[ids.mSurvivor, true]]);
    expect((await admin.get(`/tasks/${ids.mTask}`)).body.crm).toMatchObject({
      type: 'CONTACT',
      id: ids.mSurvivor,
    });
    expect(
      (await admin.get(`/comments/contact/${ids.mSurvivor}`)).body.map(
        (c: { body: string }) => c.body,
      ),
    ).toContain('Comentario del absorbido');
    expect((await admin.get(`/activities/contact/${ids.mSurvivor}`)).body).toHaveLength(1);
    // La búsqueda de la tarea usa el código del conservado.
    expect(
      (await admin.get(`/search?q=${survivor.code}`)).body.tasks.map((t: { id: string }) => t.id),
    ).toContain(ids.mTask);

    const trash = (await admin.get('/trash?pageSize=200')).body.items.find(
      (e: { entityId: string }) => e.entityId === ids.mAbsorbed,
    );
    expect(trash.relations).toMatchObject({ fusionado: true });
    const mh = await db.mergeHistory.findFirstOrThrow({ where: { mergedId: ids.mAbsorbed } });
    expect(mh.survivorId).toBe(ids.mSurvivor);
    expect(mh.choices).toMatchObject({ jobTitle: 'ABSORBED', firstName: 'ABSORBED' });
    expect((mh.snapshot as { first_name: string }).first_name).toBe('Luis A.');
    expect((mh.moved as { leads: string[] }).leads).toEqual([ids.mLead]);
    const hist = (await admin.get(`/history/CONTACT/${ids.mSurvivor}`)).body as {
      action: string;
    }[];
    expect(hist.map((h) => h.action)).toContain('MERGE');
    expect(
      await db.auditLog.count({ where: { organizationId: org.organizationId, event: 'MERGE' } }),
    ).toBe(1);
    expect(
      (await admin.get('/duplicates/candidates?status=MERGED&entityType=CONTACT')).body.total,
    ).toBe(1);
    // No se puede fusionar dos veces la misma coincidencia.
    expect(
      (await admin.post('/duplicates/merge', { candidateId: candidate, survivorId: ids.mSurvivor }))
        .status,
    ).toBe(409);
  });
});

describe('fusión: reglas y restricciones', () => {
  it('compañías: el absorbido libera su RUC y el conservado puede quedarse con él', async () => {
    const keep = (await admin.post('/companies', { legalName: 'Comercial Sur Peru SAC' })).body;
    const gone = (
      await admin.post('/companies', {
        legalName: 'Comercial Sur Perú S.A.C.',
        taxId: '20131312955',
      })
    ).body;
    const contact = (await admin.post('/contacts', { firstName: 'Pedro', companyId: gone.id }))
      .body;
    const cand = (await openCandidates('COMPANY')).items.find(
      (c: { a: { id: string }; b: { id: string } }) => [c.a.id, c.b.id].includes(gone.id),
    );
    const res = await admin.post('/duplicates/merge', {
      candidateId: cand.id,
      survivorId: keep.id,
      choices: { taxId: 'ABSORBED' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await admin.get(`/companies/${keep.id}`)).body.taxId).toBe('20131312955');
    expect((await admin.get(`/contacts/${contact.id}`)).body.companyId).toBe(keep.id);
    expect((await admin.get(`/companies/${gone.id}`)).status).toBe(404);
  });

  it('productos: las líneas pasan al producto conservado', async () => {
    const keep = (
      await admin.post('/products', {
        sku: 'PRD-A',
        name: 'Servidor rack 1U',
        price: '1000',
        currencyCode: 'PEN',
      })
    ).body;
    const gone = (
      await admin.post('/products', {
        sku: 'PRD-B',
        name: 'Servidor rack 1U.',
        price: '1100',
        currencyCode: 'PEN',
      })
    ).body;
    const lead = (await admin.post('/leads', { title: 'Con producto' })).body;
    await admin.post(`/leads/${lead.id}/products`, { productId: gone.id, quantity: '2' });
    const cand = (await openCandidates('PRODUCT')).items.find(
      (c: { a: { id: string }; b: { id: string } }) => [c.a.id, c.b.id].includes(gone.id),
    );
    const res = await admin.post('/duplicates/merge', {
      candidateId: cand.id,
      survivorId: keep.id,
      choices: { price: 'ABSORBED' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const line = (await admin.get(`/leads/${lead.id}`)).body.products[0];
    expect(line.productId).toBe(keep.id);
    expect(line.sku).toBe('PRD-B');
    expect(Number((await admin.get(`/products/${keep.id}`)).body.price)).toBe(1100);
  });

  it('negociaciones: solo abiertas y de la misma moneda; al fusionar se recalculan los totales', async () => {
    const company = (await admin.post('/companies', { legalName: 'Cliente Negocios SAC' })).body;
    const prod = (
      await admin.post('/products', {
        sku: 'NEG-1',
        name: 'Soporte mensual',
        price: '100',
        currencyCode: 'PEN',
      })
    ).body;
    const d1 = (
      await admin.post('/deals', {
        title: 'Renovación 2027',
        companyId: company.id,
        currencyCode: 'PEN',
      })
    ).body;
    const d2 = (
      await admin.post('/deals', {
        title: 'Renovación  2027',
        companyId: company.id,
        currencyCode: 'PEN',
      })
    ).body;
    await admin.post(`/deals/${d1.id}/products`, { productId: prod.id, quantity: '1' });
    await admin.post(`/deals/${d2.id}/products`, { productId: prod.id, quantity: '3' });
    const cands = (await openCandidates('DEAL')).items as {
      id: string;
      a: { id: string };
      b: { id: string };
    }[];
    const cand = cands.find((c) => [c.a.id, c.b.id].includes(d1.id))!;
    // Una negociación cerrada no se fusiona.
    const stages = (await admin.get('/pipelines?entityType=DEAL')).body[0].stages as {
      id: string;
      kind: string;
    }[];
    await admin.put(`/deals/${d2.id}/stage`, {
      stageId: stages.find((s) => s.kind === 'WON')!.id,
      index: 0,
    });
    const closed = await admin.post('/duplicates/merge', {
      candidateId: cand.id,
      survivorId: d1.id,
    });
    expect(closed.status).toBe(409);
    expect(closed.body.message).toMatch(/solo se fusionan negociaciones abiertas/);
    await admin.put(`/deals/${d2.id}/stage`, {
      stageId: stages.find((s) => s.kind === 'OPEN')!.id,
      index: 0,
    });
    const ok = await admin.post('/duplicates/merge', { candidateId: cand.id, survivorId: d1.id });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const merged = (await admin.get(`/deals/${d1.id}`)).body;
    expect(merged.products).toHaveLength(2);
    expect(Number(merged.total)).toBe(400);
  });

  it('prospectos convertidos o de distinta moneda no se fusionan', async () => {
    const a = (await admin.post('/leads', { title: 'Prospecto Gamma', currencyCode: 'PEN' })).body;
    const b = (await admin.post('/leads', { title: 'Prospecto Gamma', currencyCode: 'USD' })).body;
    const email = { email: 'gamma@x.pe' };
    await admin.patch(`/leads/${a.id}`, email);
    await admin.patch(`/leads/${b.id}`, email);
    // La regla de prospectos pide correo y compañía: la creamos por título.
    await admin.post('/duplicates/rules', {
      entityType: 'LEAD',
      name: 'Mismo título',
      conditions: [{ field: 'title', mode: 'NORMALIZED' }],
    });
    await admin.post('/duplicates/scan', { entityType: 'LEAD' });
    const cand = (await openCandidates('LEAD')).items.find(
      (c: { a: { id: string }; b: { id: string } }) => [c.a.id, c.b.id].includes(a.id),
    );
    const cmp = (await admin.get(`/duplicates/candidates/${cand.id}`)).body;
    expect(cmp.restrictions.join(' ')).toMatch(/monedas distintas/);
    expect(
      (await admin.post('/duplicates/merge', { candidateId: cand.id, survivorId: a.id })).status,
    ).toBe(409);
    // Convertido: queda como registro histórico.
    const c = (await admin.post('/leads', { title: 'Prospecto Gamma', currencyCode: 'PEN' })).body;
    const pipe = (await admin.get('/pipelines?entityType=DEAL')).body[0];
    await admin.post(`/leads/${c.id}/convert`, { pipelineId: pipe.id, stageId: pipe.stages[0].id });
    await admin.post('/duplicates/scan', { entityType: 'LEAD' });
    const cand2 = (await openCandidates('LEAD')).items.find(
      (x: { a: { id: string }; b: { id: string } }) =>
        [x.a.id, x.b.id].includes(c.id) && [x.a.id, x.b.id].includes(a.id),
    );
    const cmp2 = (await admin.get(`/duplicates/candidates/${cand2.id}`)).body;
    expect(cmp2.restrictions.join(' ')).toMatch(/convertido/);
  });
});

describe('fusión: permisos y concurrencia', () => {
  it('un supervisor solo fusiona registros de su alcance (equipo)', async () => {
    const team = (
      await admin.post('/teams', {
        name: 'Equipo dup',
        supervisorId: ids.sup,
        memberIds: [ids.sales, ids.sup],
      })
    ).body;
    const mine = (await sales.post('/leads', { title: 'Mío Delta', email: 'delta@x.pe' })).body;
    const mine2 = (await sales.post('/leads', { title: 'Mío Delta', email: 'delta@x.pe' })).body;
    const foreign = (await admin.post('/leads', { title: 'Ajeno Delta', email: 'delta@x.pe' }))
      .body;
    expect(team.id).toBeTruthy();
    await admin.post('/duplicates/rules', {
      entityType: 'LEAD',
      name: 'Mismo correo (prospectos)',
      conditions: [{ field: 'email', mode: 'NORMALIZED' }],
    });
    await admin.post('/duplicates/scan', { entityType: 'LEAD' });
    const supList = (await openCandidates('LEAD', sup)).items as {
      id: string;
      a: { id: string };
      b: { id: string };
    }[];
    // Ve las coincidencias donde participa alguien de su equipo, pero no las ajenas puras.
    const ownPair = supList.find(
      (c) => [c.a.id, c.b.id].includes(mine.id) && [c.a.id, c.b.id].includes(mine2.id),
    )!;
    expect(ownPair).toBeTruthy();
    const mixed = supList.find(
      (c) => [c.a.id, c.b.id].includes(foreign.id) && [c.a.id, c.b.id].includes(mine.id),
    )!;
    // El par mixto lo puede ver (una parte es suya) pero no fusionarlo: el otro registro es ajeno.
    expect(
      (await sup.post('/duplicates/merge', { candidateId: mixed.id, survivorId: mine.id })).status,
    ).toBe(403);
    const ok = await sup.post('/duplicates/merge', {
      candidateId: ownPair.id,
      survivorId: mine.id,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(
      (await sales.post('/duplicates/merge', { candidateId: mixed.id, survivorId: mine.id }))
        .status,
    ).toBe(403);
  });

  it('dos fusiones simultáneas del mismo registro: una gana y la otra recibe un conflicto', async () => {
    const x = (await admin.post('/contacts', { firstName: 'Xavier', email: 'xavier@x.pe' })).body;
    const y = (await admin.post('/contacts', { firstName: 'Xavier', email: 'xavier@x.pe' })).body;
    const z = (await admin.post('/contacts', { firstName: 'Xavier', email: 'xavier@x.pe' })).body;
    const cands = (await openCandidates('CONTACT')).items as {
      id: string;
      a: { id: string };
      b: { id: string };
    }[];
    const find = (p: string, q: string) =>
      cands.find((c) => [c.a.id, c.b.id].includes(p) && [c.a.id, c.b.id].includes(q))!;
    const xy = find(x.id, y.id);
    const zy = find(z.id, y.id);
    // Ambas absorben a «y».
    const [r1, r2] = await Promise.all([
      admin.post('/duplicates/merge', { candidateId: xy.id, survivorId: x.id }),
      admin.post('/duplicates/merge', { candidateId: zy.id, survivorId: z.id }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    const alive = await db.contact.count({
      where: { id: { in: [x.id, y.id, z.id] }, deletedAt: null },
    });
    expect(alive).toBe(2);
    expect(await db.mergeHistory.count({ where: { mergedId: y.id } })).toBe(1);
  });
});

describe('importación avanzada', () => {
  const csv = (lines: string[]) => Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8');
  const upload = async (lines: string[]) => {
    const up = await admin.upload('/import-export/contacts/upload', csv(lines), 'contactos.csv');
    return { jobId: up.body.jobId as string, mapping: up.body.mapping as Record<string, string> };
  };

  it('todo o nada: con una fila inválida no se guarda ninguna y el archivo se puede corregir', async () => {
    const before = (await admin.get('/contacts?pageSize=1')).body.total as number;
    const { jobId, mapping } = await upload([
      'Nombre;Correo',
      'Valido Uno;valido1@imp.pe',
      'Malo;correo-malo',
    ]);
    const res = await admin.post(`/import-export/jobs/${jobId}/confirm`, {
      mapping,
      duplicateMode: 'SKIP',
      atomic: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ aborted: true, created: 0, invalid: 1 });
    expect((await admin.get('/contacts?pageSize=1')).body.total).toBe(before);
    // El trabajo sigue disponible: sin «todo o nada», la fila válida sí entra.
    const again = await admin.post(`/import-export/jobs/${jobId}/confirm`, {
      mapping,
      duplicateMode: 'SKIP',
      atomic: false,
    });
    expect(again.body).toMatchObject({ created: 1, invalid: 1 });
    expect((await admin.get('/contacts?pageSize=1')).body.total).toBe(before + 1);
  });

  it('«crear de todos modos» registra la coincidencia con el existente para revisarla', async () => {
    await admin.post('/contacts', { firstName: 'Existente', email: 'mismo@imp.pe' });
    const { jobId, mapping } = await upload(['Nombre;Correo', 'Nuevo Homónimo;MISMO@imp.pe']);
    const skip = await admin.post(`/import-export/jobs/${jobId}/analyze`, {
      mapping,
      duplicateMode: 'SKIP',
    });
    expect(skip.body).toMatchObject({ duplicates: 1, toSkip: 1, toCreate: 0 });
    const create = await admin.post(`/import-export/jobs/${jobId}/analyze`, {
      mapping,
      duplicateMode: 'CREATE',
    });
    expect(create.body).toMatchObject({ duplicates: 1, toCreate: 1, toSkip: 0 });
    const done = await admin.post(`/import-export/jobs/${jobId}/confirm`, {
      mapping,
      duplicateMode: 'CREATE',
    });
    expect(done.body).toMatchObject({ created: 1, possibleDuplicates: 1 });
    const cands = (await openCandidates('CONTACT')).items as { source: string }[];
    expect(cands.some((c) => c.source === 'IMPORT')).toBe(true);
  });
});
