import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  companyUpdate,
  contactUpdate,
  dealUpdate,
  leadUpdate,
  productUpdate,
  projectUpdate,
  type CustomFieldType,
  type DuplicateEntity,
  type MergeChoice,
  type MergeInput,
} from '@crm/shared';
import { toActor, type AuthUser } from '../../common/auth.types';
import { AppError, conflict, notFound, validationError } from '../../common/errors';
import { Db } from '../../infra/db';
import { RecordScopeService } from '../access/record-scope.service';
import { customValues } from '../access/versioning';
import { AuditService } from '../audit/audit.service';
import { CompaniesService } from '../companies/companies.service';
import { ContactsService } from '../contacts/contacts.service';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { DealsService } from '../deals/deals.service';
import { HistoryService } from '../history/history.service';
import { LeadsService } from '../leads/leads.service';
import { ProductsService } from '../products/products.service';
import { ProjectsService } from '../projects/projects.service';
import { LineItemsService } from '../sales/line-items.service';
import { TasksService } from '../tasks/tasks.service';
import { TrashService } from '../trash/trash.service';
import { DuplicateDetectionService } from './duplicate-detection.service';
import { DuplicatesService } from './duplicates.service';
import { ENTITIES } from './duplicate-entities';

interface FieldValue {
  display: string | null;
  value: unknown;
}
interface FieldDef {
  key: string;
  label: string;
  long?: boolean;
  /** Clave del campo personalizado (si lo es). */
  customKey?: string;
  read(row: never): FieldValue;
  /** Cambios para el `update` del módulo al elegir el valor del absorbido. */
  patch?(value: unknown): Record<string, unknown>;
}
interface Loaded {
  id: string;
  code: string | null;
  name: string;
  ownerId: string | null;
  ownerName: string | null;
  createdAt: Date;
  deleted: boolean;
  currencyCode?: string;
  /** Prospecto convertido / negociación cerrada. */
  locked?: string;
  customFields: Record<string, unknown>;
  fields: Record<string, FieldValue>;
}
interface Relation {
  key: string;
  label: string;
  ids(id: string): Promise<string[]>;
  move(survivor: string, absorbed: string, ids: string[]): Promise<void>;
}

const str = (v: string | null | undefined): FieldValue => ({
  display: v ?? null,
  value: v ?? null,
});
const dec = (v: Prisma.Decimal | null | undefined): FieldValue => ({
  display: v ? v.toString() : null,
  value: v ? v.toString() : null,
});
const day = (v: Date | null | undefined): FieldValue => {
  const s = v ? v.toISOString().slice(0, 10) : null;
  return { display: s, value: s };
};
const ref = (id: string | null, name: string | null | undefined): FieldValue => ({
  display: name ?? null,
  value: id,
});
const cfDisplay = (v: unknown): string | null => {
  if (v === undefined || v === null || v === '') return null;
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  return String(v);
};
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Campo simple: la columna y la clave del `update` se llaman igual. */
function simple<R>(key: string, label: string, read: (r: R) => FieldValue, long = false): FieldDef {
  return {
    key,
    label,
    long,
    read: read as FieldDef['read'],
    patch: (v) => ({ [key]: v }),
  };
}
function field<R>(
  key: string,
  label: string,
  read: (r: R) => FieldValue,
  patch: (v: unknown) => Record<string, unknown>,
): FieldDef {
  return { key, label, read: read as FieldDef['read'], patch };
}

/**
 * Fusión segura (Fase 5, D-10). Todo ocurre en la transacción de la petición: o se completa todo
 * (campos elegidos, relaciones movidas, absorbido a la papelera, historial y auditoría) o nada.
 */
@Injectable()
export class MergeService {
  constructor(
    private readonly db: Db,
    private readonly scope: RecordScopeService,
    private readonly detection: DuplicateDetectionService,
    private readonly duplicates: DuplicatesService,
    private readonly history: HistoryService,
    private readonly audit: AuditService,
    private readonly trash: TrashService,
    private readonly customFields: CustomFieldsService,
    private readonly lines: LineItemsService,
    private readonly contacts: ContactsService,
    private readonly companies: CompaniesService,
    private readonly products: ProductsService,
    private readonly projects: ProjectsService,
    private readonly leads: LeadsService,
    private readonly deals: DealsService,
    private readonly tasks: TasksService,
  ) {}

  // --- Campos por módulo ----------------------------------------------------------------------

  private baseFields(entity: DuplicateEntity): FieldDef[] {
    type C = Prisma.ContactGetPayload<{
      include: { documentType: true; company: true; owner: true };
    }>;
    type Co = Prisma.CompanyGetPayload<{ include: { taxIdType: true; sector: true; owner: true } }>;
    type P = Prisma.ProductGetPayload<{ include: { category: true } }>;
    type Pr = Prisma.ProjectGetPayload<{ include: { owner: true } }>;
    type L = Prisma.LeadGetPayload<{
      include: { company: true; contact: true; source: true; owner: true; priority: true };
    }>;
    type D = Prisma.DealGetPayload<{ include: { company: true; owner: true; priority: true } }>;
    switch (entity) {
      case 'CONTACT':
        return [
          simple<C>('firstName', 'Nombre', (r) => str(r.firstName)),
          simple<C>('lastName', 'Apellidos', (r) => str(r.lastName)),
          field<C>(
            'document',
            'Documento',
            (r) => ({
              display: r.documentNumber
                ? [r.documentType?.code, r.documentNumber].filter(Boolean).join(' ')
                : null,
              value: { documentTypeId: r.documentTypeId, documentNumber: r.documentNumber },
            }),
            (v) => (v && typeof v === 'object' ? { ...v } : {}),
          ),
          simple<C>('email', 'Correo', (r) => str(r.email)),
          simple<C>('phone', 'Teléfono', (r) => str(r.phone)),
          simple<C>('jobTitle', 'Cargo', (r) => str(r.jobTitle)),
          field<C>(
            'company',
            'Compañía principal',
            (r) => ref(r.companyId, r.company?.legalName),
            (v) => ({ companyId: v }),
          ),
          field<C>(
            'owner',
            'Responsable',
            (r) => ref(r.ownerId, r.owner?.name),
            (v) => ({ ownerId: v }),
          ),
          simple<C>('notes', 'Observaciones', (r) => str(r.notes), true),
        ];
      case 'COMPANY':
        return [
          simple<Co>('legalName', 'Razón social', (r) => str(r.legalName)),
          simple<Co>('tradeName', 'Nombre comercial', (r) => str(r.tradeName)),
          field<Co>(
            'taxId',
            'RUC / identificador',
            (r) => ({
              display: r.taxId ? [r.taxIdType?.code, r.taxId].filter(Boolean).join(' ') : null,
              value: { taxIdTypeId: r.taxIdTypeId, taxId: r.taxId },
            }),
            (v) => (v && typeof v === 'object' ? { ...v } : {}),
          ),
          field<Co>(
            'sector',
            'Sector',
            (r) => ref(r.sectorId, r.sector?.name),
            (v) => ({ sectorId: v }),
          ),
          simple<Co>('address', 'Dirección', (r) => str(r.address)),
          simple<Co>('city', 'Ciudad', (r) => str(r.city)),
          simple<Co>('country', 'País', (r) => str(r.country)),
          simple<Co>('email', 'Correo', (r) => str(r.email)),
          simple<Co>('phone', 'Teléfono', (r) => str(r.phone)),
          simple<Co>('website', 'Sitio web', (r) => str(r.website)),
          field<Co>(
            'owner',
            'Responsable',
            (r) => ref(r.ownerId, r.owner?.name),
            (v) => ({ ownerId: v }),
          ),
          simple<Co>('notes', 'Observaciones', (r) => str(r.notes), true),
        ];
      case 'PRODUCT':
        return [
          simple<P>('sku', 'SKU', (r) => str(r.sku)),
          simple<P>('name', 'Nombre', (r) => str(r.name)),
          simple<P>('description', 'Descripción', (r) => str(r.description), true),
          field<P>(
            'category',
            'Categoría',
            (r) => ref(r.categoryId, r.category?.name),
            (v) => ({ categoryId: v }),
          ),
          field<P>(
            'price',
            'Precio',
            (r) => ({
              display: `${r.currencyCode} ${r.price.toString()}`,
              value: { price: r.price.toString(), currencyCode: r.currencyCode },
            }),
            (v) => (v && typeof v === 'object' ? { ...v } : {}),
          ),
          simple<P>('maxDiscountPct', 'Descuento máximo (%)', (r) => dec(r.maxDiscountPct)),
        ];
      case 'PROJECT':
        return [
          simple<Pr>('name', 'Nombre', (r) => str(r.name)),
          simple<Pr>('description', 'Descripción', (r) => str(r.description), true),
          field<Pr>(
            'owner',
            'Responsable',
            (r) => ref(r.ownerId, r.owner?.name),
            (v) => ({ ownerId: v }),
          ),
          simple<Pr>('status', 'Estado', (r) => str(r.status)),
          field<Pr>(
            'dates',
            'Fechas',
            (r) => {
              const s = r.startDate?.toISOString().slice(0, 10) ?? null;
              const e = r.endDate?.toISOString().slice(0, 10) ?? null;
              return {
                display: s || e ? `${s ?? '…'} → ${e ?? '…'}` : null,
                value: { startDate: s, endDate: e },
              };
            },
            (v) => (v && typeof v === 'object' ? { ...v } : {}),
          ),
        ];
      case 'LEAD':
        return [
          simple<L>('title', 'Nombre del prospecto', (r) => str(r.title)),
          field<L>(
            'contact',
            'Contacto',
            (r) =>
              ref(
                r.contactId,
                r.contact
                  ? [r.contact.firstName, r.contact.lastName].filter(Boolean).join(' ')
                  : null,
              ),
            (v) => ({ contactId: v }),
          ),
          field<L>(
            'company',
            'Compañía',
            (r) => ref(r.companyId, r.company?.legalName),
            (v) => ({ companyId: v }),
          ),
          simple<L>('phone', 'Teléfono', (r) => str(r.phone)),
          simple<L>('email', 'Correo', (r) => str(r.email)),
          field<L>(
            'source',
            'Origen',
            (r) => ref(r.sourceId, r.source?.name),
            (v) => ({ sourceId: v }),
          ),
          field<L>(
            'owner',
            'Responsable',
            (r) => ref(r.ownerId, r.owner?.name),
            (v) => ({ ownerId: v }),
          ),
          field<L>(
            'priority',
            'Prioridad',
            (r) => ref(r.priorityId, r.priority?.name),
            (v) => ({ priorityId: v }),
          ),
          simple<L>('estimatedValue', 'Valor estimado', (r) => dec(r.estimatedValue)),
          simple<L>('notes', 'Observaciones', (r) => str(r.notes), true),
        ];
      case 'DEAL':
        return [
          simple<D>('title', 'Título', (r) => str(r.title)),
          field<D>(
            'company',
            'Compañía',
            (r) => ref(r.companyId, r.company?.legalName),
            (v) => ({ companyId: v }),
          ),
          field<D>(
            'owner',
            'Responsable',
            (r) => ref(r.ownerId, r.owner?.name),
            (v) => ({ ownerId: v }),
          ),
          field<D>(
            'priority',
            'Prioridad',
            (r) => ref(r.priorityId, r.priority?.name),
            (v) => ({ priorityId: v }),
          ),
          simple<D>('estimatedValue', 'Valor estimado', (r) => dec(r.estimatedValue)),
          simple<D>('probability', 'Probabilidad (%)', (r) => ({
            display: r.probability === null ? null : String(r.probability),
            value: r.probability,
          })),
          simple<D>('expectedCloseDate', 'Cierre estimado', (r) => day(r.expectedCloseDate)),
          simple<D>('notes', 'Observaciones', (r) => str(r.notes), true),
        ];
    }
  }

  private async fieldDefs(entity: DuplicateEntity): Promise<FieldDef[]> {
    const base = this.baseFields(entity);
    if (entity === 'PROJECT') return base;
    const defs = await this.customFields.list(entity);
    const custom: FieldDef[] = defs.map((d) => ({
      key: `cf.${d.key}`,
      label: d.label,
      long: (d.type as CustomFieldType) === 'TEXTAREA',
      customKey: d.key,
      read: ((r: { customFields: Prisma.JsonValue }) => {
        const v = customValues(r.customFields)[d.key];
        return { display: cfDisplay(v), value: v ?? null };
      }) as FieldDef['read'],
    }));
    return [...base, ...custom];
  }

  // --- Carga ----------------------------------------------------------------------------------

  private async load(
    entity: DuplicateEntity,
    id: string,
    defs: FieldDef[],
  ): Promise<Loaded | null> {
    const where = { id, organizationId: this.db.organizationId };
    const read = (row: never) => Object.fromEntries(defs.map((d) => [d.key, d.read(row)]));
    switch (entity) {
      case 'CONTACT': {
        const r = await this.db.tx.contact.findFirst({
          where,
          include: { documentType: true, company: true, owner: true },
        });
        return (
          r && {
            id: r.id,
            code: r.code,
            name: [r.firstName, r.lastName].filter(Boolean).join(' '),
            ownerId: r.ownerId,
            ownerName: r.owner?.name ?? null,
            createdAt: r.createdAt,
            deleted: !!r.deletedAt,
            customFields: customValues(r.customFields),
            fields: read(r as never),
          }
        );
      }
      case 'COMPANY': {
        const r = await this.db.tx.company.findFirst({
          where,
          include: { taxIdType: true, sector: true, owner: true },
        });
        return (
          r && {
            id: r.id,
            code: r.code,
            name: r.legalName,
            ownerId: r.ownerId,
            ownerName: r.owner?.name ?? null,
            createdAt: r.createdAt,
            deleted: !!r.deletedAt,
            customFields: customValues(r.customFields),
            fields: read(r as never),
          }
        );
      }
      case 'PRODUCT': {
        const r = await this.db.tx.product.findFirst({ where, include: { category: true } });
        return (
          r && {
            id: r.id,
            code: r.sku,
            name: r.name,
            ownerId: null,
            ownerName: null,
            createdAt: r.createdAt,
            deleted: !!r.deletedAt,
            currencyCode: r.currencyCode,
            customFields: customValues(r.customFields),
            fields: read(r as never),
          }
        );
      }
      case 'PROJECT': {
        const r = await this.db.tx.project.findFirst({ where, include: { owner: true } });
        return (
          r && {
            id: r.id,
            code: r.code,
            name: r.name,
            ownerId: r.ownerId,
            ownerName: r.owner?.name ?? null,
            createdAt: r.createdAt,
            deleted: !!r.deletedAt,
            customFields: {},
            fields: read(r as never),
          }
        );
      }
      case 'LEAD': {
        const r = await this.db.tx.lead.findFirst({
          where,
          include: { company: true, contact: true, source: true, owner: true, priority: true },
        });
        return (
          r && {
            id: r.id,
            code: r.code,
            name: r.title,
            ownerId: r.ownerId,
            ownerName: r.owner?.name ?? null,
            createdAt: r.createdAt,
            deleted: !!r.deletedAt,
            currencyCode: r.currencyCode,
            locked: r.convertedAt ? 'ya fue convertido en negociación' : undefined,
            customFields: customValues(r.customFields),
            fields: read(r as never),
          }
        );
      }
      case 'DEAL': {
        const r = await this.db.tx.deal.findFirst({
          where,
          include: { company: true, owner: true, priority: true },
        });
        return (
          r && {
            id: r.id,
            code: r.code,
            name: r.title,
            ownerId: r.ownerId,
            ownerName: r.owner?.name ?? null,
            createdAt: r.createdAt,
            deleted: !!r.deletedAt,
            currencyCode: r.currencyCode,
            locked: r.status !== 'OPEN' ? 'está cerrada (ganada o perdida)' : undefined,
            customFields: customValues(r.customFields),
            fields: read(r as never),
          }
        );
      }
    }
  }

  // --- Relaciones -----------------------------------------------------------------------------

  private relations(entity: DuplicateEntity): Relation[] {
    const org = this.db.organizationId;
    const tx = this.db.tx;
    const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
    const sel = { id: true } as const;
    const tasks = (field: 'contactId' | 'companyId' | 'leadId' | 'dealId'): Relation => ({
      key: 'tasks',
      label: 'Tareas',
      ids: async (id) =>
        ids(
          await tx.task.findMany({
            where: { organizationId: org, [field]: id, deletedAt: null },
            select: sel,
          }),
        ),
      move: async (s, x, moved) => {
        await tx.task.updateMany({
          where: { organizationId: org, id: { in: moved } },
          data: { [field]: s },
        });
        await this.tasks.reindex(moved);
      },
    });
    const comments = (field: 'contactId' | 'companyId' | 'leadId' | 'dealId'): Relation => ({
      key: 'comments',
      label: 'Comentarios',
      ids: async (id) =>
        ids(
          await tx.comment.findMany({
            where: { organizationId: org, [field]: id, deletedAt: null },
            select: sel,
          }),
        ),
      move: async (s, _x, moved) => {
        await tx.comment.updateMany({
          where: { organizationId: org, id: { in: moved } },
          data: { [field]: s },
        });
      },
    });
    const activities = (field: 'contactId' | 'companyId' | 'leadId' | 'dealId'): Relation => ({
      key: 'activities',
      label: 'Actividades',
      ids: async (id) =>
        ids(
          await tx.activity.findMany({
            where: { organizationId: org, [field]: id, deletedAt: null },
            select: sel,
          }),
        ),
      move: async (s, _x, moved) => {
        await tx.activity.updateMany({
          where: { organizationId: org, id: { in: moved } },
          data: { [field]: s },
        });
      },
    });
    switch (entity) {
      case 'CONTACT':
        return [
          {
            key: 'leads',
            label: 'Prospectos',
            ids: async (id) =>
              ids(
                await tx.lead.findMany({
                  where: { organizationId: org, contactId: id, deletedAt: null },
                  select: sel,
                }),
              ),
            move: async (s, _x, moved) => {
              await tx.lead.updateMany({
                where: { organizationId: org, id: { in: moved } },
                data: { contactId: s },
              });
              await this.leads.reindex(moved);
            },
          },
          {
            key: 'deals',
            label: 'Negociaciones (como contacto)',
            ids: async (id) =>
              (
                await tx.dealContact.findMany({ where: { organizationId: org, contactId: id } })
              ).map((r) => r.dealId),
            move: async (s, x, moved) => {
              for (const dealId of moved) {
                const row = await tx.dealContact.findFirstOrThrow({
                  where: { dealId, contactId: x },
                });
                const dup = await tx.dealContact.findFirst({ where: { dealId, contactId: s } });
                if (dup) {
                  await tx.dealContact.deleteMany({ where: { dealId, contactId: x } });
                  if (row.isPrimary && !dup.isPrimary) {
                    await tx.dealContact.updateMany({
                      where: { dealId, contactId: s },
                      data: { isPrimary: true },
                    });
                  }
                } else {
                  await tx.dealContact.updateMany({
                    where: { dealId, contactId: x },
                    data: { contactId: s },
                  });
                }
              }
            },
          },
          tasks('contactId'),
          comments('contactId'),
          activities('contactId'),
          {
            key: 'companies',
            label: 'Compañías relacionadas',
            ids: async (id) =>
              (
                await tx.contactCompany.findMany({ where: { organizationId: org, contactId: id } })
              ).map((r) => r.companyId),
            move: async (s, x, moved) => {
              for (const companyId of moved) {
                const dup = await tx.contactCompany.findFirst({
                  where: { contactId: s, companyId },
                });
                if (dup) await tx.contactCompany.deleteMany({ where: { contactId: x, companyId } });
                else
                  await tx.contactCompany.updateMany({
                    where: { contactId: x, companyId },
                    data: { contactId: s },
                  });
              }
            },
          },
        ];
      case 'COMPANY':
        return [
          {
            key: 'contacts',
            label: 'Contactos (compañía principal)',
            ids: async (id) =>
              ids(
                await tx.contact.findMany({
                  where: { organizationId: org, companyId: id, deletedAt: null },
                  select: sel,
                }),
              ),
            move: async (s, _x, moved) => {
              await tx.contact.updateMany({
                where: { organizationId: org, id: { in: moved } },
                data: { companyId: s },
              });
            },
          },
          {
            key: 'related',
            label: 'Contactos relacionados',
            ids: async (id) =>
              (
                await tx.contactCompany.findMany({ where: { organizationId: org, companyId: id } })
              ).map((r) => r.contactId),
            move: async (s, x, moved) => {
              for (const contactId of moved) {
                const dup = await tx.contactCompany.findFirst({
                  where: { contactId, companyId: s },
                });
                if (dup) await tx.contactCompany.deleteMany({ where: { contactId, companyId: x } });
                else
                  await tx.contactCompany.updateMany({
                    where: { contactId, companyId: x },
                    data: { companyId: s },
                  });
              }
            },
          },
          {
            key: 'leads',
            label: 'Prospectos',
            ids: async (id) =>
              ids(
                await tx.lead.findMany({
                  where: { organizationId: org, companyId: id, deletedAt: null },
                  select: sel,
                }),
              ),
            move: async (s, _x, moved) => {
              await tx.lead.updateMany({
                where: { organizationId: org, id: { in: moved } },
                data: { companyId: s },
              });
              await this.leads.reindex(moved);
            },
          },
          {
            key: 'deals',
            label: 'Negociaciones',
            ids: async (id) =>
              ids(
                await tx.deal.findMany({
                  where: { organizationId: org, companyId: id, deletedAt: null },
                  select: sel,
                }),
              ),
            move: async (s, _x, moved) => {
              await tx.deal.updateMany({
                where: { organizationId: org, id: { in: moved } },
                data: { companyId: s },
              });
              await this.deals.reindex(moved);
            },
          },
          tasks('companyId'),
          comments('companyId'),
          activities('companyId'),
        ];
      case 'PRODUCT':
        return [
          {
            key: 'lead_products',
            label: 'Productos de prospectos',
            ids: async (id) =>
              ids(
                await tx.leadProduct.findMany({
                  where: { organizationId: org, productId: id },
                  select: sel,
                }),
              ),
            move: async (s, _x, moved) => {
              await tx.leadProduct.updateMany({
                where: { organizationId: org, id: { in: moved } },
                data: { productId: s },
              });
            },
          },
          {
            key: 'deal_products',
            label: 'Productos de negociaciones',
            ids: async (id) =>
              ids(
                await tx.dealProduct.findMany({
                  where: { organizationId: org, productId: id },
                  select: sel,
                }),
              ),
            move: async (s, _x, moved) => {
              await tx.dealProduct.updateMany({
                where: { organizationId: org, id: { in: moved } },
                data: { productId: s },
              });
            },
          },
        ];
      case 'PROJECT':
        return [
          {
            key: 'tasks',
            label: 'Tareas',
            ids: async (id) =>
              ids(
                await tx.task.findMany({
                  where: { organizationId: org, projectId: id, deletedAt: null },
                  select: sel,
                }),
              ),
            move: async (s, _x, moved) => {
              await tx.task.updateMany({
                where: { organizationId: org, id: { in: moved } },
                data: { projectId: s },
              });
            },
          },
        ];
      case 'LEAD':
        return [
          {
            key: 'products',
            label: 'Productos de interés',
            ids: async (id) =>
              ids(
                await tx.leadProduct.findMany({
                  where: { organizationId: org, leadId: id },
                  orderBy: { position: 'asc' },
                  select: sel,
                }),
              ),
            move: async (s, _x, moved) => {
              const top = await tx.leadProduct.aggregate({
                where: { organizationId: org, leadId: s },
                _max: { position: true },
              });
              let pos = (top._max.position ?? -1) + 1;
              for (const id of moved) {
                await tx.leadProduct.updateMany({
                  where: { organizationId: org, id },
                  data: { leadId: s, position: pos++ },
                });
              }
            },
          },
          tasks('leadId'),
          comments('leadId'),
          activities('leadId'),
        ];
      case 'DEAL':
        return [
          {
            key: 'products',
            label: 'Productos',
            ids: async (id) =>
              ids(
                await tx.dealProduct.findMany({
                  where: { organizationId: org, dealId: id },
                  orderBy: { position: 'asc' },
                  select: sel,
                }),
              ),
            move: async (s, _x, moved) => {
              const top = await tx.dealProduct.aggregate({
                where: { organizationId: org, dealId: s },
                _max: { position: true },
              });
              let pos = (top._max.position ?? -1) + 1;
              for (const id of moved) {
                await tx.dealProduct.updateMany({
                  where: { organizationId: org, id },
                  data: { dealId: s, position: pos++ },
                });
              }
            },
          },
          {
            key: 'contacts',
            label: 'Contactos',
            ids: async (id) =>
              (await tx.dealContact.findMany({ where: { organizationId: org, dealId: id } })).map(
                (r) => r.contactId,
              ),
            move: async (s, x, moved) => {
              for (const contactId of moved) {
                const dup = await tx.dealContact.findFirst({ where: { dealId: s, contactId } });
                if (dup) await tx.dealContact.deleteMany({ where: { dealId: x, contactId } });
                // El principal de la negociación conservada no cambia.
                else
                  await tx.dealContact.updateMany({
                    where: { dealId: x, contactId },
                    data: { dealId: s, isPrimary: false },
                  });
              }
            },
          },
          tasks('dealId'),
          comments('dealId'),
          activities('dealId'),
        ];
    }
  }

  private restrictions(entity: DuplicateEntity, a: Loaded, b: Loaded): string[] {
    const out: string[] = [];
    if (a.deleted || b.deleted) out.push('Alguno de los registros ya está en la papelera.');
    if (entity === 'LEAD' || entity === 'DEAL') {
      for (const r of [a, b]) {
        if (r.locked) {
          out.push(
            entity === 'LEAD'
              ? `«${r.name}» ${r.locked}: queda como registro histórico y no se fusiona.`
              : `«${r.name}» ${r.locked}: solo se fusionan negociaciones abiertas.`,
          );
        }
      }
      if (a.currencyCode !== b.currencyCode) {
        out.push(
          `Están en monedas distintas (${a.currencyCode} y ${b.currencyCode}): no se pueden fusionar.`,
        );
      }
    }
    return out;
  }

  // --- Vista previa ---------------------------------------------------------------------------

  async compare(user: AuthUser, candidateId: string) {
    const c = await this.duplicates.findVisible(user, candidateId);
    const entity = c.entityType as DuplicateEntity;
    const defs = await this.fieldDefs(entity);
    const [a, b] = await Promise.all([
      this.load(entity, c.recordAId, defs),
      this.load(entity, c.recordBId, defs),
    ]);
    if (!a || !b) throw notFound('El registro');
    const rels = this.relations(entity);
    const counts = await Promise.all(
      rels.map(async (r) => ({
        key: r.key,
        label: r.label,
        a: (await r.ids(a.id)).length,
        b: (await r.ids(b.id)).length,
      })),
    );
    const side = (l: Loaded) => ({
      id: l.id,
      code: l.code,
      name: l.name,
      ownerName: l.ownerName,
      createdAt: l.createdAt,
      deleted: l.deleted,
    });
    const total = (k: 'a' | 'b') => counts.reduce((n, r) => n + r[k], 0);
    // Sugerencia: se conserva el que tiene más relaciones; a igualdad, el más antiguo.
    const suggested =
      total('a') !== total('b')
        ? total('a') > total('b')
          ? a
          : b
        : a.createdAt <= b.createdAt
          ? a
          : b;
    return {
      candidate: await this.duplicates.dto(c),
      entityType: entity,
      a: side(a),
      b: side(b),
      fields: defs.map((d) => ({
        key: d.key,
        label: d.label,
        long: !!d.long,
        a: a.fields[d.key]?.display ?? null,
        b: b.fields[d.key]?.display ?? null,
        differs: !same(a.fields[d.key]?.value, b.fields[d.key]?.value),
      })),
      relations: counts,
      restrictions: this.restrictions(entity, a, b),
      suggestedSurvivorId: suggested.id,
    };
  }

  // --- Fusión ---------------------------------------------------------------------------------

  private async lock(entity: DuplicateEntity, ids: string[]) {
    // Orden fijo: dos fusiones simultáneas de los mismos registros no se bloquean entre sí.
    await this.db.tx.$queryRaw(Prisma.sql`
      SELECT id FROM ${Prisma.raw(ENTITIES[entity].table)}
      WHERE organization_id = ${this.db.organizationId}::uuid AND id IN (${Prisma.join(ids.map((i) => Prisma.sql`${i}::uuid`))})
      ORDER BY id FOR UPDATE`);
  }

  private buildPatch(
    defs: FieldDef[],
    survivor: Loaded,
    absorbed: Loaded,
    choices: Record<string, MergeChoice>,
  ) {
    for (const key of Object.keys(choices)) {
      if (!defs.some((d) => d.key === key))
        throw validationError({ choices: `El campo «${key}» no se puede fusionar.` });
    }
    const patch: Record<string, unknown> = {};
    const custom: Record<string, unknown> = { ...survivor.customFields };
    let customChanged = false;
    const applied: Record<string, MergeChoice> = {};
    for (const d of defs) {
      const choice = choices[d.key] ?? 'SURVIVOR';
      if (choice === 'SURVIVOR') continue;
      const sv = survivor.fields[d.key]!;
      const av = absorbed.fields[d.key]!;
      if (same(sv.value, av.value)) continue;
      if (choice === 'BOTH' && !d.long) {
        throw validationError({ choices: `«${d.label}» no admite combinar ambos valores.` });
      }
      if (d.customKey) {
        const v = choice === 'BOTH' ? [sv.value, av.value].filter(Boolean).join('\n\n') : av.value;
        if (v === undefined || v === null || v === '') delete custom[d.customKey];
        else custom[d.customKey] = v;
        customChanged = true;
      } else if (choice === 'BOTH') {
        Object.assign(patch, d.patch!([sv.display, av.display].filter(Boolean).join('\n\n')));
      } else {
        Object.assign(patch, d.patch!(av.value));
      }
      applied[d.key] = choice;
    }
    if (customChanged) patch.customFields = custom;
    return { patch, applied };
  }

  /** Aplica el cambio con el `update` del módulo: mismas validaciones, historial y detección. */
  private async updateSurvivor(
    user: AuthUser,
    entity: DuplicateEntity,
    id: string,
    patch: Record<string, unknown>,
  ) {
    if (Object.keys(patch).length === 0) return;
    const schemas = {
      CONTACT: contactUpdate,
      COMPANY: companyUpdate,
      PRODUCT: productUpdate,
      PROJECT: projectUpdate,
      LEAD: leadUpdate,
      DEAL: dealUpdate,
    };
    const parsed = schemas[entity].safeParse(patch);
    if (!parsed.success) {
      throw validationError({
        choices: parsed.error.issues[0]?.message ?? 'Los valores elegidos no son válidos.',
      });
    }
    switch (entity) {
      case 'CONTACT':
        await this.contacts.update(user, id, contactUpdate.parse(patch));
        break;
      case 'COMPANY':
        await this.companies.update(user, id, companyUpdate.parse(patch));
        break;
      case 'PRODUCT':
        await this.products.update(id, productUpdate.parse(patch), toActor(user));
        break;
      case 'PROJECT':
        await this.projects.update(user, id, projectUpdate.parse(patch));
        break;
      case 'LEAD':
        await this.leads.update(user, id, leadUpdate.parse(patch));
        break;
      case 'DEAL':
        await this.deals.update(user, id, dealUpdate.parse(patch));
        break;
    }
  }

  private async sendToTrash(
    user: AuthUser,
    entity: DuplicateEntity,
    absorbed: Loaded,
    into: Loaded,
    ip?: string,
  ) {
    const org = this.db.organizationId;
    const data = { deletedAt: new Date(), deletedById: user.id };
    const where = { id: absorbed.id, organizationId: org };
    switch (entity) {
      case 'CONTACT':
        await this.db.tx.contact.updateMany({ where, data });
        break;
      case 'COMPANY':
        await this.db.tx.company.updateMany({ where, data });
        break;
      case 'PRODUCT':
        await this.db.tx.product.updateMany({ where, data });
        break;
      case 'PROJECT':
        await this.db.tx.project.updateMany({ where, data });
        break;
      case 'LEAD':
        await this.db.tx.lead.updateMany({ where, data });
        break;
      case 'DEAL':
        await this.db.tx.deal.updateMany({ where, data });
        break;
    }
    await this.trash.add(
      entity,
      {
        id: absorbed.id,
        displayName: absorbed.name,
        code: absorbed.code,
        ownerId: absorbed.ownerId,
        relations: {
          fusionado: true,
          fusionadoEn: [into.code, into.name].filter(Boolean).join(' '),
        },
      },
      toActor(user, ip),
    );
  }

  async merge(user: AuthUser, input: MergeInput, ip?: string) {
    const c = await this.duplicates.findVisible(user, input.candidateId);
    const entity = c.entityType as DuplicateEntity;
    if (c.status !== 'OPEN') throw conflict('Esta coincidencia ya fue resuelta.');
    if (input.survivorId !== c.recordAId && input.survivorId !== c.recordBId) {
      throw validationError({
        survivorId: 'El registro principal debe ser uno de los dos de la coincidencia.',
      });
    }
    const survivorId = input.survivorId;
    const absorbedId = survivorId === c.recordAId ? c.recordBId : c.recordAId;

    await this.lock(entity, [survivorId, absorbedId]);
    const defs = await this.fieldDefs(entity);
    const [survivor, absorbed] = await Promise.all([
      this.load(entity, survivorId, defs),
      this.load(entity, absorbedId, defs),
    ]);
    if (!survivor || !absorbed) throw notFound('El registro');
    // Dentro del bloqueo: si otra fusión ganó primero, el absorbido ya está en la papelera.
    const blockers = this.restrictions(entity, survivor, absorbed);
    if (blockers.length > 0) {
      throw new AppError(409, 'MERGE_NOT_ALLOWED', blockers[0]!, {
        restrictions: blockers.join(' '),
      });
    }
    for (const r of [survivor, absorbed]) {
      await this.scope.assert(user, 'duplicates', 'merge', r.ownerId);
    }

    const { patch, applied } = this.buildPatch(defs, survivor, absorbed, input.choices);
    const snapshot = await this.db.tx.$queryRaw<{ row: unknown }[]>(Prisma.sql`
      SELECT to_jsonb(t) AS row FROM ${Prisma.raw(ENTITIES[entity].table)} t
      WHERE t.id = ${absorbedId}::uuid AND t.organization_id = ${user.organizationId}::uuid`);

    // Se marca antes de tocar nada: el `update` del conservado vuelve a evaluar sus coincidencias y
    // retiraría esta, que ya no estaría abierta.
    await this.db.tx.duplicateCandidate.updateMany({
      where: { id: c.id, organizationId: user.organizationId },
      data: { status: 'MERGED', reviewedById: user.id, reviewedAt: new Date() },
    });
    // 1) El absorbido sale primero: libera sus valores únicos (RUC, SKU…) para el principal.
    await this.sendToTrash(user, entity, absorbed, survivor, ip);
    // 2) Valores elegidos del absorbido.
    await this.updateSurvivor(user, entity, survivorId, patch);
    // 3) Relaciones.
    const moved: Record<string, string[]> = {};
    for (const r of this.relations(entity)) {
      const ids = await r.ids(absorbedId);
      if (ids.length === 0) continue;
      await r.move(survivorId, absorbedId, ids);
      moved[r.key] = ids;
    }
    if (entity === 'CONTACT') await this.keepAbsorbedCompany(survivorId, absorbed);
    if (entity === 'LEAD') await this.lines.recalcTotals({ kind: 'LEAD', id: survivorId });
    if (entity === 'DEAL') await this.lines.recalcTotals({ kind: 'DEAL', id: survivorId });

    // 4) Registro de la fusión.
    const mh = await this.db.tx.mergeHistory.create({
      data: {
        organizationId: user.organizationId,
        entityType: entity,
        survivorId,
        mergedId: absorbedId,
        choices: applied,
        moved,
        snapshot: (snapshot[0]?.row ?? {}) as Prisma.InputJsonValue,
        userId: user.id,
      },
    });
    const correlationId = this.history.newCorrelationId();
    const counts = Object.fromEntries(Object.entries(moved).map(([k, v]) => [k, v.length]));
    await this.history.record(
      entity,
      survivorId,
      'MERGE',
      user.id,
      {
        absorbido: [absorbed.code, absorbed.name].filter(Boolean).join(' '),
        camposDelAbsorbido: Object.keys(applied),
        relacionesMovidas: counts,
      },
      correlationId,
    );
    await this.history.record(
      entity,
      absorbedId,
      'MERGE',
      user.id,
      { fusionadoEn: [survivor.code, survivor.name].filter(Boolean).join(' ') },
      correlationId,
    );
    await this.audit.log('MERGE', {
      userId: user.id,
      entityType: entity,
      entityId: survivorId,
      ip,
      details: {
        absorbedId,
        absorbed: absorbed.code,
        survivor: survivor.code,
        mergeId: mh.id,
        relacionesMovidas: counts,
      },
    });

    // 5) Coincidencias: esta queda fusionada; las abiertas del absorbido ya no tienen sentido.
    await this.db.tx.duplicateCandidate.deleteMany({
      where: {
        organizationId: user.organizationId,
        entityType: entity,
        status: 'OPEN',
        id: { not: c.id },
        OR: [{ recordAId: absorbedId }, { recordBId: absorbedId }],
      },
    });
    await this.detection.onSaved(entity, survivorId);
    return { mergeId: mh.id, survivorId, absorbedId, moved: counts };
  }

  /** La compañía principal del absorbido pasa a ser compañía relacionada del contacto conservado. */
  private async keepAbsorbedCompany(survivorId: string, absorbed: Loaded) {
    const companyId = absorbed.fields.company?.value;
    if (typeof companyId !== 'string') return;
    const s = await this.db.tx.contact.findFirstOrThrow({
      where: { id: survivorId, organizationId: this.db.organizationId },
      select: { companyId: true },
    });
    if (s.companyId === companyId) return;
    const exists = await this.db.tx.contactCompany.findFirst({
      where: { contactId: survivorId, companyId },
    });
    if (!exists) {
      await this.db.tx.contactCompany.create({
        data: { organizationId: this.db.organizationId, contactId: survivorId, companyId },
      });
    }
  }
}
