import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, createOrg, login, ownerDb, type TestOrg } from './helpers';

let app: INestApplication;
let db: PrismaClient;
let org: TestOrg;

beforeAll(async () => {
  db = ownerDb();
  app = await createApp();
  org = await createOrg(db, 'Permisos');
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

describe('permisos validados en el backend', () => {
  it('un Comercial no administra usuarios, roles, equipos ni configuración (aunque llame a la URL)', async () => {
    const sales = await org.addUser('SALES');
    const agent = await login(app, sales.email);
    expect((await agent.get('/users')).status).toBe(403);
    expect((await agent.get(`/users/${org.adminUserId}`)).status).toBe(403);
    expect((await agent.post('/users', {})).status).toBe(403);
    expect((await agent.get('/roles')).status).toBe(403);
    expect((await agent.patch(`/roles/${org.roleIds.SALES}`, { permissions: [] })).status).toBe(
      403,
    );
    expect((await agent.post('/teams', { name: 'Hackers' })).status).toBe(403);
    expect((await agent.patch('/organization', { name: 'X' })).status).toBe(403);
    expect((await agent.post('/catalogs/lead-sources', { name: 'X' })).status).toBe(403);
    expect((await agent.get('/audit')).status).toBe(403);
    // Lo que todos necesitan para trabajar sí está disponible.
    expect((await agent.get('/users/options')).status).toBe(200);
    expect((await agent.get('/catalogs/priorities')).status).toBe(200);
    expect((await agent.get('/pipelines')).status).toBe(200);
    expect((await agent.get('/organization')).status).toBe(200);
  });

  it('expone los permisos efectivos en /auth/me', async () => {
    const sales = await org.addUser('SALES');
    const me = await (await login(app, sales.email)).get('/auth/me');
    expect(me.body.permissions.leads.view).toBe('OWN');
    expect(me.body.permissions.contacts.view).toBe('ALL');
    expect(me.body.permissions.users).toBeUndefined();
    expect(me.body.permissions.leads.import).toBeUndefined();
  });

  it('el rol Administrador no se puede modificar ni eliminar', async () => {
    const admin = await login(app, org.adminEmail);
    expect((await admin.patch(`/roles/${org.roleIds.ADMIN}`, { permissions: [] })).status).toBe(
      409,
    );
    expect((await admin.delete(`/roles/${org.roleIds.SALES}`)).status).toBe(409);
  });

  it('un cambio de permisos se aplica en la siguiente petición y queda auditado', async () => {
    const sup = await org.addUser('SUPERVISOR');
    const agent = await login(app, sup.email);
    expect((await agent.get('/users')).status).toBe(403);

    const admin = await login(app, org.adminEmail);
    const role = (await admin.get(`/roles/${org.roleIds.SUPERVISOR}`)).body;
    const res = await admin.patch(`/roles/${org.roleIds.SUPERVISOR}`, {
      permissions: [...role.permissions, { module: 'users', action: 'view', scope: 'ALL' }],
    });
    expect(res.status).toBe(200);
    expect((await agent.get('/users')).status).toBe(200);

    const audit = await db.auditLog.findFirst({
      where: { organizationId: org.organizationId, event: 'PERMISSIONS_CHANGED' },
    });
    expect(audit?.details).toMatchObject({
      changes: { 'users.view': { from: 'NONE', to: 'ALL' } },
    });
  });

  it('rechaza alcances "propios/equipo" en módulos administrativos', async () => {
    const admin = await login(app, org.adminEmail);
    const res = await admin.post('/roles', {
      name: 'Raro',
      permissions: [{ module: 'settings', action: 'manage', scope: 'OWN' }],
    });
    expect(res.status).toBe(400);
  });

  it('crea, usa y elimina un rol personalizado (solo si no tiene usuarios)', async () => {
    const admin = await login(app, org.adminEmail);
    const created = await admin.post('/roles', {
      name: 'Auditor',
      permissions: [{ module: 'audit', action: 'view', scope: 'ALL' }],
    });
    expect(created.status).toBe(201);
    const user = await admin.post('/users', {
      name: 'Ana Auditora',
      email: 'auditora@prueba.test',
      roleId: created.body.id,
      password: 'Auditora1234',
    });
    expect(user.status).toBe(201);
    const auditor = await login(app, 'auditora@prueba.test', 'Auditora1234');
    expect((await auditor.get('/audit')).status).toBe(200);
    expect((await auditor.get('/users')).status).toBe(403);

    expect((await admin.delete(`/roles/${created.body.id}`)).status).toBe(409);
    await admin.patch(`/users/${user.body.id}`, { roleId: org.roleIds.SALES });
    expect((await admin.delete(`/roles/${created.body.id}`)).status).toBe(200);
  });

  it('siempre queda al menos un administrador activo', async () => {
    const other = await createOrg(db, 'UnAdmin');
    const admin = await login(app, other.adminEmail);
    expect((await admin.put(`/users/${other.adminUserId}/active`, { active: false })).status).toBe(
      409,
    );
    expect(
      (await admin.patch(`/users/${other.adminUserId}`, { roleId: other.roleIds.SALES })).status,
    ).toBe(409);
  });

  it('desactivar un usuario cierra sus sesiones', async () => {
    const sales = await org.addUser('SALES');
    const agent = await login(app, sales.email);
    const admin = await login(app, org.adminEmail);
    expect((await admin.put(`/users/${sales.id}/active`, { active: false })).status).toBe(200);
    expect((await agent.get('/auth/me')).status).toBe(401);
  });

  it('cambiar el rol de un usuario cierra sus sesiones', async () => {
    const sales = await org.addUser('SALES');
    const agent = await login(app, sales.email);
    const admin = await login(app, org.adminEmail);
    expect(
      (await admin.patch(`/users/${sales.id}`, { roleId: org.roleIds.SUPERVISOR })).status,
    ).toBe(200);
    expect((await agent.get('/auth/me')).status).toBe(401);
  });
});
