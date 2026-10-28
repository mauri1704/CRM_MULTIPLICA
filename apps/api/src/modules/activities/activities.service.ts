import { Injectable } from '@nestjs/common';
import type { ActivityInput, ActivityTarget, ActivityType, ActivityUpdate } from '@crm/shared';
import type { AuthUser } from '../../common/auth.types';
import { forbidden, notFound } from '../../common/errors';
import { Db } from '../../infra/db';
import { CRM_FIELD, CrmRecordsService } from '../access/crm-records.service';

/**
 * Actividades (D-23): llamadas, reuniones, correos y notas registradas a mano en la línea de
 * tiempo de una ficha. Quien puede ver el registro puede registrarlas; cada autor edita las suyas.
 */
@Injectable()
export class ActivitiesService {
  constructor(
    private readonly db: Db,
    private readonly crm: CrmRecordsService,
  ) {}

  async list(user: AuthUser, type: ActivityTarget, id: string) {
    await this.crm.assertVisible(user, type, id);
    const rows = await this.db.tx.activity.findMany({
      where: { organizationId: user.organizationId, [CRM_FIELD[type]]: id, deletedAt: null },
      include: { author: { select: { id: true, name: true } } },
      orderBy: { occurredAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      type: r.type as ActivityType,
      subject: r.subject,
      notes: r.notes,
      occurredAt: r.occurredAt,
      author: r.author,
      editedAt: r.editedAt,
      createdAt: r.createdAt,
      mine: r.authorId === user.id,
    }));
  }

  async create(user: AuthUser, type: ActivityTarget, id: string, input: ActivityInput) {
    await this.crm.assertVisible(user, type, id);
    return this.db.tx.activity.create({
      data: {
        organizationId: user.organizationId,
        [CRM_FIELD[type]]: id,
        type: input.type,
        subject: input.subject,
        notes: input.notes ?? null,
        occurredAt: new Date(input.occurredAt),
        authorId: user.id,
      },
    });
  }

  private async own(user: AuthUser, activityId: string) {
    const a = await this.db.tx.activity.findFirst({
      where: { id: activityId, organizationId: user.organizationId, deletedAt: null },
    });
    if (!a) throw notFound('La actividad');
    if (a.authorId !== user.id)
      throw forbidden('Solo quien registró la actividad puede modificarla.');
    return a;
  }

  async update(user: AuthUser, activityId: string, input: ActivityUpdate) {
    await this.own(user, activityId);
    await this.db.tx.activity.updateMany({
      where: { id: activityId, organizationId: user.organizationId },
      data: {
        ...input,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : undefined,
        editedAt: new Date(),
      },
    });
  }

  async remove(user: AuthUser, activityId: string) {
    await this.own(user, activityId);
    await this.db.tx.activity.updateMany({
      where: { id: activityId, organizationId: user.organizationId },
      data: { deletedAt: new Date() },
    });
  }
}
