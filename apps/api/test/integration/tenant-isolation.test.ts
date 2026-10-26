import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Db } from '../../src/infra/db';
import { createApp, createOrg, login, ownerDb, type Agent, type TestOrg } from './helpers';

let app: INestApplication;
let db: PrismaClient;
let a: TestOrg;
let b: TestOrg;
let adminA: Agent;
let teamB: string;

beforeAll(async () => {
  db = ownerDb();
  app = await createApp();
  a = await createOrg(db, 'A');
  b = await createOrg(db, 'B');
  adminA = await login(app, a.adminEmail);
  const adminB = await login(app, b.adminEmail);
  teamB = (await adminB.post('/teams', { name: 'Equipo de B' })).body.id;
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

describe('aislamiento entre organizaciones (API)', () => {
  it('A no ve los usuarios, equipos ni catálogos de B', async () => {
    const users = await adminA.get('/users?pageSize=200');
    const userIds = users.body.items.map((u: { id: string }) => u.id);
    expect(userIds).toContain(a.adminUserId);
    expect(userIds).not.toContain(b.adminUserId);
    const teams = await adminA.get('/teams?pageSize=200');
    expect(teams.body.items.map((t: { id: string }) => t.id)).not.toContain(teamB);
    const priorities = await adminA.get('/catalogs/priorities');
    expect(priorities.body).toHaveLength(4);
  });

  it('A no lee, edita ni borra un registro de B aunque conozca su id', async () => {
    expect((await adminA.get(`/teams/${teamB}`)).status).toBe(404);
    expect((await adminA.patch(`/teams/${teamB}`, { name: 'Robado' })).status).toBe(404);
    expect((await adminA.delete(`/teams/${teamB}`)).status).toBe(404);
    expect((await adminA.get(`/users/${b.adminUserId}`)).status).toBe(404);
    expect((await adminA.put(`/users/${b.adminUserId}/active`, { active: false })).status).toBe(
      404,
    );
    expect((await adminA.patch(`/roles/${b.roleIds.SALES}`, { permissions: [] })).status).toBe(404);
    const team = await db.team.findUnique({ where: { id: teamB } });
    expect(team?.name).toBe('Equipo de B');
    expect(team?.deletedAt).toBeNull();
  });

  it('A no puede asignar a su equipo un usuario de B ni dar a un usuario un rol de B', async () => {
    expect(
      (await adminA.post('/teams', { name: 'Mixto', memberIds: [b.adminUserId] })).status,
    ).toBe(400);
    const res = await adminA.post('/users', {
      name: 'Intruso',
      email: 'intruso@prueba.test',
      roleId: b.roleIds.ADMIN,
      password: 'Intruso12345',
    });
    expect(res.status).toBe(400);
  });
});

describe('Row-Level Security (segunda barrera, en la base de datos)', () => {
  const tables = [
    'teams',
    'team_members',
    'roles',
    'role_permissions',
    'pipelines',
    'stages',
    'priorities',
    'lead_sources',
    'loss_reasons',
    'document_types',
    'economic_sectors',
    'task_statuses',
    'custom_field_definitions',
    'sequences',
    'record_history',
    'audit_log',
    'notifications',
    'trash_entries',
  ];

  it('todas las tablas de organización tienen RLS activo', async () => {
    const rows = await db.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT relname, relrowsecurity FROM pg_class WHERE relname = ANY(${tables}) AND relkind = 'r'`;
    expect(rows).toHaveLength(tables.length);
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
  });

  it('sin organización en contexto, el rol de la app no ve filas', async () => {
    const appDb = app.get(Db).client;
    expect(await appDb.team.count()).toBe(0);
    expect(await appDb.role.count()).toBe(0);
  });

  it('con la organización A, una consulta sin filtro solo devuelve filas de A', async () => {
    const appDb = app.get(Db);
    const roles = await appDb.withOrg(a.organizationId, () => appDb.tx.role.findMany());
    expect(roles.length).toBe(3);
    expect(roles.every((r) => r.organizationId === a.organizationId)).toBe(true);
  });

  it('con la organización A, no se pueden escribir filas de B', async () => {
    const appDb = app.get(Db);
    await expect(
      appDb.withOrg(a.organizationId, () =>
        appDb.tx.leadSource.create({
          data: { organizationId: b.organizationId, name: 'Inyectado' },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      appDb.withOrg(a.organizationId, () =>
        appDb.tx.team.updateMany({ where: { id: teamB }, data: { name: 'Robado' } }),
      ),
    ).resolves.toEqual({ count: 0 });
  });

  it('el historial y la auditoría son solo de inserción para la app', async () => {
    const appDb = app.get(Db);
    await expect(
      appDb.withOrg(a.organizationId, () => appDb.tx.auditLog.deleteMany({})),
    ).rejects.toThrow(/permission denied/);
    await expect(
      appDb.withOrg(a.organizationId, () =>
        appDb.tx.recordHistory.updateMany({ data: { action: 'X' } }),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
