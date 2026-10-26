import { Injectable } from '@nestjs/common';
import type { PipelineEntity, PipelineInput } from '@crm/shared';
import type { Actor } from '../../common/auth.types';
import { conflict, notFound, validationError } from '../../common/errors';
import { Db } from '../../infra/db';
import { HistoryService } from '../history/history.service';

/**
 * Pipelines y etapas. Una etapa nunca se borra (puede tener registros históricos): se desactiva.
 * El orden de las etapas es el orden del arreglo recibido.
 */
@Injectable()
export class PipelinesService {
  constructor(
    private readonly db: Db,
    private readonly history: HistoryService,
  ) {}

  list(entityType?: PipelineEntity, includeInactive = false) {
    return this.db.tx.pipeline.findMany({
      where: {
        organizationId: this.db.organizationId,
        ...(entityType ? { entityType } : {}),
        ...(includeInactive ? {} : { active: true }),
      },
      include: {
        stages: {
          where: includeInactive ? {} : { active: true },
          orderBy: { position: 'asc' },
        },
      },
      orderBy: [{ entityType: 'asc' }, { position: 'asc' }, { name: 'asc' }],
    });
  }

  async get(id: string) {
    const p = await this.db.tx.pipeline.findFirst({
      where: { id, organizationId: this.db.organizationId },
      include: { stages: { orderBy: { position: 'asc' } } },
    });
    if (!p) throw notFound('El pipeline');
    return p;
  }

  private async clearDefault(entityType: string) {
    await this.db.tx.pipeline.updateMany({
      where: { organizationId: this.db.organizationId, entityType, isDefault: true },
      data: { isDefault: false },
    });
  }

  async create(input: PipelineInput, actor: Actor) {
    const hasDefault = await this.db.tx.pipeline.count({
      where: {
        organizationId: actor.organizationId,
        entityType: input.entityType,
        isDefault: true,
      },
    });
    const isDefault = input.isDefault || hasDefault === 0;
    if (isDefault) await this.clearDefault(input.entityType);
    const position = await this.db.tx.pipeline.count({
      where: { organizationId: actor.organizationId, entityType: input.entityType },
    });
    const pipeline = await this.db.tx.pipeline.create({
      data: {
        organizationId: actor.organizationId,
        entityType: input.entityType,
        name: input.name,
        isDefault,
        position,
        stages: {
          create: input.stages.map((s, i) => ({
            organizationId: actor.organizationId,
            name: s.name,
            color: s.color,
            kind: s.kind,
            probability: s.probability ?? null,
            active: s.active,
            position: i,
          })),
        },
      },
    });
    await this.history.record('PIPELINE', pipeline.id, 'CREATE', actor.userId, {
      name: input.name,
      entityType: input.entityType,
      stages: input.stages.map((s) => s.name),
    });
    return this.get(pipeline.id);
  }

  async update(id: string, input: PipelineInput, actor: Actor) {
    const before = await this.get(id);
    if (input.entityType !== before.entityType) {
      throw validationError({ entityType: 'No se puede cambiar el tipo de un pipeline.' });
    }
    const incomingIds = new Set(input.stages.filter((s) => s.id).map((s) => s.id));
    const unknown = [...incomingIds].filter((sid) => !before.stages.some((s) => s.id === sid));
    if (unknown.length > 0)
      throw validationError({ stages: 'Hay etapas que no pertenecen a este pipeline.' });
    const removed = before.stages.filter((s) => !incomingIds.has(s.id));
    if (removed.length > 0) {
      throw conflict(
        `Las etapas no se eliminan (pueden tener registros): desactive ${removed.map((s) => `"${s.name}"`).join(', ')}.`,
      );
    }
    if (before.isDefault && !input.isDefault) {
      throw conflict('Debe haber un pipeline por defecto: marque otro como predeterminado.');
    }
    if (input.isDefault && !before.isDefault) await this.clearDefault(before.entityType);

    // Primero se mueven las posiciones fuera de rango para no chocar con el orden nuevo.
    await this.db.tx.stage.updateMany({
      where: { pipelineId: id, organizationId: actor.organizationId },
      data: { position: { increment: 1000 } },
    });
    for (const [i, s] of input.stages.entries()) {
      const data = {
        name: s.name,
        color: s.color,
        kind: s.kind,
        probability: s.probability ?? null,
        active: s.active,
        position: i,
      };
      if (s.id) {
        await this.db.tx.stage.update({ where: { id: s.id }, data });
      } else {
        await this.db.tx.stage.create({
          data: { ...data, organizationId: actor.organizationId, pipelineId: id },
        });
      }
    }
    await this.db.tx.pipeline.update({
      where: { id },
      data: { name: input.name, isDefault: input.isDefault },
    });

    const summary = (stages: { name: string; kind: string; active: boolean }[]) =>
      stages.map((s) => `${s.name} (${s.kind}${s.active ? '' : ', inactiva'})`);
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (before.name !== input.name) changes.name = { from: before.name, to: input.name };
    if (before.isDefault !== input.isDefault)
      changes.isDefault = { from: before.isDefault, to: input.isDefault };
    const prevStages = summary(before.stages);
    const nextStages = summary(input.stages);
    if (JSON.stringify(prevStages) !== JSON.stringify(nextStages))
      changes.stages = { from: prevStages, to: nextStages };
    await this.history.record('PIPELINE', id, 'UPDATE', actor.userId, changes);
    return this.get(id);
  }

  async setActive(id: string, active: boolean, actor: Actor) {
    const p = await this.get(id);
    if (p.active === active) return p;
    if (!active && p.isDefault) {
      throw conflict(
        'No se puede desactivar el pipeline por defecto. Marque otro como predeterminado primero.',
      );
    }
    await this.db.tx.pipeline.update({ where: { id }, data: { active } });
    await this.history.record('PIPELINE', id, active ? 'ACTIVATE' : 'DEACTIVATE', actor.userId);
    return this.get(id);
  }
}
