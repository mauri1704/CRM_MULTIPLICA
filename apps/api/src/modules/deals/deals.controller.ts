import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  dealInput,
  dealUpdate,
  lineInput,
  lineUpdate,
  moveStageInput,
  type DealInput,
  type DealUpdate,
  type LineInput,
  type LineUpdate,
  type MoveStageInput,
} from '@crm/shared';
import { z } from 'zod';
import { toActor, type AuthUser } from '../../common/auth.types';
import { ClientIp, CurrentUser, RequirePermission } from '../../common/decorators';
import { UuidPipe } from '../../common/uuid.pipe';
import { ZodBody, ZodQuery } from '../../common/zod';
import { DealsService } from './deals.service';

const filters = {
  q: z.string().trim().max(100).optional(),
  pipelineId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  priorityId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  status: z.enum(['OPEN', 'WON', 'LOST']).optional(),
};
export const dealQuery = z.object({
  ...filters,
  sort: z.enum(['createdAt', 'title', 'code', 'total', 'expectedCloseDate']).default('createdAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
const boardQuery = z.object(filters);

@ApiTags('Negociaciones')
@Controller('deals')
export class DealsController {
  constructor(private readonly deals: DealsService) {}

  @Get()
  @RequirePermission('deals', 'view')
  @ZodQuery(dealQuery)
  list(@CurrentUser() user: AuthUser, @Query() q: z.infer<typeof dealQuery>) {
    return this.deals.list(user, q);
  }

  @Get('board')
  @RequirePermission('deals', 'view')
  @ZodQuery(boardQuery)
  board(@CurrentUser() user: AuthUser, @Query() q: z.infer<typeof boardQuery>) {
    return this.deals.board(user, q);
  }

  @Get(':id')
  @RequirePermission('deals', 'view')
  get(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.deals.get(user, id);
  }

  @Post()
  @RequirePermission('deals', 'create')
  @ZodBody(dealInput)
  create(@CurrentUser() user: AuthUser, @Body() body: DealInput) {
    return this.deals.create(user, body);
  }

  @Patch(':id')
  @RequirePermission('deals', 'edit')
  @ZodBody(dealUpdate)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body() body: DealUpdate,
  ) {
    return this.deals.update(user, id, body);
  }

  @Put(':id/stage')
  @RequirePermission('deals', 'edit')
  @ZodBody(moveStageInput)
  move(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Param('id', UuidPipe) id: string,
    @Body() body: MoveStageInput,
  ) {
    return this.deals.move(user, id, body, ip);
  }

  @Delete(':id')
  @RequirePermission('deals', 'delete')
  async remove(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Param('id', UuidPipe) id: string,
  ) {
    await this.deals.remove(user, id, toActor(user, ip));
    return { ok: true };
  }

  @Post(':id/products')
  @RequirePermission('deals', 'edit')
  @ZodBody(lineInput)
  addLine(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body() body: LineInput,
  ) {
    return this.deals.addLine(user, id, body);
  }

  @Patch(':id/products/:lineId')
  @RequirePermission('deals', 'edit')
  @ZodBody(lineUpdate)
  updateLine(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Param('lineId', UuidPipe) lineId: string,
    @Body() body: LineUpdate,
  ) {
    return this.deals.updateLine(user, id, lineId, body);
  }

  @Delete(':id/products/:lineId')
  @RequirePermission('deals', 'edit')
  async removeLine(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Param('lineId', UuidPipe) lineId: string,
  ) {
    await this.deals.removeLine(user, id, lineId);
    return { ok: true };
  }

  @Post(':id/refresh-rates')
  @HttpCode(200)
  @RequirePermission('deals', 'edit')
  refreshRates(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.deals.refreshRates(user, id);
  }
}
