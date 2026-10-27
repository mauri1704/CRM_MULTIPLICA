import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { companyInput, companyUpdate, type CompanyInput, type CompanyUpdate } from '@crm/shared';
import { z } from 'zod';
import { toActor, type AuthUser } from '../../common/auth.types';
import { ClientIp, CurrentUser, RequirePermission } from '../../common/decorators';
import { UuidPipe } from '../../common/uuid.pipe';
import { ZodBody, ZodQuery } from '../../common/zod';
import { CompaniesService } from './companies.service';

export const companyQuery = z.object({
  q: z.string().trim().max(100).optional(),
  sectorId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  city: z.string().trim().max(100).optional(),
  sort: z.enum(['legalName', 'code', 'createdAt', 'city']).default('legalName'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

@ApiTags('Compañías')
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  @RequirePermission('companies', 'view')
  @ZodQuery(companyQuery)
  list(@CurrentUser() user: AuthUser, @Query() query: z.infer<typeof companyQuery>) {
    return this.companies.list(user, query);
  }

  @Get(':id')
  @RequirePermission('companies', 'view')
  get(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.companies.get(user, id);
  }

  @Post()
  @RequirePermission('companies', 'create')
  @ZodBody(companyInput)
  create(@CurrentUser() user: AuthUser, @Body() body: CompanyInput) {
    return this.companies.create(user, body);
  }

  @Patch(':id')
  @RequirePermission('companies', 'edit')
  @ZodBody(companyUpdate)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body() body: CompanyUpdate,
  ) {
    return this.companies.update(user, id, body);
  }

  @Delete(':id')
  @RequirePermission('companies', 'delete')
  remove(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Param('id', UuidPipe) id: string,
  ) {
    return this.companies.remove(user, id, toActor(user, ip));
  }
}
