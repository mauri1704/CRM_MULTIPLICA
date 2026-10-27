import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { contactInput, contactUpdate, type ContactInput, type ContactUpdate } from '@crm/shared';
import { z } from 'zod';
import { toActor, type AuthUser } from '../../common/auth.types';
import { ClientIp, CurrentUser, RequirePermission } from '../../common/decorators';
import { UuidPipe } from '../../common/uuid.pipe';
import { ZodBody, ZodQuery } from '../../common/zod';
import { ContactsService } from './contacts.service';

export const contactQuery = z.object({
  q: z.string().trim().max(100).optional(),
  companyId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  sort: z.enum(['firstName', 'lastName', 'code', 'createdAt']).default('firstName'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

@ApiTags('Contactos')
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  @RequirePermission('contacts', 'view')
  @ZodQuery(contactQuery)
  list(@CurrentUser() user: AuthUser, @Query() query: z.infer<typeof contactQuery>) {
    return this.contacts.list(user, query);
  }

  @Get(':id')
  @RequirePermission('contacts', 'view')
  get(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.contacts.get(user, id);
  }

  @Post()
  @RequirePermission('contacts', 'create')
  @ZodBody(contactInput)
  create(@CurrentUser() user: AuthUser, @Body() body: ContactInput) {
    return this.contacts.create(user, body);
  }

  @Patch(':id')
  @RequirePermission('contacts', 'edit')
  @ZodBody(contactUpdate)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body() body: ContactUpdate,
  ) {
    return this.contacts.update(user, id, body);
  }

  @Delete(':id')
  @RequirePermission('contacts', 'delete')
  async remove(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Param('id', UuidPipe) id: string,
  ) {
    await this.contacts.remove(user, id, toActor(user, ip));
    return { ok: true };
  }
}
