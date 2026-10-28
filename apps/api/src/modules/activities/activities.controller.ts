import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ACTIVITY_TARGETS,
  activityInput,
  activityUpdate,
  type ActivityInput,
  type ActivityTarget,
  type ActivityUpdate,
} from '@crm/shared';
import type { AuthUser } from '../../common/auth.types';
import { CurrentUser } from '../../common/decorators';
import { notFound } from '../../common/errors';
import { UuidPipe } from '../../common/uuid.pipe';
import { ZodBody } from '../../common/zod';
import { ActivitiesService } from './activities.service';

function targetOf(v: string): ActivityTarget {
  const t = v.toUpperCase();
  if (!(ACTIVITY_TARGETS as readonly string[]).includes(t)) throw notFound();
  return t as ActivityTarget;
}

/** El permiso lo da el registro: quien lo puede ver puede registrar actividades en él. */
@ApiTags('Actividades')
@Controller('activities')
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get(':type/:id')
  list(
    @CurrentUser() user: AuthUser,
    @Param('type') type: string,
    @Param('id', UuidPipe) id: string,
  ) {
    return this.activities.list(user, targetOf(type), id);
  }

  @Post(':type/:id')
  @ZodBody(activityInput)
  create(
    @CurrentUser() user: AuthUser,
    @Param('type') type: string,
    @Param('id', UuidPipe) id: string,
    @Body() body: ActivityInput,
  ) {
    return this.activities.create(user, targetOf(type), id, body);
  }

  @Patch(':activityId')
  @ZodBody(activityUpdate)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('activityId', UuidPipe) activityId: string,
    @Body() body: ActivityUpdate,
  ) {
    await this.activities.update(user, activityId, body);
    return { ok: true };
  }

  @Delete(':activityId')
  async remove(@CurrentUser() user: AuthUser, @Param('activityId', UuidPipe) activityId: string) {
    await this.activities.remove(user, activityId);
    return { ok: true };
  }
}
