import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  convertLeadInput,
  currencyCode,
  leadInput,
  leadUpdate,
  lineInput,
  lineUpdate,
  moveStageInput,
  type ConvertLeadInput,
  type LeadInput,
  type LeadUpdate,
  type LineInput,
  type LineUpdate,
  type MoveStageInput,
} from '@crm/shared';
import { z } from 'zod';
import { toActor, type AuthUser } from '../../common/auth.types';
import { ClientIp, CurrentUser, RequirePermission } from '../../common/decorators';
import { UuidPipe } from '../../common/uuid.pipe';
import { ZodBody, ZodQuery } from '../../common/zod';
import { LeadsService } from './leads.service';

const filters = {
  q: z.string().trim().max(100).optional(),
  pipelineId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  priorityId: z.string().uuid().optional(),
  status: z.enum(['OPEN', 'LOST', 'CONVERTED']).optional(),
};
export const leadQuery = z.object({
  ...filters,
  sort: z.enum(['createdAt', 'title', 'code', 'estimatedValue']).default('createdAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
const boardQuery = z.object(filters);
const previewQuery = z.object({ currencyCode: currencyCode.optional() });

@ApiTags('Prospectos')
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  @RequirePermission('leads', 'view')
  @ZodQuery(leadQuery)
  list(@CurrentUser() user: AuthUser, @Query() q: z.infer<typeof leadQuery>) {
    return this.leads.list(user, q);
  }

  @Get('board')
  @RequirePermission('leads', 'view')
  @ZodQuery(boardQuery)
  board(@CurrentUser() user: AuthUser, @Query() q: z.infer<typeof boardQuery>) {
    return this.leads.board(user, q);
  }

  @Get(':id')
  @RequirePermission('leads', 'view')
  get(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.leads.get(user, id);
  }

  @Post()
  @RequirePermission('leads', 'create')
  @ZodBody(leadInput)
  create(@CurrentUser() user: AuthUser, @Body() body: LeadInput) {
    return this.leads.create(user, body);
  }

  @Patch(':id')
  @RequirePermission('leads', 'edit')
  @ZodBody(leadUpdate)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body() body: LeadUpdate,
  ) {
    return this.leads.update(user, id, body);
  }

  @Put(':id/stage')
  @RequirePermission('leads', 'edit')
  @ZodBody(moveStageInput)
  move(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body() body: MoveStageInput,
  ) {
    return this.leads.move(user, id, body);
  }

  @Delete(':id')
  @RequirePermission('leads', 'delete')
  async remove(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Param('id', UuidPipe) id: string,
  ) {
    await this.leads.remove(user, id, toActor(user, ip));
    return { ok: true };
  }

  @Post(':id/products')
  @RequirePermission('leads', 'edit')
  @ZodBody(lineInput)
  addLine(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body() body: LineInput,
  ) {
    return this.leads.addLine(user, id, body);
  }

  @Patch(':id/products/:lineId')
  @RequirePermission('leads', 'edit')
  @ZodBody(lineUpdate)
  updateLine(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Param('lineId', UuidPipe) lineId: string,
    @Body() body: LineUpdate,
  ) {
    return this.leads.updateLine(user, id, lineId, body);
  }

  @Delete(':id/products/:lineId')
  @RequirePermission('leads', 'edit')
  async removeLine(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Param('lineId', UuidPipe) lineId: string,
  ) {
    await this.leads.removeLine(user, id, lineId);
    return { ok: true };
  }

  @Get(':id/conversion-preview')
  @RequirePermission('deals', 'create')
  @ZodQuery(previewQuery)
  preview(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Query() q: z.infer<typeof previewQuery>,
  ) {
    return this.leads.conversionPreview(user, id, q.currencyCode);
  }

  /** Convertir exige poder editar el prospecto y crear negociaciones. */
  @Post(':id/convert')
  @RequirePermission('deals', 'create')
  @ZodBody(convertLeadInput)
  convert(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body() body: ConvertLeadInput,
  ) {
    return this.leads.convert(user, id, body);
  }
}
