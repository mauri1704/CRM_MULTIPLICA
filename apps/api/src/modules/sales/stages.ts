import { Injectable } from '@nestjs/common';
import type { PipelineEntity } from '@crm/shared';
import { conflict, validationError } from '../../common/errors';
import { Db } from '../../infra/db';

/** Resolución y validación de pipeline/etapa para prospectos y negociaciones. */
@Injectable()
export class StagesService {
  constructor(private readonly db: Db) {}

  async defaultPipeline(entity: PipelineEntity) {
    const p = await this.db.tx.pipeline.findFirst({
      where: { organizationId: this.db.organizationId, entityType: entity, active: true },
      orderBy: [{ isDefault: 'desc' }, { position: 'asc' }],
    });
    if (!p)
      throw conflict('No hay un pipeline activo. Configure uno en Administración → Pipelines.');
    return p;
  }

  async stage(entity: PipelineEntity, stageId: string) {
    const s = await this.db.tx.stage.findFirst({
      where: {
        id: stageId,
        organizationId: this.db.organizationId,
        pipeline: { entityType: entity },
      },
      include: { pipeline: true },
    });
    if (!s) throw validationError({ stageId: 'La etapa no existe.' });
    if (!s.active || !s.pipeline.active)
      throw validationError({ stageId: 'La etapa o su pipeline están inactivos.' });
    return s;
  }

  /** Pipeline + etapa inicial (primera etapa "en curso") para un registro nuevo. */
  async initial(entity: PipelineEntity, pipelineId?: string | null, stageId?: string | null) {
    if (stageId) {
      const s = await this.stage(entity, stageId);
      if (pipelineId && s.pipelineId !== pipelineId)
        throw validationError({ stageId: 'La etapa no pertenece al pipeline.' });
      if (s.kind !== 'OPEN')
        throw validationError({ stageId: 'Un registro nuevo empieza en una etapa en curso.' });
      return s;
    }
    const pipeline = pipelineId
      ? await this.db.tx.pipeline.findFirst({
          where: {
            id: pipelineId,
            organizationId: this.db.organizationId,
            entityType: entity,
            active: true,
          },
        })
      : await this.defaultPipeline(entity);
    if (!pipeline) throw validationError({ pipelineId: 'El pipeline no existe o está inactivo.' });
    const s = await this.db.tx.stage.findFirst({
      where: {
        organizationId: this.db.organizationId,
        pipelineId: pipeline.id,
        active: true,
        kind: 'OPEN',
      },
      orderBy: { position: 'asc' },
      include: { pipeline: true },
    });
    if (!s) throw conflict('El pipeline no tiene etapas en curso activas.');
    return s;
  }

  async defaultPriorityId(): Promise<string | null> {
    const p = await this.db.tx.priority.findFirst({
      where: { organizationId: this.db.organizationId, isDefault: true, active: true },
    });
    return p?.id ?? null;
  }

  async assertPriority(id: string) {
    const p = await this.db.tx.priority.findFirst({
      where: { id, organizationId: this.db.organizationId },
    });
    if (!p) throw validationError({ priorityId: 'La prioridad no existe.' });
  }

  async assertLossReason(entity: PipelineEntity, id: string | null | undefined) {
    if (!id) throw validationError({ lossReasonId: 'Indique el motivo de pérdida.' });
    const r = await this.db.tx.lossReason.findFirst({
      where: { id, organizationId: this.db.organizationId, entityType: entity, active: true },
    });
    if (!r)
      throw validationError({ lossReasonId: 'El motivo de pérdida no existe o está inactivo.' });
  }
}
