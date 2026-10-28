import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, createOrg, login, ownerDb, type Agent, type TestOrg } from './helpers';

let app: INestApplication;
let db: PrismaClient;
let org: TestOrg;
let admin: Agent;
let sup: Agent;
let salesA: Agent;
let salesB: Agent;
const ids: Record<string, string> = {};

const lima = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' });
const daysAgo = (n: number) => lima.format(new Date(Date.now() - n * 86_400_000));
const today = daysAgo(0);
const D1 = daysAgo(10);
const D2 = daysAgo(3);

interface ReportBody {
  rows: Record<string, string | number | null>[];
  totals: Record<string, string | number | null> | null;
  meta: {
    currency: string;
    criterion: string;
    cutoffDate: string;
    excluded: { currency: string; count: number; amount: string }[];
  };
}
const report = async (agent: Agent, key: string, q = ''): Promise<ReportBody> => {
  const res = await agent.get(`/reports/${key}${q ? `?${q}` : ''}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
};

beforeAll(async () => {
  db = ownerDb();
  app = await createApp();
  org = await createOrg(db, 'Reportes');
  admin = await login(app, org.adminEmail);
  const supUser = await org.addUser('SUPERVISOR');
  const aUser = await org.addUser('SALES');
  const bUser = await org.addUser('SALES');
  Object.assign(ids, { sup: supUser.id, a: aUser.id, b: bUser.id });
  sup = await login(app, supUser.email);
  salesA = await login(app, aUser.email);
  salesB = await login(app, bUser.email);
  ids.team = (
    await admin.post('/teams', {
      name: 'Equipo A',
      supervisorId: ids.sup,
      memberIds: [ids.a, ids.sup],
    })
  ).body.id;

  // Tipos de cambio: hoy 3.75 y, el día del cierre de D2, 3.60.
  await admin.post('/exchange-rates', {
    date: today,
    fromCurrency: 'USD',
    toCurrency: 'PEN',
    rate: '3.75',
  });
  await admin.post('/exchange-rates', {
    date: D2,
    fromCurrency: 'USD',
    toCurrency: 'PEN',
    rate: '3.60',
  });
  await admin.post('/currencies', { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2 });

  ids.p1 = (
    await admin.post('/products', {
      sku: 'P1',
      name: 'Servicio PEN',
      price: '100',
      currencyCode: 'PEN',
    })
  ).body.id;
  ids.p2 = (
    await admin.post('/products', {
      sku: 'P2',
      name: 'Licencia USD',
      price: '1000',
      currencyCode: 'USD',
    })
  ).body.id;
  const pipe = (await admin.get('/pipelines?entityType=DEAL')).body[0];
  ids.dealPipeline = pipe.id;
  const stages = pipe.stages as { id: string; kind: string; probability: number | null }[];
  ids.open = stages.find((s) => s.kind === 'OPEN')!.id;
  ids.won = stages.find((s) => s.kind === 'WON')!.id;
  ids.lost = stages.find((s) => s.kind === 'LOST')!.id;
  ids.reason = (await admin.get('/catalogs/loss-reasons')).body.find(
    (r: { entityType: string }) => r.entityType === 'DEAL',
  ).id;

  const deal = async (agent: Agent, title: string, extra: object = {}) =>
    (await agent.post('/deals', { title, currencyCode: 'PEN', ...extra })).body.id as string;
  const line = (agent: Agent, dealId: string, productId: string, quantity: string) =>
    agent.post(`/deals/${dealId}/products`, { productId, quantity });

  // Ganadas de A: 500 PEN (cierre D1) y 1000 USD (cierre D2).
  ids.d1 = await deal(salesA, 'Venta 1');
  await line(salesA, ids.d1, ids.p1!, '5');
  await salesA.put(`/deals/${ids.d1}/stage`, {
    stageId: ids.won,
    index: 0,
    finalValue: '500',
    closedAt: D1,
  });
  ids.d2 = await deal(salesA, 'Venta 2', { currencyCode: 'USD' });
  await line(salesA, ids.d2, ids.p2!, '1');
  await salesA.put(`/deals/${ids.d2}/stage`, {
    stageId: ids.won,
    index: 0,
    finalValue: '1000',
    closedAt: D2,
  });
  // Perdida de B: 300 PEN.
  ids.d3 = await deal(salesB, 'Perdida B');
  await line(salesB, ids.d3, ids.p1!, '3');
  await salesB.put(`/deals/${ids.d3}/stage`, {
    stageId: ids.lost,
    index: 0,
    lossReasonId: ids.reason,
    closedAt: D2,
  });
  // Abiertas de A: 1000 PEN y 500 EUR (sin tasa).
  ids.d4 = await deal(salesA, 'Abierta PEN');
  await line(salesA, ids.d4, ids.p1!, '10');
  ids.d5 = await deal(salesA, 'Abierta EUR', { currencyCode: 'EUR', estimatedValue: '500' });

  // Prospectos: A crea 4 y convierte 1; B crea 1.
  const leads: string[] = [];
  for (const t of ['L1', 'L2', 'L3', 'L4'])
    leads.push((await salesA.post('/leads', { title: t })).body.id);
  await salesB.post('/leads', { title: 'LB' });
  await salesA.post(`/leads/${leads[0]}/convert`, {
    pipelineId: ids.dealPipeline,
    stageId: ids.open,
  });

  // Tareas de A: una vencida y una al día; una completada.
  const past = new Date(Date.now() - 5 * 86_400_000).toISOString();
  const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
  await salesA.post('/tasks', { title: 'Vencida A', dueAt: past });
  await salesA.post('/tasks', { title: 'Al día A', dueAt: future });
  const done = (await salesA.post('/tasks', { title: 'Hecha A' })).body;
  const doneStatus = (await admin.get('/catalogs/task-statuses')).body.find(
    (s: { category: string }) => s.category === 'DONE',
  ).id;
  await salesA.put(`/tasks/${done.id}/status`, { statusId: doneStatus, index: 0 });
  await salesB.post('/tasks', { title: 'Vencida B', dueAt: past });
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

describe('ventas ganadas y consolidación multimoneda (D-14)', () => {
  it('convierte con la tasa de la fecha de corte por defecto', async () => {
    const r = await report(admin, 'won-sales');
    expect(r.rows).toHaveLength(2);
    expect(r.meta).toMatchObject({
      currency: 'PEN',
      criterion: 'CUTOFF',
      cutoffDate: today,
      excluded: [],
    });
    expect(r.totals!.amount).toBe(4250); // 500 + 1000 × 3.75
    const usd = r.rows.find((x) => x.code && x.currency === 'USD')!;
    expect(usd).toMatchObject({ original: 1000, amount: 3750 });
  });

  it('con el criterio «fecha de cierre» usa la tasa del día de cada cierre', async () => {
    const r = await report(admin, 'won-sales', 'criterion=CLOSE');
    expect(r.totals!.amount).toBe(4100); // 500 + 1000 × 3.60
    // La venta en PEN no depende de la tasa.
    expect(r.rows.find((x) => x.currency === 'PEN')!.amount).toBe(500);
  });

  it('presenta en otra moneda y respeta el rango de fechas', async () => {
    const usd = await report(admin, 'won-sales', 'currency=USD');
    expect(usd.meta.currency).toBe('USD');
    expect(usd.totals!.amount).toBe(1133.33); // 500 ÷ 3.75 (tasa inversa) + 1000
    const range = await report(admin, 'won-sales', `from=${daysAgo(5)}&to=${today}`);
    expect(range.rows.map((x) => x.code && x.currency)).toEqual(['USD']);
    expect(range.totals!.amount).toBe(3750);
  });

  it('lo que no tiene tasa se excluye y se informa, sin inventar una', async () => {
    const r = await report(admin, 'pipeline-value');
    expect(r.meta.excluded).toEqual([{ currency: 'EUR', count: 1, amount: '500.0000' }]);
    expect(r.totals).toMatchObject({ count: 3, value: 1000 }); // incluye la nacida de la conversión, sin importe
    // Ponderado: 1000 × probabilidad de la etapa inicial (10 %, 20 %…) según el pipeline sembrado.
    const prob = (await admin.get('/pipelines?entityType=DEAL')).body[0].stages[0]
      .probability as number;
    expect(r.totals!.weighted).toBe((1000 * prob) / 100);
  });

  it('validaciones: moneda inexistente, rango invertido y pipeline ajeno', async () => {
    expect((await admin.get('/reports/won-sales?currency=ZZZ')).status).toBe(400);
    expect((await admin.get('/reports/won-sales?from=2026-12-01&to=2026-11-01')).status).toBe(400);
    expect(
      (await admin.get('/reports/won-sales?pipelineId=00000000-0000-7000-8000-000000000000'))
        .status,
    ).toBe(404);
    expect((await admin.get('/reports/no-existe')).status).toBe(404);
  });
});

describe('alcance del usuario en reportes y dashboard', () => {
  it('cada rol ve solo lo suyo: propios, equipo o todos', async () => {
    const owners = async (agent: Agent) =>
      ((await report(agent, 'owner-performance')).rows.map((r) => r.owner) as string[]).length;
    const rowsAdmin = (await report(admin, 'owner-performance')).rows;
    expect(rowsAdmin.length).toBeGreaterThanOrEqual(2);
    // B (propios): solo su fila; A y el supervisor (equipo A): sin B.
    expect(await owners(salesB)).toBe(1);
    expect((await report(salesB, 'lost-sales')).rows).toHaveLength(1);
    expect((await report(salesA, 'lost-sales')).rows).toHaveLength(0);
    expect((await report(sup, 'lost-sales')).rows).toHaveLength(0);
    expect((await report(admin, 'lost-sales')).rows).toHaveLength(1);
    expect((await report(salesA, 'won-sales')).totals!.amount).toBe(4250);
    expect((await report(salesB, 'won-sales')).rows).toHaveLength(0);
  });

  it('los filtros de equipo y responsable no amplían el alcance', async () => {
    expect((await report(admin, 'won-sales', `teamId=${ids.team}`)).rows).toHaveLength(2);
    expect((await report(admin, 'lost-sales', `teamId=${ids.team}`)).rows).toHaveLength(0);
    expect((await report(admin, 'lost-sales', `ownerId=${ids.b}`)).rows).toHaveLength(1);
    // B pidiendo a A como responsable: su alcance (propios) lo deja sin filas.
    expect((await report(salesB, 'won-sales', `ownerId=${ids.a}`)).rows).toHaveLength(0);
    expect(
      (await admin.get('/reports/won-sales?teamId=00000000-0000-7000-8000-000000000000')).status,
    ).toBe(404);
  });

  it('dashboard: indicadores de hoy y del rango, con el alcance de cada persona', async () => {
    const dash = async (agent: Agent, q = '') =>
      (await agent.get(`/dashboard${q ? `?${q}` : ''}`)).body;
    const a = await dash(salesA);
    expect(a.kpis).toMatchObject({
      activeLeads: 3, // L2, L3, L4 (L1 se convirtió)
      newLeads: 4,
      openDeals: 3, // abierta PEN, abierta EUR y la nacida de la conversión
      wonDeals: 2,
      lostDeals: 0,
      pipelineValue: 1000,
      closedSales: 4250,
      pendingTasks: 2,
      overdueTasks: 1,
    });
    expect(a.meta.excluded).toEqual([{ currency: 'EUR', count: 1, amount: '500.0000' }]);
    expect(a.ownerDistribution).toHaveLength(1);
    expect(a.recentActivity.length).toBeGreaterThan(0);
    const b = await dash(salesB);
    expect(b.kpis).toMatchObject({
      activeLeads: 1,
      newLeads: 1,
      openDeals: 0,
      wonDeals: 0,
      lostDeals: 1,
      closedSales: 0,
      overdueTasks: 1,
    });
    const all = await dash(admin);
    expect(all.kpis).toMatchObject({ newLeads: 5, wonDeals: 2, lostDeals: 1, closedSales: 4250 });
    expect(all.ownerDistribution.map((o: { owner: string }) => o.owner).length).toBe(2);
    // Un rango sin movimientos no trae ventas pero conserva el estado de hoy.
    const old = (await dash(admin, 'from=2020-01-01&to=2020-01-31')).kpis;
    expect(old).toMatchObject({ newLeads: 0, wonDeals: 0, closedSales: 0, openDeals: 3 });
    // La evolución cubre todo el rango por semanas o meses.
    const evo = (await dash(admin, `from=${daysAgo(60)}&to=${today}`)).evolution;
    expect(evo.length).toBeGreaterThanOrEqual(9);
    expect(evo.reduce((n: number, e: { dealsWon: number }) => n + e.dealsWon, 0)).toBe(2);
  });
});

describe('demás reportes contra datos conocidos', () => {
  it('conversión: convertidos ÷ creados, por responsable', async () => {
    const r = await report(admin, 'lead-conversion');
    const a = r.rows.find((x) => x.created === 4)!;
    expect(a).toMatchObject({ converted: 1, rate: 25 });
    expect(r.totals).toMatchObject({ created: 5, converted: 1, rate: 20 });
  });

  it('prospectos y negociaciones por etapa, motivos de pérdida y productos vendidos', async () => {
    const leads = await report(admin, 'leads-by-stage');
    expect(leads.totals!.count).toBe(5);
    const deals = await report(admin, 'deals-by-stage');
    expect(deals.totals!.count).toBe(6);
    expect(deals.rows.find((x) => x.kind === 'Ganada')!.count).toBe(2);
    const reasons = await report(admin, 'loss-reasons');
    expect(reasons.rows[0]).toMatchObject({ deals: 1, total: 1, value: 300 });
    const products = await report(admin, 'products-sold');
    expect(products.rows).toEqual([
      expect.objectContaining({ sku: 'P2', quantity: 1, amount: 3750 }),
      expect.objectContaining({ sku: 'P1', quantity: 5, amount: 500 }),
    ]);
  });

  it('desempeño: efectividad, pipeline y tareas por persona', async () => {
    const r = await report(admin, 'owner-performance');
    const a = r.rows.find((x) => x.won === 2)!;
    expect(a).toMatchObject({
      wonValue: 4250,
      lost: 0,
      winRate: 100,
      open: 3,
      openValue: 1000,
      done: 1,
      overdue: 1,
    });
    const b = r.rows.find((x) => x.lost === 1)!;
    expect(b).toMatchObject({ won: 0, winRate: 0, overdue: 1 });
  });

  it('tareas pendientes y vencidas', async () => {
    const pending = await report(admin, 'pending-tasks');
    expect(pending.rows.map((x) => x.title).sort()).toEqual(['Al día A', 'Vencida A', 'Vencida B']);
    const overdue = await report(admin, 'overdue-tasks');
    expect(overdue.rows.map((x) => x.title).sort()).toEqual(['Vencida A', 'Vencida B']);
    expect(overdue.rows.every((x) => Number(x.daysLate) >= 5)).toBe(true);
    expect((await report(salesB, 'overdue-tasks')).rows.map((x) => x.title)).toEqual(['Vencida B']);
  });

  it('duplicados y papelera (con el permiso de cada módulo)', async () => {
    await admin.post('/contacts', { firstName: 'Dup', email: 'd@x.pe' });
    await admin.post('/contacts', { firstName: 'Dup2', email: 'D@x.pe' });
    const t = (await admin.post('/tasks', { title: 'A la papelera' })).body.id;
    await admin.delete(`/tasks/${t}`);
    const dup = await report(admin, 'duplicates');
    expect(dup.rows.find((x) => x.module === 'Contactos')).toMatchObject({ detected: 1, open: 1 });
    const trash = await report(admin, 'trash');
    expect(trash.rows.find((x) => x.module === 'Tareas')).toMatchObject({ deleted: 1, inTrash: 1 });
    expect((await salesA.get('/reports/duplicates')).status).toBe(403);
    const idx = (await salesA.get('/reports')).body.reports.map((x: { key: string }) => x.key);
    expect(idx).not.toContain('duplicates');
    expect(idx).toContain('won-sales');
  });
});

describe('exportación y aislamiento', () => {
  it('exporta CSV con totales, criterio de conversión y auditoría', async () => {
    const res = await admin.download('/reports/won-sales/export?format=csv');
    expect(res.status).toBe(200);
    const text = (res.body as Buffer).toString('utf8');
    expect(text).toContain('Venta 1');
    expect(text).toContain('Importe en PEN');
    expect(text).toContain('4250');
    expect(text).toContain('Moneda: PEN');
    expect(text).toContain('Tasa de la fecha de corte del reporte');
    expect(
      await db.auditLog.count({ where: { organizationId: org.organizationId, event: 'EXPORT' } }),
    ).toBeGreaterThanOrEqual(1);
    const xlsx = await admin.download('/reports/pending-tasks/export?format=xlsx');
    expect(xlsx.status).toBe(200);
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  });

  it('otra organización no ve estos datos', async () => {
    const other = await createOrg(db, 'Otra');
    const agent = await login(app, other.adminEmail);
    const dash = (await agent.get('/dashboard')).body;
    expect(dash.kpis).toMatchObject({
      activeLeads: 0,
      newLeads: 0,
      openDeals: 0,
      wonDeals: 0,
      closedSales: 0,
      pendingTasks: 0,
    });
    expect((await report(agent, 'won-sales')).rows).toEqual([]);
    expect((await agent.get(`/reports/won-sales?teamId=${ids.team}`)).status).toBe(404);
    expect((await agent.get(`/reports/won-sales?pipelineId=${ids.dealPipeline}`)).status).toBe(404);
  });
});
