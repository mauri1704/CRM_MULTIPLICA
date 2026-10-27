import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import {
  FILE_FORMATS,
  IMPORT_ENTITIES,
  MAX_IMPORT_BYTES,
  importRunInput,
  type ImportEntity,
  type ImportRunInput,
} from '@crm/shared';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth.types';
import { CurrentUser } from '../../common/decorators';
import { badRequest, notFound } from '../../common/errors';
import { TxTimeout } from '../../common/tx-timeout';
import { UuidPipe } from '../../common/uuid.pipe';
import { ZodBody, ZodQuery } from '../../common/zod';
import { ImportExportService, type FileResult } from './import-export.service';

const formatQuery = z.object({ format: z.enum(FILE_FORMATS).default('xlsx') });
/** Formato, columnas y separador; el resto de parámetros son los filtros de la lista del módulo. */
const exportQuery = z
  .object({
    format: z.enum(FILE_FORMATS).default('xlsx'),
    columns: z
      .string()
      .optional()
      .transform((v) => (v ? v.split(',').filter(Boolean) : undefined)),
    delimiter: z.enum([',', ';']).default(','),
  })
  .passthrough();

function entityOf(v: string): ImportEntity {
  if (!(IMPORT_ENTITIES as readonly string[]).includes(v)) throw notFound('El módulo');
  return v as ImportEntity;
}

const file = (r: FileResult) =>
  new StreamableFile(r.buffer, {
    type: r.contentType,
    disposition: `attachment; filename="${r.fileName}"`,
    length: r.buffer.length,
  });

@ApiTags('Importación y exportación')
@Controller('import-export')
export class ImportExportController {
  constructor(private readonly service: ImportExportService) {}

  @Get('jobs')
  jobs(@CurrentUser() user: AuthUser) {
    return this.service.jobs(user);
  }

  @Get('jobs/:id/errors')
  @TxTimeout(60_000)
  @ZodQuery(formatQuery)
  async errors(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Query() q: z.infer<typeof formatQuery>,
  ) {
    return file(await this.service.errorReport(user, id, q.format));
  }

  @Post('jobs/:id/analyze')
  @HttpCode(200)
  @TxTimeout(120_000)
  @ZodBody(importRunInput)
  analyze(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body() body: ImportRunInput,
  ) {
    return this.service.run(user, id, body, false);
  }

  @Post('jobs/:id/confirm')
  @HttpCode(200)
  @TxTimeout(300_000)
  @ZodBody(importRunInput)
  confirm(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body() body: ImportRunInput,
  ) {
    return this.service.run(user, id, body, true);
  }

  @Get(':entity/fields')
  fields(@CurrentUser() user: AuthUser, @Param('entity') entity: string) {
    return this.service.fields(user, entityOf(entity));
  }

  @Get(':entity/template')
  @ZodQuery(formatQuery)
  async template(
    @CurrentUser() user: AuthUser,
    @Param('entity') entity: string,
    @Query() q: z.infer<typeof formatQuery>,
  ) {
    return file(await this.service.template(user, entityOf(entity), q.format));
  }

  @Post(':entity/upload')
  @ApiConsumes('multipart/form-data')
  @TxTimeout(60_000)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } }))
  upload(
    @CurrentUser() user: AuthUser,
    @Param('entity') entity: string,
    @UploadedFile() upload: Express.Multer.File | undefined,
  ) {
    if (!upload) throw badRequest('Adjunte un archivo .xlsx o .csv.');
    return this.service.upload(user, entityOf(entity), upload);
  }

  @Get(':entity/export-columns')
  exportColumns(@CurrentUser() user: AuthUser, @Param('entity') entity: string) {
    return this.service.exportColumns(user, entityOf(entity));
  }

  @Get(':entity/export')
  @TxTimeout(120_000)
  @ZodQuery(exportQuery)
  async export(
    @CurrentUser() user: AuthUser,
    @Param('entity') entity: string,
    @Query() q: z.infer<typeof exportQuery>,
  ) {
    const { format, columns, delimiter, ...filters } = q;
    return file(
      await this.service.export(user, entityOf(entity), { format, columns, delimiter, filters }),
    );
  }
}
