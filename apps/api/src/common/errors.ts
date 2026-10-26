import { HttpStatus } from '@nestjs/common';

/** Error de negocio con mensaje para el usuario (en español) y código estable para la interfaz. */
export class AppError extends Error {
  constructor(
    readonly status: HttpStatus,
    readonly code: string,
    message: string,
    readonly details?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFound = (what = 'El registro') =>
  new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} no existe o no tiene acceso.`);

export const conflict = (message: string, details?: Record<string, string>) =>
  new AppError(HttpStatus.CONFLICT, 'CONFLICT', message, details);

export const badRequest = (message: string, details?: Record<string, string>) =>
  new AppError(HttpStatus.BAD_REQUEST, 'BAD_REQUEST', message, details);

export const validationError = (
  details: Record<string, string>,
  message = 'Revise los datos ingresados.',
) => new AppError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', message, details);

export const forbidden = (message = 'No tiene permiso para realizar esta acción.') =>
  new AppError(HttpStatus.FORBIDDEN, 'FORBIDDEN', message);

export const unauthorized = (message = 'Inicie sesión para continuar.') =>
  new AppError(HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', message);
