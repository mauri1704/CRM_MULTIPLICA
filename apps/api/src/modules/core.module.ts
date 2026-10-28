import { CrmRecordsService } from './access/crm-records.service';
import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit/audit.service';
import { SessionService } from './auth/session.service';
import { HistoryService } from './history/history.service';
import { NotificationsService } from './notifications/notifications.service';
import { OrganizationSettingsService } from './organization/organization-settings.service';
import { SequenceService } from './sequences/sequence.service';
import { TrashService } from './trash/trash.service';
import { CustomFieldsService } from './custom-fields/custom-fields.service';
import { RecordScopeService } from './access/record-scope.service';

/** Servicios transversales que usan todos los módulos de dominio. */
@Global()
@Module({
  providers: [
    AuditService,
    HistoryService,
    SequenceService,
    SessionService,
    NotificationsService,
    OrganizationSettingsService,
    TrashService,
    CustomFieldsService,
    RecordScopeService,
    CrmRecordsService,
  ],
  exports: [
    AuditService,
    HistoryService,
    SequenceService,
    SessionService,
    NotificationsService,
    OrganizationSettingsService,
    TrashService,
    CustomFieldsService,
    RecordScopeService,
    CrmRecordsService,
  ],
})
export class CoreModule {}
