import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Db } from '../../src/infra/db';
import { TrashService } from '../../src/modules/trash/trash.service';
import { createApp, createOrg, login, ownerDb, type Agent, type TestOrg } from './helpers';

let app: INestApplication;
let db: PrismaClient;
let org: TestOrg;
let admin: Agent;

beforeAll(async () => {
  db = ownerDb();
  app = await createApp();
  org = await createOrg(db, 'Papelera');
  admin = await login(app, org.adminEmail);
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

const trashEntryFor = async (entityId: string) =>
  (await admin.get('/trash?pageSize=200')).body.items.find(
    (i: { entityId: string }) => i.entityId === entityId,
  );

describe('papelera', () => {
  it('eliminar es lógico: el registro desaparece de las listas y aparece en la papelera', async () => {
    const team = (await admin.post('/teams', { name: 'Temporal' })).body;
    expect((await admin.delete(`/teams/${team.id}`)).status).toBe(200);

    const list = await admin.get('/teams?includeInactive=true');
    expect(list.body.items.map((t: { id: string }) => t.id)).not.toContain(team.id);
    expect((await admin.get(`/teams/${team.id}`)).status).toBe(404);
    expect(await db.team.findUnique({ where: { id: team.id } })).not.toBeNull();

    const entry = await trashEntryFor(team.id);
    expect(entry).toMatchObject({
      entityType: 'TEAM',
      displayName: 'Temporal',
      status: 'IN_TRASH',
    });
    expect(entry.deletedByName).toBe('Admin Prueba');
    const days =
      (new Date(entry.purgeAfter).getTime() - new Date(entry.deletedAt).getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(90);
  });

  it('restaura el registro con sus relaciones y deja historial y auditoría', async () => {
    const sales = await org.addUser('SALES');
    const team = (await admin.post('/teams', { name: 'Para restaurar', memberIds: [sales.id] }))
      .body;
    await admin.delete(`/teams/${team.id}`);
    const entry = await trashEntryFor(team.id);

    const res = await admin.post('/trash/restore', { ids: [entry.id] });
    expect(res.status).toBe(201);
    expect(res.body.restored).toHaveLength(1);
    const restored = await admin.get(`/teams/${team.id}`);
    expect(restored.body.members.map((m: { id: string }) => m.id)).toEqual([sales.id]);

    const history = await admin.get(`/history/TEAM/${team.id}`);
    expect(history.body.map((h: { action: string }) => h.action)).toEqual([
      'RESTORE',
      'DELETE',
      'CREATE',
    ]);
    const audit = await db.auditLog.findFirst({
      where: { entityId: team.id, event: 'RECORD_RESTORED' },
    });
    expect(audit).not.toBeNull();
  });

  it('detecta conflictos al restaurar y no restaura hasta resolverlos', async () => {
    const first = (await admin.post('/teams', { name: 'Duplicado' })).body;
    await admin.delete(`/teams/${first.id}`);
    const second = (await admin.post('/teams', { name: 'Duplicado' })).body;
    expect(second.id).toBeDefined();
    const entry = await trashEntryFor(first.id);

    const detail = await admin.get(`/trash/${entry.id}`);
    expect(detail.body.restoreConflicts[0]).toMatch(/Ya existe un equipo activo/);
    const res = await admin.post('/trash/restore', { ids: [entry.id] });
    expect(res.body.restored).toHaveLength(0);
    expect(res.body.conflicts[0].reasons[0]).toMatch(/Ya existe/);

    await admin.patch(`/teams/${second.id}`, { name: 'Duplicado 2' });
    expect((await admin.post('/trash/restore', { ids: [entry.id] })).body.restored).toHaveLength(1);
  });

  it('la eliminación definitiva exige confirmación escrita y permiso de administrador', async () => {
    const team = (await admin.post('/teams', { name: 'Borrar del todo' })).body;
    await admin.delete(`/teams/${team.id}`);
    const entry = await trashEntryFor(team.id);

    const sup = await login(app, (await org.addUser('SUPERVISOR')).email);
    expect(
      (await sup.delete(`/trash/${entry.id}`, { confirmation: 'Borrar del todo' })).status,
    ).toBe(403);

    const wrong = await admin.delete(`/trash/${entry.id}`, { confirmation: 'otra cosa' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe('CONFIRMATION_MISMATCH');

    expect(
      (await admin.delete(`/trash/${entry.id}`, { confirmation: 'Borrar del todo' })).status,
    ).toBe(200);
    expect(await db.team.findUnique({ where: { id: team.id } })).toBeNull();
    expect((await db.trashEntry.findUnique({ where: { id: entry.id } }))?.status).toBe('PURGED');
    // El historial sobrevive a la eliminación definitiva.
    expect(await db.recordHistory.count({ where: { entityId: team.id } })).toBeGreaterThan(0);
  });

  it('un Comercial solo ve en la papelera lo que él eliminó o era suyo', async () => {
    const sales = await login(app, (await org.addUser('SALES')).email);
    const res = await sales.get('/trash');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });

  it('la purga por retención elimina lo vencido y conserva lo vigente', async () => {
    const old = (await admin.post('/teams', { name: 'Vencido' })).body;
    const recent = (await admin.post('/teams', { name: 'Vigente' })).body;
    await admin.delete(`/teams/${old.id}`);
    await admin.delete(`/teams/${recent.id}`);
    await db.trashEntry.updateMany({
      where: { entityId: old.id },
      data: { purgeAfter: new Date(Date.now() - 1000) },
    });

    const dbs = app.get(Db);
    const result = await dbs.withOrg(org.organizationId, () =>
      app.get(TrashService).purgeExpired(),
    );
    expect(result.purged).toBe(1);
    expect(await db.team.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await db.team.findUnique({ where: { id: recent.id } })).not.toBeNull();
    // Idempotente: una segunda corrida no hace nada.
    expect(
      await dbs.withOrg(org.organizationId, () => app.get(TrashService).purgeExpired()),
    ).toEqual({
      purged: 0,
      blocked: 0,
    });
  });
});
