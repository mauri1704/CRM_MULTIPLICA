import { Injectable } from '@nestjs/common';
import type { CommentInput, CommentTarget } from '@crm/shared';
import type { AuthUser } from '../../common/auth.types';
import { forbidden, notFound, validationError } from '../../common/errors';
import { Db } from '../../infra/db';
import { CrmRecordsService } from '../access/crm-records.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TasksService } from '../tasks/tasks.service';

const FIELD = {
  LEAD: 'leadId',
  DEAL: 'dealId',
  CONTACT: 'contactId',
  COMPANY: 'companyId',
  TASK: 'taskId',
} as const;
const PATH = {
  LEAD: '/prospectos',
  DEAL: '/negociaciones',
  CONTACT: '/contactos',
  COMPANY: '/companias',
  TASK: '/tareas',
} as const;

/** Comentarios en fichas. Quien puede ver el registro puede comentarlo; cada uno edita los suyos. */
@Injectable()
export class CommentsService {
  constructor(
    private readonly db: Db,
    private readonly notifications: NotificationsService,
    private readonly tasks: TasksService,
    private readonly crm: CrmRecordsService,
  ) {}

  /** Comprueba que el registro existe, está vigente y lo puede ver; devuelve su nombre. */
  private async target(user: AuthUser, type: CommentTarget, id: string): Promise<string> {
    // Tareas: la ven responsable, participantes, observadores y el alcance del rol (T-02).
    if (type === 'TASK') return (await this.tasks.assertVisible(user, id)).name;
    return this.crm.assertVisible(user, type, id);
  }

  async list(user: AuthUser, type: CommentTarget, id: string) {
    await this.target(user, type, id);
    const rows = await this.db.tx.comment.findMany({
      where: { organizationId: user.organizationId, [FIELD[type]]: id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const users = await this.db.q.user.findMany({
      where: {
        organizationId: user.organizationId,
        id: { in: [...new Set(rows.flatMap((r) => [r.authorId, ...r.mentions]))] },
      },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({
      id: r.id,
      body: r.body,
      author: { id: r.authorId, name: names.get(r.authorId) ?? '—' },
      mentions: r.mentions.map((m) => ({ id: m, name: names.get(m) ?? '—' })),
      editedAt: r.editedAt,
      createdAt: r.createdAt,
      mine: r.authorId === user.id,
    }));
  }

  async create(user: AuthUser, type: CommentTarget, id: string, input: CommentInput) {
    const name = await this.target(user, type, id);
    const mentions = [...new Set(input.mentions)].filter((m) => m !== user.id);
    if (mentions.length > 0) {
      const n = await this.db.q.user.count({
        where: { id: { in: mentions }, organizationId: user.organizationId, active: true },
      });
      if (n !== mentions.length)
        throw validationError({ mentions: 'Algún usuario mencionado no existe o está inactivo.' });
    }
    const c = await this.db.tx.comment.create({
      data: {
        organizationId: user.organizationId,
        [FIELD[type]]: id,
        body: input.body,
        authorId: user.id,
        mentions,
      },
    });
    // Notificación interna como consecuencia directa de la mención (D-16).
    await this.notifications.notify(
      mentions.map((userId) => ({
        userId,
        type: 'MENTION',
        title: `${user.name} lo mencionó en ${name}`,
        link: `${PATH[type]}?id=${id}`,
        entityType: type,
        entityId: id,
      })),
    );
    return c;
  }

  private async own(user: AuthUser, commentId: string) {
    const c = await this.db.tx.comment.findFirst({
      where: { id: commentId, organizationId: user.organizationId, deletedAt: null },
    });
    if (!c) throw notFound('El comentario');
    if (c.authorId !== user.id) throw forbidden('Solo el autor puede modificar su comentario.');
    return c;
  }

  async update(user: AuthUser, commentId: string, body: string) {
    await this.own(user, commentId);
    return this.db.tx.comment.update({
      where: { id: commentId },
      data: { body, editedAt: new Date() },
    });
  }

  async remove(user: AuthUser, commentId: string) {
    await this.own(user, commentId);
    await this.db.tx.comment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
  }
}
