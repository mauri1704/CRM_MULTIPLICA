import { HttpStatus } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { CustomFieldValues } from '@crm/shared';
import { AppError } from '../../common/errors';

/** Control de concurrencia optimista: 0 filas actualizadas = otro usuario guardó antes. */
export function assertVersion(count: number): void {
  if (count === 0) {
    throw new AppError(
      HttpStatus.CONFLICT,
      'STALE_VERSION',
      'Otro usuario modificó este registro mientras usted lo editaba. Recargue para ver los cambios; lo que escribió no se perdió.',
    );
  }
}

export function customValues(raw: Prisma.JsonValue): CustomFieldValues {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as CustomFieldValues) : {};
}
