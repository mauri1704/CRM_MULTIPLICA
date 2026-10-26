import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  MAX_CUSTOM_FIELDS_PER_ENTITY,
  validateCustomFields,
  type CustomFieldDefinitionInput,
  type CustomFieldDefinitionLike,
  type CustomFieldDefinitionUpdate,
  type CustomFieldEntity,
  type CustomFieldType,
  type CustomFieldValues,
} from '@crm/shared';
import type { Actor } from '../../common/auth.types';
import { conflict, notFound, validationError } from '../../common/errors';
import { Db } from '../../infra/db';
import { HistoryService, diff } from '../history/history.service';

function parseOptions(raw: Prisma.JsonValue): { value: string; label: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((o) =>
    o &&
    typeof o === 'object' &&
    !Array.isArray(o) &&
    typeof o.value === 'string' &&
    typeof o.label === 'string'
      ? [{ value: o.value, label: o.label }]
      : [],
  );
}

@Injectable()
export class CustomFieldsService {
  constructor(
    private readonly db: Db,
    private readonly history: HistoryService,
  ) {}

  async list(entityType?: CustomFieldEntity, includeInactive = false) {
    const rows = await this.db.tx.customFieldDefinition.findMany({
      where: {
        organizationId: this.db.organizationId,
        ...(entityType ? { entityType } : {}),
        ...(includeInactive ? {} : { active: true }),
      },
      orderBy: [{ entityType: 'asc' }, { position: 'asc' }, { label: 'asc' }],
    });
    return rows.map((r) => ({
      ...r,
      type: r.type as CustomFieldType,
      options: parseOptions(r.options),
    }));
  }

  private async find(id: string) {
    const row = await this.db.tx.customFieldDefinition.findFirst({
      where: { id, organizationId: this.db.organizationId },
    });
    if (!row) throw notFound('El campo personalizado');
    return row;
  }

  async create(input: CustomFieldDefinitionInput, actor: Actor) {
    const count = await this.db.tx.customFieldDefinition.count({
      where: { organizationId: actor.organizationId, entityType: input.entityType },
    });
    if (count >= MAX_CUSTOM_FIELDS_PER_ENTITY) {
      throw conflict(
        `Se alcanzó el máximo de ${MAX_CUSTOM_FIELDS_PER_ENTITY} campos para este módulo.`,
      );
    }
    const clash = await this.db.tx.customFieldDefinition.findFirst({
      where: { organizationId: actor.organizationId, entityType: input.entityType, key: input.key },
    });
    if (clash)
      throw conflict('Ya existe un campo con esa clave en este módulo.', { key: 'Clave en uso.' });
    const row = await this.db.tx.customFieldDefinition.create({
      data: {
        organizationId: actor.organizationId,
        entityType: input.entityType,
        key: input.key,
        label: input.label,
        type: input.type,
        options: input.options,
        required: input.required,
        section: input.section ?? null,
        helpText: input.helpText ?? null,
        position: input.position,
      },
    });
    await this.history.record('CUSTOM_FIELD', row.id, 'CREATE', actor.userId, {
      entityType: input.entityType,
      key: input.key,
      label: input.label,
      type: input.type,
    });
    return row;
  }

  async update(id: string, input: CustomFieldDefinitionUpdate, actor: Actor) {
    const before = await this.find(id);
    if (input.options !== undefined) {
      const usesOptions = before.type === 'SELECT' || before.type === 'MULTISELECT';
      if (!usesOptions && input.options.length > 0) {
        throw validationError({ options: 'Este tipo de campo no usa opciones.' });
      }
      if (usesOptions && input.options.length === 0)
        throw validationError({ options: 'Agregue al menos una opción.' });
    }
    const row = await this.db.tx.customFieldDefinition.update({
      where: { id },
      data: {
        ...input,
        ...(input.options !== undefined ? { options: input.options } : {}),
      },
    });
    await this.history.record(
      'CUSTOM_FIELD',
      id,
      'UPDATE',
      actor.userId,
      diff({ ...before, options: parseOptions(before.options) }, input, [
        'label',
        'options',
        'required',
        'section',
        'helpText',
        'position',
        'active',
      ]),
    );
    return row;
  }

  /**
   * Valida los valores de campos personalizados de un registro (lo usan los módulos de datos
   * desde la Fase 2). Lanza VALIDATION_ERROR con el detalle por campo.
   */
  async validate(
    entityType: CustomFieldEntity,
    input: Record<string, unknown> | null | undefined,
    previous: CustomFieldValues = {},
  ): Promise<CustomFieldValues> {
    const defs: CustomFieldDefinitionLike[] = (await this.list(entityType, true)).map((d) => ({
      key: d.key,
      label: d.label,
      type: d.type,
      required: d.required,
      active: d.active,
      options: d.options,
    }));
    const result = validateCustomFields(defs, input, previous);
    if (!result.ok) {
      throw validationError(
        Object.fromEntries(Object.entries(result.errors).map(([k, v]) => [`customFields.${k}`, v])),
      );
    }
    return result.values;
  }
}
