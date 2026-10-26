import { ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { PermissionAction, PermissionModule } from '@crm/shared';
import type { AuthRequest, AuthUser } from './auth.types';
import { unauthorized } from './errors';

export const IS_PUBLIC = 'crm:public';
export const REQUIRED_PERMISSION = 'crm:permission';

/** Endpoint sin sesión (login, recuperación de clave, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export interface RequiredPermission {
  module: PermissionModule;
  action: PermissionAction;
}

/** Permiso mínimo (alcance ≥ OWN) para entrar al endpoint. El alcance fino lo aplica el service. */
export const RequirePermission = (module: PermissionModule, action: PermissionAction) =>
  SetMetadata(REQUIRED_PERMISSION, { module, action } satisfies RequiredPermission);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AuthRequest>().user;
  if (!user) throw unauthorized();
  return user;
});

export const ClientIp = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string | undefined =>
    ctx.switchToHttp().getRequest<AuthRequest>().ip,
);
