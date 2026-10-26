import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ApiError } from '@crm/shared';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from './errors';

export function zodDetails(error: ZodError): Record<string, string> {
  const details: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    details[key] ??= issue.message;
  }
  return details;
}

/** Convierte cualquier error en `{ code, message, details? }` con mensajes comprensibles. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const [status, body] = this.map(exception);
    if (status >= 500) this.logger.error(exception instanceof Error ? exception.stack : exception);
    res.status(status).json(body);
  }

  private map(e: unknown): [number, ApiError] {
    if (e instanceof AppError) {
      return [e.status, { code: e.code, message: e.message, details: e.details }];
    }
    if (e instanceof ZodError) {
      return [
        HttpStatus.BAD_REQUEST,
        {
          code: 'VALIDATION_ERROR',
          message: 'Revise los datos ingresados.',
          details: zodDetails(e),
        },
      ];
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      switch (e.code) {
        case 'P2002':
          return [
            HttpStatus.CONFLICT,
            { code: 'DUPLICATE', message: 'Ya existe un registro con esos datos.' },
          ];
        case 'P2003':
          return [
            HttpStatus.CONFLICT,
            {
              code: 'IN_USE',
              message: 'El registro está relacionado con otros datos y no se puede modificar así.',
            },
          ];
        case 'P2025':
          return [
            HttpStatus.NOT_FOUND,
            { code: 'NOT_FOUND', message: 'El registro no existe o no tiene acceso.' },
          ];
      }
    }
    if (e instanceof HttpException) {
      const status = e.getStatus();
      const messages: Partial<Record<number, string>> = {
        [HttpStatus.TOO_MANY_REQUESTS]:
          'Demasiados intentos. Espere un momento y vuelva a intentar.',
        [HttpStatus.NOT_FOUND]: 'Recurso no encontrado.',
        [HttpStatus.PAYLOAD_TOO_LARGE]: 'El contenido enviado es demasiado grande.',
      };
      return [status, { code: `HTTP_${status}`, message: messages[status] ?? e.message }];
    }
    return [
      HttpStatus.INTERNAL_SERVER_ERROR,
      { code: 'INTERNAL', message: 'Ocurrió un error inesperado. Intente nuevamente.' },
    ];
  }
}
