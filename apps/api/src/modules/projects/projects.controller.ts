import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  PROJECT_STATUSES,
  projectInput,
  projectUpdate,
  type ProjectInput,
  type ProjectUpdate,
} from '@crm/shared';
import { z } from 'zod';
import { toActor, type AuthUser } from '../../common/auth.types';
import { ClientIp, CurrentUser, RequirePermission } from '../../common/decorators';
import { UuidPipe } from '../../common/uuid.pipe';
import { ZodBody, ZodQuery } from '../../common/zod';
import { ProjectsService } from './projects.service';

export const projectQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  ownerId: z.string().uuid().optional(),
  sort: z.enum(['createdAt', 'name', 'code', 'endDate']).default('createdAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

@ApiTags('Proyectos')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequirePermission('projects', 'view')
  @ZodQuery(projectQuery)
  list(@CurrentUser() user: AuthUser, @Query() q: z.infer<typeof projectQuery>) {
    return this.projects.list(user, q);
  }

  @Get(':id')
  @RequirePermission('projects', 'view')
  get(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.projects.get(user, id);
  }

  @Post()
  @RequirePermission('projects', 'create')
  @ZodBody(projectInput)
  create(@CurrentUser() user: AuthUser, @Body() body: ProjectInput) {
    return this.projects.create(user, body);
  }

  @Patch(':id')
  @RequirePermission('projects', 'edit')
  @ZodBody(projectUpdate)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body() body: ProjectUpdate,
  ) {
    return this.projects.update(user, id, body);
  }

  @Delete(':id')
  @RequirePermission('projects', 'delete')
  async remove(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Param('id', UuidPipe) id: string,
  ) {
    await this.projects.remove(user, id, toActor(user, ip));
    return { ok: true };
  }
}
