import { Injectable } from '@nestjs/common';
import type { CurrencyInput, CurrencyUpdate } from '@crm/shared';
import type { Actor } from '../../common/auth.types';
import { conflict, notFound, validationError } from '../../common/errors';
import { Db } from '../../infra/db';
import { AuditService } from '../audit/audit.service';
import { HistoryService, diff } from '../history/history.service';

/** Maestro de monedas. Una moneda nunca se borra: se desactiva. */
@Injectable()
export class CurrenciesService {
  constructor(
    private readonly db: Db,
    private readonly history: HistoryService,
    private readonly audit: AuditService,
  ) {}

  list(includeInactive = false) {
    return this.db.tx.currency.findMany({
      where: {
        organizationId: this.db.organizationId,
        ...(includeInactive ? {} : { active: true }),
      },
      orderBy: [{ isBase: 'desc' }, { code: 'asc' }],
    });
  }

  async get(id: string) {
    const c = await this.db.tx.currency.findFirst({
      where: { id, organizationId: this.db.organizationId },
    });
    if (!c) throw notFound('La moneda');
    return c;
  }

  /** Lanza si la moneda no existe o está inactiva (para productos, tasas…). */
  async assertActive(code: string, field = 'currencyCode'): Promise<void> {
    const c = await this.db.tx.currency.findFirst({
      where: { organizationId: this.db.organizationId, code },
    });
    if (!c) throw validationError({ [field]: `La moneda ${code} no está registrada.` });
    if (!c.active) throw validationError({ [field]: `La moneda ${code} está inactiva.` });
  }

  async findByCode(code: string) {
    return this.db.tx.currency.findFirst({
      where: { organizationId: this.db.organizationId, code },
    });
  }

  async create(input: CurrencyInput, actor: Actor) {
    if (await this.findByCode(input.code))
      throw conflict(`La moneda ${input.code} ya existe.`, { code: 'Código en uso.' });
    const c = await this.db.tx.currency.create({
      data: { ...input, organizationId: actor.organizationId },
    });
    await this.history.record('CURRENCY', c.id, 'CREATE', actor.userId, { ...input });
    await this.audit.log('CURRENCY_CHANGED', {
      userId: actor.userId,
      entityType: 'CURRENCY',
      entityId: c.id,
      ip: actor.ip,
      details: { action: 'create', code: c.code },
    });
    return c;
  }

  async update(id: string, input: CurrencyUpdate, actor: Actor) {
    const before = await this.get(id);
    if (input.active === false && before.isBase) {
      throw conflict(
        'No se puede desactivar la moneda principal. Elija otra moneda principal primero.',
      );
    }
    const changes = diff(before, input, ['name', 'symbol', 'decimals', 'symbolPosition', 'active']);
    if (Object.keys(changes).length === 0) return before;
    const c = await this.db.tx.currency.update({ where: { id }, data: input });
    await this.history.record('CURRENCY', id, 'UPDATE', actor.userId, changes);
    await this.audit.log('CURRENCY_CHANGED', {
      userId: actor.userId,
      entityType: 'CURRENCY',
      entityId: id,
      ip: actor.ip,
      details: { code: c.code, changes },
    });
    return c;
  }

  /**
   * Cambia la moneda principal. No convierte importes ya guardados (cada uno conserva su moneda);
   * los reportes consolidan en la moneda que elija el usuario (D-14).
   */
  async setBase(id: string, actor: Actor) {
    const c = await this.get(id);
    if (!c.active) throw conflict('Active la moneda antes de marcarla como principal.');
    if (c.isBase) return c;
    const previous = await this.db.tx.currency.findFirst({
      where: { organizationId: actor.organizationId, isBase: true },
    });
    await this.db.tx.currency.updateMany({
      where: { organizationId: actor.organizationId, isBase: true },
      data: { isBase: false },
    });
    await this.db.tx.currency.update({ where: { id }, data: { isBase: true } });
    await this.db.q.organization.update({
      where: { id: actor.organizationId },
      data: { baseCurrencyCode: c.code },
    });
    const changes = { isBase: { from: previous?.code ?? null, to: c.code } };
    await this.history.record('CURRENCY', id, 'UPDATE', actor.userId, changes);
    await this.history.record('ORGANIZATION', actor.organizationId, 'UPDATE', actor.userId, {
      baseCurrencyCode: { from: previous?.code ?? null, to: c.code },
    });
    await this.audit.log('CURRENCY_CHANGED', {
      userId: actor.userId,
      entityType: 'CURRENCY',
      entityId: id,
      ip: actor.ip,
      details: { action: 'set-base', from: previous?.code ?? null, to: c.code },
    });
    return this.get(id);
  }
}
