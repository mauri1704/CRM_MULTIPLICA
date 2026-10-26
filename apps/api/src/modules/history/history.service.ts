import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { EntityType, HistoryAction } from '@crm/shared';
import { Db } from '../../infra/db';

export type Changes = Record<string, { from: unknown; to: unknown }>;

function normalize(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Prisma.Decimal) return v.toString();
  return v ?? null;
}

/** Diferencias campo a campo entre dos versiones de un registro (solo los campos indicados). */
export function diff<T extends object>(
  before: T,
  after: Partial<T>,
  fields: readonly (keyof T)[],
): Changes {
  const changes: Changes = {};
  for (const f of fields) {
    if (!(f in after)) continue;
    const a = normalize(before[f]);
    const b = normalize(after[f]);
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[String(f)] = { from: a, to: b };
  }
  return changes;
}

/** Historial de cambios por registro. Solo inserción. */
@Injectable()
export class HistoryService {
  constructor(private readonly db: Db) {}

  newCorrelationId(): string {
    return randomUUID();
  }

  async record(
    entityType: EntityType,
    entityId: string,
    action: HistoryAction,
    userId: string | null,
    changes: Changes | Record<string, unknown> = {},
    correlationId?: string,
  ): Promise<void> {
    if (action === 'UPDATE' && Object.keys(changes).length === 0) return;
    await this.db.tx.recordHistory.create({
      data: {
        organizationId: this.db.organizationId,
        entityType,
        entityId,
        action,
        userId,
        changes: changes as Prisma.InputJsonValue,
        correlationId: correlationId ?? null,
      },
    });
  }

  async list(entityType: EntityType, entityId: string) {
    const items = await this.db.tx.recordHistory.findMany({
      where: { organizationId: this.db.organizationId, entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const userIds = [...new Set(items.map((i) => i.userId).filter((u): u is string => !!u))];
    const users = await this.db.q.user.findMany({
      where: { id: { in: userIds }, organizationId: this.db.organizationId },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return items.map((i) => ({ ...i, userName: i.userId ? (names.get(i.userId) ?? null) : null }));
  }
}
