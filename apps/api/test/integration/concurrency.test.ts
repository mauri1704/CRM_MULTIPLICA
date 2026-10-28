import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, createOrg, login, ownerDb, type Agent, type TestOrg } from './helpers';

let app: INestApplication;
let db: PrismaClient;
let org: TestOrg;
let admin: Agent;
const ids: Record<string, string> = {};

beforeAll(async () => {
  db = ownerDb();
  app = await createApp();
  org = await createOrg(db, 'Concurrencia');
  admin = await login(app, org.adminEmail);
  const stages = (await admin.get('/pipelines?entityType=LEAD')).body[0].stages as {
    id: string;
    kind: string;
  }[];
  const open = stages.filter((s) => s.kind === 'OPEN');
  ids.s0 = open[0]!.id;
  ids.s1 = open[1]!.id;
  ids.s2 = open[2]!.id;
  const statuses = (await admin.get('/catalogs/task-statuses')).body as {
    id: string;
    category: string;
  }[];
  ids.t0 = statuses.find((s) => s.category === 'OPEN')!.id;
  ids.t1 = statuses.find((s) => s.category === 'IN_PROGRESS')!.id;
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

const newLeads = async (n: number) =>
  Promise.all(
    Array.from({ length: n }, (_, i) =>
      admin.post('/leads', { title: `Lead ${i}`, stageId: ids.s0 }),
    ),
  ).then((r) => r.map((x) => x.body as { id: string; version: number }));

describe('Kanban: movimientos simultáneos (A-03)', () => {
  it('con la misma versión, dos movimientos del mismo registro: uno gana y el otro recibe un conflicto', async () => {
    const [lead] = await newLeads(1);
    const [a, b] = await Promise.all([
      admin.put(`/leads/${lead!.id}/stage`, { stageId: ids.s1, index: 0, version: lead!.version }),
      admin.put(`/leads/${lead!.id}/stage`, { stageId: ids.s2, index: 0, version: lead!.version }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.code).toBe('STALE_VERSION');
    // El registro quedó en la etapa del que ganó, nunca a medias.
    const winner = a.status === 200 ? ids.s1 : ids.s2;
    expect((await admin.get(`/leads/${lead!.id}`)).body.stageId).toBe(winner);
  });

  it('muchas tarjetas a la misma columna a la vez: ninguna se pierde y el orden es estable', async () => {
    const leads = await newLeads(8);
    const res = await Promise.all(
      leads.map((l) => admin.put(`/leads/${l.id}/stage`, { stageId: ids.s2, index: 0 })),
    );
    expect(res.every((r) => r.status === 200)).toBe(true);
    const read = async () => {
      const board = (await admin.get('/leads/board')).body;
      const col = board.columns.find((c: { stage: { id: string } }) => c.stage.id === ids.s2);
      return col.items.map((i: { id: string }) => i.id) as string[];
    };
    const first = await read();
    const moved = new Set(leads.map((l) => l.id));
    expect(first.filter((id) => moved.has(id))).toHaveLength(8);
    expect(await read()).toEqual(first);
    expect(new Set(first).size).toBe(first.length);
  });

  it('tareas: dos personas cambian el estado a la vez con la misma versión', async () => {
    const t = (await admin.post('/tasks', { title: 'Tarea compartida' })).body;
    const [a, b] = await Promise.all([
      admin.put(`/tasks/${t.id}/status`, { statusId: ids.t1, index: 0, version: t.version }),
      admin.put(`/tasks/${t.id}/status`, { statusId: ids.t0, index: 1, version: t.version }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });
});

describe('conversión simultánea (A-03)', () => {
  it('convertir dos veces el mismo prospecto a la vez crea una sola negociación', async () => {
    const lead = (await admin.post('/leads', { title: 'Convertible' })).body;
    const pipe = (await admin.get('/pipelines?entityType=DEAL')).body[0];
    const body = { pipelineId: pipe.id, stageId: pipe.stages[0].id };
    const res = await Promise.all([
      admin.post(`/leads/${lead.id}/convert`, body),
      admin.post(`/leads/${lead.id}/convert`, body),
      admin.post(`/leads/${lead.id}/convert`, body),
    ]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await db.deal.count({ where: { sourceLeadId: lead.id } })).toBe(1);
  });
});
