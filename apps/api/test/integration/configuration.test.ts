import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Db } from '../../src/infra/db';
import { SequenceService } from '../../src/modules/sequences/sequence.service';
import { CustomFieldsService } from '../../src/modules/custom-fields/custom-fields.service';
import { createApp, createOrg, login, ownerDb, type Agent, type TestOrg } from './helpers';

let app: INestApplication;
let db: PrismaClient;
let org: TestOrg;
let admin: Agent;

beforeAll(async () => {
  db = ownerDb();
  app = await createApp();
  org = await createOrg(db, 'Config');
  admin = await login(app, org.adminEmail);
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

describe('organización y parámetros', () => {
  it('actualiza parámetros, valida rangos y registra historial y auditoría', async () => {
    const res = await admin.patch('/organization', {
      name: 'Config SAC',
      settings: { trashRetentionDays: 30 },
    });
    expect(res.status).toBe(200);
    expect(res.body.settings.trashRetentionDays).toBe(30);
    expect(res.body.settings.timezone).toBe('America/Lima');

    const bad = await admin.patch('/organization', { settings: { trashRetentionDays: 1 } });
    expect(bad.status).toBe(400);
    expect(bad.body.details['settings.trashRetentionDays']).toBe('Mínimo 7 días.');
    const badRuc = await admin.patch('/organization', { taxId: '123' });
    expect(badRuc.body.details.taxId).toBe('El RUC debe tener 11 dígitos.');

    const history = await admin.get(`/history/ORGANIZATION/${org.organizationId}`);
    expect(history.body[0].changes).toMatchObject({
      name: { to: 'Config SAC' },
      'settings.trashRetentionDays': { from: 90, to: 30 },
    });
    const audit = await admin.get('/audit?event=SETTINGS_CHANGED');
    expect(audit.body.total).toBe(1);
  });
});

describe('catálogos', () => {
  it('crea valores, impide duplicados y no permite borrar: solo desactivar', async () => {
    const created = await admin.post('/catalogs/lead-sources', { name: 'Feria' });
    expect(created.status).toBe(201);
    expect((await admin.post('/catalogs/lead-sources', { name: 'Feria' })).status).toBe(409);
    expect((await admin.delete(`/catalogs/lead-sources/${created.body.id}`)).status).toBe(404);

    await admin.put(`/catalogs/lead-sources/${created.body.id}/active`, { active: false });
    const active = await admin.get('/catalogs/lead-sources');
    expect(active.body.map((s: { name: string }) => s.name)).not.toContain('Feria');
    const all = await admin.get('/catalogs/lead-sources?includeInactive=true');
    expect(all.body.map((s: { name: string }) => s.name)).toContain('Feria');
  });

  it('mantiene exactamente una prioridad por defecto', async () => {
    const list = (await admin.get('/catalogs/priorities')).body as {
      id: string;
      name: string;
      isDefault: boolean;
    }[];
    const media = list.find((p) => p.name === 'Media');
    const alta = list.find((p) => p.name === 'Alta');
    expect(media?.isDefault).toBe(true);
    expect(
      (await admin.put(`/catalogs/priorities/${media?.id}/active`, { active: false })).status,
    ).toBe(409);
    expect(
      (await admin.patch(`/catalogs/priorities/${media?.id}`, { isDefault: false })).status,
    ).toBe(409);
    await admin.patch(`/catalogs/priorities/${alta?.id}`, { isDefault: true });
    const after = (await admin.get('/catalogs/priorities')).body as {
      name: string;
      isDefault: boolean;
    }[];
    expect(after.filter((p) => p.isDefault).map((p) => p.name)).toEqual(['Alta']);
  });

  it('valida colores y deja al menos un estado de tarea pendiente y uno completado', async () => {
    expect(
      (
        await admin.post('/catalogs/priorities', {
          name: 'X',
          color: 'rojo',
          icon: 'flag',
          rank: 1,
        })
      ).status,
    ).toBe(400);
    const statuses = (await admin.get('/catalogs/task-statuses')).body as {
      id: string;
      category: string;
    }[];
    const done = statuses.find((s) => s.category === 'DONE');
    expect(
      (await admin.put(`/catalogs/task-statuses/${done?.id}/active`, { active: false })).status,
    ).toBe(409);
  });

  it('valida la expresión regular de los tipos de documento', async () => {
    const res = await admin.post('/catalogs/document-types', {
      code: 'X',
      name: 'X',
      pattern: '([',
    });
    expect(res.status).toBe(400);
    expect(res.body.details.pattern).toBe('Expresión regular no válida.');
  });
});

describe('pipelines y etapas', () => {
  const stages = [
    { name: 'Inicio', color: '#64748B', kind: 'OPEN' },
    { name: 'Ganada', color: '#16A34A', kind: 'WON' },
    { name: 'Perdida', color: '#DC2626', kind: 'LOST' },
  ];

  it('exige etapas en curso, ganada y perdida; y tipos válidos por entidad', async () => {
    const noWon = await admin.post('/pipelines', {
      entityType: 'DEAL',
      name: 'Incompleto',
      stages: stages.filter((s) => s.kind !== 'WON'),
    });
    expect(noWon.status).toBe(400);
    const leadWon = await admin.post('/pipelines', { entityType: 'LEAD', name: 'Raro', stages });
    expect(leadWon.status).toBe(400);
  });

  it('reordena, agrega y desactiva etapas, pero no permite quitarlas', async () => {
    const created = await admin.post('/pipelines', {
      entityType: 'DEAL',
      name: 'Proyectos',
      stages,
    });
    expect(created.status).toBe(201);
    expect(created.body.isDefault).toBe(false);
    const [inicio, ganada, perdida] = created.body.stages;

    const reordered = await admin.put(`/pipelines/${created.body.id}`, {
      entityType: 'DEAL',
      name: 'Proyectos',
      stages: [
        { name: 'Diagnóstico', color: '#0891B2', kind: 'OPEN' },
        { ...inicio, active: false },
        ganada,
        perdida,
      ],
    });
    expect(reordered.status).toBe(200);
    expect(reordered.body.stages.map((s: { name: string }) => s.name)).toEqual([
      'Diagnóstico',
      'Inicio',
      'Ganada',
      'Perdida',
    ]);

    const removed = await admin.put(`/pipelines/${created.body.id}`, {
      entityType: 'DEAL',
      name: 'Proyectos',
      stages: [ganada, perdida, { name: 'Abierta', color: '#000000', kind: 'OPEN' }],
    });
    expect(removed.status).toBe(409);
    expect(removed.body.message).toMatch(/desactive/);
  });

  it('el pipeline por defecto no se puede desactivar', async () => {
    const list = (await admin.get('/pipelines?entityType=LEAD')).body as {
      id: string;
      isDefault: boolean;
    }[];
    const def = list.find((p) => p.isDefault);
    expect((await admin.put(`/pipelines/${def?.id}/active`, { active: false })).status).toBe(409);
  });
});

describe('campos personalizados', () => {
  it('define campos y valida valores según su tipo', async () => {
    const select = await admin.post('/custom-fields', {
      entityType: 'CONTACT',
      key: 'canal_preferido',
      label: 'Canal preferido',
      type: 'SELECT',
      options: [
        { value: 'correo', label: 'Correo' },
        { value: 'llamada', label: 'Llamada' },
      ],
      required: true,
    });
    expect(select.status).toBe(201);
    expect(
      (await admin.post('/custom-fields', { ...select.body, options: [], key: 'canal_preferido' }))
        .status,
    ).toBe(400);
    await admin.post('/custom-fields', {
      entityType: 'CONTACT',
      key: 'cumple',
      label: 'Cumpleaños',
      type: 'DATE',
    });

    const dbs = app.get(Db);
    const fields = app.get(CustomFieldsService);
    const ok = await dbs.withOrg(org.organizationId, () =>
      fields.validate('CONTACT', {
        canal_preferido: 'correo',
        cumple: '1990-05-20',
        desconocido: 'x',
      }),
    );
    expect(ok).toEqual({ canal_preferido: 'correo', cumple: '1990-05-20' });
    await expect(
      dbs.withOrg(org.organizationId, () => fields.validate('CONTACT', { cumple: '20/05/1990' })),
    ).rejects.toMatchObject({
      details: {
        'customFields.canal_preferido': 'Canal preferido es obligatorio.',
        'customFields.cumple': 'Cumpleaños: fecha inválida (aaaa-mm-dd).',
      },
    });
  });

  it('no permite claves repetidas en el mismo módulo', async () => {
    const body = { entityType: 'COMPANY', key: 'tamano', label: 'Tamaño', type: 'NUMBER' };
    expect((await admin.post('/custom-fields', body)).status).toBe(201);
    expect((await admin.post('/custom-fields', body)).status).toBe(409);
  });
});

describe('códigos correlativos', () => {
  it('no repite números aunque se pidan en paralelo', async () => {
    const dbs = app.get(Db);
    const seq = app.get(SequenceService);
    const codes = await Promise.all(
      Array.from({ length: 15 }, () => dbs.withOrg(org.organizationId, () => seq.next('LEAD'))),
    );
    expect(new Set(codes).size).toBe(15);
    expect([...codes].sort()[0]).toBe('PRO-000001');
    expect([...codes].sort()[14]).toBe('PRO-000015');
  });
});

describe('usuarios y equipos', () => {
  it('crea un usuario con equipos, registra historial y lo muestra en el equipo', async () => {
    const team = (await admin.post('/teams', { name: 'Ventas Norte' })).body;
    const user = await admin.post('/users', {
      name: 'Nora Norte',
      email: 'NORA@prueba.test',
      roleId: org.roleIds.SALES,
      password: 'NoraNorte123',
      teamIds: [team.id],
    });
    expect(user.status).toBe(201);
    expect(user.body.email).toBe('nora@prueba.test');
    expect(user.body.teams).toEqual([{ id: team.id, name: 'Ventas Norte' }]);
    expect(
      (await admin.get(`/teams/${team.id}`)).body.members.map((m: { id: string }) => m.id),
    ).toEqual([user.body.id]);
    expect(
      (
        await admin.post('/users', {
          name: 'Otra',
          email: 'nora@prueba.test',
          roleId: org.roleIds.SALES,
          password: 'NoraNorte123',
        })
      ).status,
    ).toBe(409);

    await admin.patch(`/users/${user.body.id}`, { name: 'Nora N.' });
    const history = await admin.get(`/history/USER/${user.body.id}`);
    expect(history.body[0]).toMatchObject({
      action: 'UPDATE',
      changes: { name: { from: 'Nora Norte', to: 'Nora N.' } },
    });
  });

  it('un nombre de equipo no se repite entre equipos vigentes', async () => {
    await admin.post('/teams', { name: 'Único' });
    expect((await admin.post('/teams', { name: 'único' })).status).toBe(409);
  });
});
