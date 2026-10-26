import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  PIPELINE_ENTITIES,
  catalogActiveInput,
  pipelineInput,
  type PipelineInput,
} from '@crm/shared';
import { z } from 'zod';
import { toActor, type AuthUser } from '../../common/auth.types';
import { ClientIp, CurrentUser, RequirePermission } from '../../common/decorators';
import { UuidPipe } from '../../common/uuid.pipe';
import { ZodBody, ZodQuery } from '../../common/zod';
import { PipelinesService } from './pipelines.service';

const pipelinesQuery = z.object({
  entityType: z.enum(PIPELINE_ENTITIES).optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

@ApiTags('Pipelines')
@Controller('pipelines')
export class PipelinesController {
  constructor(private readonly pipelines: PipelinesService) {}

  @Get()
  @ZodQuery(pipelinesQuery)
  list(@Query() query: z.infer<typeof pipelinesQuery>) {
    return this.pipelines.list(query.entityType, query.includeInactive);
  }

  @Get(':id')
  get(@Param('id', UuidPipe) id: string) {
    return this.pipelines.get(id);
  }

  @Post()
  @RequirePermission('settings', 'manage')
  @ZodBody(pipelineInput)
  create(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Body() body: PipelineInput,
  ) {
    return this.pipelines.create(body, toActor(user, ip));
  }

  @Put(':id')
  @RequirePermission('settings', 'manage')
  @ZodBody(pipelineInput)
  update(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Param('id', UuidPipe) id: string,
    @Body() body: PipelineInput,
  ) {
    return this.pipelines.update(id, body, toActor(user, ip));
  }

  @Put(':id/active')
  @RequirePermission('settings', 'manage')
  @ZodBody(catalogActiveInput)
  setActive(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Param('id', UuidPipe) id: string,
    @Body() body: { active: boolean },
  ) {
    return this.pipelines.setActive(id, body.active, toActor(user, ip));
  }
}
