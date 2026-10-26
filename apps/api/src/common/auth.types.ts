import type { PermissionMap, SystemRoleKey } from '@crm/shared';
import type { Request } from 'express';

/** Usuario autenticado de la petición. Lo arma AuthGuard a partir de la sesión. */
export interface AuthUser {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  roleId: string;
  roleName: string;
  roleKey: SystemRoleKey | null;
  permissions: PermissionMap;
  teamIds: string[];
  theme: string;
  sessionId: string;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

/** Quién hace la acción: va a historial y auditoría. */
export interface Actor {
  userId: string;
  organizationId: string;
  ip?: string;
}

export const toActor = (user: AuthUser, ip?: string): Actor => ({
  userId: user.id,
  organizationId: user.organizationId,
  ip,
});
