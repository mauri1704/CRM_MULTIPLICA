import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Db } from '../../src/infra/db';
import { TasksService } from '../../src/modules/tasks/tasks.service';
import { createApp, createOrg, login, ownerDb, type Agent, type TestOrg } from './helpers';

let app: INestApplication;
let db: PrismaClient;
let org: TestOrg;
let admin: Agent;
const ids: Record<string, string> = {};
const users: Record<string, { id: string; email: string; agent: Agent }> = {};

const csv = (lines: string[]) => Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8');
const inDays = (n: number, hour = 10) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

beforeAll(async () => {
  db = ownerDb();
  app = await createApp();
  org = await createOrg(db, 'Operación');
  admin = await login(app, org.adminEmail);
  for (const [key, role] of [
    ['ana', 'SALES'],
    ['beto', 'SALES'],
    ['carla', 'SALES'],
    ['sup', 'SUPERVISOR'],
  ] as const) {
    const u = await org.addUser(role);
    users[key] = { ...u, agent: undefined as unknown as Agent };
  }
  // Ana, Beto y la supervisora forman un equipo; Carla queda fuera.
  await admin.post('/teams', {
    name: 'Ventas',
    supervisorId: users.sup!.id,
    memberIds: [users.ana!.id, users.beto!.id, users.sup!.id],
  });
  for (const u of Object.values(users)) u.agent = await login(app, u.email);
  const statuses = (await admin.get('/catalogs/task-statuses')).body as {
    id: string;
    category: string;
  }[];
  for (const s of statuses) ids[s.category] = s.id;
  ids.company = (await admin.post('/companies', { legalName: 'Cliente Tareas SAC' })).body.id;
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

const anaTask = async (extra: object = {}) =>
  users.ana!.agent.post('/tasks', {
    title: 'Llamar al cliente',
    participantIds: [users.beto!.id],
    observerIds: [users.carla!.id],
    dueAt: inDays(2),
    ...extra,
  });

describe('tareas: roles en la tarea (T-02)', () => {
  it('responsable, participante y observador tienen permisos distintos, validados en la API', async () => {
    const created = await anaTask();
    expect(created.status).toBe(201);
    const t = created.body;
    expect(t.code).toMatch(/^TAR-\d{6}$/);
    expect(t.status.category).toBe('OPEN');
    expect(t.myRole).toBe('RESPONSIBLE');
    expect(t.participants.map((p: { id: string }) => p.id)).toEqual([users.beto!.id]);

    // Participante: ve, cambia el estado y comenta; no edita el resto.
    const beto = users.beto!.agent;
    const seen = await beto.get(`/tasks/${t.id}`);
    expect(seen.body).toMatchObject({ myRole: 'PARTICIPANT', can: { edit: false, status: true } });
    expect((await beto.patch(`/tasks/${t.id}`, { title: 'Cambiado' })).status).toBe(403);
    const moved = await beto.put(`/tasks/${t.id}/status`, { statusId: ids.IN_PROGRESS, index: 0 });
    expect(moved.status).toBe(200);
    expect(moved.body.status.category).toBe('IN_PROGRESS');
    expect((await beto.post(`/comments/task/${t.id}`, { body: 'Voy yo' })).status).toBe(201);

    // Observador: ve y comenta; no cambia el estado ni edita.
    const carla = users.carla!.agent;
    expect((await carla.get(`/tasks/${t.id}`)).body.myRole).toBe('OBSERVER');
    const denied = await carla.put(`/tasks/${t.id}/status`, { statusId: ids.DONE, index: 0 });
    expect(denied.status).toBe(403);
    expect(denied.body.message).toMatch(/observador/);
    expect((await carla.post(`/comments/task/${t.id}`, { body: 'Visto' })).status).toBe(201);
    expect((await carla.delete(`/tasks/${t.id}`)).status).toBe(403);

    // Ajeno: un comercial sin relación con la tarea no la ve ni comenta.
    const other = await login(app, (await org.addUser('SALES')).email);
    expect((await other.get(`/tasks/${t.id}`)).status).toBe(403);
    expect((await other.post(`/comments/task/${t.id}`, { body: 'x' })).status).toBe(403);
    expect((await other.get('/tasks?rel=all')).body.items).toEqual([]);

    // Supervisor del equipo: edita por alcance de equipo sin ser miembro.
    const sup = users.sup!.agent;
    const edited = await sup.patch(`/tasks/${t.id}`, { title: 'Llamar al cliente (urgente)' });
    expect(edited.status).toBe(200);
    expect(edited.body.myRole).toBeNull();
  });

  it('las asignaciones notifican a responsable, participantes y observadores (no a quien asigna)', async () => {
    const t = (await anaTask({ title: 'Tarea con avisos' })).body;
    const notes = await db.notification.findMany({ where: { entityId: t.id } });
    expect(notes.map((n) => [n.userId, n.type]).sort()).toEqual(
      [
        [users.beto!.id, 'TASK_MEMBER'],
        [users.carla!.id, 'TASK_MEMBER'],
      ].sort(),
    );
    // Reasignar al compañero de equipo notifica al nuevo responsable.
    await users.sup!.agent.patch(`/tasks/${t.id}`, { responsibleId: users.beto!.id });
    const after = await db.notification.findMany({
      where: { entityId: t.id, type: 'TASK_ASSIGNED' },
    });
    expect(after.map((n) => n.userId)).toEqual([users.beto!.id]);
    // El nuevo responsable deja de figurar como participante.
    const task = (await admin.get(`/tasks/${t.id}`)).body;
    expect(task.responsibleId).toBe(users.beto!.id);
    expect(task.participants).toEqual([]);
  });

  it('un comercial solo puede asignarse tareas a sí mismo', async () => {
    const res = await users.carla!.agent.post('/tasks', {
      title: 'Para otro',
      responsibleId: users.ana!.id,
    });
    expect(res.status).toBe(403);
  });

  it('filtros Mis tareas, Participo y Observo', async () => {
    const titles = async (agent: Agent, rel: string) =>
      ((await agent.get(`/tasks?rel=${rel}&pageSize=200`)).body.items as { title: string }[]).map(
        (t) => t.title,
      );
    const beto = users.beto!.agent;
    expect(await titles(beto, 'participant')).toContain('Llamar al cliente (urgente)');
    expect(await titles(beto, 'mine')).toContain('Tarea con avisos');
    expect(await titles(users.carla!.agent, 'observer')).toContain('Llamar al cliente (urgente)');
    expect(await titles(users.carla!.agent, 'mine')).toEqual([]);
  });
});

describe('tareas: fechas, estados y vistas', () => {
  it('el vencimiento no puede ser anterior al inicio', async () => {
    const res = await admin.post('/tasks', {
      title: 'Fechas al revés',
      startAt: inDays(3),
      dueAt: inDays(1),
    });
    expect(res.status).toBe(400);
    expect(res.body.details.dueAt).toMatch(/anterior al inicio/);
    const t = (
      await admin.post('/tasks', { title: 'Fechas', startAt: inDays(1), dueAt: inDays(3) })
    ).body;
    const bad = await admin.patch(`/tasks/${t.id}`, { dueAt: inDays(0) });
    expect(bad.status).toBe(400);
  });

  it('completar registra completed_at y reabrir lo limpia (T-06)', async () => {
    const t = (await admin.post('/tasks', { title: 'Completar' })).body;
    const done = await admin.put(`/tasks/${t.id}/status`, { statusId: ids.DONE, index: 0 });
    expect(done.body.completedAt).not.toBeNull();
    expect(done.body.overdue).toBe(false);
    const back = await admin.put(`/tasks/${t.id}/status`, { statusId: ids.OPEN, index: 0 });
    expect(back.body.completedAt).toBeNull();
    const history = (await admin.get(`/history/TASK/${t.id}`)).body as { action: string }[];
    expect(history.filter((h) => h.action === 'STATUS_CHANGE')).toHaveLength(2);
  });

  it('Kanban: columnas por estado y orden dentro de la columna', async () => {
    const a = (await admin.post('/tasks', { title: 'Orden A' })).body;
    const b = (await admin.post('/tasks', { title: 'Orden B' })).body;
    await admin.put(`/tasks/${a.id}/status`, { statusId: ids.REVIEW, index: 0 });
    await admin.put(`/tasks/${b.id}/status`, { statusId: ids.REVIEW, index: 0 });
    const board = (await admin.get('/tasks/board?q=orden')).body;
    const review = board.columns.find(
      (c: { stage: { kind: string } }) => c.stage.kind === 'REVIEW',
    );
    expect(review.items.map((t: { title: string }) => t.title)).toEqual(['Orden B', 'Orden A']);
    expect(board.columns.map((c: { stage: { kind: string } }) => c.stage.kind)).toEqual([
      'OPEN',
      'IN_PROGRESS',
      'REVIEW',
      'DONE',
      'CANCELED',
    ]);
  });

  it('calendario: rango de fechas y reprogramación (solo quien puede editar)', async () => {
    const t = (
      await anaTask({ title: 'En calendario', startAt: inDays(5, 9), dueAt: inDays(5, 11) })
    ).body;
    const range = `from=${inDays(4, 0)}&to=${inDays(7, 0)}`;
    const cal = (await users.ana!.agent.get(`/tasks/calendar?${range}`)).body;
    expect(cal.map((x: { id: string }) => x.id)).toContain(t.id);
    expect((await admin.get(`/tasks/calendar?from=${inDays(0)}&to=${inDays(90)}`)).status).toBe(
      400,
    );

    const body = { startAt: inDays(6, 9), dueAt: inDays(6, 11), version: t.version };
    expect((await users.beto!.agent.put(`/tasks/${t.id}/schedule`, body)).status).toBe(403);
    const ok = await users.ana!.agent.put(`/tasks/${t.id}/schedule`, body);
    expect(ok.status).toBe(200);
    expect(ok.body.dueAt).toBe(inDays(6, 11));
    // Versión vieja: conflicto de concurrencia.
    const stale = { ...body, dueAt: inDays(6, 12) };
    expect((await users.ana!.agent.put(`/tasks/${t.id}/schedule`, stale)).status).toBe(409);
  });

  it('aviso diario de vencidas: una vez por tarea y por día (D-16)', async () => {
    const t = (await anaTask({ title: 'Vencida', dueAt: inDays(-1) })).body;
    expect(t.overdue).toBe(true);
    const appDb = app.get(Db);
    const tasks = app.get(TasksService);
    const run = () => appDb.withOrg(org.organizationId, () => tasks.notifyOverdue());
    expect(await run()).toBeGreaterThanOrEqual(1);
    await run();
    const notes = await db.notification.findMany({
      where: { entityId: t.id, type: 'TASK_OVERDUE' },
    });
    expect(notes.map((n) => n.userId)).toEqual([users.ana!.id]);
    // Completada, ya no se avisa aunque pase el día.
    await users.ana!.agent.put(`/tasks/${t.id}/status`, { statusId: ids.DONE, index: 0 });
    await db.task.update({ where: { id: t.id }, data: { overdueNotifiedAt: null } });
    await run();
    expect(await db.notification.count({ where: { entityId: t.id, type: 'TASK_OVERDUE' } })).toBe(
      1,
    );
  });
});

describe('tareas: asociación CRM y proyectos', () => {
  it('una tarea se asocia a un elemento CRM y aparece en su ficha (T-03, D-26)', async () => {
    const t = (
      await admin.post('/tasks', {
        title: 'Visitar compañía',
        crm: { type: 'COMPANY', id: ids.company },
      })
    ).body;
    expect(t.crm).toMatchObject({ type: 'COMPANY', id: ids.company, name: 'Cliente Tareas SAC' });
    const related = (await admin.get(`/tasks?companyId=${ids.company}`)).body.items;
    expect(related.map((x: { id: string }) => x.id)).toEqual([t.id]);
    // La búsqueda por código del elemento la encuentra.
    expect((await admin.get('/search?q=visitar')).body.tasks[0].id).toBe(t.id);
    // La base de datos impide dos elementos a la vez.
    const contact = (await admin.post('/contacts', { firstName: 'Doble' })).body.id;
    await expect(
      db.task.update({ where: { id: t.id }, data: { contactId: contact } }),
    ).rejects.toThrow();
    // Un comercial no asocia un prospecto fuera de su alcance (los prospectos son por responsable).
    const lead = (await admin.post('/leads', { title: 'Prospecto del admin' })).body;
    const res = await users.carla!.agent.post('/tasks', {
      title: 'Ajena',
      crm: { type: 'LEAD', id: lead.id },
    });
    expect(res.status).toBe(400);
    expect(res.body.details.crm).toMatch(/alcance/);
  });

  it('al convertir un prospecto, sus tareas abiertas pasan a la negociación', async () => {
    const lead = (await admin.post('/leads', { title: 'Prospecto con tareas' })).body;
    const open = (
      await admin.post('/tasks', { title: 'Abierta', crm: { type: 'LEAD', id: lead.id } })
    ).body;
    const done = (
      await admin.post('/tasks', { title: 'Hecha', crm: { type: 'LEAD', id: lead.id } })
    ).body;
    await admin.put(`/tasks/${done.id}/status`, { statusId: ids.DONE, index: 0 });
    const pipe = (await admin.get('/pipelines?entityType=DEAL')).body[0];
    const conv = await admin.post(`/leads/${lead.id}/convert`, {
      pipelineId: pipe.id,
      stageId: pipe.stages[0].id,
    });
    expect(conv.status).toBe(201);
    expect(conv.body.movedTasks).toBe(1);
    expect((await admin.get(`/tasks/${open.id}`)).body.crm).toMatchObject({
      type: 'DEAL',
      id: conv.body.dealId,
    });
    expect((await admin.get(`/tasks/${done.id}`)).body.crm).toMatchObject({ type: 'LEAD' });
  });

  it('proyectos: fechas válidas, tareas filtrables y purga bloqueada con tareas vigentes (T-04)', async () => {
    const bad = await admin.post('/projects', {
      name: 'Fechas al revés',
      startDate: '2026-12-01',
      endDate: '2026-11-01',
    });
    expect(bad.status).toBe(400);
    const p = (
      await admin.post('/projects', {
        name: 'Proyecto Norte',
        status: 'ACTIVE',
        startDate: '2026-11-01',
        endDate: '2026-12-31',
      })
    ).body;
    expect(p).toMatchObject({ code: expect.stringMatching(/^PRY-/), status: 'ACTIVE' });
    const t = (await admin.post('/tasks', { title: 'Del proyecto', projectId: p.id })).body;
    expect(t.project).toMatchObject({ id: p.id, name: 'Proyecto Norte' });
    expect((await admin.get(`/tasks?projectId=${p.id}`)).body.total).toBe(1);
    expect((await admin.get(`/projects/${p.id}`)).body.tasks).toEqual({ open: 1, done: 0 });

    await admin.delete(`/projects/${p.id}`);
    const entry = (await admin.get('/trash?pageSize=200')).body.items.find(
      (e: { entityId: string }) => e.entityId === p.id,
    );
    const purge = await admin.delete(`/trash/${entry.id}`, { confirmation: p.code });
    expect(purge.status, JSON.stringify(purge.body)).toBe(409);
    // Un comercial no ve proyectos de otros.
    expect((await users.carla!.agent.get('/projects')).body.items).toEqual([]);
  });

  it('importar tareas desde CSV y exportarlas respetando el alcance', async () => {
    const file = csv([
      'Título;Responsable;Vencimiento;Estado;Asociado a',
      `Importada uno;${users.ana!.email};15/11/2026 10:30;En progreso;`,
      'Importada dos;;20/11/2026;;CIA-999999',
      ';;;;',
    ]);
    const up = await admin.upload('/import-export/tasks/upload', file, 'tareas.csv');
    expect(up.status).toBe(201);
    const mapping = up.body.mapping as Record<string, string>;
    expect(mapping).toMatchObject({
      Título: 'title',
      Vencimiento: 'dueAt',
      'Asociado a': 'related',
    });
    const done = await admin.post(`/import-export/jobs/${up.body.jobId}/confirm`, {
      mapping,
      duplicateMode: 'SKIP',
    });
    expect(done.body, JSON.stringify(done.body)).toMatchObject({ created: 1, invalid: 1 });
    const t = (await admin.get('/tasks?q=importada')).body.items[0];
    expect(t).toMatchObject({ responsibleId: users.ana!.id, status: { category: 'IN_PROGRESS' } });
    expect(t.dueAt).toBe('2026-11-15T15:30:00.000Z');

    const exported = await users.carla!.agent.download('/import-export/tasks/export?format=csv');
    expect(exported.status).toBe(200);
    expect(exported.body.toString()).not.toContain('Importada uno');
  });
});

describe('actividades (D-23)', () => {
  it('se registran en la ficha, solo su autor las modifica y no admiten fechas futuras', async () => {
    const res = await admin.post(`/activities/company/${ids.company}`, {
      type: 'CALL',
      subject: 'Llamada de seguimiento',
      occurredAt: inDays(-1),
    });
    expect(res.status).toBe(201);
    const future = await admin.post(`/activities/company/${ids.company}`, {
      type: 'NOTE',
      subject: 'Del futuro',
      occurredAt: inDays(3),
    });
    expect(future.status).toBe(400);
    const list = (await admin.get(`/activities/company/${ids.company}`)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: 'CALL', mine: true });

    const sup = users.sup!.agent;
    expect((await sup.patch(`/activities/${res.body.id}`, { subject: 'Otro' })).status).toBe(403);
    expect((await admin.delete(`/activities/${res.body.id}`)).status).toBe(200);
    expect((await admin.get(`/activities/company/${ids.company}`)).body).toEqual([]);
    expect((await admin.get(`/activities/task/${ids.company}`)).status).toBe(404);
  });
});

describe('índices de integridad y búsqueda', () => {
  it('existen los índices únicos y de búsqueda (una migración no debe volver a eliminarlos)', async () => {
    const expected = [
      'companies_code_key',
      'contacts_code_key',
      'leads_code_key',
      'deals_code_key',
      'tasks_code_key',
      'projects_code_key',
      'companies_search_trgm',
      'contacts_search_trgm',
      'leads_search_trgm',
      'deals_search_trgm',
      'tasks_search_trgm',
      'products_name_trgm',
      'projects_name_trgm',
      'companies_tax_id_alive_key',
      'products_sku_alive_key',
      'deal_contacts_one_primary',
      'tasks_open_due',
    ];
    const rows = await db.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY(${expected})`;
    expect(rows.map((r) => r.indexname).sort()).toEqual([...expected].sort());
  });
});
