import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { can } from '@crm/shared';
import { SessionService } from '../modules/auth/session.service';
import type { AuthRequest } from './auth.types';
import { IS_PUBLIC, REQUIRED_PERMISSION, type RequiredPermission } from './decorators';
import { AppError, forbidden, unauthorized } from './errors';
import { HttpStatus } from '@nestjs/common';

export const SESSION_COOKIE = 'crm_session';
export const CSRF_HEADER = 'x-crm-request';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Guard global, en este orden:
 * 1. CSRF: toda petición que modifica exige la cabecera `X-CRM-Request: 1`. Un formulario o una
 *    imagen de otro sitio no pueden enviarla sin un preflight CORS, que no se permite.
 * 2. Sesión: salvo endpoints @Public.
 * 3. Permiso: @RequirePermission(módulo, acción) con alcance ≥ OWN.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthRequest>();

    if (!SAFE_METHODS.has(req.method) && req.header(CSRF_HEADER) !== '1') {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        'CSRF',
        'Solicitud rechazada por seguridad. Recargue la página.',
      );
    }

    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || token.length === 0) throw unauthorized();
    const user = await this.sessions.authenticate(token);
    if (!user) throw unauthorized('Su sesión expiró. Inicie sesión nuevamente.');
    req.user = user;

    const required = this.reflector.getAllAndOverride<RequiredPermission | undefined>(
      REQUIRED_PERMISSION,
      targets,
    );
    if (required && !can(user.permissions, required.module, required.action)) throw forbidden();
    return true;
  }
}
