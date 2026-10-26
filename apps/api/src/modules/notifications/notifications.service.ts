import { Injectable } from '@nestjs/common';
import type { EntityType } from '@crm/shared';
import { Db } from '../../infra/db';

export interface NewNotification {
  userId: string;
  type: string;
  title: string;
  link?: string;
  entityType?: EntityType;
  entityId?: string;
}

/** Notificaciones internas (D-16). Se generan como consecuencia directa de una acción. */
@Injectable()
export class NotificationsService {
  constructor(private readonly db: Db) {}

  async notify(items: NewNotification[]): Promise<void> {
    if (items.length === 0) return;
    await this.db.tx.notification.createMany({
      data: items.map((n) => ({ ...n, organizationId: this.db.organizationId })),
    });
  }

  async list(userId: string, unreadOnly: boolean) {
    const where = {
      organizationId: this.db.organizationId,
      userId,
      ...(unreadOnly ? { readAt: null } : {}),
    };
    const [items, unread] = await Promise.all([
      this.db.tx.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.db.tx.notification.count({
        where: { organizationId: this.db.organizationId, userId, readAt: null },
      }),
    ]);
    return { items, unread };
  }

  async markRead(userId: string, id?: string): Promise<void> {
    await this.db.tx.notification.updateMany({
      where: {
        organizationId: this.db.organizationId,
        userId,
        readAt: null,
        ...(id ? { id } : {}),
      },
      data: { readAt: new Date() },
    });
  }
}
