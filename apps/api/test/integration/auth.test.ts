import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MailService } from '../../src/infra/mail.service';
import { PASSWORD, anon, createApp, createOrg, login, ownerDb, type TestOrg } from './helpers';

let app: INestApplication;
let db: PrismaClient;
let org: TestOrg;

beforeAll(async () => {
  db = ownerDb();
  app = await createApp();
  org = await createOrg(db, 'Auth');
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

describe('autenticación', () => {
  it('inicia sesión, devuelve el usuario y cierra sesión revocando la cookie', async () => {
    const agent = await login(app, org.adminEmail);
    const me = await agent.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(org.adminEmail);
    expect(me.body.roleKey).toBe('ADMIN');
    expect(me.body.sessionId).toBeUndefined();

    expect((await agent.post('/auth/logout')).status).toBe(200);
    expect((await agent.get('/auth/me')).status).toBe(401);
  });

  it('acepta el correo en mayúsculas', async () => {
    await expect(login(app, org.adminEmail.toUpperCase())).resolves.toBeDefined();
  });

  it('rechaza credenciales inválidas con un mensaje genérico', async () => {
    const res = await anon(app).post('/auth/login', {
      email: org.adminEmail,
      password: 'incorrecta1',
    });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Correo o contraseña incorrectos.');
    const unknown = await anon(app).post('/auth/login', {
      email: 'nadie@prueba.test',
      password: 'incorrecta1',
    });
    expect(unknown.status).toBe(401);
    expect(unknown.body.message).toBe(res.body.message);
  });

  it('bloquea la cuenta 15 minutos tras 5 intentos fallidos', async () => {
    const user = await org.addUser('SALES');
    for (let i = 0; i < 5; i++) {
      expect(
        (await anon(app).post('/auth/login', { email: user.email, password: 'incorrecta1' }))
          .status,
      ).toBe(401);
    }
    const locked = await anon(app).post('/auth/login', { email: user.email, password: PASSWORD });
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    const audit = await db.auditLog.findMany({ where: { userId: user.id, event: 'LOGIN_LOCKED' } });
    expect(audit).toHaveLength(1);
  });

  it('no deja entrar a un usuario desactivado', async () => {
    const user = await org.addUser('SALES', { active: false });
    const res = await anon(app).post('/auth/login', { email: user.email, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('USER_INACTIVE');
  });

  it('exige la cabecera anti-CSRF en peticiones que modifican', async () => {
    const res = await anon(app)
      .raw.post('/api/v1/auth/login')
      .send({ email: org.adminEmail, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF');
  });

  it('la cookie de sesión es httpOnly y SameSite=Lax', async () => {
    const res = await anon(app).post('/auth/login', { email: org.adminEmail, password: PASSWORD });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain('crm_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('recupera la contraseña con un enlace de un solo uso y cierra las sesiones abiertas', async () => {
    const user = await org.addUser('SALES');
    const session = await login(app, user.email);
    const mail = app.get(MailService);
    mail.outbox.length = 0;

    const forgot = await anon(app).post('/auth/forgot-password', { email: user.email });
    expect(forgot.status).toBe(200);
    const unknown = await anon(app).post('/auth/forgot-password', { email: 'nadie@prueba.test' });
    expect(unknown.body.message).toBe(forgot.body.message);
    expect(mail.outbox).toHaveLength(1);
    const token = decodeURIComponent(/token=([^\s]+)/.exec(mail.outbox[0]?.text ?? '')?.[1] ?? '');

    const reset = await anon(app).post('/auth/reset-password', {
      token,
      password: 'NuevaClave123',
    });
    expect(reset.status).toBe(200);
    expect((await session.get('/auth/me')).status).toBe(401);
    const reuse = await anon(app).post('/auth/reset-password', {
      token,
      password: 'OtraClave1234',
    });
    expect(reuse.status).toBe(400);
    await expect(login(app, user.email, 'NuevaClave123')).resolves.toBeDefined();
  });

  it('cambia la contraseña validando la actual y cierra las demás sesiones', async () => {
    const user = await org.addUser('SALES');
    const a = await login(app, user.email);
    const b = await login(app, user.email);
    const wrong = await a.post('/auth/change-password', {
      currentPassword: 'x',
      newPassword: 'Cambiada1234',
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.details.currentPassword).toBeDefined();
    const ok = await a.post('/auth/change-password', {
      currentPassword: PASSWORD,
      newPassword: 'Cambiada1234',
    });
    expect(ok.status).toBe(200);
    expect((await a.get('/auth/me')).status).toBe(200);
    expect((await b.get('/auth/me')).status).toBe(401);
  });

  it('valida la política de contraseñas', async () => {
    const agent = await login(app, org.adminEmail);
    const res = await agent.post('/users', {
      name: 'Débil',
      email: 'debil@prueba.test',
      roleId: org.roleIds.SALES,
      password: 'corta',
    });
    expect(res.status).toBe(400);
    expect(res.body.details.password).toMatch(/al menos 10/);
  });
});
