import { Injectable } from '@nestjs/common';
import { CATALOG_KINDS, CATALOG_LABELS, catalogInputs, type CatalogKind } from '@crm/shared';
import type { ZodObject, ZodRawShape } from 'zod';
import type { Actor } from '../../common/auth.types';
import { conflict, notFound, validationError } from '../../common/errors';
import { zodDetails } from '../../common/http-exception.filter';
import { Db } from '../../infra/db';
import { HistoryService, diff } from '../history/history.service';

type Row = { id: string; active: boolean; [k: string]: unknown };
type Where = Record<string, unknown>;

/** Lo mínimo que usamos de cada delegate de Prisma (todas las tablas de catálogo lo cumplen). */
interface CatalogDelegate {
  findMany(args: { where: Where; orderBy: Record<string, 'asc' | 'desc'>[] }): Promise<Row[]>;
  findFirst(args: { where: Where }): Promise<Row | null>;
  create(args: { data: Where }): Promise<Row>;
  update(args: { where: { id: string }; data: Where }): Promise<Row>;
  updateMany(args: { where: Where; data: Where }): Promise<{ count: number }>;
  count(args: { where: Where }): Promise<number>;
}

const ORDER: Record<CatalogKind, Record<string, 'asc' | 'desc'>[]> = {
  priorities: [{ rank: 'desc' }],
  'task-statuses': [{ position: 'asc' }],
  'lead-sources': [{ name: 'asc' }],
  'loss-reasons': [{ entityType: 'asc' }, { name: 'asc' }],
  'document-types': [{ code: 'asc' }],
  'economic-sectors': [{ name: 'asc' }],
};

export const isCatalogKind = (v: string): v is CatalogKind =>
  (CATALOG_KINDS as readonly string[]).includes(v);

/**
 * Catálogos simples de configuración. No se eliminan: un valor en uso se desactiva, así los
 * registros históricos lo conservan.
 */
@Injectable()
export class CatalogsService {
  constructor(
    private readonly db: Db,
    private readonly history: HistoryService,
  ) {}

  private delegate(kind: CatalogKind): CatalogDelegate {
    const tx = this.db.tx;
    const map = {
      priorities: tx.priority,
      'lead-sources': tx.leadSource,
      'loss-reasons': tx.lossReason,
      'document-types': tx.documentType,
      'economic-sectors': tx.economicSector,
      'task-statuses': tx.taskStatus,
    } as const;
    // Los delegates de Prisma tienen firmas genéricas más amplias que CatalogDelegate; se
    // restringen aquí, en un único lugar.
    return map[kind] as unknown as CatalogDelegate;
  }

  private parse(kind: CatalogKind, body: unknown, partial: boolean): Where {
    const schema = catalogInputs[kind] as ZodObject<ZodRawShape>;
    const parsed = (partial ? schema.partial() : schema).safeParse(body ?? {});
    if (!parsed.success) throw validationError(zodDetails(parsed.error));
    return parsed.data as Where;
  }

  list(kind: CatalogKind, includeInactive: boolean) {
    return this.delegate(kind).findMany({
      where: {
        organizationId: this.db.organizationId,
        ...(includeInactive ? {} : { active: true }),
      },
      orderBy: ORDER[kind],
    });
  }

  private async find(kind: CatalogKind, id: string): Promise<Row> {
    const row = await this.delegate(kind).findFirst({
      where: { id, organizationId: this.db.organizationId },
    });
    if (!row) throw notFound(CATALOG_LABELS[kind].singular);
    return row;
  }

  async create(kind: CatalogKind, body: unknown, actor: Actor) {
    const data = this.parse(kind, body, false);
    if (kind === 'priorities' && data.isDefault === true) await this.clearDefault();
    const row = await this.delegate(kind).create({
      data: { ...data, organizationId: actor.organizationId },
    });
    await this.history.record('CATALOG', row.id, 'CREATE', actor.userId, {
      catalog: kind,
      ...data,
    });
    return row;
  }

  async update(kind: CatalogKind, id: string, body: unknown, actor: Actor) {
    const before = await this.find(kind, id);
    const data = this.parse(kind, body, true);
    if (kind === 'priorities') {
      if (data.isDefault === true && !before.isDefault) await this.clearDefault();
      if (data.isDefault === false && before.isDefault) {
        throw conflict('Debe haber una prioridad por defecto: marque otra como predeterminada.');
      }
    }
    if (
      kind === 'task-statuses' &&
      data.category &&
      data.category !== before.category &&
      before.active
    ) {
      await this.assertTaskStatusCoverage(id, String(before.category));
    }
    const row = await this.delegate(kind).update({ where: { id }, data });
    await this.history.record('CATALOG', id, 'UPDATE', actor.userId, {
      ...diff(before, data, Object.keys(data)),
    });
    return row;
  }

  async setActive(kind: CatalogKind, id: string, active: boolean, actor: Actor) {
    const before = await this.find(kind, id);
    if (before.active === active) return before;
    if (!active) {
      if (kind === 'priorities' && before.isDefault) {
        throw conflict(
          'No se puede desactivar la prioridad por defecto. Marque otra como predeterminada primero.',
        );
      }
      if (kind === 'task-statuses')
        await this.assertTaskStatusCoverage(id, String(before.category));
    }
    const row = await this.delegate(kind).update({ where: { id }, data: { active } });
    await this.history.record('CATALOG', id, active ? 'ACTIVATE' : 'DEACTIVATE', actor.userId, {
      catalog: kind,
    });
    return row;
  }

  private async clearDefault() {
    await this.delegate('priorities').updateMany({
      where: { organizationId: this.db.organizationId, isDefault: true },
      data: { isDefault: false },
    });
  }

  /** Siempre debe quedar al menos un estado activo "Pendiente" y uno "Completada". */
  private async assertTaskStatusCoverage(excludingId: string, category: string) {
    if (category !== 'OPEN' && category !== 'DONE') return;
    const others = await this.delegate('task-statuses').count({
      where: {
        organizationId: this.db.organizationId,
        active: true,
        category,
        id: { not: excludingId },
      },
    });
    if (others === 0) {
      throw conflict(
        category === 'OPEN'
          ? 'Debe quedar al menos un estado activo de tipo "Pendiente".'
          : 'Debe quedar al menos un estado activo de tipo "Completada".',
      );
    }
  }
}
