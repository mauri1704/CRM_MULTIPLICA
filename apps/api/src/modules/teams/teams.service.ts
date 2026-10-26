import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ListQuery, TeamInput, TeamUpdate } from '@crm/shared';
import type { Actor } from '../../common/auth.types';
import { badRequest, conflict, notFound } from '../../common/errors';
import { Db } from '../../infra/db';
import { HistoryService, diff } from '../history/history.service';
import { TrashService } from '../trash/trash.service';
import type { TrashHandler } from '../trash/trash.types';

const teamInclude = {
  supervisor: { select: { id: true, name: true } },
  members: { select: { user: { select: { id: true, name: true, email: true, active: true } } } },
} satisfies Prisma.TeamInclude;

type TeamRow = Prisma.TeamGetPayload<{ include: typeof teamInclude }>;

const toDto = (t: TeamRow) => ({
  id: t.id,
  name: t.name,
  description: t.description,
  active: t.active,
  supervisor: t.supervisor,
  members: t.members.map((m) => m.user).sort((a, b) => a.name.localeCompare(b.name)),
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
});

@Injectable()
export class TeamsService implements OnModuleInit, TrashHandler {
  readonly entityType = 'TEAM' as const;

  constructor(
    private readonly db: Db,
    private readonly history: HistoryService,
    private readonly trash: TrashService,
  ) {}

  onModuleInit(): void {
    this.trash.register(this);
  }

  async list(q: ListQuery) {
    const where: Prisma.TeamWhereInput = {
      organizationId: this.db.organizationId,
      deletedAt: null,
      ...(q.includeInactive ? {} : { active: true }),
      ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.tx.team.findMany({
        where,
        include: teamInclude,
        orderBy: { name: 'asc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.tx.team.count({ where }),
    ]);
    return { items: items.map(toDto), total, page: q.page, pageSize: q.pageSize };
  }

  async get(id: string) {
    const t = await this.db.tx.team.findFirst({
      where: { id, organizationId: this.db.organizationId, deletedAt: null },
      include: teamInclude,
    });
    if (!t) throw notFound('El equipo');
    return toDto(t);
  }

  private async assertUsers(ids: string[]) {
    if (ids.length === 0) return;
    const unique = [...new Set(ids)];
    const count = await this.db.q.user.count({
      where: { id: { in: unique }, organizationId: this.db.organizationId },
    });
    if (count !== unique.length)
      throw badRequest('Algún usuario no existe.', { memberIds: 'Usuario no válido.' });
  }

  private async assertNameFree(name: string, exceptId?: string) {
    const clash = await this.db.tx.team.findFirst({
      where: {
        organizationId: this.db.organizationId,
        deletedAt: null,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
    if (clash) throw conflict('Ya existe un equipo con ese nombre.', { name: 'Nombre en uso.' });
  }

  private async setMembers(teamId: string, memberIds: string[]) {
    await this.db.tx.teamMember.deleteMany({
      where: { organizationId: this.db.organizationId, teamId },
    });
    if (memberIds.length > 0) {
      await this.db.tx.teamMember.createMany({
        data: [...new Set(memberIds)].map((userId) => ({
          organizationId: this.db.organizationId,
          teamId,
          userId,
        })),
      });
    }
  }

  async create(input: TeamInput, actor: Actor) {
    await this.assertNameFree(input.name);
    await this.assertUsers([
      ...input.memberIds,
      ...(input.supervisorId ? [input.supervisorId] : []),
    ]);
    const team = await this.db.tx.team.create({
      data: {
        organizationId: actor.organizationId,
        name: input.name,
        description: input.description ?? null,
        supervisorId: input.supervisorId ?? null,
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });
    await this.setMembers(team.id, input.memberIds);
    await this.history.record('TEAM', team.id, 'CREATE', actor.userId, {
      name: team.name,
      supervisorId: team.supervisorId,
      memberIds: input.memberIds,
    });
    return this.get(team.id);
  }

  async update(id: string, input: TeamUpdate, actor: Actor) {
    const before = await this.db.tx.team.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
      include: { members: { select: { userId: true } } },
    });
    if (!before) throw notFound('El equipo');
    if (input.name && input.name.toLowerCase() !== before.name.toLowerCase())
      await this.assertNameFree(input.name, id);
    await this.assertUsers([
      ...(input.memberIds ?? []),
      ...(input.supervisorId ? [input.supervisorId] : []),
    ]);

    const { memberIds, ...fields } = input;
    const changes = diff(before, fields, ['name', 'description', 'supervisorId', 'active']);
    if (memberIds) {
      const prev = before.members.map((m) => m.userId).sort();
      const next = [...new Set(memberIds)].sort();
      if (JSON.stringify(prev) !== JSON.stringify(next))
        changes.memberIds = { from: prev, to: next };
      await this.setMembers(id, memberIds);
    }
    await this.db.tx.team.update({ where: { id }, data: { ...fields, updatedById: actor.userId } });
    await this.history.record('TEAM', id, 'UPDATE', actor.userId, changes);
    return this.get(id);
  }

  async remove(id: string, actor: Actor) {
    const team = await this.db.tx.team.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
      include: { _count: { select: { members: true } } },
    });
    if (!team) throw notFound('El equipo');
    await this.db.tx.team.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: actor.userId },
    });
    await this.trash.add(
      'TEAM',
      { id, displayName: team.name, relations: { members: team._count.members } },
      actor,
    );
  }

  // --- Papelera -----------------------------------------------------------------------------

  async restoreConflicts(entityId: string): Promise<string[]> {
    const team = await this.db.tx.team.findFirst({
      where: { id: entityId, organizationId: this.db.organizationId },
    });
    if (!team) return ['El equipo ya no existe.'];
    const clash = await this.db.tx.team.findFirst({
      where: {
        organizationId: this.db.organizationId,
        deletedAt: null,
        name: { equals: team.name, mode: 'insensitive' },
        id: { not: entityId },
      },
    });
    return clash
      ? [
          `Ya existe un equipo activo llamado "${clash.name}". Cámbiele el nombre y vuelva a intentar.`,
        ]
      : [];
  }

  async restore(entityId: string, actor: Actor): Promise<void> {
    await this.db.tx.team.updateMany({
      where: { id: entityId, organizationId: actor.organizationId },
      data: { deletedAt: null, deletedById: null, updatedById: actor.userId },
    });
  }

  async purgeBlockers(_entityId: string): Promise<string[]> {
    // Los equipos no tienen dependencias que impidan borrarlos (los miembros se borran en cascada).
    return [];
  }

  async purge(entityId: string): Promise<void> {
    await this.db.tx.team.deleteMany({
      where: { id: entityId, organizationId: this.db.organizationId, deletedAt: { not: null } },
    });
  }
}
