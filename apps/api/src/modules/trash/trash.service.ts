import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SCOPE_RANK, scopeOf, type PermissionAction, type TrashableEntity } from '@crm/shared';
import type { Actor, AuthUser } from '../../common/auth.types';
import { AppError, conflict, forbidden, notFound } from '../../common/errors';
import { Db } from '../../infra/db';
import { AuditService } from '../audit/audit.service';
import { HistoryService } from '../history/history.service';
import { OrganizationSettingsService } from '../organization/organization-settings.service';
import type { TrashHandler, TrashSubject } from './trash.types';

export interface TrashListQuery {
  entityType?: TrashableEntity;
  q?: string;
  status: 'IN_TRASH' | 'RESTORED' | 'PURGED';
  page: number;
  pageSize: number;
}

export interface RestoreResult {
  restored: { id: string; entityType: string; entityId: string; displayName: string }[];
  conflicts: { id: string; displayName: string; reasons: string[] }[];
}

const DAY_MS = 86_400_000;

/** Papelera transversal: índice de registros eliminados lógicamente, restauración y purga. */
@Injectable()
export class TrashService {
  private readonly handlers = new Map<TrashableEntity, TrashHandler>();

  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly history: HistoryService,
    private readonly settings: OrganizationSettingsService,
  ) {}

  register(handler: TrashHandler): void {
    this.handlers.set(handler.entityType, handler);
  }

  private handler(entityType: string): TrashHandler {
    const h = this.handlers.get(entityType as TrashableEntity);
    if (!h) throw new Error(`Sin manejador de papelera para ${entityType}`);
    return h;
  }

  /**
   * Registra en la papelera un registro que el módulo ya marcó con deleted_at.
   * Debe llamarse en la misma transacción que la eliminación lógica.
   */
  async add(
    entityType: TrashableEntity,
    subject: TrashSubject,
    actor: Actor,
    cascadeGroupId?: string,
  ) {
    const { trashRetentionDays } = await this.settings.get();
    await this.db.tx.trashEntry.create({
      data: {
        organizationId: this.db.organizationId,
        entityType,
        entityId: subject.id,
        displayName: subject.displayName.slice(0, 300),
        code: subject.code ?? null,
        ownerId: subject.ownerId ?? null,
        deletedById: actor.userId,
        relations: (subject.relations ?? {}) as Prisma.InputJsonValue,
        purgeAfter: new Date(Date.now() + trashRetentionDays * DAY_MS),
        cascadeGroupId: cascadeGroupId ?? null,
      },
    });
    await this.history.record(entityType, subject.id, 'DELETE', actor.userId, {}, cascadeGroupId);
  }

  /** Filtro por alcance: propios = los que eliminó o de los que era responsable. */
  private async scopeWhere(
    user: AuthUser,
    action: PermissionAction,
  ): Promise<Prisma.TrashEntryWhereInput> {
    const scope = scopeOf(user.permissions, 'trash', action);
    if (scope === 'NONE') throw forbidden();
    if (scope === 'ALL') return {};
    let ids = [user.id];
    if (scope === 'TEAM') {
      const members = await this.db.tx.teamMember.findMany({
        where: { organizationId: user.organizationId, teamId: { in: user.teamIds } },
        select: { userId: true },
      });
      ids = [...new Set([user.id, ...members.map((m) => m.userId)])];
    }
    return { OR: [{ deletedById: { in: ids } }, { ownerId: { in: ids } }] };
  }

  /** Movimiento de la papelera por módulo, dentro del alcance del usuario (para reportes). */
  async stats(user: AuthUser, from: Date | null, to: Date | null) {
    const scope = await this.scopeWhere(user, 'view');
    const between = (field: 'deletedAt' | 'resolvedAt') =>
      from || to ? { [field]: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {};
    const count = async (extra: Prisma.TrashEntryWhereInput) =>
      new Map(
        (
          await this.db.tx.trashEntry.groupBy({
            by: ['entityType'],
            where: { AND: [{ organizationId: user.organizationId }, scope, extra] },
            _count: { _all: true },
          })
        ).map((r) => [r.entityType, r._count._all]),
      );
    const [deleted, restored, purged, inTrash] = await Promise.all([
      count(between('deletedAt')),
      count({ status: 'RESTORED', ...between('resolvedAt') }),
      count({ status: 'PURGED', ...between('resolvedAt') }),
      count({ status: 'IN_TRASH' }),
    ]);
    const types = new Set([
      ...deleted.keys(),
      ...restored.keys(),
      ...purged.keys(),
      ...inTrash.keys(),
    ]);
    return [...types].sort().map((entityType) => ({
      entityType,
      deleted: deleted.get(entityType) ?? 0,
      restored: restored.get(entityType) ?? 0,
      purged: purged.get(entityType) ?? 0,
      inTrash: inTrash.get(entityType) ?? 0,
    }));
  }

  async list(user: AuthUser, q: TrashListQuery) {
    const where: Prisma.TrashEntryWhereInput = {
      AND: [
        { organizationId: user.organizationId, status: q.status },
        q.entityType ? { entityType: q.entityType } : {},
        q.q
          ? {
              OR: [
                { displayName: { contains: q.q, mode: 'insensitive' } },
                { code: { contains: q.q, mode: 'insensitive' } },
                ...(/^[0-9a-f-]{36}$/i.test(q.q) ? [{ entityId: q.q }] : []),
              ],
            }
          : {},
        await this.scopeWhere(user, 'view'),
      ],
    };
    const [items, total] = await Promise.all([
      this.db.tx.trashEntry.findMany({
        where,
        orderBy: { deletedAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.tx.trashEntry.count({ where }),
    ]);
    const userIds = [
      ...new Set(
        items.flatMap((i) => [i.deletedById, i.resolvedById]).filter((u): u is string => !!u),
      ),
    ];
    const users = await this.db.q.user.findMany({
      where: { id: { in: userIds }, organizationId: user.organizationId },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return {
      items: items.map((i) => ({
        ...i,
        deletedByName: names.get(i.deletedById) ?? null,
        resolvedByName: i.resolvedById ? (names.get(i.resolvedById) ?? null) : null,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  private async findVisible(user: AuthUser, id: string, action: PermissionAction) {
    const entry = await this.db.tx.trashEntry.findFirst({
      where: {
        AND: [{ id, organizationId: user.organizationId }, await this.scopeWhere(user, action)],
      },
    });
    if (!entry) throw notFound('El elemento de la papelera');
    return entry;
  }

  /** Detalle antes de restaurar: datos del índice + conflictos actuales + bloqueos de purga. */
  async detail(user: AuthUser, id: string) {
    const entry = await this.findVisible(user, id, 'view');
    const h = this.handler(entry.entityType);
    const inTrash = entry.status === 'IN_TRASH';
    return {
      ...entry,
      restoreConflicts: inTrash ? await h.restoreConflicts(entry.entityId) : [],
      purgeBlockers: inTrash ? await h.purgeBlockers(entry.entityId) : [],
    };
  }

  /**
   * Restaura uno o varios. Los que tienen conflictos no se restauran y se devuelven con el motivo
   * para que el usuario los resuelva; los demás se restauran.
   */
  async restore(user: AuthUser, ids: string[], ip?: string): Promise<RestoreResult> {
    const result: RestoreResult = { restored: [], conflicts: [] };
    const actor: Actor = { userId: user.id, organizationId: user.organizationId, ip };
    for (const id of [...new Set(ids)]) {
      const entry = await this.findVisible(user, id, 'restore');
      if (entry.status !== 'IN_TRASH') {
        result.conflicts.push({
          id,
          displayName: entry.displayName,
          reasons: ['Ya no está en la papelera.'],
        });
        continue;
      }
      const h = this.handler(entry.entityType);
      const reasons = await h.restoreConflicts(entry.entityId);
      if (reasons.length > 0) {
        result.conflicts.push({ id, displayName: entry.displayName, reasons });
        continue;
      }
      await h.restore(entry.entityId, actor);
      await this.db.tx.trashEntry.update({
        where: { id },
        data: { status: 'RESTORED', resolvedById: user.id, resolvedAt: new Date() },
      });
      await this.history.record(
        entry.entityType as TrashableEntity,
        entry.entityId,
        'RESTORE',
        user.id,
      );
      await this.audit.log('RECORD_RESTORED', {
        userId: user.id,
        entityType: entry.entityType as TrashableEntity,
        entityId: entry.entityId,
        ip,
        details: { displayName: entry.displayName, code: entry.code },
      });
      result.restored.push({
        id,
        entityType: entry.entityType,
        entityId: entry.entityId,
        displayName: entry.displayName,
      });
    }
    return result;
  }

  /**
   * Eliminación definitiva: exige permiso `trash.purge` con alcance total, que el usuario escriba
   * el código (o el nombre, si no hay código) y que no queden dependencias vivas.
   */
  async purge(user: AuthUser, id: string, confirmation: string, ip?: string): Promise<void> {
    if (SCOPE_RANK[scopeOf(user.permissions, 'trash', 'purge')] < SCOPE_RANK.ALL) throw forbidden();
    const entry = await this.findVisible(user, id, 'purge');
    if (entry.status !== 'IN_TRASH') throw conflict('El elemento ya no está en la papelera.');
    const expected = entry.code ?? entry.displayName;
    if (confirmation.trim() !== expected) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'CONFIRMATION_MISMATCH',
        `Para confirmar escriba exactamente: ${expected}`,
      );
    }
    await this.purgeEntry(entry, user.id, ip);
  }

  private async purgeEntry(
    entry: {
      id: string;
      entityType: string;
      entityId: string;
      displayName: string;
      code: string | null;
    },
    userId: string | null,
    ip?: string,
  ): Promise<void> {
    const h = this.handler(entry.entityType);
    const blockers = await h.purgeBlockers(entry.entityId);
    if (blockers.length > 0) {
      throw conflict('No se puede eliminar definitivamente: tiene registros relacionados.', {
        blockers: blockers.join(' '),
      });
    }
    await h.purge(entry.entityId);
    await this.db.tx.trashEntry.update({
      where: { id: entry.id },
      data: { status: 'PURGED', resolvedById: userId, resolvedAt: new Date() },
    });
    await this.audit.log('RECORD_PURGED', {
      userId,
      entityType: entry.entityType as TrashableEntity,
      entityId: entry.entityId,
      ip,
      details: { displayName: entry.displayName, code: entry.code, automatic: userId === null },
    });
  }

  /**
   * Purga por retención (la ejecuta el worker, D-09/D-16). Solo lo vencido y sin dependencias;
   * lo bloqueado queda en la papelera para revisión manual. Debe llamarse dentro de withOrg.
   */
  async purgeExpired(now = new Date()): Promise<{ purged: number; blocked: number }> {
    const settings = await this.settings.get();
    if (!settings.trashAutoPurge) return { purged: 0, blocked: 0 };
    const due = await this.db.tx.trashEntry.findMany({
      where: {
        organizationId: this.db.organizationId,
        status: 'IN_TRASH',
        purgeAfter: { lte: now },
      },
      orderBy: { purgeAfter: 'asc' },
      take: 500,
    });
    let purged = 0;
    let blocked = 0;
    for (const entry of due) {
      if (!this.handlers.has(entry.entityType as TrashableEntity)) continue;
      const blockers = await this.handler(entry.entityType).purgeBlockers(entry.entityId);
      if (blockers.length > 0) {
        blocked++;
        continue;
      }
      await this.purgeEntry(entry, null);
      purged++;
    }
    if (purged + blocked > 0) {
      await this.audit.log('TRASH_AUTO_PURGED', { details: { purged, blocked } });
    }
    return { purged, blocked };
  }
}
