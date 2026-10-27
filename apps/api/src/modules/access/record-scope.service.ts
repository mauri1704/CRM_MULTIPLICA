import { Injectable } from '@nestjs/common';
import { scopeOf, type PermissionAction, type PermissionModule } from '@crm/shared';
import type { AuthUser } from '../../common/auth.types';
import { forbidden } from '../../common/errors';
import { Db } from '../../infra/db';

/**
 * Alcance por registro (D-08): "propios" = el usuario es el responsable; "su equipo" = el
 * responsable es miembro de alguno de sus equipos; "todos" = sin restricción.
 */
@Injectable()
export class RecordScopeService {
  constructor(private readonly db: Db) {}

  /** Ids de usuarios cuyos registros entran en el alcance, o null si el alcance es "todos". */
  async ownerIds(
    user: AuthUser,
    module: PermissionModule,
    action: PermissionAction,
  ): Promise<string[] | null> {
    const scope = scopeOf(user.permissions, module, action);
    if (scope === 'NONE') throw forbidden();
    if (scope === 'ALL') return null;
    if (scope === 'OWN') return [user.id];
    const members = await this.db.tx.teamMember.findMany({
      where: { organizationId: user.organizationId, teamId: { in: user.teamIds } },
      select: { userId: true },
    });
    return [...new Set([user.id, ...members.map((m) => m.userId)])];
  }

  /** Filtro Prisma por responsable para listas y exportaciones. */
  async ownerWhere(
    user: AuthUser,
    module: PermissionModule,
    action: PermissionAction,
  ): Promise<{ ownerId?: { in: string[] } }> {
    const ids = await this.ownerIds(user, module, action);
    return ids === null ? {} : { ownerId: { in: ids } };
  }

  /** ¿El registro (por su responsable) está dentro del alcance de la acción? */
  async allows(
    user: AuthUser,
    module: PermissionModule,
    action: PermissionAction,
    ownerId: string | null,
  ): Promise<boolean> {
    const ids = await this.ownerIds(user, module, action);
    return ids === null || (ownerId !== null && ids.includes(ownerId));
  }

  async assert(
    user: AuthUser,
    module: PermissionModule,
    action: PermissionAction,
    ownerId: string | null,
  ): Promise<void> {
    if (!(await this.allows(user, module, action, ownerId))) {
      throw forbidden('Este registro no está dentro de su alcance para esta acción.');
    }
  }

  /**
   * Responsable a asignar: por defecto el propio usuario. Asignar a otro exige que ese usuario esté
   * dentro del alcance de "crear"/"editar" y que pertenezca a la organización y esté activo.
   */
  async resolveOwner(
    user: AuthUser,
    module: PermissionModule,
    action: 'create' | 'edit',
    requested: string | null | undefined,
  ): Promise<string> {
    const ownerId = requested ?? user.id;
    if (ownerId === user.id) return ownerId;
    const target = await this.db.q.user.findFirst({
      where: { id: ownerId, organizationId: user.organizationId, active: true },
      select: { id: true },
    });
    if (!target) throw forbidden('El responsable indicado no existe o está inactivo.');
    await this.assert(user, module, action, ownerId);
    return ownerId;
  }
}
