import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  normalizeEmail,
  normalizeIdentifier,
  normalizePhone,
  normalizeText,
  type CompanyInput,
  type CompanyUpdate,
} from '@crm/shared';
import type { Actor, AuthUser } from '../../common/auth.types';
import { conflict, notFound } from '../../common/errors';
import { Db } from '../../infra/db';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { HistoryService, diff } from '../history/history.service';
import { SequenceService } from '../sequences/sequence.service';
import { TrashService } from '../trash/trash.service';
import type { TrashHandler } from '../trash/trash.types';
import { checkDocument } from '../access/documents';
import { RecordScopeService } from '../access/record-scope.service';
import { assertVersion, customValues } from '../access/versioning';

export interface CompanyQuery {
  q?: string;
  sectorId?: string;
  ownerId?: string;
  city?: string;
  sort?: 'legalName' | 'code' | 'createdAt' | 'city';
  dir?: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

const include = {
  owner: { select: { id: true, name: true } },
  sector: { select: { id: true, name: true } },
  taxIdType: { select: { id: true, code: true, name: true } },
  _count: { select: { contacts: { where: { deletedAt: null } } } },
} satisfies Prisma.CompanyInclude;
type Row = Prisma.CompanyGetPayload<{ include: typeof include }>;

export const companyDto = (c: Row) => ({
  id: c.id,
  code: c.code,
  legalName: c.legalName,
  tradeName: c.tradeName,
  taxIdType: c.taxIdType,
  taxIdTypeId: c.taxIdTypeId,
  taxId: c.taxId,
  sector: c.sector,
  sectorId: c.sectorId,
  address: c.address,
  city: c.city,
  country: c.country,
  email: c.email,
  phone: c.phone,
  website: c.website,
  owner: c.owner,
  ownerId: c.ownerId,
  notes: c.notes,
  customFields: customValues(c.customFields),
  contactCount: c._count.contacts,
  version: c.version,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

const FIELDS = [
  'legalName',
  'tradeName',
  'taxIdTypeId',
  'taxId',
  'sectorId',
  'address',
  'city',
  'country',
  'email',
  'phone',
  'website',
  'ownerId',
  'notes',
  'customFields',
] as const;

@Injectable()
export class CompaniesService implements OnModuleInit, TrashHandler {
  readonly entityType = 'COMPANY' as const;

  constructor(
    private readonly db: Db,
    private readonly history: HistoryService,
    private readonly trash: TrashService,
    private readonly sequences: SequenceService,
    private readonly scope: RecordScopeService,
    private readonly customFields: CustomFieldsService,
  ) {}

  onModuleInit(): void {
    this.trash.register(this);
  }

  async where(
    user: AuthUser,
    q: Omit<CompanyQuery, 'page' | 'pageSize' | 'sort' | 'dir'>,
    action: 'view' | 'export' = 'view',
  ) {
    const norm = normalizeText(q.q);
    return {
      organizationId: user.organizationId,
      deletedAt: null,
      ...(await this.scope.ownerWhere(user, 'companies', action)),
      ...(q.sectorId ? { sectorId: q.sectorId } : {}),
      ...(q.ownerId ? { AND: [{ ownerId: q.ownerId }] } : {}),
      ...(q.city ? { city: { equals: q.city, mode: 'insensitive' as const } } : {}),
      ...(norm ? { searchNorm: { contains: norm } } : {}),
    } satisfies Prisma.CompanyWhereInput;
  }

  async list(user: AuthUser, q: CompanyQuery) {
    const where = await this.where(user, q);
    const [items, total] = await Promise.all([
      this.db.tx.company.findMany({
        where,
        include,
        orderBy: { [q.sort ?? 'legalName']: q.dir ?? 'asc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.tx.company.count({ where }),
    ]);
    return { items: items.map(companyDto), total, page: q.page, pageSize: q.pageSize };
  }

  /** Para exportar: todos los registros que cumplen el filtro (hasta `limit`). */
  listRaw(where: Prisma.CompanyWhereInput, limit: number) {
    return this.db.tx.company.findMany({
      where,
      include,
      orderBy: { legalName: 'asc' },
      take: limit,
    });
  }

  private async findAlive(id: string) {
    const c = await this.db.tx.company.findFirst({
      where: { id, organizationId: this.db.organizationId, deletedAt: null },
      include,
    });
    if (!c) throw notFound('La compañía');
    return c;
  }

  /** Ficha: datos + contactos (principal o relacionados). */
  async get(user: AuthUser, id: string) {
    const c = await this.findAlive(id);
    await this.scope.assert(user, 'companies', 'view', c.ownerId);
    const [contacts, related] = await Promise.all([
      this.db.tx.contact.findMany({
        where: { organizationId: user.organizationId, companyId: id, deletedAt: null },
        select: {
          id: true,
          code: true,
          firstName: true,
          lastName: true,
          jobTitle: true,
          email: true,
          phone: true,
        },
        orderBy: { firstName: 'asc' },
      }),
      this.db.tx.contactCompany.findMany({
        where: { organizationId: user.organizationId, companyId: id, contact: { deletedAt: null } },
        select: {
          jobTitle: true,
          contact: {
            select: {
              id: true,
              code: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
        },
      }),
    ]);
    return {
      ...companyDto(c),
      contacts,
      relatedContacts: related.map((r) => ({ ...r.contact, jobTitle: r.jobTitle })),
    };
  }

  /** Validaciones con consultas, sin escrituras (también para la vista previa de importación). */
  async check(
    input: Partial<CompanyInput>,
    current?: { id: string; taxIdTypeId: string | null; taxId: string | null },
  ) {
    const typeId =
      input.taxIdTypeId !== undefined ? input.taxIdTypeId : (current?.taxIdTypeId ?? null);
    const taxId = input.taxId !== undefined ? input.taxId : (current?.taxId ?? null);
    await checkDocument(
      this.db.tx,
      this.db.organizationId,
      typeId,
      taxId,
      { type: 'taxIdTypeId', number: 'taxId' },
      'identificador',
    );
    const norm = normalizeIdentifier(taxId);
    if (norm) {
      const clash = await this.findByTaxId(norm);
      if (clash && clash.id !== current?.id) {
        throw conflict(
          `Ya existe la compañía «${clash.legalName}» (${clash.code}) con ese RUC/identificador.`,
          {
            taxId: 'Identificador ya registrado.',
          },
        );
      }
    }
    if (input.sectorId) {
      const s = await this.db.tx.economicSector.findFirst({
        where: { id: input.sectorId, organizationId: this.db.organizationId },
      });
      if (!s) throw conflict('El sector no existe.', { sectorId: 'Sector no válido.' });
    }
  }

  /** Si se indica un identificador sin tipo, se asume RUC (el caso habitual en Perú). */
  async withDefaultTaxType<T extends Partial<CompanyInput>>(
    input: T,
    currentTypeId: string | null = null,
  ): Promise<T> {
    if (!input.taxId || input.taxIdTypeId || currentTypeId) return input;
    const ruc = await this.db.tx.documentType.findFirst({
      where: { organizationId: this.db.organizationId, code: 'RUC' },
      select: { id: true },
    });
    return { ...input, taxIdTypeId: ruc?.id ?? null };
  }

  findByTaxId(taxIdNorm: string) {
    return this.db.tx.company.findFirst({
      where: { organizationId: this.db.organizationId, deletedAt: null, taxIdNorm },
    });
  }

  private norms(c: {
    code: string;
    legalName: string;
    tradeName?: string | null;
    taxId?: string | null;
    email?: string | null;
    phone?: string | null;
  }) {
    return {
      taxIdNorm: normalizeIdentifier(c.taxId),
      emailNorm: normalizeEmail(c.email),
      phoneNorm: normalizePhone(c.phone),
      searchNorm: normalizeText(
        [c.code, c.legalName, c.tradeName, c.taxId].filter(Boolean).join(' '),
      ),
    };
  }

  async create(user: AuthUser, raw: CompanyInput) {
    const input = await this.withDefaultTaxType(raw);
    await this.check(input);
    const ownerId = await this.scope.resolveOwner(user, 'companies', 'create', input.ownerId);
    const custom = await this.customFields.validate('COMPANY', input.customFields);
    const code = await this.sequences.next('COMPANY');
    const { customFields: _cf, ownerId: _o, ...fields } = input;
    const c = await this.db.tx.company.create({
      data: {
        ...fields,
        organizationId: user.organizationId,
        code,
        ownerId,
        customFields: custom as Prisma.InputJsonValue,
        ...this.norms({ ...fields, code }),
        createdById: user.id,
        updatedById: user.id,
      },
    });
    await this.history.record('COMPANY', c.id, 'CREATE', user.id, {
      code,
      legalName: c.legalName,
      taxId: c.taxId,
      ownerId,
    });
    return companyDto(await this.findAlive(c.id));
  }

  async update(user: AuthUser, id: string, input: CompanyUpdate) {
    const before = await this.findAlive(id);
    await this.scope.assert(user, 'companies', 'edit', before.ownerId);
    const { version, customFields, ...rest } = input;
    const fields = await this.withDefaultTaxType(rest, before.taxIdTypeId);
    await this.check(fields, before);
    if (fields.ownerId !== undefined && fields.ownerId !== before.ownerId) {
      fields.ownerId = await this.scope.resolveOwner(user, 'companies', 'edit', fields.ownerId);
    }
    const custom =
      customFields !== undefined
        ? await this.customFields.validate(
            'COMPANY',
            customFields,
            customValues(before.customFields),
          )
        : undefined;
    const merged = { ...before, ...fields };
    const changes = diff(
      { ...before, customFields: customValues(before.customFields) },
      { ...fields, ...(custom !== undefined ? { customFields: custom } : {}) },
      FIELDS,
    );
    if (Object.keys(changes).length === 0) return companyDto(before);
    const res = await this.db.tx.company.updateMany({
      where: {
        id,
        organizationId: user.organizationId,
        deletedAt: null,
        ...(version !== undefined ? { version } : {}),
      },
      data: {
        ...fields,
        ...(custom !== undefined ? { customFields: custom as Prisma.InputJsonValue } : {}),
        ...this.norms(merged),
        version: { increment: 1 },
        updatedById: user.id,
      },
    });
    assertVersion(res.count);
    await this.history.record('COMPANY', id, 'UPDATE', user.id, changes);
    return companyDto(await this.findAlive(id));
  }

  /** No elimina sus contactos: quedan sin compañía principal visible hasta restaurarla. */
  async remove(user: AuthUser, id: string, actor: Actor) {
    const c = await this.findAlive(id);
    await this.scope.assert(user, 'companies', 'delete', c.ownerId);
    await this.db.tx.company.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: user.id },
    });
    await this.trash.add(
      'COMPANY',
      {
        id,
        displayName: c.legalName,
        code: c.code,
        ownerId: c.ownerId,
        relations: { contactos: c._count.contacts },
      },
      actor,
    );
    return { contacts: c._count.contacts };
  }

  // --- Papelera -----------------------------------------------------------------------------

  async restoreConflicts(entityId: string): Promise<string[]> {
    const c = await this.db.tx.company.findFirst({
      where: { id: entityId, organizationId: this.db.organizationId },
    });
    if (!c) return ['La compañía ya no existe.'];
    if (!c.taxIdNorm) return [];
    const clash = await this.findByTaxId(c.taxIdNorm);
    return clash && clash.id !== entityId
      ? [`Ya existe una compañía vigente con el identificador ${c.taxId} («${clash.legalName}»).`]
      : [];
  }

  async restore(entityId: string, actor: Actor): Promise<void> {
    await this.db.tx.company.updateMany({
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
    const contacts = await this.db.tx.contact.count({
      where: { organizationId: this.db.organizationId, companyId: entityId },
    });
    return contacts > 0
      ? [
          `${contacts} contacto(s) (vigentes o en papelera) la tienen como compañía principal. Cámbieles la compañía primero.`,
        ]
      : [];
  }

  async purge(entityId: string): Promise<void> {
    await this.db.tx.company.deleteMany({
      where: { id: entityId, organizationId: this.db.organizationId, deletedAt: { not: null } },
    });
  }
}
