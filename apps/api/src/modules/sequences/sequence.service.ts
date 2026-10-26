import { Injectable } from '@nestjs/common';
import { formatCode, type SequenceEntity } from '@crm/shared';
import { Db } from '../../infra/db';

/**
 * Códigos correlativos por organización (D-11): `PRO-000001`, `NEG-000001`…
 * Atómico: INSERT … ON CONFLICT DO UPDATE bloquea la fila del contador hasta el fin de la
 * transacción, así dos altas simultáneas nunca obtienen el mismo número. Los números no se
 * reutilizan (si la transacción se revierte, el contador también).
 */
@Injectable()
export class SequenceService {
  constructor(private readonly db: Db) {}

  async next(entity: SequenceEntity): Promise<string> {
    const rows = await this.db.tx.$queryRaw<{ value: number }[]>`
      INSERT INTO sequences (organization_id, entity_type, next_value)
      VALUES (${this.db.organizationId}::uuid, ${entity}, 2)
      ON CONFLICT (organization_id, entity_type)
      DO UPDATE SET next_value = sequences.next_value + 1
      RETURNING next_value - 1 AS value`;
    const value = rows[0]?.value;
    if (value === undefined) throw new Error('No se pudo generar el código.');
    return formatCode(entity, Number(value));
  }
}
