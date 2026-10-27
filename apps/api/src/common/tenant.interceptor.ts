import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, lastValueFrom } from 'rxjs';
import { Db } from '../infra/db';
import type { AuthRequest } from './auth.types';
import { TX_TIMEOUT } from './tx-timeout';

/**
 * Ejecuta toda petición autenticada dentro de `db.withOrg(organizationId)`: una transacción con
 * Row-Level Security fijada a la organización del usuario. Si el handler falla, nada se guarda.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(
    private readonly db: Db,
    private readonly reflector: Reflector,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const user = ctx.switchToHttp().getRequest<AuthRequest>().user;
    if (!user) return next.handle();
    // Importar/exportar declaran un tiempo mayor con @TxTimeout; el resto usa el de Db.withOrg.
    const timeout = this.reflector.get<number | undefined>(TX_TIMEOUT, ctx.getHandler());
    return from(
      this.db.withOrg(
        user.organizationId,
        () => lastValueFrom(next.handle(), { defaultValue: undefined }),
        {
          timeout,
        },
      ),
    );
  }
}
