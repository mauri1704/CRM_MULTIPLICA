import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { env } from './env';

interface OrgContext {
  organizationId: string;
  tx: Prisma.TransactionClient;
}

/**
 * Acceso a la base de datos.
 *
 * - Se conecta con `APP_DATABASE_URL` (rol `crm_app`, sujeto a Row-Level Security).
 * - Las tablas con RLS solo se leen/escriben dentro de `withOrg(organizationId, fn)`, que abre una
 *   transacción y fija `app.organization_id` (SET LOCAL). Fuera de ella, Postgres no devuelve filas.
 * - Cada petición autenticada corre entera dentro de `withOrg` (TenantInterceptor): todo lo que
 *   hace una petición se confirma o se revierte junto.
 * - Los repositorios filtran además por `organizationId` en el `where`: doble barrera.
 */
@Injectable()
export class Db implements OnModuleDestroy {
  readonly client: PrismaClient;
  private readonly als = new AsyncLocalStorage<OrgContext>();

  constructor() {
    this.client = new PrismaClient({
      datasourceUrl: env().APP_DATABASE_URL,
      log: env().NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  /** Transacción actual de la organización. Lanza si se usa fuera de `withOrg`. */
  get tx(): Prisma.TransactionClient {
    const ctx = this.als.getStore();
    if (!ctx) throw new Error('Acceso a datos de organización fuera de withOrg().');
    return ctx.tx;
  }

  /** Transacción actual si existe; si no, el cliente. Solo para tablas sin RLS (users, sessions…). */
  get q(): Prisma.TransactionClient | PrismaClient {
    return this.als.getStore()?.tx ?? this.client;
  }

  get organizationId(): string {
    const ctx = this.als.getStore();
    if (!ctx) throw new Error('Sin organización en contexto.');
    return ctx.organizationId;
  }

  get inOrgContext(): boolean {
    return this.als.getStore() !== undefined;
  }

  async withOrg<T>(
    organizationId: string,
    fn: () => Promise<T>,
    opts?: { timeout?: number },
  ): Promise<T> {
    const current = this.als.getStore();
    if (current) {
      if (current.organizationId !== organizationId) {
        throw new Error('withOrg anidado con otra organización.');
      }
      return fn();
    }
    return this.client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
        return this.als.run({ organizationId, tx }, fn);
      },
      { timeout: opts?.timeout ?? 20_000, maxWait: 5_000 },
    );
  }
}
