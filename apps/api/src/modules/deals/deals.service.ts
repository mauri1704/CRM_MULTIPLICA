import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  can,
  normalizeName,
  normalizeText,
  type DealInput,
  type DealUpdate,
  type LineInput,
  type LineUpdate,
  type MoveStageInput,
} from '@crm/shared';
import type { Actor, AuthUser } from '../../common/auth.types';
import { conflict, forbidden, notFound, validationError } from '../../common/errors';
import { Db } from '../../infra/db';
import { RecordScopeService } from '../access/record-scope.service';
import { assertVersion, customValues } from '../access/versioning';
import { AuditService } from '../audit/audit.service';
import { CurrenciesService } from '../currencies/currencies.service';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { DuplicateDetectionService } from '../duplicates/duplicate-detection.service';
import { HistoryService, diff } from '../history/history.service';
import { SequenceService } from '../sequences/sequence.service';
import { positionAt } from '../sales/board';
import { LineItemsService, type LineParent } from '../sales/line-items.service';
import { StagesService } from '../sales/stages';
import { TrashService } from '../trash/trash.service';
import type { TrashHandler } from '../trash/trash.types';

export interface DealQuery {
  q?: string;
  pipelineId?: string;
  stageId?: string;
  ownerId?: string;
  priorityId?: string;
  companyId?: string;
  contactId?: string;
  status?: 'OPEN' | 'WON' | 'LOST';
  sort?: 'createdAt' | 'title' | 'code' | 'total' | 'expectedCloseDate';
  dir?: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export const dealInclude = {
  company: { select: { id: true, code: true, legalName: true, deletedAt: true } },
  pipeline: { select: { id: true, name: true } },
  stage: { select: { id: true, name: true, kind: true, color: true, probability: true } },
  owner: { select: { id: true, name: true } },
  priority: { select: { id: true, name: true, color: true, icon: true, rank: true } },
  lossReason: { select: { id: true, name: true } },
  sourceLead: { select: { id: true, code: true, title: true } },
  contacts: {
    select: {
      isPrimary: true,
      contact: {
        select: {
          id: true,
          code: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          deletedAt: true,
        },
      },
    },
  },
} satisfies Prisma.DealInclude;
type Row = Prisma.DealGetPayload<{ include: typeof dealInclude }>;

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export const dealDto = (d: Row) => ({
  id: d.id,
  code: d.code,
  title: d.title,
  sourceLead: d.sourceLead,
  company:
    d.company && !d.company.deletedAt
      ? { id: d.company.id, code: d.company.code, legalName: d.company.legalName }
      : null,
  companyId: d.companyId,
  contacts: d.contacts
    .filter((c) => !c.contact.deletedAt)
    .map((c) => ({
      id: c.contact.id,
      code: c.contact.code,
      name: [c.contact.firstName, c.contact.lastName].filter(Boolean).join(' '),
      email: c.contact.email,
      phone: c.contact.phone,
      isPrimary: c.isPrimary,
    }))
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)),
  pipeline: d.pipeline,
  pipelineId: d.pipelineId,
  stage: d.stage,
  stageId: d.stageId,
  stagePosition: d.stagePosition,
  stageChangedAt: d.stageChangedAt,
  owner: d.owner,
  ownerId: d.ownerId,
  priority: d.priority,
  priorityId: d.priorityId,
  currencyCode: d.currencyCode,
  estimatedValue: d.estimatedValue?.toFixed(4) ?? null,
  subtotal: d.subtotal.toFixed(4),
  discount: d.discount.toFixed(4),
  total: d.total.toFixed(4),
  finalValue: d.finalValue?.toFixed(4) ?? null,
  probability: d.probability,
  expectedCloseDate: isoDate(d.expectedCloseDate),
  status: d.status as 'OPEN' | 'WON' | 'LOST',
  closedAt: isoDate(d.closedAt),
  lossReason: d.lossReason,
  lossReasonId: d.lossReasonId,
  lossNote: d.lossNote,
  notes: d.notes,
  customFields: customValues(d.customFields),
  version: d.version,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});
export type DealDto = ReturnType<typeof dealDto>;

const FIELDS = [
  'title',
  'companyId',
  'ownerId',
  'priorityId',
  'currencyCode',
  'estimatedValue',
  'probability',
  'expectedCloseDate',
  'notes',
  'customFields',
] as const;
const toDate = (v: string | null | undefined) =>
  v ? new Date(`${v}T00:00:00.000Z`) : v === null ? null : undefined;

@Injectable()
export class DealsService implements OnModuleInit, TrashHandler {
  readonly entityType = 'DEAL' as const;

  constructor(
    private readonly db: Db,
    private readonly history: HistoryService,
    private readonly audit: AuditService,
    private readonly trash: TrashService,
    private readonly sequences: SequenceService,
    private readonly scope: RecordScopeService,
    private readonly customFields: CustomFieldsService,
    private readonly currencies: CurrenciesService,
    private readonly stages: StagesService,
    private readonly lines: LineItemsService,
    private readonly duplicates: DuplicateDetectionService,
  ) {}

  onModuleInit(): void {
    this.trash.register(this);
  }

  async where(
    user: AuthUser,
    q: Omit<DealQuery, 'page' | 'pageSize' | 'sort' | 'dir'>,
    action: 'view' | 'export' = 'view',
  ) {
    const norm = normalizeText(q.q);
    return {
      organizationId: user.organizationId,
      deletedAt: null,
      ...(await this.scope.ownerWhere(user, 'deals', action)),
      ...(q.ownerId ? { AND: [{ ownerId: q.ownerId }] } : {}),
      ...(q.pipelineId ? { pipelineId: q.pipelineId } : {}),
      ...(q.stageId ? { stageId: q.stageId } : {}),
      ...(q.priorityId ? { priorityId: q.priorityId } : {}),
      ...(q.companyId ? { companyId: q.companyId } : {}),
      ...(q.contactId ? { contacts: { some: { contactId: q.contactId } } } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(norm ? { searchNorm: { contains: norm } } : {}),
    } satisfies Prisma.DealWhereInput;
  }

  async list(user: AuthUser, q: DealQuery) {
    const where = await this.where(user, q);
    const [items, total] = await Promise.all([
      this.db.tx.deal.findMany({
        where,
        include: dealInclude,
        orderBy: { [q.sort ?? 'createdAt']: q.dir ?? 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.tx.deal.count({ where }),
    ]);
    return { items: items.map(dealDto), total, page: q.page, pageSize: q.pageSize };
  }

  listRaw(where: Prisma.DealWhereInput, limit: number) {
    return this.db.tx.deal.findMany({
      where,
      include: dealInclude,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async board(user: AuthUser, q: Omit<DealQuery, 'page' | 'pageSize' | 'sort' | 'dir'>) {
    const pipeline = q.pipelineId
      ? await this.db.tx.pipeline.findFirst({
          where: { id: q.pipelineId, organizationId: user.organizationId, entityType: 'DEAL' },
        })
      : await this.stages.defaultPipeline('DEAL');
    if (!pipeline) throw notFound('El pipeline');
    const stageList = await this.db.tx.stage.findMany({
      where: { organizationId: user.organizationId, pipelineId: pipeline.id, active: true },
      orderBy: { position: 'asc' },
    });
    const items = await this.db.tx.deal.findMany({
      where: await this.where(user, { ...q, pipelineId: pipeline.id }),
      include: dealInclude,
      orderBy: [{ stagePosition: 'asc' }, { id: 'asc' }],
      take: 1000,
    });
    return {
      pipeline: { id: pipeline.id, name: pipeline.name },
      truncated: items.length === 1000,
      columns: stageList.map((s) => {
        const cards = items.filter((i) => i.stageId === s.id);
        const sums = new Map<string, Prisma.Decimal>();
        for (const c of cards) {
          const v =
            c.finalValue ??
            (c.total.isZero() ? (c.estimatedValue ?? new Prisma.Decimal(0)) : c.total);
          sums.set(c.currencyCode, (sums.get(c.currencyCode) ?? new Prisma.Decimal(0)).plus(v));
        }
        return {
          stage: { id: s.id, name: s.name, kind: s.kind, color: s.color },
          count: cards.length,
          sums: [...sums.entries()].map(([currencyCode, amount]) => ({
            currencyCode,
            amount: amount.toFixed(4),
          })),
          items: cards.map(dealDto),
        };
      }),
    };
  }

  private async findAlive(id: string) {
    const d = await this.db.tx.deal.findFirst({
      where: { id, organizationId: this.db.organizationId, deletedAt: null },
      include: dealInclude,
    });
    if (!d) throw notFound('La negociación');
    return d;
  }

  async get(user: AuthUser, id: string) {
    const d = await this.findAlive(id);
    await this.scope.assert(user, 'deals', 'view', d.ownerId);
    return { ...dealDto(d), products: await this.lines.list({ kind: 'DEAL', id }) };
  }

  /** Con la negociación ganada o perdida, importes y tasas quedan congelados (D-06). */
  private assertOpen(d: { status: string }) {
    if (d.status !== 'OPEN') {
      throw conflict(
        'La negociación está cerrada: sus importes quedan congelados. Reábrala para modificarla.',
      );
    }
  }

  async check(input: Partial<DealInput>) {
    if (input.companyId) {
      const c = await this.db.tx.company.findFirst({
        where: { id: input.companyId, organizationId: this.db.organizationId, deletedAt: null },
      });
      if (!c) throw validationError({ companyId: 'La compañía no existe o está en la papelera.' });
    }
    const contactIds = [
      ...new Set([
        ...(input.contactIds ?? []),
        ...(input.primaryContactId ? [input.primaryContactId] : []),
      ]),
    ];
    if (contactIds.length > 0) {
      const n = await this.db.tx.contact.count({
        where: { id: { in: contactIds }, organizationId: this.db.organizationId, deletedAt: null },
      });
      if (n !== contactIds.length)
        throw validationError({ contactIds: 'Algún contacto no existe o está en la papelera.' });
    }
    if (input.priorityId) await this.stages.assertPriority(input.priorityId);
    if (input.currencyCode) await this.currencies.assertActive(input.currencyCode);
  }

  private async setContacts(
    dealId: string,
    contactIds: string[],
    primaryId: string | null | undefined,
  ) {
    const ids = [...new Set([...(primaryId ? [primaryId] : []), ...contactIds])];
    await this.db.tx.dealContact.deleteMany({
      where: { organizationId: this.db.organizationId, dealId },
    });
    if (ids.length > 0) {
      const primary = primaryId ?? ids[0];
      await this.db.tx.dealContact.createMany({
        data: ids.map((contactId) => ({
          organizationId: this.db.organizationId,
          dealId,
          contactId,
          isPrimary: contactId === primary,
        })),
      });
    }
  }

  private async searchNorm(code: string, title: string, companyId: string | null | undefined) {
    const c = companyId
      ? await this.db.tx.company.findFirst({
          where: { id: companyId },
          select: { legalName: true },
        })
      : null;
    return normalizeText([code, title, c?.legalName].filter(Boolean).join(' '));
  }

  /** Recalcula el texto de búsqueda (p. ej. tras mover una compañía por una fusión). */
  async reindex(ids: string[]): Promise<void> {
    for (const id of ids) {
      const d = await this.db.tx.deal.findFirst({
        where: { id, organizationId: this.db.organizationId },
        select: { code: true, title: true, companyId: true },
      });
      if (!d) continue;
      await this.db.tx.deal.updateMany({
        where: { id, organizationId: this.db.organizationId },
        data: { searchNorm: await this.searchNorm(d.code, d.title, d.companyId) },
      });
    }
  }

  async create(user: AuthUser, input: DealInput) {
    await this.check(input);
    const ownerId = await this.scope.resolveOwner(user, 'deals', 'create', input.ownerId);
    const stage = await this.stages.initial('DEAL', input.pipelineId, input.stageId);
    const custom = await this.customFields.validate('DEAL', input.customFields);
    const currencyCode =
      input.currencyCode ??
      (await this.db.q.organization.findUniqueOrThrow({ where: { id: user.organizationId } }))
        .baseCurrencyCode;
    const code = await this.sequences.next('DEAL');
    const top = await this.db.tx.deal.aggregate({
      where: { organizationId: user.organizationId, stageId: stage.id, deletedAt: null },
      _min: { stagePosition: true },
    });
    await this.duplicates.assertNoBlocking('DEAL', { ...input, customFields: custom });
    const deal = await this.db.tx.deal.create({
      data: {
        organizationId: user.organizationId,
        code,
        title: input.title,
        companyId: input.companyId ?? null,
        pipelineId: stage.pipelineId,
        stageId: stage.id,
        stagePosition: (top._min.stagePosition ?? 1000) - 1000,
        ownerId,
        priorityId: input.priorityId ?? (await this.stages.defaultPriorityId()),
        currencyCode,
        estimatedValue: input.estimatedValue ? new Prisma.Decimal(input.estimatedValue) : null,
        probability: input.probability ?? stage.probability,
        expectedCloseDate: toDate(input.expectedCloseDate) ?? null,
        notes: input.notes ?? null,
        customFields: custom as Prisma.InputJsonValue,
        nameNorm: normalizeName(input.title),
        searchNorm: await this.searchNorm(code, input.title, input.companyId),
        createdById: user.id,
        updatedById: user.id,
      },
    });
    await this.setContacts(deal.id, input.contactIds ?? [], input.primaryContactId);
    await this.history.record('DEAL', deal.id, 'CREATE', user.id, {
      code,
      title: deal.title,
      stage: stage.name,
      ownerId,
    });
    await this.duplicates.onSaved('DEAL', deal.id);
    return this.get(user, deal.id);
  }

  async update(user: AuthUser, id: string, input: DealUpdate) {
    const before = await this.findAlive(id);
    await this.scope.assert(user, 'deals', 'edit', before.ownerId);
    const {
      version,
      customFields,
      contactIds,
      primaryContactId,
      pipelineId: _p,
      stageId: _s,
      ...fields
    } = input;
    const currencyChanged =
      fields.currencyCode !== undefined && fields.currencyCode !== before.currencyCode;
    if (before.status !== 'OPEN' && (currencyChanged || fields.estimatedValue !== undefined))
      this.assertOpen(before);
    await this.check({ ...fields, contactIds, primaryContactId });
    await this.duplicates.assertNoBlocking(
      'DEAL',
      {
        title: fields.title ?? before.title,
        companyId: fields.companyId !== undefined ? fields.companyId : before.companyId,
        customFields: customFields ?? customValues(before.customFields),
      },
      id,
    );
    if (fields.ownerId !== undefined && fields.ownerId !== before.ownerId) {
      fields.ownerId = await this.scope.resolveOwner(user, 'deals', 'edit', fields.ownerId);
    }
    const custom =
      customFields !== undefined
        ? await this.customFields.validate('DEAL', customFields, customValues(before.customFields))
        : undefined;
    const beforeFlat = {
      ...before,
      expectedCloseDate: isoDate(before.expectedCloseDate),
      customFields: customValues(before.customFields),
    };
    const changes = diff(
      beforeFlat,
      { ...fields, ...(custom !== undefined ? { customFields: custom } : {}) },
      FIELDS,
    );
    if (contactIds !== undefined || primaryContactId !== undefined) {
      const prev = before.contacts.map((c) => `${c.contact.id}${c.isPrimary ? '*' : ''}`).sort();
      const ids = [
        ...new Set([
          ...(primaryContactId ? [primaryContactId] : []),
          ...(contactIds ?? before.contacts.map((c) => c.contact.id)),
        ]),
      ];
      const primary = primaryContactId ?? ids[0];
      const next = ids.map((i) => `${i}${i === primary ? '*' : ''}`).sort();
      if (JSON.stringify(prev) !== JSON.stringify(next)) {
        changes.contactos = { from: prev, to: next };
        await this.setContacts(id, ids, primary);
      }
    }
    if (Object.keys(changes).length === 0) return this.get(user, id);
    const res = await this.db.tx.deal.updateMany({
      where: {
        id,
        organizationId: user.organizationId,
        deletedAt: null,
        ...(version !== undefined ? { version } : {}),
      },
      data: {
        ...fields,
        estimatedValue:
          fields.estimatedValue === undefined
            ? undefined
            : fields.estimatedValue
              ? new Prisma.Decimal(fields.estimatedValue)
              : null,
        expectedCloseDate: toDate(fields.expectedCloseDate),
        ...(custom !== undefined ? { customFields: custom as Prisma.InputJsonValue } : {}),
        nameNorm: normalizeName(fields.title ?? before.title),
        searchNorm: await this.searchNorm(
          before.code,
          fields.title ?? before.title,
          fields.companyId !== undefined ? fields.companyId : before.companyId,
        ),
        version: { increment: 1 },
        updatedById: user.id,
      },
    });
    assertVersion(res.count);
    if (currencyChanged)
      await this.lines.reprice(user, { kind: 'DEAL', id, currencyCode: fields.currencyCode! });
    await this.history.record('DEAL', id, 'UPDATE', user.id, changes);
    await this.duplicates.onSaved('DEAL', id);
    return this.get(user, id);
  }

  /**
   * Mover de etapa. El estado sigue al tipo de etapa (D-19): ganar exige valor final (por defecto
   * el total) y fecha de cierre; perder exige motivo; reabrir una cerrada exige alcance de equipo.
   */
  async move(user: AuthUser, id: string, input: MoveStageInput, ip?: string) {
    const deal = await this.findAlive(id);
    await this.scope.assert(user, 'deals', 'edit', deal.ownerId);
    const stage = await this.stages.stage('DEAL', input.stageId);
    const newStatus = stage.kind === 'WON' ? 'WON' : stage.kind === 'LOST' ? 'LOST' : 'OPEN';
    const reopening = deal.status !== 'OPEN' && newStatus === 'OPEN';
    if (reopening && !can(user.permissions, 'deals', 'edit', 'TEAM')) {
      throw forbidden('Reabrir una negociación cerrada requiere autorización de un supervisor.');
    }
    if (newStatus === 'LOST' && deal.status !== 'LOST')
      await this.stages.assertLossReason('DEAL', input.lossReasonId);
    const others = await this.db.tx.deal.findMany({
      where: {
        organizationId: user.organizationId,
        stageId: stage.id,
        deletedAt: null,
        id: { not: id },
      },
      orderBy: { stagePosition: 'asc' },
      select: { stagePosition: true },
    });
    const statusChanged = newStatus !== deal.status;
    const today = await this.lines.today();
    const closing: Prisma.DealUncheckedUpdateManyInput = !statusChanged
      ? {}
      : newStatus === 'WON'
        ? {
            finalValue: new Prisma.Decimal(
              input.finalValue ??
                (deal.total.isZero() ? (deal.estimatedValue ?? deal.total) : deal.total).toString(),
            ),
            closedAt: toDate(input.closedAt ?? today),
            probability: 100,
            lossReasonId: null,
            lossNote: null,
          }
        : newStatus === 'LOST'
          ? {
              closedAt: toDate(input.closedAt ?? today),
              probability: 0,
              lossReasonId: input.lossReasonId,
              lossNote: input.lossNote ?? null,
              finalValue: null,
            }
          : {
              closedAt: null,
              finalValue: null,
              lossReasonId: null,
              lossNote: null,
              probability: stage.probability,
            };
    const stageChanged = stage.id !== deal.stageId;
    const res = await this.db.tx.deal.updateMany({
      where: {
        id,
        organizationId: user.organizationId,
        ...(input.version !== undefined ? { version: input.version } : {}),
      },
      data: {
        pipelineId: stage.pipelineId,
        stageId: stage.id,
        stagePosition: positionAt(
          others.map((o) => o.stagePosition),
          input.index,
        ),
        status: newStatus,
        ...(stageChanged ? { stageChangedAt: new Date() } : {}),
        ...(stageChanged && !statusChanged && stage.probability !== null
          ? { probability: stage.probability }
          : {}),
        ...closing,
        version: { increment: 1 },
        updatedById: user.id,
      },
    });
    assertVersion(res.count);
    if (stageChanged || statusChanged) {
      await this.history.record('DEAL', id, 'STAGE_CHANGE', user.id, {
        stage: { from: deal.stage.name, to: stage.name },
        ...(statusChanged ? { status: { from: deal.status, to: newStatus } } : {}),
        ...(newStatus === 'WON' && statusChanged
          ? { finalValue: { from: null, to: closing.finalValue?.toString() } }
          : {}),
        ...(newStatus === 'LOST' && statusChanged
          ? {
              lossReasonId: { from: null, to: input.lossReasonId },
              lossNote: { from: null, to: input.lossNote ?? null },
            }
          : {}),
      });
    }
    if (reopening) {
      await this.audit.log('DEAL_REOPENED', {
        userId: user.id,
        entityType: 'DEAL',
        entityId: id,
        ip,
        details: { code: deal.code, from: deal.status },
      });
    }
    return dealDto(await this.findAlive(id));
  }

  async remove(user: AuthUser, id: string, actor: Actor) {
    const d = await this.findAlive(id);
    await this.scope.assert(user, 'deals', 'delete', d.ownerId);
    await this.db.tx.deal.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: user.id },
    });
    await this.trash.add(
      'DEAL',
      {
        id,
        displayName: d.title,
        code: d.code,
        ownerId: d.ownerId,
        relations: d.company ? { compañía: d.company.legalName } : {},
      },
      actor,
    );
  }

  // --- Productos asociados --------------------------------------------------------------------

  private async parentFor(user: AuthUser, id: string): Promise<LineParent> {
    const d = await this.findAlive(id);
    await this.scope.assert(user, 'deals', 'edit', d.ownerId);
    this.assertOpen(d);
    return { kind: 'DEAL', id, currencyCode: d.currencyCode };
  }

  async addLine(user: AuthUser, id: string, input: LineInput) {
    return this.lines.add(user, await this.parentFor(user, id), input);
  }

  async updateLine(user: AuthUser, id: string, lineId: string, input: LineUpdate) {
    return this.lines.update(user, await this.parentFor(user, id), lineId, input);
  }

  async removeLine(user: AuthUser, id: string, lineId: string) {
    await this.lines.remove(user, await this.parentFor(user, id), lineId);
  }

  /** "Actualizar tasas": recalcula con la tasa vigente hoy. Solo negociaciones abiertas (D-06). */
  async refreshRates(user: AuthUser, id: string) {
    const parent = await this.parentFor(user, id);
    const changed = await this.lines.reprice(user, parent);
    await this.history.record('DEAL', id, 'UPDATE', user.id, {
      tasas: { from: null, to: `Actualizadas (${changed} línea(s) cambiaron)` },
    });
    return { changed, deal: await this.get(user, id) };
  }

  // --- Papelera -------------------------------------------------------------------------------

  async restoreConflicts(entityId: string): Promise<string[]> {
    const d = await this.db.tx.deal.findFirst({
      where: { id: entityId, organizationId: this.db.organizationId },
      include: { company: true },
    });
    if (!d) return ['La negociación ya no existe.'];
    return d.company?.deletedAt
      ? [`Su compañía «${d.company.legalName}» está en la papelera: restáurela primero.`]
      : [];
  }

  async restore(entityId: string, actor: Actor): Promise<void> {
    await this.db.tx.deal.updateMany({
      where: { id: entityId, organizationId: actor.organizationId },
      data: {
        deletedAt: null,
        deletedById: null,
        updatedById: actor.userId,
        version: { increment: 1 },
      },
    });
  }

  async purgeBlockers(_entityId: string): Promise<string[]> {
    return [];
  }

  async purge(entityId: string): Promise<void> {
    await this.db.tx.deal.deleteMany({
      where: { id: entityId, organizationId: this.db.organizationId, deletedAt: { not: null } },
    });
  }
}
