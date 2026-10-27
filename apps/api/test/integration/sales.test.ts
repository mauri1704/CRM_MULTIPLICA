import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, createOrg, login, ownerDb, type Agent, type TestOrg } from './helpers';

let app: INestApplication;
let db: PrismaClient;
let org: TestOrg;
let admin: Agent;
let today: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  db = ownerDb();
  app = await createApp();
  org = await createOrg(db, 'Ventas');
  admin = await login(app, org.adminEmail);
  today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
  await admin.post('/exchange-rates', {
    date: today,
    fromCurrency: 'USD',
    toCurrency: 'PEN',
    rate: '3.75',
  });
  ids.licUsd = (
    await admin.post('/products', {
      sku: 'LIC',
      name: 'Licencia',
      price: '1200',
      currencyCode: 'USD',
      maxDiscountPct: '10',
    })
  ).body.id;
  ids.srvPen = (
    await admin.post('/products', {
      sku: 'SRV',
      name: 'Servicio',
      price: '100',
      currencyCode: 'PEN',
      maxDiscountPct: '0',
    })
  ).body.id;
  ids.company = (
    await admin.post('/companies', { legalName: 'Cliente SAC', taxId: '20131312955' })
  ).body.id;
  ids.contact = (
    await admin.post('/contacts', {
      firstName: 'Carla',
      companyId: ids.company,
      email: 'carla@cliente.pe',
    })
  ).body.id;
  const pipes = (await admin.get('/pipelines?entityType=DEAL')).body;
  ids.dealPipeline = pipes[0].id;
  for (const s of pipes[0].stages) ids[`deal_${s.kind}_${s.position}`] = s.id;
  ids.dealFirst = pipes[0].stages[0].id;
  ids.dealWon = pipes[0].stages.find((s: { kind: string }) => s.kind === 'WON').id;
  ids.dealLost = pipes[0].stages.find((s: { kind: string }) => s.kind === 'LOST').id;
  const leadPipes = (await admin.get('/pipelines?entityType=LEAD')).body;
  ids.leadStage1 = leadPipes[0].stages[1].id;
  ids.leadLost = leadPipes[0].stages.find((s: { kind: string }) => s.kind === 'LOST').id;
  ids.leadConverted = leadPipes[0].stages.find((s: { kind: string }) => s.kind === 'CONVERTED').id;
  ids.leadLossReason = (await admin.get('/catalogs/loss-reasons')).body.find(
    (r: { entityType: string }) => r.entityType === 'LEAD',
  ).id;
  ids.dealLossReason = (await admin.get('/catalogs/loss-reasons')).body.find(
    (r: { entityType: string }) => r.entityType === 'DEAL',
  ).id;
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

const newLead = async (extra: object = {}) =>
  (
    await admin.post('/leads', {
      title: 'Prospecto de prueba',
      companyId: ids.company,
      contactId: ids.contact,
      ...extra,
    })
  ).body;

describe('prospectos', () => {
  it('se crea con código, pipeline y etapa por defecto, prioridad por defecto y moneda principal', async () => {
    const l = await newLead();
    expect(l).toMatchObject({
      code: 'PRO-000001',
      currencyCode: 'PEN',
      stage: { kind: 'OPEN' },
      priority: { name: 'Media' },
      total: '0.0000',
    });
  });

  it('productos de interés: conversión a la moneda del prospecto con la tasa del día, guardada en la línea', async () => {
    const l = await newLead();
    const line = await admin.post(`/leads/${l.id}/products`, {
      productId: ids.licUsd,
      quantity: '2',
      discountType: 'PERCENT',
      discountValue: '10',
    });
    expect(line.status).toBe(201);
    expect(line.body).toMatchObject({
      currencyCode: 'USD',
      unitPrice: '1200.0000',
      exchangeRate: '3.7500000000',
      exchangeRateDate: today,
      rateSource: 'MASTER',
      lineSubtotal: '9000.0000',
      lineDiscount: '900.0000',
      lineTotal: '8100.0000',
    });
    await admin.post(`/leads/${l.id}/products`, { productId: ids.srvPen, quantity: '3' });
    const after = (await admin.get(`/leads/${l.id}`)).body;
    expect([after.subtotal, after.discount, after.total]).toEqual([
      '9300.0000',
      '900.0000',
      '8400.0000',
    ]);

    // Cambiar el precio del catálogo o la tasa del maestro no altera la línea guardada.
    await admin.patch(`/products/${ids.licUsd}`, { price: '1500' });
    const rate = (await admin.get(`/exchange-rates?from=${today}&to=${today}`)).body.items[0];
    await admin.patch(`/exchange-rates/${rate.id}`, { rate: '3.80', reason: 'prueba' });
    const again = (await admin.get(`/leads/${l.id}`)).body;
    expect(again.products[0]).toMatchObject({
      unitPrice: '1200.0000',
      exchangeRate: '3.7500000000',
      lineTotal: '8100.0000',
    });
    expect(again.total).toBe('8400.0000');
    await admin.patch(`/exchange-rates/${rate.id}`, { rate: '3.75', reason: 'volver' });
    await admin.patch(`/products/${ids.licUsd}`, { price: '1200' });
  });

  it('sin tasa válida no guarda la línea; la tasa manual exige permiso y queda auditada', async () => {
    await admin.post('/currencies', { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2 });
    const eurProduct = (
      await admin.post('/products', {
        sku: 'EUR1',
        name: 'Europeo',
        price: '10',
        currencyCode: 'EUR',
      })
    ).body.id;
    const l = await newLead();
    const missing = await admin.post(`/leads/${l.id}/products`, {
      productId: eurProduct,
      quantity: '1',
    });
    expect(missing.status).toBe(422);
    expect(missing.body.code).toBe('MISSING_EXCHANGE_RATE');
    expect((await admin.get(`/leads/${l.id}`)).body.products).toHaveLength(0);

    const salesUser = await org.addUser('SALES');
    const sales = await login(app, salesUser.email);
    const own = (await sales.post('/leads', { title: 'Mío' })).body;
    const denied = await sales.post(`/leads/${own.id}/products`, {
      productId: eurProduct,
      quantity: '1',
      manualRate: '4.1',
      manualRateReason: 'Tasa del banco',
    });
    expect(denied.status).toBe(403);

    const manual = await admin.post(`/leads/${l.id}/products`, {
      productId: eurProduct,
      quantity: '1',
      manualRate: '4.1',
      manualRateReason: 'Tasa del banco',
    });
    expect(manual.body).toMatchObject({
      rateSource: 'MANUAL',
      rateReason: 'Tasa del banco',
      lineTotal: '41.0000',
    });
    expect((await admin.get('/audit?event=MANUAL_EXCHANGE_RATE')).body.total).toBe(1);
  });

  it('descuentos: no superan el importe ni el máximo del producto (salvo supervisor)', async () => {
    const salesUser = await org.addUser('SALES');
    const sales = await login(app, salesUser.email);
    const l = (await sales.post('/leads', { title: 'Descuentos' })).body;
    const over = await sales.post(`/leads/${l.id}/products`, {
      productId: ids.licUsd,
      quantity: '1',
      discountValue: '15',
    });
    expect(over.status).toBe(400);
    expect(over.body.details.discountValue).toMatch(/supera el máximo permitido.*10%/);
    expect(
      (
        await sales.post(`/leads/${l.id}/products`, {
          productId: ids.srvPen,
          quantity: '1',
          discountType: 'AMOUNT',
          discountValue: '150',
        })
      ).body.details.discountValue,
    ).toBe('El descuento no puede superar el importe de la línea.');
    const sup = await login(app, (await org.addUser('SUPERVISOR')).email);
    const supLead = (await sup.post('/leads', { title: 'Del supervisor' })).body;
    expect(
      (
        await sup.post(`/leads/${supLead.id}/products`, {
          productId: ids.licUsd,
          quantity: '1',
          discountValue: '15',
        })
      ).status,
    ).toBe(201);
  });

  it('no permite agregar productos inactivos', async () => {
    const p = (
      await admin.post('/products', {
        sku: 'OFF',
        name: 'Apagado',
        price: '1',
        currencyCode: 'PEN',
      })
    ).body;
    await admin.patch(`/products/${p.id}`, { active: false });
    const l = await newLead();
    expect(
      (await admin.post(`/leads/${l.id}/products`, { productId: p.id, quantity: '1' })).body.details
        .productId,
    ).toMatch(/inactivo/);
  });

  it('Kanban: mueve y ordena; perder exige motivo; «Convertido» solo por conversión', async () => {
    const a = await newLead({ title: 'Alfa' });
    const b = await newLead({ title: 'Beta' });
    const c = await newLead({ title: 'Gama' });
    const m1 = await admin.put(`/leads/${a.id}/stage`, { stageId: ids.leadStage1, index: 0 });
    expect(m1.body).toMatchObject({ stage: { id: ids.leadStage1 } });
    await admin.put(`/leads/${b.id}/stage`, { stageId: ids.leadStage1, index: 1 });
    await admin.put(`/leads/${c.id}/stage`, { stageId: ids.leadStage1, index: 1 });
    const board = (await admin.get('/leads/board')).body;
    const col = board.columns.find((x: { stage: { id: string } }) => x.stage.id === ids.leadStage1);
    expect(col.items.map((i: { title: string }) => i.title)).toEqual(['Alfa', 'Gama', 'Beta']);

    const noReason = await admin.put(`/leads/${a.id}/stage`, { stageId: ids.leadLost });
    expect(noReason.body.details.lossReasonId).toBe('Indique el motivo de pérdida.');
    const lost = await admin.put(`/leads/${a.id}/stage`, {
      stageId: ids.leadLost,
      lossReasonId: ids.leadLossReason,
      lossNote: 'Sin presupuesto este año',
    });
    expect(lost.body).toMatchObject({
      stage: { kind: 'LOST' },
      lossNote: 'Sin presupuesto este año',
    });
    expect(
      (await admin.put(`/leads/${b.id}/stage`, { stageId: ids.leadConverted })).body.details
        .stageId,
    ).toMatch(/Convertir/);
    const hist = (await admin.get(`/history/LEAD/${a.id}`)).body;
    expect(hist[0]).toMatchObject({ action: 'STAGE_CHANGE' });
  });
});

describe('conversión de prospecto a negociación', () => {
  it('transfiere datos y productos en una transacción y deja el prospecto como histórico', async () => {
    const l = await newLead({ title: 'Para convertir', estimatedValue: '20000' });
    await admin.post(`/leads/${l.id}/products`, {
      productId: ids.licUsd,
      quantity: '2',
      discountValue: '10',
    });
    await admin.post(`/leads/${l.id}/products`, { productId: ids.srvPen, quantity: '1' });
    const preview = (await admin.get(`/leads/${l.id}/conversion-preview`)).body;
    expect(preview).toMatchObject({ currencyCode: 'PEN', total: '8200.0000', missingRates: false });

    const res = await admin.post(`/leads/${l.id}/convert`, {
      pipelineId: ids.dealPipeline,
      stageId: ids.dealFirst,
      expectedCloseDate: '2026-12-31',
    });
    expect(res.status).toBe(201);
    const deal = (await admin.get(`/deals/${res.body.dealId}`)).body;
    expect(deal).toMatchObject({
      title: 'Para convertir',
      sourceLead: { id: l.id },
      company: { id: ids.company },
      contacts: [{ id: ids.contact, isPrimary: true }],
      currencyCode: 'PEN',
      estimatedValue: '20000.0000',
      total: '8200.0000',
      expectedCloseDate: '2026-12-31',
      status: 'OPEN',
    });
    expect(
      deal.products.map(
        (p: {
          sku: string;
          quantity: string;
          unitPrice: string;
          currencyCode: string;
          discountValue: string;
          lineTotal: string;
        }) => [p.sku, p.quantity, p.unitPrice, p.currencyCode, p.discountValue, p.lineTotal],
      ),
    ).toEqual([
      ['LIC', '2.0000', '1200.0000', 'USD', '10.0000', '8100.0000'],
      ['SRV', '1.0000', '100.0000', 'PEN', '0.0000', '100.0000'],
    ]);

    const lead = (await admin.get(`/leads/${l.id}`)).body;
    expect(lead).toMatchObject({ stage: { kind: 'CONVERTED' }, deal: { id: deal.id } });
    expect((await admin.patch(`/leads/${l.id}`, { title: 'Cambio' })).status).toBe(409);
    expect(
      (await admin.post(`/leads/${l.id}/products`, { productId: ids.srvPen, quantity: '1' }))
        .status,
    ).toBe(409);
    expect(
      (
        await admin.post(`/leads/${l.id}/convert`, {
          pipelineId: ids.dealPipeline,
          stageId: ids.dealFirst,
        })
      ).status,
    ).toBe(409);

    const [lh, dh] = [
      (await admin.get(`/history/LEAD/${l.id}`)).body[0],
      (await admin.get(`/history/DEAL/${deal.id}`)).body[0],
    ];
    expect(lh.action).toBe('CONVERT');
    expect(dh.action).toBe('CONVERT');
    const rows = await db.recordHistory.findMany({
      where: { action: 'CONVERT', entityId: { in: [l.id, deal.id] } },
    });
    expect(new Set(rows.map((r) => r.correlationId)).size).toBe(1);
  });

  it('dos conversiones simultáneas crean una sola negociación', async () => {
    const l = await newLead({ title: 'Concurrente' });
    const body = { pipelineId: ids.dealPipeline, stageId: ids.dealFirst };
    const results = await Promise.all([
      admin.post(`/leads/${l.id}/convert`, body),
      admin.post(`/leads/${l.id}/convert`, body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db.deal.count({ where: { sourceLeadId: l.id } })).toBe(1);
  });

  it('a otra moneda reconvierte con la tasa del día; si falta una tasa no crea nada', async () => {
    const l = await newLead({ title: 'En dólares' });
    await admin.post(`/leads/${l.id}/products`, { productId: ids.srvPen, quantity: '375' });
    const res = await admin.post(`/leads/${l.id}/convert`, {
      ...{ pipelineId: ids.dealPipeline, stageId: ids.dealFirst },
      currencyCode: 'USD',
    });
    const deal = (await admin.get(`/deals/${res.body.dealId}`)).body;
    expect(deal).toMatchObject({ currencyCode: 'USD', total: '10000.0000' });
    expect(deal.products[0]).toMatchObject({ rateSource: 'INVERSE', exchangeRateDate: today });

    const other = await newLead({ title: 'Sin tasa' });
    await admin.post(`/leads/${other.id}/products`, { productId: ids.srvPen, quantity: '1' });
    const fail = await admin.post(`/leads/${other.id}/convert`, {
      pipelineId: ids.dealPipeline,
      stageId: ids.dealFirst,
      currencyCode: 'EUR',
    });
    expect(fail.status).toBe(422);
    expect(await db.deal.count({ where: { sourceLeadId: other.id } })).toBe(0);
    expect((await admin.get(`/leads/${other.id}`)).body.convertedAt).toBeNull();
  });
});

describe('negociaciones', () => {
  it('ganar fija valor final y fecha, congela importes; reabrir exige supervisor y queda auditado', async () => {
    const salesUser = await org.addUser('SALES');
    const sales = await login(app, salesUser.email);
    const d = (await sales.post('/deals', { title: 'Venta', currencyCode: 'PEN' })).body;
    await sales.post(`/deals/${d.id}/products`, { productId: ids.srvPen, quantity: '5' });
    const won = await sales.put(`/deals/${d.id}/stage`, { stageId: ids.dealWon });
    expect(won.body).toMatchObject({
      status: 'WON',
      finalValue: '500.0000',
      closedAt: today,
      probability: 100,
    });
    expect(
      (await sales.post(`/deals/${d.id}/products`, { productId: ids.srvPen, quantity: '1' }))
        .status,
    ).toBe(409);
    expect((await sales.patch(`/deals/${d.id}`, { currencyCode: 'USD' })).status).toBe(409);

    expect((await sales.put(`/deals/${d.id}/stage`, { stageId: ids.dealFirst })).status).toBe(403);
    const reopened = await admin.put(`/deals/${d.id}/stage`, { stageId: ids.dealFirst });
    expect(reopened.body).toMatchObject({ status: 'OPEN', finalValue: null, closedAt: null });
    expect((await admin.get('/audit?event=DEAL_REOPENED')).body.total).toBe(1);
  });

  it('perder exige motivo del catálogo de negociaciones', async () => {
    const d = (await admin.post('/deals', { title: 'Perdible' })).body;
    expect((await admin.put(`/deals/${d.id}/stage`, { stageId: ids.dealLost })).status).toBe(400);
    expect(
      (
        await admin.put(`/deals/${d.id}/stage`, {
          stageId: ids.dealLost,
          lossReasonId: ids.leadLossReason,
        })
      ).status,
    ).toBe(400);
    const lost = await admin.put(`/deals/${d.id}/stage`, {
      stageId: ids.dealLost,
      lossReasonId: ids.dealLossReason,
    });
    expect(lost.body).toMatchObject({
      status: 'LOST',
      probability: 0,
      lossReason: { id: ids.dealLossReason },
    });
  });

  it('«Actualizar tasas» recalcula con la tasa vigente; cambiar la moneda reconvierte todo', async () => {
    const d = (await admin.post('/deals', { title: 'Multimoneda', currencyCode: 'PEN' })).body;
    await admin.post(`/deals/${d.id}/products`, { productId: ids.licUsd, quantity: '1' });
    const rate = (await admin.get(`/exchange-rates?from=${today}&to=${today}`)).body.items.find(
      (r: { fromCurrency: string; status: string }) =>
        r.fromCurrency === 'USD' && r.status === 'ACTIVE',
    );
    await admin.patch(`/exchange-rates/${rate.id}`, { rate: '3.80', reason: 'Cierre' });
    expect((await admin.get(`/deals/${d.id}`)).body.total).toBe('4500.0000');
    const refreshed = await admin.post(`/deals/${d.id}/refresh-rates`);
    expect(refreshed.body).toMatchObject({ changed: 1, deal: { total: '4560.0000' } });
    const usd = await admin.patch(`/deals/${d.id}`, { currencyCode: 'USD' });
    expect(usd.body).toMatchObject({ currencyCode: 'USD', total: '1200.0000' });
    await admin.patch(`/exchange-rates/${rate.id}`, { rate: '3.75', reason: 'Volver' });
  });

  it('contactos de la negociación: uno principal', async () => {
    const other = (await admin.post('/contacts', { firstName: 'Otro' })).body.id;
    const d = (
      await admin.post('/deals', {
        title: 'Con contactos',
        contactIds: [ids.contact, other],
        primaryContactId: other,
      })
    ).body;
    expect(d.contacts.map((c: { id: string; isPrimary: boolean }) => [c.id, c.isPrimary])).toEqual([
      [other, true],
      [ids.contact, false],
    ]);
    expect(
      (await admin.get(`/deals?contactId=${ids.contact}`)).body.items.map(
        (i: { id: string }) => i.id,
      ),
    ).toContain(d.id);
  });

  it('el alcance aplica al tablero: un Comercial solo ve sus negociaciones', async () => {
    const sales = await login(app, (await org.addUser('SALES')).email);
    await sales.post('/deals', { title: 'Solo mía' });
    const board = (await sales.get('/deals/board')).body;
    const titles = board.columns.flatMap((c: { items: { title: string }[] }) =>
      c.items.map((i) => i.title),
    );
    expect(titles).toEqual(['Solo mía']);
  });
});

describe('integridad', () => {
  it('no se eliminan definitivamente productos, compañías ni contactos usados en ventas', async () => {
    await admin.delete(`/products/${ids.srvPen}`);
    const entry = (await admin.get('/trash')).body.items.find(
      (t: { entityId: string }) => t.entityId === ids.srvPen,
    );
    const detail = (await admin.get(`/trash/${entry.id}`)).body;
    expect(detail.purgeBlockers.join(' ')).toMatch(
      /línea\(s\) de prospectos.*línea\(s\) de negociaciones/,
    );
    expect((await admin.delete(`/trash/${entry.id}`, { confirmation: 'SRV' })).status).toBe(409);
    await admin.post('/trash/restore', { ids: [entry.id] });
  });

  it('un prospecto con compañía en papelera no se restaura hasta restaurarla', async () => {
    const company = (await admin.post('/companies', { legalName: 'Temporal Ventas SAC' })).body.id;
    const l = await newLead({ companyId: company, contactId: null });
    await admin.delete(`/leads/${l.id}`);
    await admin.delete(`/companies/${company}`);
    const entry = (await admin.get('/trash?entityType=LEAD')).body.items.find(
      (t: { entityId: string }) => t.entityId === l.id,
    );
    const res = await admin.post('/trash/restore', { ids: [entry.id] });
    expect(res.body.conflicts[0].reasons[0]).toMatch(/Temporal Ventas SAC.*papelera/);
  });
});

describe('comentarios', () => {
  it('se comentan prospectos y negociaciones; las menciones notifican', async () => {
    const sup = await org.addUser('SUPERVISOR');
    const l = await newLead();
    const c = await admin.post(`/comments/lead/${l.id}`, {
      body: 'Llamar el lunes',
      mentions: [sup.id],
    });
    expect(c.status).toBe(201);
    const list = (await admin.get(`/comments/lead/${l.id}`)).body;
    expect(list[0]).toMatchObject({
      body: 'Llamar el lunes',
      mine: true,
      mentions: [{ id: sup.id }],
    });
    const supAgent = await login(app, sup.email);
    const notes = (await supAgent.get('/notifications')).body;
    expect(notes.items[0]).toMatchObject({ type: 'MENTION', link: `/prospectos?id=${l.id}` });
    expect((await supAgent.patch(`/comments/${c.body.id}`, { body: 'hack' })).status).toBe(403);
    expect(
      (await admin.patch(`/comments/${c.body.id}`, { body: 'Llamar el martes' })).body.editedAt,
    ).not.toBeNull();
  });
});

describe('importación de prospectos', () => {
  it('importa con pipeline/etapa por nombre y valida referencias', async () => {
    const file = Buffer.from(
      [
        'Nombre o título,Compañía,Etapa,Prioridad,Moneda,Valor estimado',
        'Importado 1,20131312955,Contactado,Alta,USD,"1,500.50"',
        'Importado 2,,Inexistente,,,',
      ].join('\n'),
    );
    const up = await admin.upload('/import-export/leads/upload', file, 'prospectos.csv');
    const done = await admin.post(`/import-export/jobs/${up.body.jobId}/confirm`, {
      mapping: up.body.mapping,
    });
    expect(done.body).toMatchObject({ created: 1, invalid: 1 });
    expect(done.body.errors[0].message).toMatch(/Etapa «Inexistente»/);
    const created = (await admin.get('/leads?q=importado 1')).body.items[0];
    expect(created).toMatchObject({
      stage: { name: 'Contactado' },
      priority: { name: 'Alta' },
      currencyCode: 'USD',
      estimatedValue: '1500.5000',
    });
  });
});
