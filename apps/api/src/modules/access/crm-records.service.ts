import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth.types';
import { notFound } from '../../common/errors';
import { Db } from '../../infra/db';
import { RecordScopeService } from './record-scope.service';

export type CrmRecordType = 'LEAD' | 'DEAL' | 'CONTACT' | 'COMPANY';

export const CRM_MODULE = {
  LEAD: 'leads',
  DEAL: 'deals',
  CONTACT: 'contacts',
  COMPANY: 'companies',
} as const;
export const CRM_FIELD = {
  LEAD: 'leadId',
  DEAL: 'dealId',
  CONTACT: 'contactId',
  COMPANY: 'companyId',
} as const;
export const CRM_PATH = {
  LEAD: '/prospectos',
  DEAL: '/negociaciones',
  CONTACT: '/contactos',
  COMPANY: '/companias',
} as const;

/** Registros CRM (prospecto, negociación, contacto, compañía) vistos desde otros módulos. */
@Injectable()
export class CrmRecordsService {
  constructor(
    private readonly db: Db,
    private readonly scope: RecordScopeService,
  ) {}

  /** Registro vigente (o null) con su responsable, código y nombre para mostrar. */
  async find(type: CrmRecordType, id: string) {
    const where = { id, organizationId: this.db.organizationId, deletedAt: null };
    switch (type) {
      case 'LEAD': {
        const r = await this.db.tx.lead.findFirst({
          where,
          select: { ownerId: true, code: true, title: true },
        });
        return r && { ownerId: r.ownerId, code: r.code, name: r.title };
      }
      case 'DEAL': {
        const r = await this.db.tx.deal.findFirst({
          where,
          select: { ownerId: true, code: true, title: true },
        });
        return r && { ownerId: r.ownerId, code: r.code, name: r.title };
      }
      case 'CONTACT': {
        const r = await this.db.tx.contact.findFirst({
          where,
          select: { ownerId: true, code: true, firstName: true, lastName: true },
        });
        return (
          r && {
            ownerId: r.ownerId,
            code: r.code,
            name: [r.firstName, r.lastName].filter(Boolean).join(' '),
          }
        );
      }
      case 'COMPANY': {
        const r = await this.db.tx.company.findFirst({
          where,
          select: { ownerId: true, code: true, legalName: true },
        });
        return r && { ownerId: r.ownerId, code: r.code, name: r.legalName };
      }
    }
  }

  /** Comprueba que existe, está vigente y el usuario lo puede ver; devuelve "código nombre". */
  async assertVisible(user: AuthUser, type: CrmRecordType, id: string): Promise<string> {
    const rec = await this.find(type, id);
    if (!rec) throw notFound();
    await this.scope.assert(user, CRM_MODULE[type], 'view', rec.ownerId);
    return `${rec.code} ${rec.name}`;
  }
}
