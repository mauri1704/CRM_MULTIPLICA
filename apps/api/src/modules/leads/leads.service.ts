import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  normalizeEmail,
  normalizeText,
  type ConvertLeadInput,
  type LeadInput,
  type LeadUpdate,
  type LineInput,
  type LineUpdate,
  type MoveStageInput,
} from '@crm/shared';
import type { Actor, AuthUser } from '../../common/auth.types';
import { conflict, notFound, validationError } from '../../common/errors';
import { Db } from '../../infra/db';
import { RecordScopeService } from '../access/record-scope.service';
import { assertVersion, customValues } from '../access/versioning';
import { CurrenciesService } from '../currencies/currencies.service';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { HistoryService, diff } from '../history/history.service';
import { SequenceService } from '../sequences/sequence.service';
import { positionAt } from '../sales/board';
import { LineItemsService, lineDto, type LineParent } from '../sales/line-items.service';
import { computeLine } from '../sales/line-math';
import { StagesService } from '../sales/stages';
import { TasksService } from '../tasks/tasks.service';
import { TrashService } from '../trash/trash.service';
import type { TrashHandler } from '../trash/trash.types';

export interface LeadQuery {
  q?: string;
  pipelineId?: string;
  stageId?: string;
  ownerId?: string;
  priorityId?: string;
  status?: 'OPEN' | 'LOST' | 'CONVERTED';
  sort?: 'createdAt' | 'title' | 'code' | 'estimatedValue';
  dir?: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export const leadInclude = {
  contact: {
    select: { id: true, code: true, firstName: true, lastName: true, email: true, deletedAt: true },
  },
  company: { select: { id: true, code: true, legalName: true, deletedAt: true } },
  source: { select: { id: true, name: true } },
  pipeline: { select: { id: true, name: true } },
  stage: { select: { id: true, name: true, kind: true, color: true } },
  owner: { select: { id: true, name: true } },
  priority: { select: { id: true, name: true, color: true, icon: true, rank: true } },
  lossReason: { select: { id: true, name: true } },
  deal: { select: { id: true, code: true, title: true, deletedAt: true } },
} satisfies Prisma.LeadInclude;
type Row = Prisma.LeadGetPayload<{ include: typeof leadInclude }>;

const alive = <T extends { deletedAt: Date | null }>(v: T | null) => (v && !v.deletedAt ? v : null);

export const leadDto = (l: Row) => ({
  id: l.id,
  code: l.code,
  title: l.title,
  contact: alive(l.contact)
    ? {
        id: l.contact!.id,
        code: l.contact!.code,
        name: [l.contact!.firstName, l.contact!.lastName].filter(Boolean).join(' '),
        email: l.contact!.email,
      }
    : null,
  contactId: l.contactId,
  company: alive(l.company)
    ? { id: l.company!.id, code: l.company!.code, legalName: l.company!.legalName }
    : null,
  companyId: l.companyId,
  phone: l.phone,
  email: l.email,
  source: l.source,
  sourceId: l.sourceId,
  pipeline: l.pipeline,
  pipelineId: l.pipelineId,
  stage: l.stage,
  stageId: l.stageId,
  stagePosition: l.stagePosition,
  stageChangedAt: l.stageChangedAt,
  owner: l.owner,
  ownerId: l.ownerId,
  priority: l.priority,
  priorityId: l.priorityId,
  currencyCode: l.currencyCode,
  estimatedValue: l.estimatedValue?.toFixed(4) ?? null,
  subtotal: l.subtotal.toFixed(4),
  discount: l.discount.toFixed(4),
  total: l.total.toFixed(4),
  notes: l.notes,
  lossReason: l.lossReason,
  lossReasonId: l.lossReasonId,
  lossNote: l.lossNote,
  convertedAt: l.convertedAt,
  deal: alive(l.deal),
  customFields: customValues(l.customFields),
  version: l.version,
  createdAt: l.createdAt,
  updatedAt: l.updatedAt,
});
export type LeadDto = ReturnType<typeof leadDto>;

const FIELDS = [
  'title',
  'contactId',
  'companyId',
  'phone',
  'email',
  'sourceId',
  'ownerId',
  'priorityId',
  'currencyCode',
  'estimatedValue',
  'notes',
  'customFields',
] as const;

@Injectable()
export class LeadsService implements OnModuleInit, TrashHandler {
  readonly entityType = 'LEAD' as const;

  constructor(
    private readonly db: Db,
    private readonly history: HistoryService,
    private readonly trash: TrashService,
    private readonly sequences: SequenceService,
    private readonly scope: RecordScopeService,
    private readonly customFields: CustomFieldsService,
    private readonly currencies: CurrenciesService,
    private readonly stages: StagesService,
    private readonly lines: LineItemsService,
    private readonly tasks: TasksService,
  ) {}

  onModuleInit(): void {
    this.trash.register(this);
  }

  async where(
    user: AuthUser,
    q: Omit<LeadQuery, 'page' | 'pageSize' | 'sort' | 'dir'>,
    action: 'view' | 'export' = 'view',
  ) {
    const norm = normalizeText(q.q);
    return {
      organizationId: user.organizationId,
      deletedAt: null,
      ...(await this.scope.ownerWhere(user, 'leads', action)),
      ...(q.ownerId ? { AND: [{ ownerId: q.ownerId }] } : {}),
      ...(q.pipelineId ? { pipelineId: q.pipelineId } : {}),
      ...(q.stageId ? { stageId: q.stageId } : {}),
      ...(q.priorityId ? { priorityId: q.priorityId } : {}),
      ...(q.status ? { stage: { kind: q.status } } : {}),
      ...(norm ? { searchNorm: { contains: norm } } : {}),
    } satisfies Prisma.LeadWhereInput;
  }

  async list(user: AuthUser, q: LeadQuery) {
    const where = await this.where(user, q);
    const [items, total] = await Promise.all([
      this.db.tx.lead.findMany({
        where,
        include: leadInclude,
        orderBy: { [q.sort ?? 'createdAt']: q.dir ?? 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.tx.lead.count({ where }),
    ]);
    return { items: items.map(leadDto), total, page: q.page, pageSize: q.pageSize };
  }

  listRaw(where: Prisma.LeadWhereInput, limit: number) {
    return this.db.tx.lead.findMany({
      where,
      include: leadInclude,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /** Kanban: columnas del pipeline con sus tarjetas, cantidad y suma por moneda. */
  async board(user: AuthUser, q: Omit<LeadQuery, 'page' | 'pageSize' | 'sort' | 'dir'>) {
    const pipeline = q.pipelineId
      ? await this.db.tx.pipeline.findFirst({
          where: { id: q.pipelineId, organizationId: user.organizationId, entityType: 'LEAD' },
        })
      : await this.stages.defaultPipeline('LEAD');
    if (!pipeline) throw notFound('El pipeline');
    const stageList = await this.db.tx.stage.findMany({
      where: { organizationId: user.organizationId, pipelineId: pipeline.id, active: true },
      orderBy: { position: 'asc' },
    });
    const where = await this.where(user, { ...q, pipelineId: pipeline.id });
    const items = await this.db.tx.lead.findMany({
      where,
      include: leadInclude,
      orderBy: { stagePosition: 'asc' },
      take: 1000,
    });
    return {
      pipeline: { id: pipeline.id, name: pipeline.name },
      truncated: items.length === 1000,
      columns: stageList.map((s) => {
        const cards = items.filter((i) => i.stageId === s.id);
        const sums = new Map<string, Prisma.Decimal>();
        for (const c of cards) {
          const v = c.total.isZero() ? (c.estimatedValue ?? new Prisma.Decimal(0)) : c.total;
          sums.set(c.currencyCode, (sums.get(c.currencyCode) ?? new Prisma.Decimal(0)).plus(v));
        }
        return {
          stage: { id: s.id, name: s.name, kind: s.kind, color: s.color },
          count: cards.length,
          sums: [...sums.entries()].map(([currencyCode, amount]) => ({
            currencyCode,
            amount: amount.toFixed(4),
          })),
          items: cards.map(leadDto),
        };
      }),
    };
  }

  private async findAlive(id: string) {
    const l = await this.db.tx.lead.findFirst({
      where: { id, organizationId: this.db.organizationId, deletedAt: null },
      include: leadInclude,
    });
    if (!l) throw notFound('El prospecto');
    return l;
  }

  async get(user: AuthUser, id: string) {
    const l = await this.findAlive(id);
    await this.scope.assert(user, 'leads', 'view', l.ownerId);
    return { ...leadDto(l), products: await this.lines.list({ kind: 'LEAD', id }) };
  }

  /** Un prospecto convertido queda como registro histórico (D-07). */
  private assertNotConverted(l: { convertedAt: Date | null }) {
    if (l.convertedAt) {
      throw conflict(
        'El prospecto ya fue convertido en negociación: queda como registro histórico y no se modifica.',
      );
    }
  }

  async check(input: Partial<LeadInput>) {
    if (input.contactId) {
      const c = await this.db.tx.contact.findFirst({
        where: { id: input.contactId, organizationId: this.db.organizationId, deletedAt: null },
      });
      if (!c) throw validationError({ contactId: 'El contacto no existe o está en la papelera.' });
    }
    if (input.companyId) {
      const c = await this.db.tx.company.findFirst({
        where: { id: input.companyId, organizationId: this.db.organizationId, deletedAt: null },
      });
      if (!c) throw validationError({ companyId: 'La compañía no existe o está en la papelera.' });
    }
    if (input.sourceId) {
      const s = await this.db.tx.leadSource.findFirst({
        where: { id: input.sourceId, organizationId: this.db.organizationId },
      });
      if (!s) throw validationError({ sourceId: 'El origen no existe.' });
    }
    if (input.priorityId) await this.stages.assertPriority(input.priorityId);
    if (input.currencyCode) await this.currencies.assertActive(input.currencyCode);
  }

  private norms(
    l: { code: string; title: string; email?: string | null; phone?: string | null },
    companyName?: string | null,
    contactName?: string | null,
  ) {
    return {
      emailNorm: normalizeEmail(l.email),
      searchNorm: normalizeText(
        [l.code, l.title, l.email, l.phone, companyName, contactName].filter(Boolean).join(' '),
      ),
    };
  }

  private async names(companyId?: string | null, contactId?: string | null) {
    const [company, contact] = await Promise.all([
      companyId
        ? this.db.tx.company.findFirst({ where: { id: companyId }, select: { legalName: true } })
        : null,
      contactId
        ? this.db.tx.contact.findFirst({
            where: { id: contactId },
            select: { firstName: true, lastName: true },
          })
        : null,
    ]);
    return {
      company: company?.legalName ?? null,
      contact: contact ? [contact.firstName, contact.lastName].filter(Boolean).join(' ') : null,
    };
  }

  async create(user: AuthUser, input: LeadInput) {
    await this.check(input);
    const ownerId = await this.scope.resolveOwner(user, 'leads', 'create', input.ownerId);
    const stage = await this.stages.initial('LEAD', input.pipelineId, input.stageId);
    const custom = await this.customFields.validate('LEAD', input.customFields);
    const currencyCode =
      input.currencyCode ??
      (await this.db.q.organization.findUniqueOrThrow({ where: { id: user.organizationId } }))
        .baseCurrencyCode;
    const code = await this.sequences.next('LEAD');
    const top = await this.db.tx.lead.aggregate({
      where: { organizationId: user.organizationId, stageId: stage.id, deletedAt: null },
      _min: { stagePosition: true },
    });
    const n = await this.names(input.companyId, input.contactId);
    const lead = await this.db.tx.lead.create({
      data: {
        organizationId: user.organizationId,
        code,
        title: input.title,
        contactId: input.contactId ?? null,
        companyId: input.companyId ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        sourceId: input.sourceId ?? null,
        pipelineId: stage.pipelineId,
        stageId: stage.id,
        stagePosition: (top._min.stagePosition ?? 1000) - 1000,
        ownerId,
        priorityId: input.priorityId ?? (await this.stages.defaultPriorityId()),
        currencyCode,
        estimatedValue: input.estimatedValue ? new Prisma.Decimal(input.estimatedValue) : null,
        notes: input.notes ?? null,
        customFields: custom as Prisma.InputJsonValue,
        ...this.norms(
          { code, title: input.title, email: input.email, phone: input.phone },
          n.company,
          n.contact,
        ),
        createdById: user.id,
        updatedById: user.id,
      },
    });
    await this.history.record('LEAD', lead.id, 'CREATE', user.id, {
      code,
      title: lead.title,
      stage: stage.name,
      ownerId,
    });
    return this.get(user, lead.id);
  }

  async update(user: AuthUser, id: string, input: LeadUpdate) {
    const before = await this.findAlive(id);
    await this.scope.assert(user, 'leads', 'edit', before.ownerId);
    this.assertNotConverted(before);
    const { version, customFields, pipelineId: _p, stageId: _s, ...fields } = input;
    await this.check(fields);
    if (fields.ownerId !== undefined && fields.ownerId !== before.ownerId) {
      fields.ownerId = await this.scope.resolveOwner(user, 'leads', 'edit', fields.ownerId);
    }
    const custom =
      customFields !== undefined
        ? await this.customFields.validate('LEAD', customFields, customValues(before.customFields))
        : undefined;
    const changes = diff(
      { ...before, customFields: customValues(before.customFields) },
      { ...fields, ...(custom !== undefined ? { customFields: custom } : {}) },
      FIELDS,
    );
    if (Object.keys(changes).length === 0) return this.get(user, id);
    const currencyChanged =
      fields.currencyCode !== undefined && fields.currencyCode !== before.currencyCode;
    const merged = { ...before, ...fields };
    const n = await this.names(merged.companyId, merged.contactId);
    const res = await this.db.tx.lead.updateMany({
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
        ...(custom !== undefined ? { customFields: custom as Prisma.InputJsonValue } : {}),
        ...this.norms(merged, n.company, n.contact),
        version: { increment: 1 },
        updatedById: user.id,
      },
    });
    assertVersion(res.count);
    // Cambiar la moneda reconvierte los productos de interés con la tasa vigente (acción explícita).
    if (currencyChanged)
      await this.lines.reprice(user, { kind: 'LEAD', id, currencyCode: fields.currencyCode! });
    await this.history.record('LEAD', id, 'UPDATE', user.id, changes);
    return this.get(user, id);
  }

  /** Mover en el Kanban (o a otro pipeline de prospectos). */
  async move(user: AuthUser, id: string, input: MoveStageInput) {
    const lead = await this.findAlive(id);
    await this.scope.assert(user, 'leads', 'edit', lead.ownerId);
    this.assertNotConverted(lead);
    const stage = await this.stages.stage('LEAD', input.stageId);
    if (stage.kind === 'CONVERTED') {
      throw validationError({
        stageId: 'Para pasar a «Convertido» use la acción «Convertir en negociación».',
      });
    }
    if (stage.kind === 'LOST') await this.stages.assertLossReason('LEAD', input.lossReasonId);
    const others = await this.db.tx.lead.findMany({
      where: {
        organizationId: user.organizationId,
        stageId: stage.id,
        deletedAt: null,
        id: { not: id },
      },
      orderBy: { stagePosition: 'asc' },
      select: { stagePosition: true },
    });
    const stageChanged = stage.id !== lead.stageId;
    const res = await this.db.tx.lead.updateMany({
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
        ...(stageChanged ? { stageChangedAt: new Date() } : {}),
        ...(stage.kind === 'LOST'
          ? { lossReasonId: input.lossReasonId, lossNote: input.lossNote ?? null }
          : { lossReasonId: null, lossNote: null }),
        version: { increment: 1 },
        updatedById: user.id,
      },
    });
    assertVersion(res.count);
    if (stageChanged) {
      await this.history.record('LEAD', id, 'STAGE_CHANGE', user.id, {
        stage: { from: lead.stage.name, to: stage.name },
        ...(stage.kind === 'LOST'
          ? {
              lossReasonId: { from: null, to: input.lossReasonId },
              lossNote: { from: null, to: input.lossNote ?? null },
            }
          : {}),
      });
    }
    return leadDto(await this.findAlive(id));
  }

  async remove(user: AuthUser, id: string, actor: Actor) {
    const l = await this.findAlive(id);
    await this.scope.assert(user, 'leads', 'delete', l.ownerId);
    await this.db.tx.lead.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: user.id },
    });
    await this.trash.add(
      'LEAD',
      {
        id,
        displayName: l.title,
        code: l.code,
        ownerId: l.ownerId,
        relations: {
          ...(l.company ? { compañía: l.company.legalName } : {}),
          ...(l.deal ? { negociación: l.deal.code } : {}),
        },
      },
      actor,
    );
  }

  // --- Productos de interés -------------------------------------------------------------------

  private async parentFor(user: AuthUser, id: string): Promise<LineParent> {
    const l = await this.findAlive(id);
    await this.scope.assert(user, 'leads', 'edit', l.ownerId);
    this.assertNotConverted(l);
    return { kind: 'LEAD', id, currencyCode: l.currencyCode };
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

  // --- Conversión (D-07) ------------------------------------------------------------------------

  /**
   * Resumen previo: qué se transfiere y cómo quedan los productos en la moneda de la negociación.
   * No escribe nada. Si falta una tasa, lo indica por línea.
   */
  async conversionPreview(user: AuthUser, id: string, currencyCode?: string) {
    const lead = await this.findAlive(id);
    await this.scope.assert(user, 'leads', 'edit', lead.ownerId);
    this.assertNotConverted(lead);
    const target = currencyCode ?? lead.currencyCode;
    await this.currencies.assertActive(target);
    const decimals = (await this.currencies.findByCode(target))?.decimals ?? 2;
    const lines = await this.db.tx.leadProduct.findMany({
      where: { organizationId: user.organizationId, leadId: id },
      orderBy: { position: 'asc' },
    });
    const preview = [];
    for (const l of lines) {
      if (l.currencyCode === target && target === lead.currencyCode) {
        preview.push({ ...lineDto(l), missingRate: false });
        continue;
      }
      try {
        const rate = await this.lines.resolveRate(user, l.currencyCode, target);
        const a = computeLine({
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discountType: l.discountType as 'AMOUNT' | 'PERCENT',
          discountValue: l.discountValue,
          rate: rate.rate,
          decimals,
        });
        preview.push({
          ...lineDto(l),
          exchangeRate: rate.rate.toFixed(10),
          exchangeRateDate: rate.date,
          rateSource: rate.source,
          lineSubtotal: a.subtotal.toFixed(4),
          lineDiscount: a.discount.toFixed(4),
          lineTotal: a.total.toFixed(4),
          missingRate: false,
        });
      } catch {
        preview.push({ ...lineDto(l), missingRate: true });
      }
    }
    const total = preview.reduce(
      (acc, l) => acc.plus(l.missingRate ? 0 : l.lineTotal),
      new Prisma.Decimal(0),
    );
    const dealDefs = await this.customFields.list('DEAL');
    const leadCustom = customValues(lead.customFields);
    return {
      lead: leadDto(lead),
      currencyCode: target,
      products: preview,
      total: total.toFixed(4),
      missingRates: preview.some((l) => l.missingRate),
      customFields: dealDefs
        .filter((d) => d.key in leadCustom)
        .map((d) => ({ key: d.key, label: d.label, value: leadCustom[d.key] })),
    };
  }

  /**
   * Conversión transaccional: si algo falla no queda nada. Un bloqueo de fila y la restricción
   * única de `deals.source_lead_id` impiden crear dos negociaciones desde el mismo prospecto.
   */
  async convert(user: AuthUser, id: string, input: ConvertLeadInput) {
    // Bloquea la fila del prospecto hasta el fin de la transacción.
    await this.db.tx
      .$queryRaw`SELECT id FROM leads WHERE id = ${id}::uuid AND organization_id = ${user.organizationId}::uuid FOR UPDATE`;
    const lead = await this.findAlive(id);
    await this.scope.assert(user, 'leads', 'edit', lead.ownerId);
    this.assertNotConverted(lead);
    if (lead.stage.kind === 'LOST')
      throw conflict(
        'El prospecto está descartado. Muévalo a una etapa en curso antes de convertirlo.',
      );
    const dealStage = await this.stages.stage('DEAL', input.stageId);
    if (dealStage.pipelineId !== input.pipelineId)
      throw validationError({ stageId: 'La etapa no pertenece al pipeline.' });
    if (dealStage.kind !== 'OPEN')
      throw validationError({ stageId: 'La negociación empieza en una etapa en curso.' });
    const convertedStage = await this.db.tx.stage.findFirst({
      where: {
        organizationId: user.organizationId,
        pipelineId: lead.pipelineId,
        kind: 'CONVERTED',
        active: true,
      },
      orderBy: { position: 'asc' },
    });
    if (!convertedStage)
      throw conflict('El pipeline del prospecto no tiene una etapa «Convertido» activa.');
    const currencyCode = input.currencyCode ?? lead.currencyCode;
    await this.currencies.assertActive(currencyCode);
    // Campos personalizados con la misma clave en negociaciones.
    const dealDefs = await this.customFields.list('DEAL');
    const leadCustom = customValues(lead.customFields);
    const custom = await this.customFields.validate(
      'DEAL',
      Object.fromEntries(
        dealDefs.filter((d) => d.key in leadCustom).map((d) => [d.key, leadCustom[d.key]]),
      ),
    );

    const correlationId = this.history.newCorrelationId();
    const code = await this.sequences.next('DEAL');
    const top = await this.db.tx.deal.aggregate({
      where: { organizationId: user.organizationId, stageId: dealStage.id, deletedAt: null },
      _min: { stagePosition: true },
    });
    const title = input.title ?? lead.title;
    let deal;
    try {
      deal = await this.db.tx.deal.create({
        data: {
          organizationId: user.organizationId,
          code,
          title,
          sourceLeadId: lead.id,
          companyId: lead.company ? lead.companyId : null,
          pipelineId: dealStage.pipelineId,
          stageId: dealStage.id,
          stagePosition: (top._min.stagePosition ?? 1000) - 1000,
          ownerId: lead.ownerId,
          priorityId: lead.priorityId,
          currencyCode,
          estimatedValue: lead.estimatedValue,
          probability: dealStage.probability,
          expectedCloseDate: input.expectedCloseDate
            ? new Date(`${input.expectedCloseDate}T00:00:00.000Z`)
            : null,
          notes: lead.notes,
          customFields: custom as Prisma.InputJsonValue,
          searchNorm: normalizeText(
            [code, title, lead.company?.legalName].filter(Boolean).join(' '),
          ),
          createdById: user.id,
          updatedById: user.id,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw conflict('Este prospecto ya fue convertido en negociación.');
      }
      throw e;
    }
    if (lead.contact) {
      await this.db.tx.dealContact.create({
        data: {
          organizationId: user.organizationId,
          dealId: deal.id,
          contactId: lead.contact.id,
          isPrimary: true,
        },
      });
    }
    // Cada producto de interés pasa a la negociación con su cantidad, precio, descuento y moneda.
    const leadLines = await this.db.tx.leadProduct.findMany({
      where: { organizationId: user.organizationId, leadId: id },
      orderBy: { position: 'asc' },
    });
    const decimals = (await this.currencies.findByCode(currencyCode))?.decimals ?? 2;
    for (const l of leadLines) {
      const keep = currencyCode === lead.currencyCode;
      const rate = keep
        ? {
            rate: l.exchangeRate,
            date: l.exchangeRateDate?.toISOString().slice(0, 10) ?? null,
            exchangeRateId: l.exchangeRateId,
            source: l.rateSource,
            reason: l.rateReason,
          }
        : await this.lines.resolveRate(user, l.currencyCode, currencyCode);
      const a = keep
        ? { subtotal: l.lineSubtotal, discount: l.lineDiscount, total: l.lineTotal }
        : computeLine({
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountType: l.discountType as 'AMOUNT' | 'PERCENT',
            discountValue: l.discountValue,
            rate: rate.rate,
            decimals,
          });
      await this.db.tx.dealProduct.create({
        data: {
          organizationId: user.organizationId,
          dealId: deal.id,
          productId: l.productId,
          sourceLeadProductId: l.id,
          position: l.position,
          sku: l.sku,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          currencyCode: l.currencyCode,
          discountType: l.discountType,
          discountValue: l.discountValue,
          exchangeRate: rate.rate,
          exchangeRateDate: rate.date ? new Date(`${rate.date}T00:00:00.000Z`) : null,
          exchangeRateId: rate.exchangeRateId,
          rateSource: rate.source,
          rateReason: rate.reason,
          lineSubtotal: a.subtotal,
          lineDiscount: a.discount,
          lineTotal: a.total,
        },
      });
    }
    await this.lines.recalcTotals({ kind: 'DEAL', id: deal.id });

    await this.db.tx.lead.update({
      where: { id },
      data: {
        stageId: convertedStage.id,
        stageChangedAt: new Date(),
        convertedAt: new Date(),
        version: { increment: 1 },
        updatedById: user.id,
      },
    });
    await this.history.record(
      'LEAD',
      id,
      'CONVERT',
      user.id,
      {
        negociación: deal.code,
        stage: { from: lead.stage.name, to: convertedStage.name },
        productos: leadLines.length,
      },
      correlationId,
    );
    await this.history.record(
      'DEAL',
      deal.id,
      'CONVERT',
      user.id,
      {
        prospecto: lead.code,
        productos: leadLines.length,
        moneda: currencyCode,
      },
      correlationId,
    );
    const movedTasks = input.moveOpenTasks
      ? await this.tasks.moveOpenFromLeadToDeal(user, id, deal.id, correlationId)
      : 0;
    return { dealId: deal.id, dealCode: deal.code, movedTasks };
  }

  // --- Papelera -------------------------------------------------------------------------------

  async restoreConflicts(entityId: string): Promise<string[]> {
    const l = await this.db.tx.lead.findFirst({
      where: { id: entityId, organizationId: this.db.organizationId },
      include: { contact: true, company: true },
    });
    if (!l) return ['El prospecto ya no existe.'];
    const reasons: string[] = [];
    if (l.company?.deletedAt)
      reasons.push(`Su compañía «${l.company.legalName}» está en la papelera: restáurela primero.`);
    if (l.contact?.deletedAt)
      reasons.push(`Su contacto «${l.contact.firstName}» está en la papelera: restáurelo primero.`);
    return reasons;
  }

  async restore(entityId: string, actor: Actor): Promise<void> {
    await this.db.tx.lead.updateMany({
      where: { id: entityId, organizationId: actor.organizationId },
      data: {
        deletedAt: null,
        deletedById: null,
        updatedById: actor.userId,
        version: { increment: 1 },
      },
    });
  }

  async purgeBlockers(entityId: string): Promise<string[]> {
    const deal = await this.db.tx.deal.findFirst({
      where: { organizationId: this.db.organizationId, sourceLeadId: entityId },
    });
    return deal
      ? [`Originó la negociación ${deal.code}: se conserva como registro histórico.`]
      : [];
  }

  async purge(entityId: string): Promise<void> {
    await this.db.tx.lead.deleteMany({
      where: { id: entityId, organizationId: this.db.organizationId, deletedAt: { not: null } },
    });
  }
}
