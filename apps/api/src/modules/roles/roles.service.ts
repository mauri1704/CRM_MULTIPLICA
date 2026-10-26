import { Injectable } from '@nestjs/common';
import {
  ADMIN_PERMISSIONS,
  PERMISSION_MODULES,
  type PermissionModule,
  type RoleInput,
  type RoleUpdate,
} from '@crm/shared';
import type { Actor } from '../../common/auth.types';
import { conflict, notFound, validationError } from '../../common/errors';
import { Db } from '../../infra/db';
import { AuditService } from '../audit/audit.service';
import { HistoryService } from '../history/history.service';

type PermissionEntry = RoleInput['permissions'][number];

/**
 * En los módulos administrativos (sin alcance por registro) solo valen "Sin acceso" o "Todos":
 * "propios" o "su equipo" no significan nada para, por ejemplo, la configuración.
 */
function checkPermissions(entries: PermissionEntry[]): PermissionEntry[] {
  const errors: Record<string, string> = {};
  const seen = new Map<string, PermissionEntry>();
  for (const p of entries) {
    const def = PERMISSION_MODULES[p.module as PermissionModule];
    if (!def.recordScoped && (p.scope === 'OWN' || p.scope === 'TEAM')) {
      errors[`${p.module}.${p.action}`] = `${def.label}: elija "Sin acceso" o "Todos".`;
    }
    seen.set(`${p.module}.${p.action}`, p);
  }
  if (Object.keys(errors).length > 0) throw validationError(errors);
  return [...seen.values()].filter((p) => p.scope !== 'NONE');
}

const key = (p: { module: string; action: string }) => `${p.module}.${p.action}`;

@Injectable()
export class RolesService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly history: HistoryService,
  ) {}

  async list() {
    const roles = await this.db.tx.role.findMany({
      where: { organizationId: this.db.organizationId },
      include: { permissions: true, _count: { select: { users: true } } },
      orderBy: [{ systemKey: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
    });
    return roles.map((r) => this.toDto(r));
  }

  private toDto(r: {
    id: string;
    name: string;
    description: string | null;
    systemKey: string | null;
    permissions: { module: string; action: string; scope: string }[];
    _count?: { users: number };
  }) {
    const permissions =
      r.systemKey === 'ADMIN'
        ? Object.entries(ADMIN_PERMISSIONS).flatMap(([module, actions]) =>
            Object.entries(actions ?? {}).map(([action, scope]) => ({
              module,
              action,
              scope: scope as string,
            })),
          )
        : r.permissions.map(({ module, action, scope }) => ({ module, action, scope }));
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      systemKey: r.systemKey,
      editable: r.systemKey !== 'ADMIN',
      deletable: r.systemKey === null,
      userCount: r._count?.users ?? 0,
      permissions,
    };
  }

  async get(id: string) {
    const r = await this.db.tx.role.findFirst({
      where: { id, organizationId: this.db.organizationId },
      include: { permissions: true, _count: { select: { users: true } } },
    });
    if (!r) throw notFound('El rol');
    return this.toDto(r);
  }

  private async assertNameFree(name: string, exceptId?: string) {
    const clash = await this.db.tx.role.findFirst({
      where: {
        organizationId: this.db.organizationId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
    if (clash) throw conflict('Ya existe un rol con ese nombre.', { name: 'Nombre en uso.' });
  }

  async create(input: RoleInput, actor: Actor) {
    await this.assertNameFree(input.name);
    const permissions = checkPermissions(input.permissions);
    const role = await this.db.tx.role.create({
      data: {
        organizationId: actor.organizationId,
        name: input.name,
        description: input.description ?? null,
        permissions: {
          create: permissions.map((p) => ({ ...p, organizationId: actor.organizationId })),
        },
      },
    });
    await this.history.record('ROLE', role.id, 'CREATE', actor.userId, {
      name: role.name,
      permissions,
    });
    await this.audit.log('ROLE_CREATED', {
      userId: actor.userId,
      entityType: 'ROLE',
      entityId: role.id,
      ip: actor.ip,
      details: { name: role.name },
    });
    return this.get(role.id);
  }

  async update(id: string, input: RoleUpdate, actor: Actor) {
    const role = await this.db.tx.role.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: { permissions: true },
    });
    if (!role) throw notFound('El rol');
    if (role.systemKey === 'ADMIN') {
      throw conflict(
        'El rol Administrador siempre tiene todos los permisos y no se puede modificar.',
      );
    }
    if (role.systemKey && input.name && input.name !== role.name) {
      throw conflict('Los roles del sistema no se pueden renombrar.');
    }
    if (input.name && input.name.toLowerCase() !== role.name.toLowerCase())
      await this.assertNameFree(input.name, id);

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (input.name !== undefined && input.name !== role.name)
      changes.name = { from: role.name, to: input.name };
    if (input.description !== undefined && (input.description ?? null) !== role.description) {
      changes.description = { from: role.description, to: input.description ?? null };
    }
    await this.db.tx.role.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      },
    });

    if (input.permissions) {
      const next = checkPermissions(input.permissions);
      const prevMap = new Map(role.permissions.map((p) => [key(p), p.scope]));
      const nextMap = new Map(next.map((p) => [key(p), p.scope]));
      const permissionChanges: Record<string, { from: string; to: string }> = {};
      for (const k of new Set([...prevMap.keys(), ...nextMap.keys()])) {
        const from = prevMap.get(k) ?? 'NONE';
        const to = nextMap.get(k) ?? 'NONE';
        if (from !== to) permissionChanges[k] = { from, to };
      }
      if (Object.keys(permissionChanges).length > 0) {
        await this.db.tx.rolePermission.deleteMany({
          where: { roleId: id, organizationId: actor.organizationId },
        });
        if (next.length > 0) {
          await this.db.tx.rolePermission.createMany({
            data: next.map((p) => ({ ...p, roleId: id, organizationId: actor.organizationId })),
          });
        }
        Object.assign(
          changes,
          Object.fromEntries(
            Object.entries(permissionChanges).map(([k, v]) => [`permiso.${k}`, v]),
          ),
        );
        await this.audit.log('PERMISSIONS_CHANGED', {
          userId: actor.userId,
          entityType: 'ROLE',
          entityId: id,
          ip: actor.ip,
          details: { role: role.name, changes: permissionChanges },
        });
      }
    }
    await this.history.record('ROLE', id, 'UPDATE', actor.userId, changes);
    return this.get(id);
  }

  /** Solo roles creados por la organización y sin usuarios asignados. */
  async remove(id: string, actor: Actor) {
    const role = await this.db.tx.role.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw notFound('El rol');
    if (role.systemKey) throw conflict('Los roles del sistema no se pueden eliminar.');
    if (role._count.users > 0) {
      throw conflict(
        `El rol tiene ${role._count.users} usuario(s). Asígneles otro rol antes de eliminarlo.`,
      );
    }
    await this.db.tx.role.delete({ where: { id } });
    await this.audit.log('ROLE_DELETED', {
      userId: actor.userId,
      entityType: 'ROLE',
      entityId: id,
      ip: actor.ip,
      details: { name: role.name },
    });
  }
}
