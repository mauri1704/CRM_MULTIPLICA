import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { UpdateOrganizationInput } from '@crm/shared';
import type { Actor } from '../../common/auth.types';
import { notFound } from '../../common/errors';
import { Db } from '../../infra/db';
import { AuditService } from '../audit/audit.service';
import { HistoryService, diff } from '../history/history.service';
import { parseSettings } from './organization-settings.service';

@Injectable()
export class OrganizationService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly history: HistoryService,
  ) {}

  async get() {
    const org = await this.db.q.organization.findUnique({ where: { id: this.db.organizationId } });
    if (!org) throw notFound('La organización');
    return { ...org, settings: parseSettings(org.settings) };
  }

  async update(input: UpdateOrganizationInput, actor: Actor) {
    const current = await this.get();
    const settings = { ...current.settings, ...(input.settings ?? {}) };
    const next = {
      name: input.name ?? current.name,
      legalName: input.legalName === undefined ? current.legalName : input.legalName,
      taxId: input.taxId === undefined ? current.taxId : input.taxId,
      baseCurrencyCode: input.baseCurrencyCode ?? current.baseCurrencyCode,
    };
    const changes = {
      ...diff(current, next, ['name', 'legalName', 'taxId', 'baseCurrencyCode']),
      ...Object.fromEntries(
        Object.entries(
          diff(current.settings, settings, Object.keys(settings) as (keyof typeof settings)[]),
        ).map(([k, v]) => [`settings.${k}`, v]),
      ),
    };
    if (Object.keys(changes).length === 0) return current;

    await this.db.q.organization.update({
      where: { id: actor.organizationId },
      data: { ...next, settings: settings as Prisma.InputJsonValue },
    });
    await this.history.record(
      'ORGANIZATION',
      actor.organizationId,
      'UPDATE',
      actor.userId,
      changes,
    );
    await this.audit.log('SETTINGS_CHANGED', {
      userId: actor.userId,
      entityType: 'ORGANIZATION',
      entityId: actor.organizationId,
      ip: actor.ip,
      details: { changes },
    });
    return this.get();
  }
}
