import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth.types';
import { CurrentUser } from '../../common/decorators';
import { UuidPipe } from '../../common/uuid.pipe';
import { ZodQuery } from '../../common/zod';
import { NotificationsService } from './notifications.service';

const notificationsQuery = z.object({
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

/** Solo las notificaciones propias del usuario. */
@ApiTags('Notificaciones')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ZodQuery(notificationsQuery)
  list(@CurrentUser() user: AuthUser, @Query() query: z.infer<typeof notificationsQuery>) {
    return this.notifications.list(user.id, query.unread);
  }

  @Post('read-all')
  @HttpCode(200)
  async readAll(@CurrentUser() user: AuthUser) {
    await this.notifications.markRead(user.id);
    return { ok: true };
  }

  @Post(':id/read')
  @HttpCode(200)
  async read(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    await this.notifications.markRead(user.id, id);
    return { ok: true };
  }
}
