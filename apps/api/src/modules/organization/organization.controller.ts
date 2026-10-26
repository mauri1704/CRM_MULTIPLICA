import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { updateOrganizationInput, type UpdateOrganizationInput } from '@crm/shared';
import { toActor, type AuthUser } from '../../common/auth.types';
import { ClientIp, CurrentUser, RequirePermission } from '../../common/decorators';
import { ZodBody } from '../../common/zod';
import { OrganizationService } from './organization.service';

@ApiTags('Organización')
@Controller('organization')
export class OrganizationController {
  constructor(private readonly organization: OrganizationService) {}

  /** Cualquier usuario autenticado: la interfaz necesita zona horaria, formatos y moneda principal. */
  @Get()
  get() {
    return this.organization.get();
  }

  @Patch()
  @RequirePermission('settings', 'manage')
  @ZodBody(updateOrganizationInput)
  update(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Body() body: UpdateOrganizationInput,
  ) {
    return this.organization.update(body, toActor(user, ip));
  }
}
