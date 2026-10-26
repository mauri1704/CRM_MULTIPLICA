import { Injectable } from '@nestjs/common';
import {
  ADMIN_PERMISSIONS,
  isValidPermission,
  type PermissionAction,
  type PermissionMap,
  type PermissionModule,
  type PermissionScope,
  type SystemRoleKey,
} from '@crm/shared';
import type { AuthUser } from '../../common/auth.types';
import { Db } from '../../infra/db';
import { parseSettings } from '../organization/organization-settings.service';
import { newToken, sha256 } from './password';

export const SESSION_ABSOLUTE_MS = 7 * 86_400_000;
const TOUCH_EVERY_MS = 60_000;

@Injectable()
export class SessionService {
  constructor(private readonly db: Db) {}

  async create(
    userId: string,
    ip?: string,
    userAgent?: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const { token, hash } = newToken();
    const expiresAt = new Date(Date.now() + SESSION_ABSOLUTE_MS);
    await this.db.client.session.create({
      data: {
        userId,
        tokenHash: hash,
        expiresAt,
        ip: ip ?? null,
        userAgent: userAgent?.slice(0, 300) ?? null,
      },
    });
    return { token, expiresAt };
  }

  async revoke(token: string): Promise<void> {
    await this.db.client.session.updateMany({
      where: { tokenHash: sha256(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Cierra todas las sesiones del usuario (desactivación, cambio o restablecimiento de clave). */
  async revokeAll(userId: string, exceptSessionId?: string): Promise<void> {
    await this.db.q.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
  }

  /** Valida la cookie y arma el usuario de la petición; null si la sesión no sirve. */
  async authenticate(token: string): Promise<AuthUser | null> {
    const now = Date.now();
    const session = await this.db.client.session.findUnique({
      where: { tokenHash: sha256(token) },
      // `roles` tiene RLS: se lee después, dentro de withOrg.
      include: { user: { include: { organization: { select: { settings: true } } } } },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= now ||
      !session.user.active
    ) {
      return null;
    }
    const idleMs = parseSettings(session.user.organization.settings).sessionIdleHours * 3_600_000;
    if (now - session.lastSeenAt.getTime() > idleMs) {
      await this.db.client.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      return null;
    }
    if (now - session.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
      await this.db.client.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      });
    }

    const { user } = session;
    const ctx = await this.db.withOrg(user.organizationId, async () => {
      const role = await this.db.tx.role.findFirst({
        where: { id: user.roleId, organizationId: user.organizationId },
      });
      if (!role) return null;
      const teams = await this.db.tx.teamMember.findMany({
        where: {
          organizationId: user.organizationId,
          userId: user.id,
          team: { deletedAt: null, active: true },
        },
        select: { teamId: true },
      });
      return {
        role,
        permissions: await this.loadPermissions(role.id, role.systemKey),
        teamIds: teams.map((t) => t.teamId),
      };
    });
    if (!ctx) return null;

    return {
      id: user.id,
      organizationId: user.organizationId,
      email: user.email,
      name: user.name,
      roleId: user.roleId,
      roleName: ctx.role.name,
      roleKey: (ctx.role.systemKey as SystemRoleKey | null) ?? null,
      permissions: ctx.permissions,
      teamIds: ctx.teamIds,
      theme: user.theme,
      sessionId: session.id,
    };
  }

  /** El rol Administrador tiene siempre todos los permisos, sin importar lo guardado. */
  async loadPermissions(roleId: string, systemKey: string | null): Promise<PermissionMap> {
    if (systemKey === 'ADMIN') return ADMIN_PERMISSIONS;
    const rows = await this.db.tx.rolePermission.findMany({ where: { roleId } });
    const map: PermissionMap = {};
    for (const r of rows) {
      if (!isValidPermission(r.module, r.action) || r.scope === 'NONE') continue;
      const m = r.module as PermissionModule;
      map[m] = { ...map[m], [r.action as PermissionAction]: r.scope as PermissionScope };
    }
    return map;
  }
}
