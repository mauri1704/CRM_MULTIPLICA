import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TRASHABLE_ENTITIES } from '@crm/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth.types';
import { ClientIp, CurrentUser, RequirePermission } from '../../common/decorators';
import { UuidPipe } from '../../common/uuid.pipe';
import { ZodBody, ZodQuery } from '../../common/zod';
import { TrashService } from './trash.service';

const trashQuery = z.object({
  entityType: z.enum(TRASHABLE_ENTITIES).optional(),
  q: z.string().trim().max(100).optional(),
  status: z.enum(['IN_TRASH', 'RESTORED', 'PURGED']).default('IN_TRASH'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
const restoreBody = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) });
const purgeBody = z.object({ confirmation: z.string().min(1).max(300) });

@ApiTags('Papelera')
@Controller('trash')
export class TrashController {
  constructor(private readonly trash: TrashService) {}

  @Get()
  @RequirePermission('trash', 'view')
  @ZodQuery(trashQuery)
  list(@CurrentUser() user: AuthUser, @Query() query: z.infer<typeof trashQuery>) {
    return this.trash.list(user, query);
  }

  @Get(':id')
  @RequirePermission('trash', 'view')
  detail(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.trash.detail(user, id);
  }

  @Post('restore')
  @RequirePermission('trash', 'restore')
  @ZodBody(restoreBody)
  restore(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Body() body: z.infer<typeof restoreBody>,
  ) {
    return this.trash.restore(user, body.ids, ip);
  }

  @Delete(':id')
  @RequirePermission('trash', 'purge')
  @ZodBody(purgeBody)
  async purge(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Param('id', UuidPipe) id: string,
    @Body() body: z.infer<typeof purgeBody>,
  ) {
    await this.trash.purge(user, id, body.confirmation, ip);
    return { ok: true };
  }
}
