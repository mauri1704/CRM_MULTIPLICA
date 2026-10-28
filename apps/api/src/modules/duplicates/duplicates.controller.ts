import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CANDIDATE_STATUSES,
  DUPLICATE_ENTITIES,
  checkDuplicatesInput,
  duplicateRuleInput,
  duplicateRuleUpdate,
  mergeInput,
  scanInput,
  type CheckDuplicatesInput,
  type DuplicateRuleInput,
  type DuplicateRuleUpdate,
  type MergeInput,
  type ScanInput,
} from '@crm/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth.types';
import { ClientIp, CurrentUser, RequirePermission } from '../../common/decorators';
import { UuidPipe } from '../../common/uuid.pipe';
import { ZodBody, ZodQuery } from '../../common/zod';
import { DuplicatesService } from './duplicates.service';
import { MergeService } from './merge.service';

const ruleQuery = z.object({ entityType: z.enum(DUPLICATE_ENTITIES).optional() });
const candidateQuery = z.object({
  status: z.enum(CANDIDATE_STATUSES).default('OPEN'),
  entityType: z.enum(DUPLICATE_ENTITIES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

@ApiTags('Duplicados')
@Controller('duplicates')
export class DuplicatesController {
  constructor(
    private readonly duplicates: DuplicatesService,
    private readonly merges: MergeService,
  ) {}

  @Get('rules')
  @RequirePermission('duplicates', 'view')
  @ZodQuery(ruleQuery)
  rules(@Query() q: z.infer<typeof ruleQuery>) {
    return this.duplicates.listRules(q.entityType);
  }

  @Post('rules')
  @RequirePermission('duplicates', 'manage')
  @ZodBody(duplicateRuleInput)
  createRule(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Body() body: DuplicateRuleInput,
  ) {
    return this.duplicates.createRule(user, body, ip);
  }

  @Patch('rules/:id')
  @RequirePermission('duplicates', 'manage')
  @ZodBody(duplicateRuleUpdate)
  updateRule(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Param('id', UuidPipe) id: string,
    @Body() body: DuplicateRuleUpdate,
  ) {
    return this.duplicates.updateRule(user, id, body, ip);
  }

  @Delete('rules/:id')
  @RequirePermission('duplicates', 'manage')
  async deleteRule(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Param('id', UuidPipe) id: string,
  ) {
    await this.duplicates.deleteRule(user, id, ip);
    return { ok: true };
  }

  @Post('scan')
  @HttpCode(200)
  @RequirePermission('duplicates', 'view')
  @ZodBody(scanInput)
  scan(@CurrentUser() user: AuthUser, @Body() body: ScanInput) {
    return this.duplicates.scan(user, body.entityType);
  }

  /** Aviso al guardar: el formulario consulta antes de enviar. */
  @Post('check')
  @HttpCode(200)
  @ZodBody(checkDuplicatesInput)
  check(@CurrentUser() user: AuthUser, @Body() body: CheckDuplicatesInput) {
    return this.duplicates.check(user, body);
  }

  @Get('counts')
  @RequirePermission('duplicates', 'view')
  counts(@CurrentUser() user: AuthUser) {
    return this.duplicates.counts(user);
  }

  @Get('candidates')
  @RequirePermission('duplicates', 'view')
  @ZodQuery(candidateQuery)
  list(@CurrentUser() user: AuthUser, @Query() q: z.infer<typeof candidateQuery>) {
    return this.duplicates.list(user, q);
  }

  @Get('candidates/:id')
  @RequirePermission('duplicates', 'view')
  compare(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.merges.compare(user, id);
  }

  @Post('candidates/:id/keep-both')
  @RequirePermission('duplicates', 'merge')
  keepBoth(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.duplicates.resolve(user, id, 'KEPT_BOTH');
  }

  @Post('candidates/:id/reviewed')
  @RequirePermission('duplicates', 'merge')
  reviewed(@CurrentUser() user: AuthUser, @Param('id', UuidPipe) id: string) {
    return this.duplicates.resolve(user, id, 'REVIEWED');
  }

  @Post('merge')
  @RequirePermission('duplicates', 'merge')
  @ZodBody(mergeInput)
  merge(
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string | undefined,
    @Body() body: MergeInput,
  ) {
    return this.merges.merge(user, body, ip);
  }
}
