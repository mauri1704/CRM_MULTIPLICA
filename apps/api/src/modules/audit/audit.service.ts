import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuditEvent, EntityType } from '@crm/shared';
import { Db } from '../../infra/db';

export interface AuditEntry {
  userId?: string | null;
  entityType?: EntityType;
  entityId?: string;
  ip?: string;
  details?: Record<string, unknown>;
}

export interface AuditQuery {
  event?: string;
  userId?: string;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

/** Registro de eventos sensibles. Solo inserción (el rol de la app no puede editarlo ni borrarlo). */
@Injectable()
export class AuditService {
  constructor(private readonly db: Db) {}

  /** Debe llamarse dentro de withOrg (las peticiones autenticadas ya lo están). */
  async log(event: AuditEvent, entry: AuditEntry = {}): Promise<void> {
    await this.db.tx.auditLog.create({
      data: {
        organizationId: this.db.organizationId,
        event,
        userId: entry.userId ?? null,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        ip: entry.ip ?? null,
        details: (entry.details ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  /** Para eventos fuera de una petición autenticada (login, recuperación de clave). */
  async logFor(organizationId: string, event: AuditEvent, entry: AuditEntry = {}): Promise<void> {
    await this.db.withOrg(organizationId, () => this.log(event, entry));
  }

  async list(q: AuditQuery) {
    const where: Prisma.AuditLogWhereInput = {
      organizationId: this.db.organizationId,
      ...(q.event ? { event: q.event } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.from || q.to ? { createdAt: { gte: q.from, lte: q.to } } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.tx.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.tx.auditLog.count({ where }),
    ]);
    const userIds = [...new Set(items.map((i) => i.userId).filter((u): u is string => !!u))];
    const users = await this.db.q.user.findMany({
      where: { id: { in: userIds }, organizationId: this.db.organizationId },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return {
      items: items.map((i) => ({
        ...i,
        userName: i.userId ? (names.get(i.userId) ?? null) : null,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
}
