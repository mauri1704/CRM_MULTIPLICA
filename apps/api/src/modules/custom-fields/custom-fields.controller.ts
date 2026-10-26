import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CUSTOM_FIELD_ENTITIES,
  customFieldDefinitionInput,
  customFieldDefinitionUpdate,
  type CustomFieldDefinitionInput,
  type CustomFieldDefinitionUpdate,
} from '@crm/shared';
import { z } from 'zod';
import { toActor, type AuthUser } from '../../common/auth.types';
import { ClientIp, CurrentUser, RequirePermission } from '../../common/decorators';
import { UuidPipe } from '../../common/uuid.pipe';
import { ZodBody, ZodQuery } from '../../common/zod';
import { CustomFieldsService } from './custom-fields.service';

const customFieldsQuery = z.object({
  entityType: z.enum(CUSTOM_FIELD_ENTITIES).optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

@ApiTags('Campos personalizados')
@Controller('custom-fields')
export class CustomFieldsController {
  constructor(private readonly fields: CustomFieldsService) {}

  @Get()
  @ZodQuery(customFieldsQuery)
  list(@Query() query: z.infer<typeof customFieldsQuery>) {
    return this.fields.list(query.entityType, query.includeInactive);
  }

  @Post()
  @RequirePermission('settings', 'manage')
  @ZodBody(customFieldDefinitionInput)
  create(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Body() body: CustomFieldDefinitionInput,
  ) {
    return this.fields.create(body, toActor(user, ip));
  }

  @Patch(':id')
  @RequirePermission('settings', 'manage')
  @ZodBody(customFieldDefinitionUpdate)
  update(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Param('id', UuidPipe) id: string,
    @Body() body: CustomFieldDefinitionUpdate,
  ) {
    return this.fields.update(id, body, toActor(user, ip));
  }
}
