import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  normalizeEmail,
  normalizeIdentifier,
  normalizePhone,
  normalizeName,
  normalizeText,
  type ContactInput,
  type ContactUpdate,
} from '@crm/shared';
import type { Actor, AuthUser } from '../../common/auth.types';
import { notFound, validationError } from '../../common/errors';
import { Db } from '../../infra/db';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { DuplicateDetectionService } from '../duplicates/duplicate-detection.service';
import { HistoryService, diff } from '../history/history.service';
import { SequenceService } from '../sequences/sequence.service';
import { TrashService } from '../trash/trash.service';
import type { TrashHandler } from '../trash/trash.types';
import { checkDocument } from '../access/documents';
import { RecordScopeService } from '../access/record-scope.service';
import { assertVersion, customValues } from '../access/versioning';

export interface ContactQuery {
  q?: string;
  companyId?: string;
  ownerId?: string;
  sort?: 'firstName' | 'lastName' | 'code' | 'createdAt';
  dir?: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

const include = {
  owner: { select: { id: true, name: true } },
  company: { select: { id: true, code: true, legalName: true, deletedAt: true } },
  documentType: { select: { id: true, code: true, name: true } },
  relatedCompanies: {
    select: {
      jobTitle: true,
      company: { select: { id: true, code: true, legalName: true, deletedAt: true } },
    },
  },
} satisfies Prisma.ContactInclude;
type Row = Prisma.ContactGetPayload<{ include: typeof include }>;

export const contactDto = (c: Row) => ({
  id: c.id,
  code: c.code,
  firstName: c.firstName,
  lastName: c.lastName,
  fullName: [c.firstName, c.lastName].filter(Boolean).join(' '),
  documentType: c.documentType,
  documentTypeId: c.documentTypeId,
  documentNumber: c.documentNumber,
  phone: c.phone,
  email: c.email,
  jobTitle: c.jobTitle,
  company:
    c.company && !c.company.deletedAt
      ? { id: c.company.id, code: c.company.code, legalName: c.company.legalName }
      : null,
  companyId: c.companyId,
  relatedCompanies: c.relatedCompanies
    .filter((r) => !r.company.deletedAt)
    .map((r) => ({
      id: r.company.id,
      code: r.company.code,
      legalName: r.company.legalName,
      jobTitle: r.jobTitle,
    })),
  owner: c.owner,
  ownerId: c.ownerId,
  notes: c.notes,
  customFields: customValues(c.customFields),
  version: c.version,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

const FIELDS = [
  'firstName',
  'lastName',
  'documentTypeId',
  'documentNumber',
  'phone',
  'email',
  'jobTitle',
  'companyId',
  'ownerId',
  'notes',
  'customFields',
] as const;

@Injectable()
export class ContactsService implements OnModuleInit, TrashHandler {
  readonly entityType = 'CONTACT' as const;

  constructor(
    private readonly db: Db,
    private readonly history: HistoryService,
    private readonly trash: TrashService,
    private readonly sequences: SequenceService,
    private readonly scope: RecordScopeService,
    private readonly customFields: CustomFieldsService,
    private readonly duplicates: DuplicateDetectionService,
  ) {}

  onModuleInit(): void {
    this.trash.register(this);
  }

  async where(
    user: AuthUser,
    q: Omit<ContactQuery, 'page' | 'pageSize' | 'sort' | 'dir'>,
    action: 'view' | 'export' = 'view',
  ) {
    const norm = normalizeText(q.q);
    return {
      organizationId: user.organizationId,
      deletedAt: null,
      ...(await this.scope.ownerWhere(user, 'contacts', action)),
      ...(q.ownerId ? { AND: [{ ownerId: q.ownerId }] } : {}),
      ...(q.companyId
        ? {
            OR: [
              { companyId: q.companyId },
              { relatedCompanies: { some: { companyId: q.companyId } } },
            ],
          }
        : {}),
      ...(norm ? { searchNorm: { contains: norm } } : {}),
    } satisfies Prisma.ContactWhereInput;
  }

  async list(user: AuthUser, q: ContactQuery) {
    const where = await this.where(user, q);
    const [items, total] = await Promise.all([
      this.db.tx.contact.findMany({
        where,
        include,
        orderBy: { [q.sort ?? 'firstName']: q.dir ?? 'asc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.tx.contact.count({ where }),
    ]);
    return { items: items.map(contactDto), total, page: q.page, pageSize: q.pageSize };
  }

  /** Para exportar: todos los registros que cumplen el filtro (hasta `limit`). */
  listRaw(where: Prisma.ContactWhereInput, limit: number) {
    return this.db.tx.contact.findMany({
      where,
      include,
      orderBy: { firstName: 'asc' },
      take: limit,
    });
  }

  private async findAlive(id: string) {
    const c = await this.db.tx.contact.findFirst({
      where: { id, organizationId: this.db.organizationId, deletedAt: null },
      include,
    });
    if (!c) throw notFound('El contacto');
    return c;
  }

  async get(user: AuthUser, id: string) {
    const c = await this.findAlive(id);
    await this.scope.assert(user, 'contacts', 'view', c.ownerId);
    return contactDto(c);
  }

  async check(
    input: Partial<ContactInput>,
    current?: { documentTypeId: string | null; documentNumber: string | null },
  ) {
    const typeId =
      input.documentTypeId !== undefined ? input.documentTypeId : (current?.documentTypeId ?? null);
    const number =
      input.documentNumber !== undefined ? input.documentNumber : (current?.documentNumber ?? null);
    await checkDocument(this.db.tx, this.db.organizationId, typeId, number, {
      type: 'documentTypeId',
      number: 'documentNumber',
    });
    const companyIds = [
      ...(input.companyId ? [input.companyId] : []),
      ...(input.relatedCompanyIds ?? []),
    ];
    if (companyIds.length > 0) {
      const found = await this.db.tx.company.count({
        where: {
          id: { in: [...new Set(companyIds)] },
          organizationId: this.db.organizationId,
          deletedAt: null,
        },
      });
      if (found !== new Set(companyIds).size) {
        throw validationError({ companyId: 'La compañía no existe o está en la papelera.' });
      }
    }
  }

  private norms(c: {
    code: string;
    firstName: string;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
    documentNumber?: string | null;
  }) {
    return {
      emailNorm: normalizeEmail(c.email),
      phoneNorm: normalizePhone(c.phone),
      documentNorm: normalizeIdentifier(c.documentNumber),
      nameNorm: normalizeName([c.firstName, c.lastName].filter(Boolean).join(' ')),
      searchNorm: normalizeText(
        [c.code, c.firstName, c.lastName, c.email, c.documentNumber, normalizePhone(c.phone)]
          .filter(Boolean)
          .join(' '),
      ),
    };
  }

  private async setRelated(contactId: string, companyIds: string[], primaryId: string | null) {
    await this.db.tx.contactCompany.deleteMany({
      where: { organizationId: this.db.organizationId, contactId },
    });
    const ids = [...new Set(companyIds)].filter((id) => id !== primaryId);
    if (ids.length > 0) {
      await this.db.tx.contactCompany.createMany({
        data: ids.map((companyId) => ({
          organizationId: this.db.organizationId,
          contactId,
          companyId,
        })),
      });
    }
  }

  async create(user: AuthUser, input: ContactInput) {
    await this.check(input);
    const ownerId = await this.scope.resolveOwner(user, 'contacts', 'create', input.ownerId);
    const custom = await this.customFields.validate('CONTACT', input.customFields);
    const code = await this.sequences.next('CONTACT');
    const { customFields: _cf, ownerId: _o, relatedCompanyIds, ...fields } = input;
    await this.duplicates.assertNoBlocking('CONTACT', { ...fields, customFields: custom });
    const c = await this.db.tx.contact.create({
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
    if (relatedCompanyIds) await this.setRelated(c.id, relatedCompanyIds, c.companyId);
    await this.history.record('CONTACT', c.id, 'CREATE', user.id, {
      code,
      name: [c.firstName, c.lastName].filter(Boolean).join(' '),
      companyId: c.companyId,
      ownerId,
    });
    await this.duplicates.onSaved('CONTACT', c.id);
    return contactDto(await this.findAlive(c.id));
  }

  async update(user: AuthUser, id: string, input: ContactUpdate) {
    const before = await this.findAlive(id);
    await this.scope.assert(user, 'contacts', 'edit', before.ownerId);
    const { version, customFields, relatedCompanyIds, ...fields } = input;
    await this.check({ ...fields, relatedCompanyIds }, before);
    if (fields.ownerId !== undefined && fields.ownerId !== before.ownerId) {
      fields.ownerId = await this.scope.resolveOwner(user, 'contacts', 'edit', fields.ownerId);
    }
    const custom =
      customFields !== undefined
        ? await this.customFields.validate(
            'CONTACT',
            customFields,
            customValues(before.customFields),
          )
        : undefined;
    const changes = diff(
      { ...before, customFields: customValues(before.customFields) },
      { ...fields, ...(custom !== undefined ? { customFields: custom } : {}) },
      FIELDS,
    );
    if (relatedCompanyIds !== undefined) {
      const prev = before.relatedCompanies.map((r) => r.company.id).sort();
      const next = [...new Set(relatedCompanyIds)].sort();
      if (JSON.stringify(prev) !== JSON.stringify(next))
        changes.relatedCompanyIds = { from: prev, to: next };
    }
    if (Object.keys(changes).length === 0) return contactDto(before);
    await this.duplicates.assertNoBlocking(
      'CONTACT',
      { ...before, ...fields, customFields: custom ?? customValues(before.customFields) },
      id,
    );
    const res = await this.db.tx.contact.updateMany({
      where: {
        id,
        organizationId: user.organizationId,
        deletedAt: null,
        ...(version !== undefined ? { version } : {}),
      },
      data: {
        ...fields,
        ...(custom !== undefined ? { customFields: custom as Prisma.InputJsonValue } : {}),
        ...this.norms({ ...before, ...fields }),
        version: { increment: 1 },
        updatedById: user.id,
      },
    });
    assertVersion(res.count);
    if (relatedCompanyIds !== undefined) {
      await this.setRelated(
        id,
        relatedCompanyIds,
        fields.companyId !== undefined ? fields.companyId : before.companyId,
      );
    }
    await this.history.record('CONTACT', id, 'UPDATE', user.id, changes);
    await this.duplicates.onSaved('CONTACT', id);
    return contactDto(await this.findAlive(id));
  }

  async remove(user: AuthUser, id: string, actor: Actor) {
    const c = await this.findAlive(id);
    await this.scope.assert(user, 'contacts', 'delete', c.ownerId);
    await this.db.tx.contact.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: user.id },
    });
    await this.trash.add(
      'CONTACT',
      {
        id,
        displayName: [c.firstName, c.lastName].filter(Boolean).join(' '),
        code: c.code,
        ownerId: c.ownerId,
        relations: c.company ? { compañía: c.company.legalName } : {},
      },
      actor,
    );
  }

  // --- Papelera -----------------------------------------------------------------------------

  /** No se restaura un contacto cuya compañía principal sigue en la papelera. */
  async restoreConflicts(entityId: string): Promise<string[]> {
    const c = await this.db.tx.contact.findFirst({
      where: { id: entityId, organizationId: this.db.organizationId },
      include: { company: { select: { legalName: true, deletedAt: true } } },
    });
    if (!c) return ['El contacto ya no existe.'];
    return c.company?.deletedAt
      ? [`Su compañía principal «${c.company.legalName}» está en la papelera: restáurela primero.`]
      : [];
  }

  async restore(entityId: string, actor: Actor): Promise<void> {
    await this.db.tx.contact.updateMany({
      where: { id: entityId, organizationId: actor.organizationId },
      data: {
        deletedAt: null,
        deletedById: null,
        updatedById: actor.userId,
        version: { increment: 1 },
      },
    });
  }

  /** Un contacto usado en prospectos o negociaciones (vigentes o en papelera) no se elimina. */
  async purgeBlockers(entityId: string): Promise<string[]> {
    const org = this.db.organizationId;
    const [leads, deals] = await Promise.all([
      this.db.tx.lead.count({ where: { organizationId: org, contactId: entityId } }),
      this.db.tx.dealContact.count({ where: { organizationId: org, contactId: entityId } }),
    ]);
    return [
      ...(leads > 0 ? [`Está en ${leads} prospecto(s).`] : []),
      ...(deals > 0 ? [`Está en ${deals} negociación(es).`] : []),
    ];
  }

  async purge(entityId: string): Promise<void> {
    await this.db.tx.contact.deleteMany({
      where: { id: entityId, organizationId: this.db.organizationId, deletedAt: { not: null } },
    });
  }
}
