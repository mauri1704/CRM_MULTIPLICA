import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  TASK_RELATIONS,
  moveTaskInput,
  rescheduleTaskInput,
  taskInput,
  taskUpdate,
  type MoveTaskInput,
  type RescheduleTaskInput,
  type TaskInput,
  type TaskUpdate,
} from '@crm/shared';
import { z } from 'zod';
import { toActor, type AuthUser } from '../../common/auth.types';
import { ClientIp, CurrentUser, RequirePermission } from '../../common/decorators';
import { UuidPipe } from '../../common/uuid.pipe';
import { ZodBody, ZodQuery } from '../../common/zod';
import { TasksService } from './tasks.service';

const flag = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');
const id = z.string().uuid().optional();
const filters = {
  q: z.string().trim().max(100).optional(),
  rel: z.enum(TASK_RELATIONS).optional(),
  responsibleId: id,
  priorityId: id,
  statusId: id,
  projectId: id,
  contactId: id,
  companyId: id,
  leadId: id,
  dealId: id,
  open: flag,
  overdue: flag,
};
export const taskQuery = z.object({
  ...filters,
  sort: z.enum(['dueAt', 'createdAt', 'title', 'code']).default('dueAt'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
const boardQuery = z.object(filters);
const calendarQuery = z
  .object({ ...filters, from: z.coerce.date(), to: z.coerce.date() })
  .refine((v) => v.to > v.from && v.to.getTime() - v.from.getTime() <= 62 * 86_400_000, {
    message: 'Rango de fechas no válido (máximo 62 días).',
    path: ['to'],
  });

@ApiTags('Tareas')
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @RequirePermission('tasks', 'view')
  @ZodQuery(taskQuery)
  list(@CurrentUser() user: AuthUser, @Query() q: z.infer<typeof taskQuery>) {
    return this.tasks.list(user, q);
  }

  @Get('board')
  @RequirePermission('tasks', 'view')
  @ZodQuery(boardQuery)
  board(@CurrentUser() user: AuthUser, @Query() q: z.infer<typeof boardQuery>) {
    return this.tasks.board(user, q);
  }

  @Get('calendar')
  @RequirePermission('tasks', 'view')
  @ZodQuery(calendarQuery)
  calendar(@CurrentUser() user: AuthUser, @Query() q: z.infer<typeof calendarQuery>) {
    return this.tasks.calendar(user, q);
  }

  @Get(':id')
  @RequirePermission('tasks', 'view')
  get(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.tasks.get(user, id);
  }

  @Post()
  @RequirePermission('tasks', 'create')
  @ZodBody(taskInput)
  create(@CurrentUser() user: AuthUser, @Body() body: TaskInput) {
    return this.tasks.create(user, body);
  }

  @Patch(':id')
  @RequirePermission('tasks', 'edit')
  @ZodBody(taskUpdate)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body() body: TaskUpdate,
  ) {
    return this.tasks.update(user, id, body);
  }

  @Put(':id/status')
  @RequirePermission('tasks', 'edit')
  @ZodBody(moveTaskInput)
  move(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body() body: MoveTaskInput,
  ) {
    return this.tasks.move(user, id, body);
  }

  @Put(':id/schedule')
  @RequirePermission('tasks', 'edit')
  @ZodBody(rescheduleTaskInput)
  reschedule(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body() body: RescheduleTaskInput,
  ) {
    return this.tasks.reschedule(user, id, body);
  }

  @Delete(':id')
  @RequirePermission('tasks', 'delete')
  async remove(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Param('id', UuidPipe) id: string,
  ) {
    await this.tasks.remove(user, id, toActor(user, ip));
    return { ok: true };
  }
}
