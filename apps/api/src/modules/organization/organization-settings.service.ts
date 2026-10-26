import { Injectable } from '@nestjs/common';
import {
  DEFAULT_ORGANIZATION_SETTINGS,
  organizationSettingsSchema,
  type OrganizationSettings,
} from '@crm/shared';
import { Db } from '../../infra/db';

/** Lee los parámetros de la organización completando con los valores por defecto. */
export function parseSettings(raw: unknown): OrganizationSettings {
  const merged = {
    ...DEFAULT_ORGANIZATION_SETTINGS,
    ...(raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}),
  };
  const parsed = organizationSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_ORGANIZATION_SETTINGS;
}

@Injectable()
export class OrganizationSettingsService {
  constructor(private readonly db: Db) {}

  /** Parámetros de la organización en contexto (withOrg). */
  async get(): Promise<OrganizationSettings> {
    return this.getFor(this.db.organizationId);
  }

  async getFor(organizationId: string): Promise<OrganizationSettings> {
    const org = await this.db.q.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    });
    return parseSettings(org?.settings);
  }
}
