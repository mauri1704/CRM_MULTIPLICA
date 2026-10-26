import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CreateUserInput, ListQuery, UpdateUserInput } from '@crm/shared';
import type { Actor } from '../../common/auth.types';
import { badRequest, conflict, notFound } from '../../common/errors';
import { Db } from '../../infra/db';
import { AuditService } from '../audit/audit.service';
import { hashPassword } from '../auth/password';
import { SessionService } from '../auth/session.service';
import { HistoryService, diff } from '../history/history.service';

const userSelect = {
  id: true,
  name: true,
  email: true,
  active: true,
  roleId: true,
  lastLoginAt: true,
  lockedUntil: true,
  createdAt: true,
  updatedAt: true,
  role: { select: { id: true, name: true, systemKey: true } },
  teams: { select: { team: { select: { id: true, name: true, deletedAt: true } } } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

function toDto(u: UserRow) {
  const { teams, ...rest } = u;
  return {
    ...rest,
    teams: teams
      .map((t) => t.team)
      .filter((t) => t.deletedAt === null)
      .map(({ id, name }) => ({ id, name })),
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly history: HistoryService,
    private readonly sessions: SessionService,
  ) {}

  async list(q: ListQuery & { active?: boolean }) {
    const where: Prisma.UserWhereInput = {
      organizationId: this.db.organizationId,
      ...(q.active === undefined ? {} : { active: q.active }),
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: 'insensitive' } },
              { email: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.q.user.findMany({
        where,
        select: userSelect,
        orderBy: [{ active: 'desc' }, { name: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.q.user.count({ where }),
    ]);
    return { items: items.map(toDto), total, page: q.page, pageSize: q.pageSize };
  }

  /** Lista corta para selectores (responsable, supervisor…). Solo usuarios activos. */
  async options() {
    return this.db.q.user.findMany({
      where: { organizationId: this.db.organizationId, active: true },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });
  }

  async get(id: string) {
    const u = await this.db.q.user.findFirst({
      where: { id, organizationId: this.db.organizationId },
      select: userSelect,
    });
    if (!u) throw notFound('El usuario');
    return toDto(u);
  }

  private async assertRole(roleId: string) {
    const role = await this.db.tx.role.findFirst({
      where: { id: roleId, organizationId: this.db.organizationId },
    });
    if (!role) throw badRequest('El rol no existe.', { roleId: 'Seleccione un rol válido.' });
    return role;
  }

  private async assertTeams(teamIds: string[]) {
    if (teamIds.length === 0) return;
    const count = await this.db.tx.team.count({
      where: { id: { in: teamIds }, organizationId: this.db.organizationId, deletedAt: null },
    });
    if (count !== new Set(teamIds).size)
      throw badRequest('Algún equipo no existe.', { teamIds: 'Equipo no válido.' });
  }

  private async setTeams(userId: string, teamIds: string[]) {
    await this.db.tx.teamMember.deleteMany({
      where: { organizationId: this.db.organizationId, userId },
    });
    if (teamIds.length > 0) {
      await this.db.tx.teamMember.createMany({
        data: [...new Set(teamIds)].map((teamId) => ({
          organizationId: this.db.organizationId,
          teamId,
          userId,
        })),
      });
    }
  }

  /** Cantidad de administradores activos distintos de `exceptUserId`. */
  private async otherActiveAdmins(exceptUserId: string): Promise<number> {
    return this.db.q.user.count({
      where: {
        organizationId: this.db.organizationId,
        active: true,
        id: { not: exceptUserId },
        role: { systemKey: 'ADMIN' },
      },
    });
  }

  async create(input: CreateUserInput, actor: Actor) {
    await this.assertRole(input.roleId);
    await this.assertTeams(input.teamIds);
    const exists = await this.db.q.user.findUnique({ where: { email: input.email } });
    if (exists)
      throw conflict('Ya existe un usuario con ese correo.', { email: 'Correo ya registrado.' });
    const user = await this.db.q.user.create({
      data: {
        organizationId: actor.organizationId,
        name: input.name,
        email: input.email,
        roleId: input.roleId,
        passwordHash: await hashPassword(input.password),
        createdById: actor.userId,
      },
    });
    await this.setTeams(user.id, input.teamIds);
    await this.history.record('USER', user.id, 'CREATE', actor.userId, {
      name: user.name,
      email: user.email,
      roleId: user.roleId,
    });
    await this.audit.log('USER_CREATED', {
      userId: actor.userId,
      entityType: 'USER',
      entityId: user.id,
      ip: actor.ip,
      details: { email: user.email, roleId: user.roleId },
    });
    return this.get(user.id);
  }

  async update(id: string, input: UpdateUserInput, actor: Actor) {
    const before = await this.db.q.user.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: { role: true, teams: { select: { teamId: true } } },
    });
    if (!before) throw notFound('El usuario');

    if (input.roleId && input.roleId !== before.roleId) {
      const role = await this.assertRole(input.roleId);
      if (before.role.systemKey === 'ADMIN' && role.systemKey !== 'ADMIN' && before.active) {
        if ((await this.otherActiveAdmins(id)) === 0) {
          throw conflict('Debe quedar al menos un administrador activo.');
        }
      }
    }
    if (input.email && input.email !== before.email) {
      const exists = await this.db.q.user.findUnique({ where: { email: input.email } });
      if (exists)
        throw conflict('Ya existe un usuario con ese correo.', { email: 'Correo ya registrado.' });
    }
    if (input.teamIds) await this.assertTeams(input.teamIds);

    const { teamIds, ...fields } = input;
    const changes = diff(before, fields, ['name', 'email', 'roleId']);
    if (teamIds) {
      const prev = before.teams.map((t) => t.teamId).sort();
      const next = [...new Set(teamIds)].sort();
      if (JSON.stringify(prev) !== JSON.stringify(next)) changes.teamIds = { from: prev, to: next };
      await this.setTeams(id, teamIds);
    }
    if (Object.keys(fields).length > 0)
      await this.db.q.user.update({ where: { id }, data: fields });
    // Cambiar el rol cambia lo que puede hacer: se cierran sus sesiones para que entre con el nuevo.
    if (changes.roleId) await this.sessions.revokeAll(id);

    await this.history.record('USER', id, 'UPDATE', actor.userId, changes);
    if (Object.keys(changes).length > 0) {
      await this.audit.log('USER_UPDATED', {
        userId: actor.userId,
        entityType: 'USER',
        entityId: id,
        ip: actor.ip,
        details: { changes },
      });
    }
    return this.get(id);
  }

  async setActive(id: string, active: boolean, actor: Actor) {
    const user = await this.db.q.user.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: { role: true },
    });
    if (!user) throw notFound('El usuario');
    if (user.active === active) return this.get(id);
    if (!active) {
      if (id === actor.userId) throw conflict('No puede desactivar su propio usuario.');
      if (user.role.systemKey === 'ADMIN' && (await this.otherActiveAdmins(id)) === 0) {
        throw conflict('Debe quedar al menos un administrador activo.');
      }
    }
    await this.db.q.user.update({
      where: { id },
      data: active ? { active, failedLoginCount: 0, lockedUntil: null } : { active },
    });
    if (!active) await this.sessions.revokeAll(id);
    await this.history.record('USER', id, active ? 'ACTIVATE' : 'DEACTIVATE', actor.userId);
    await this.audit.log(active ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', {
      userId: actor.userId,
      entityType: 'USER',
      entityId: id,
      ip: actor.ip,
    });
    return this.get(id);
  }

  /** El administrador define una nueva contraseña (p. ej. si no hay correo configurado). */
  async setPassword(id: string, password: string, actor: Actor) {
    const user = await this.db.q.user.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!user) throw notFound('El usuario');
    await this.db.q.user.update({
      where: { id },
      data: {
        passwordHash: await hashPassword(password),
        passwordChangedAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await this.sessions.revokeAll(id);
    await this.audit.log('PASSWORD_CHANGED', {
      userId: actor.userId,
      entityType: 'USER',
      entityId: id,
      ip: actor.ip,
      details: { byAdmin: true },
    });
  }
}
