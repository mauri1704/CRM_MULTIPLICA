import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent';
import { AppModule } from '../../src/app.module';
import { API_PREFIX, configureApp } from '../../src/bootstrap-app';
import { hashPassword } from '../../src/modules/auth/password';
import {
  bootstrapOrganization,
  type BootstrapResult,
} from '../../src/modules/bootstrap/bootstrap-organization';

export const PASSWORD = 'Prueba12345';

export async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

/** Cliente con el rol dueño (sin RLS): solo para preparar datos en las pruebas. */
export const ownerDb = () => new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

export interface TestOrg extends BootstrapResult {
  adminEmail: string;
  /** Crea un usuario con el rol indicado y devuelve su correo. */
  addUser(
    role: keyof BootstrapResult['roleIds'],
    opts?: { teamId?: string; active?: boolean },
  ): Promise<{ id: string; email: string }>;
}

export async function createOrg(db: PrismaClient, name = 'Org'): Promise<TestOrg> {
  const tag = randomUUID().slice(0, 8);
  const adminEmail = `admin-${tag}@prueba.test`;
  const result = await bootstrapOrganization(db, {
    name: `${name} ${tag}`,
    admin: { name: 'Admin Prueba', email: adminEmail, password: PASSWORD },
  });
  const passwordHash = await hashPassword(PASSWORD);
  return {
    ...result,
    adminEmail,
    async addUser(role, opts = {}) {
      const email = `${role.toLowerCase()}-${randomUUID().slice(0, 8)}@prueba.test`;
      const user = await db.user.create({
        data: {
          organizationId: result.organizationId,
          name: `${role} ${email.slice(0, 12)}`,
          email,
          passwordHash,
          roleId: result.roleIds[role],
          active: opts.active ?? true,
        },
      });
      if (opts.teamId) {
        await db.teamMember.create({
          data: { organizationId: result.organizationId, teamId: opts.teamId, userId: user.id },
        });
      }
      return { id: user.id, email };
    },
  };
}

/** Agente con cookie de sesión y la cabecera anti-CSRF ya puesta. */
export async function login(
  app: INestApplication,
  email: string,
  password = PASSWORD,
): Promise<Agent> {
  const agent = request.agent(app.getHttpServer());
  const res = await agent
    .post(`/${API_PREFIX}/auth/login`)
    .set('x-crm-request', '1')
    .send({ email, password });
  if (res.status !== 200)
    throw new Error(`Login falló (${res.status}): ${JSON.stringify(res.body)}`);
  return wrap(agent);
}

export type Agent = ReturnType<typeof wrap>;

function wrap(agent: TestAgent) {
  const url = (path: string) => `/${API_PREFIX}${path}`;
  return {
    raw: agent,
    get: (path: string) => agent.get(url(path)),
    post: (path: string, body?: object) =>
      agent.post(url(path)).set('x-crm-request', '1').send(body),
    patch: (path: string, body?: object) =>
      agent.patch(url(path)).set('x-crm-request', '1').send(body),
    put: (path: string, body?: object) => agent.put(url(path)).set('x-crm-request', '1').send(body),
    delete: (path: string, body?: object) =>
      agent.delete(url(path)).set('x-crm-request', '1').send(body),
  };
}

export const anon = (app: INestApplication) => wrap(request.agent(app.getHttpServer()));
