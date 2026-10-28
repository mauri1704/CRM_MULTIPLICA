import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CUSTOM_PREFIX,
  DUPLICATE_ENTITIES,
  can,
  type CandidateStatus,
  type CheckDuplicatesInput,
  type DuplicateCondition,
  type DuplicateEntity,
  type DuplicateRuleInput,
  type DuplicateRuleUpdate,
} from '@crm/shared';
import type { AuthUser } from '../../common/auth.types';
import { forbidden, notFound, validationError } from '../../common/errors';
import { Db } from '../../infra/db';
import { RecordScopeService } from '../access/record-scope.service';
import { AuditService } from '../audit/audit.service';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { DuplicateDetectionService } from './duplicate-detection.service';
import { ENTITIES } from './duplicate-entities';

export interface CandidateQuery {
  status: CandidateStatus;
  entityType?: DuplicateEntity;
  page: number;
  pageSize: number;
}

const customEntities = ['LEAD', 'DEAL', 'CONTACT', 'COMPANY', 'PRODUCT'] as const;
const raw = (s: string) => Prisma.raw(s);

/** Reglas, búsqueda bajo demanda y revisión de candidatos. La fusión vive en MergeService. */
@Injectable()
export class DuplicatesService {
  constructor(
    private readonly db: Db,
    private readonly detection: DuplicateDetectionService,
    private readonly scope: RecordScopeService,
    private readonly audit: AuditService,
    private readonly customFields: CustomFieldsService,
  ) {}

  // --- Reglas ---------------------------------------------------------------------------------

  async listRules(entityType?: DuplicateEntity) {
    const rows = await this.db.tx.duplicateRule.findMany({
      where: { organizationId: this.db.organizationId, ...(entityType ? { entityType } : {}) },
      orderBy: [{ entityType: 'asc' }, { name: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      entityType: r.entityType as DuplicateEntity,
      name: r.name,
      active: r.active,
      action: r.action as 'WARN' | 'BLOCK',
      conditions: r.conditions as unknown as DuplicateCondition[],
    }));
  }

  /** Los campos personalizados de la condición deben existir y estar activos en el módulo. */
  private async checkCustom(entity: DuplicateEntity, conditions: DuplicateCondition[]) {
    const custom = conditions.filter((c) => c.field.startsWith(CUSTOM_PREFIX));
    if (custom.length === 0) return;
    if (!(customEntities as readonly string[]).includes(entity)) {
      throw validationError({ conditions: 'Este módulo no tiene campos personalizados.' });
    }
    const defs = await this.customFields.list(entity as (typeof customEntities)[number]);
    for (const c of custom) {
      const key = c.field.slice(CUSTOM_PREFIX.length);
      if (!defs.some((d) => d.key === key)) {
        throw validationError({ conditions: `El campo personalizado «${key}» no existe.` });
      }
    }
  }

  async createRule(user: AuthUser, input: DuplicateRuleInput, ip?: string) {
    await this.checkCustom(input.entityType, input.conditions);
    const exists = await this.db.tx.duplicateRule.findFirst({
      where: {
        organizationId: user.organizationId,
        entityType: input.entityType,
        name: input.name,
      },
    });
    if (exists)
      throw validationError({ name: 'Ya existe una regla con ese nombre en este módulo.' });
    const r = await this.db.tx.duplicateRule.create({
      data: { ...input, organizationId: user.organizationId, conditions: input.conditions },
    });
    await this.audit.log('DUPLICATE_RULE_CHANGED', {
      userId: user.id,
      ip,
      details: { action: 'created', name: r.name, entityType: r.entityType },
    });
    return (await this.listRules(input.entityType)).find((x) => x.id === r.id)!;
  }

  async updateRule(user: AuthUser, id: string, input: DuplicateRuleUpdate, ip?: string) {
    const before = await this.db.tx.duplicateRule.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!before) throw notFound('La regla');
    const entity = (input.entityType ?? before.entityType) as DuplicateEntity;
    const conditions = input.conditions ?? (before.conditions as unknown as DuplicateCondition[]);
    if (input.conditions) {
      // Misma validación que al crear (campos y modos permitidos).
      const { duplicateRuleInput } = await import('@crm/shared');
      const parsed = duplicateRuleInput.safeParse({
        entityType: entity,
        name: input.name ?? before.name,
        active: input.active ?? before.active,
        action: input.action ?? before.action,
        conditions,
      });
      if (!parsed.success) {
        throw validationError({
          conditions: parsed.error.issues[0]?.message ?? 'Condiciones no válidas.',
        });
      }
      await this.checkCustom(entity, conditions);
    }
    if (input.name && input.name !== before.name) {
      const clash = await this.db.tx.duplicateRule.findFirst({
        where: {
          organizationId: user.organizationId,
          entityType: entity,
          name: input.name,
          id: { not: id },
        },
      });
      if (clash)
        throw validationError({ name: 'Ya existe una regla con ese nombre en este módulo.' });
    }
    await this.db.tx.duplicateRule.updateMany({
      where: { id, organizationId: user.organizationId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.action !== undefined ? { action: input.action } : {}),
        ...(input.conditions !== undefined ? { conditions: input.conditions } : {}),
      },
    });
    await this.audit.log('DUPLICATE_RULE_CHANGED', {
      userId: user.id,
      ip,
      details: {
        action: 'updated',
        name: input.name ?? before.name,
        entityType: entity,
        changes: Object.keys(input),
      },
    });
    return (await this.listRules(entity)).find((x) => x.id === id)!;
  }

  async deleteRule(user: AuthUser, id: string, ip?: string) {
    const before = await this.db.tx.duplicateRule.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!before) throw notFound('La regla');
    await this.db.tx.duplicateRule.deleteMany({
      where: { id, organizationId: user.organizationId },
    });
    await this.audit.log('DUPLICATE_RULE_CHANGED', {
      userId: user.id,
      ip,
      details: { action: 'deleted', name: before.name, entityType: before.entityType },
    });
  }

  // --- Búsqueda y aviso -----------------------------------------------------------------------

  /** «Buscar duplicados»: solo los módulos que el usuario puede ver. */
  async scan(user: AuthUser, entityType?: DuplicateEntity) {
    const entities = (entityType ? [entityType] : [...DUPLICATE_ENTITIES]).filter((e) =>
      can(user.permissions, ENTITIES[e].module, 'view'),
    );
    if (entityType && entities.length === 0) throw forbidden();
    return this.detection.scan(entities);
  }

  check(user: AuthUser, input: CheckDuplicatesInput) {
    if (!can(user.permissions, ENTITIES[input.entityType].module, 'view')) throw forbidden();
    return this.detection.check(user, input.entityType, input.values, input.excludeId);
  }

  // --- Candidatos -----------------------------------------------------------------------------

  /** Ids de usuarios del alcance de «ver duplicados», o null si es «todos». */
  private async scopeIds(user: AuthUser): Promise<string[] | null> {
    return this.scope.ownerIds(user, 'duplicates', 'view');
  }

  /** Condición SQL por entidad: ambos registros vigentes y, con alcance limitado, alguno propio. */
  private entityClause(entity: DuplicateEntity, ids: string[] | null, requireAlive: boolean) {
    const m = ENTITIES[entity];
    const pair = Prisma.sql`r.id IN (c.record_a_id, c.record_b_id)`;
    const alive = requireAlive
      ? Prisma.sql`(SELECT count(*) FROM ${raw(m.table)} r WHERE ${pair} AND r.deleted_at IS NULL) = 2`
      : Prisma.sql`true`;
    const owned =
      ids === null || !m.ownerColumn
        ? Prisma.sql`true`
        : Prisma.sql`EXISTS (SELECT 1 FROM ${raw(m.table)} r WHERE ${pair} AND r.${raw(m.ownerColumn)} = ANY(${ids}::uuid[]))`;
    return Prisma.sql`(c.entity_type = ${entity} AND ${alive} AND ${owned})`;
  }

  private async visibleWhere(user: AuthUser, q: Pick<CandidateQuery, 'status' | 'entityType'>) {
    const ids = await this.scopeIds(user);
    const entities = (q.entityType ? [q.entityType] : [...DUPLICATE_ENTITIES]).filter((e) =>
      can(user.permissions, ENTITIES[e].module, 'view'),
    );
    if (entities.length === 0) return null;
    return Prisma.sql`c.organization_id = ${user.organizationId}::uuid AND c.status = ${q.status}
      AND (${Prisma.join(
        entities.map((e) => this.entityClause(e, ids, q.status !== 'MERGED')),
        ' OR ',
      )})`;
  }

  async list(user: AuthUser, q: CandidateQuery) {
    const where = await this.visibleWhere(user, q);
    if (!where) return { items: [], total: 0, page: q.page, pageSize: q.pageSize };
    const [rows, count] = await Promise.all([
      this.db.tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT c.id FROM duplicate_candidates c WHERE ${where}
        ORDER BY c.score DESC, c.created_at DESC
        OFFSET ${(q.page - 1) * q.pageSize} LIMIT ${q.pageSize}`),
      this.db.tx.$queryRaw<{ n: bigint }[]>(
        Prisma.sql`SELECT count(*) AS n FROM duplicate_candidates c WHERE ${where}`,
      ),
    ]);
    const items = await this.db.tx.duplicateCandidate.findMany({
      where: { organizationId: user.organizationId, id: { in: rows.map((r) => r.id) } },
    });
    const order = new Map(rows.map((r, i) => [r.id, i]));
    items.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    const dtos = [];
    for (const c of items) dtos.push(await this.dto(c));
    return { items: dtos, total: Number(count[0]?.n ?? 0), page: q.page, pageSize: q.pageSize };
  }

  /** Cuántos hay por revisar, por módulo (para el menú y las pestañas). */
  async counts(user: AuthUser) {
    const out: Record<string, number> = {};
    for (const e of DUPLICATE_ENTITIES) {
      const where = await this.visibleWhere(user, { status: 'OPEN', entityType: e });
      if (!where) continue;
      const r = await this.db.tx.$queryRaw<{ n: bigint }[]>(
        Prisma.sql`SELECT count(*) AS n FROM duplicate_candidates c WHERE ${where}`,
      );
      out[e] = Number(r[0]?.n ?? 0);
    }
    return out;
  }

  async dto(c: Prisma.DuplicateCandidateGetPayload<object>) {
    const entity = c.entityType as DuplicateEntity;
    const labels = await this.detection.labels(entity, [c.recordAId, c.recordBId]);
    const side = (id: string) => {
      const l = labels.get(id);
      return {
        id,
        code: l?.code ?? null,
        name: l?.name ?? '—',
        createdAt: l?.createdAt ?? null,
        deleted: !!l?.deletedAt,
      };
    };
    return {
      id: c.id,
      entityType: entity,
      status: c.status as CandidateStatus,
      score: Number(c.score),
      source: c.source,
      matched: c.matched as unknown as { rule: string; fields: string[]; score: number }[],
      a: side(c.recordAId),
      b: side(c.recordBId),
      createdAt: c.createdAt,
      reviewedAt: c.reviewedAt,
    };
  }

  /** Candidato visible para el usuario (existe y alguno de sus registros está en su alcance). */
  async findVisible(user: AuthUser, id: string) {
    const c = await this.db.tx.duplicateCandidate.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!c) throw notFound('La coincidencia');
    const entity = c.entityType as DuplicateEntity;
    if (!can(user.permissions, ENTITIES[entity].module, 'view')) throw notFound('La coincidencia');
    const ids = await this.scopeIds(user);
    if (ids !== null && ENTITIES[entity].ownerColumn) {
      const labels = await this.detection.labels(entity, [c.recordAId, c.recordBId]);
      const ok = [c.recordAId, c.recordBId].some((r) => {
        const o = labels.get(r)?.ownerId;
        return !!o && ids.includes(o);
      });
      if (!ok) throw notFound('La coincidencia');
    }
    return c;
  }

  async resolve(user: AuthUser, id: string, status: 'KEPT_BOTH' | 'REVIEWED') {
    const c = await this.findVisible(user, id);
    if (c.status !== 'OPEN')
      throw validationError({ status: 'Esta coincidencia ya fue resuelta.' });
    await this.db.tx.duplicateCandidate.updateMany({
      where: { id, organizationId: user.organizationId, status: 'OPEN' },
      data: { status, reviewedById: user.id, reviewedAt: new Date() },
    });
    return this.dto(await this.db.tx.duplicateCandidate.findFirstOrThrow({ where: { id } }));
  }
}
