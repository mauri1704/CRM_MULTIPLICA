import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  normalizeIdentifier,
  normalizeText,
  type ProductInput,
  type ProductUpdate,
} from '@crm/shared';
import type { Actor } from '../../common/auth.types';
import { conflict, notFound, validationError } from '../../common/errors';
import { Db } from '../../infra/db';
import { CurrenciesService } from '../currencies/currencies.service';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { DuplicateDetectionService } from '../duplicates/duplicate-detection.service';
import { HistoryService, diff } from '../history/history.service';
import { TrashService } from '../trash/trash.service';
import type { TrashHandler } from '../trash/trash.types';
import { assertVersion, customValues } from '../access/versioning';

export interface ProductQuery {
  q?: string;
  categoryId?: string;
  currencyCode?: string;
  active?: boolean;
  sort?: 'name' | 'sku' | 'price' | 'createdAt';
  dir?: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

const include = { category: { select: { id: true, name: true } } } satisfies Prisma.ProductInclude;
type Row = Prisma.ProductGetPayload<{ include: typeof include }>;

export const productDto = (p: Row) => ({
  id: p.id,
  sku: p.sku,
  name: p.name,
  description: p.description,
  category: p.category,
  categoryId: p.categoryId,
  price: p.price.toFixed(4),
  currencyCode: p.currencyCode,
  maxDiscountPct: p.maxDiscountPct.toFixed(2),
  active: p.active,
  customFields: customValues(p.customFields),
  version: p.version,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

const FIELDS = [
  'sku',
  'name',
  'description',
  'categoryId',
  'price',
  'currencyCode',
  'maxDiscountPct',
  'active',
  'customFields',
] as const;

/**
 * Catálogo de productos. El precio del catálogo es una referencia: prospectos y negociaciones
 * guardan su propia copia, así cambiar un precio aquí no altera registros históricos.
 */
@Injectable()
export class ProductsService implements OnModuleInit, TrashHandler {
  readonly entityType = 'PRODUCT' as const;

  constructor(
    private readonly db: Db,
    private readonly history: HistoryService,
    private readonly trash: TrashService,
    private readonly currencies: CurrenciesService,
    private readonly customFields: CustomFieldsService,
    private readonly duplicates: DuplicateDetectionService,
  ) {}

  onModuleInit(): void {
    this.trash.register(this);
  }

  where(q: Omit<ProductQuery, 'page' | 'pageSize' | 'sort' | 'dir'>): Prisma.ProductWhereInput {
    const norm = normalizeText(q.q);
    return {
      organizationId: this.db.organizationId,
      deletedAt: null,
      ...(q.active === undefined ? {} : { active: q.active }),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.currencyCode ? { currencyCode: q.currencyCode } : {}),
      ...(norm
        ? {
            OR: [
              { nameNorm: { contains: norm } },
              { skuNorm: { contains: normalizeIdentifier(q.q) ?? norm } },
            ],
          }
        : {}),
    };
  }

  async list(q: ProductQuery) {
    const where = this.where(q);
    const [items, total] = await Promise.all([
      this.db.tx.product.findMany({
        where,
        include,
        orderBy: { [q.sort ?? 'name']: q.dir ?? 'asc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.tx.product.count({ where }),
    ]);
    return { items: items.map(productDto), total, page: q.page, pageSize: q.pageSize };
  }

  /** Para exportar: todos los registros que cumplen el filtro (hasta `limit`). */
  listRaw(where: Prisma.ProductWhereInput, limit: number) {
    return this.db.tx.product.findMany({ where, include, orderBy: { name: 'asc' }, take: limit });
  }

  async get(id: string) {
    const p = await this.db.tx.product.findFirst({
      where: { id, organizationId: this.db.organizationId, deletedAt: null },
      include,
    });
    if (!p) throw notFound('El producto');
    return productDto(p);
  }

  async findBySku(sku: string) {
    return this.db.tx.product.findFirst({
      where: {
        organizationId: this.db.organizationId,
        deletedAt: null,
        skuNorm: normalizeIdentifier(sku) ?? '',
      },
    });
  }

  /** Validaciones que consultan la base. Sin escrituras: se usan también en la vista previa de importación. */
  async check(input: Partial<ProductInput>, exceptId?: string): Promise<void> {
    if (input.sku !== undefined) {
      const clash = await this.findBySku(input.sku);
      if (clash && clash.id !== exceptId) {
        throw conflict(`Ya existe un producto con el SKU ${input.sku}.`, { sku: 'SKU en uso.' });
      }
    }
    if (input.currencyCode !== undefined) await this.currencies.assertActive(input.currencyCode);
    if (input.categoryId) {
      const cat = await this.db.tx.productCategory.findFirst({
        where: { id: input.categoryId, organizationId: this.db.organizationId },
      });
      if (!cat) throw validationError({ categoryId: 'La categoría no existe.' });
    }
  }

  private derived(input: Partial<ProductInput>) {
    return {
      ...(input.sku !== undefined ? { skuNorm: normalizeIdentifier(input.sku) ?? '' } : {}),
      ...(input.name !== undefined ? { nameNorm: normalizeText(input.name) } : {}),
    };
  }

  async create(input: ProductInput, actor: Actor) {
    await this.check(input);
    const custom = await this.customFields.validate('PRODUCT', input.customFields);
    await this.duplicates.assertNoBlocking('PRODUCT', { ...input, customFields: custom });
    const p = await this.db.tx.product.create({
      data: {
        organizationId: actor.organizationId,
        sku: input.sku,
        name: input.name,
        description: input.description ?? null,
        categoryId: input.categoryId ?? null,
        price: new Prisma.Decimal(input.price),
        currencyCode: input.currencyCode,
        maxDiscountPct: new Prisma.Decimal(input.maxDiscountPct),
        customFields: custom as Prisma.InputJsonValue,
        skuNorm: normalizeIdentifier(input.sku) ?? '',
        nameNorm: normalizeText(input.name),
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });
    await this.history.record('PRODUCT', p.id, 'CREATE', actor.userId, {
      sku: p.sku,
      name: p.name,
      price: input.price,
      currencyCode: p.currencyCode,
    });
    await this.duplicates.onSaved('PRODUCT', p.id);
    return this.get(p.id);
  }

  async update(id: string, input: ProductUpdate, actor: Actor) {
    const before = await this.db.tx.product.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
    });
    if (!before) throw notFound('El producto');
    const { version, customFields, ...fields } = input;
    await this.check(fields, id);
    const custom =
      customFields !== undefined
        ? await this.customFields.validate(
            'PRODUCT',
            customFields,
            customValues(before.customFields),
          )
        : undefined;
    const data = {
      ...fields,
      ...(fields.price !== undefined ? { price: new Prisma.Decimal(fields.price) } : {}),
      ...(fields.maxDiscountPct !== undefined
        ? { maxDiscountPct: new Prisma.Decimal(fields.maxDiscountPct) }
        : {}),
      ...(custom !== undefined ? { customFields: custom as Prisma.InputJsonValue } : {}),
      ...this.derived(fields),
    };
    const { customFields: _json, ...plain } = data;
    const changes = diff(
      { ...before, customFields: customValues(before.customFields) },
      { ...plain, ...(custom !== undefined ? { customFields: custom } : {}) },
      FIELDS,
    );
    if (Object.keys(changes).length === 0) return this.get(id);
    await this.duplicates.assertNoBlocking(
      'PRODUCT',
      { ...before, ...fields, customFields: custom ?? customValues(before.customFields) },
      id,
    );
    const res = await this.db.tx.product.updateMany({
      where: {
        id,
        organizationId: actor.organizationId,
        deletedAt: null,
        ...(version !== undefined ? { version } : {}),
      },
      data: { ...data, version: { increment: 1 }, updatedById: actor.userId },
    });
    assertVersion(res.count);
    await this.history.record('PRODUCT', id, 'UPDATE', actor.userId, changes);
    await this.duplicates.onSaved('PRODUCT', id);
    return this.get(id);
  }

  async remove(id: string, actor: Actor) {
    const p = await this.db.tx.product.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
    });
    if (!p) throw notFound('El producto');
    await this.db.tx.product.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: actor.userId },
    });
    await this.trash.add('PRODUCT', { id, displayName: p.name, code: p.sku }, actor);
  }

  // --- Papelera -----------------------------------------------------------------------------

  async restoreConflicts(entityId: string): Promise<string[]> {
    const p = await this.db.tx.product.findFirst({
      where: { id: entityId, organizationId: this.db.organizationId },
    });
    if (!p) return ['El producto ya no existe.'];
    const clash = await this.db.tx.product.findFirst({
      where: {
        organizationId: this.db.organizationId,
        deletedAt: null,
        skuNorm: p.skuNorm,
        id: { not: entityId },
      },
    });
    return clash
      ? [
          `Ya existe un producto vigente con el SKU ${p.sku} («${clash.name}»). Cambie uno de los SKU.`,
        ]
      : [];
  }

  async restore(entityId: string, actor: Actor): Promise<void> {
    await this.db.tx.product.updateMany({
      where: { id: entityId, organizationId: actor.organizationId },
      data: {
        deletedAt: null,
        deletedById: null,
        updatedById: actor.userId,
        version: { increment: 1 },
      },
    });
  }

  /** Un producto usado en prospectos o negociaciones no se elimina: son registros históricos. */
  async purgeBlockers(entityId: string): Promise<string[]> {
    const org = this.db.organizationId;
    const [leads, deals] = await Promise.all([
      this.db.tx.leadProduct.count({ where: { organizationId: org, productId: entityId } }),
      this.db.tx.dealProduct.count({ where: { organizationId: org, productId: entityId } }),
    ]);
    return [
      ...(leads > 0 ? [`Está en ${leads} línea(s) de prospectos.`] : []),
      ...(deals > 0 ? [`Está en ${deals} línea(s) de negociaciones.`] : []),
    ];
  }

  async purge(entityId: string): Promise<void> {
    await this.db.tx.product.deleteMany({
      where: { id: entityId, organizationId: this.db.organizationId, deletedAt: { not: null } },
    });
  }
}
