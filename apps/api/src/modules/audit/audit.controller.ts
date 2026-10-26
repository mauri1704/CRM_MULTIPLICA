import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AUDIT_EVENTS } from '@crm/shared';
import { z } from 'zod';
import { RequirePermission } from '../../common/decorators';
import { ZodQuery } from '../../common/zod';
import { AuditService } from './audit.service';

const auditQuery = z.object({
  event: z.enum(AUDIT_EVENTS).optional(),
  userId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

@ApiTags('Auditoría')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('audit', 'view')
  @ZodQuery(auditQuery)
  list(@Query() query: z.infer<typeof auditQuery>) {
    return this.audit.list(query);
  }
}
