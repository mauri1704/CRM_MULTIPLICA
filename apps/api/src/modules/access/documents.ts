import { isValidRuc } from '@crm/shared';
import type { Prisma } from '@prisma/client';
import { validationError } from '../../common/errors';

/**
 * Valida un número de documento según su tipo (catálogo "Tipos de documento"): el RUC con su dígito
 * verificador y los demás con la expresión regular configurada. Devuelve el tipo encontrado.
 */
export async function checkDocument(
  tx: Prisma.TransactionClient,
  organizationId: string,
  typeId: string | null | undefined,
  value: string | null | undefined,
  fields: { type: string; number: string },
  noun = 'documento',
): Promise<void> {
  if (!typeId) {
    if (value) throw validationError({ [fields.type]: `Indique el tipo de ${noun}.` });
    return;
  }
  const type = await tx.documentType.findFirst({ where: { id: typeId, organizationId } });
  if (!type) throw validationError({ [fields.type]: `El tipo de ${noun} no existe.` });
  if (!value) return;
  const clean = value.replace(/[\s.-]/g, '');
  if (type.code === 'RUC') {
    if (!isValidRuc(clean))
      throw validationError({ [fields.number]: 'RUC no válido: revise los 11 dígitos.' });
    return;
  }
  if (type.pattern && !new RegExp(type.pattern).test(clean)) {
    throw validationError({ [fields.number]: `El número no tiene el formato de ${type.name}.` });
  }
}
