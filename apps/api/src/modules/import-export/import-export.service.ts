import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  IMPORT_ENTITY_LABELS,
  MAX_EXPORT_ROWS,
  PERMISSION_MODULES,
  can,
  normalizeText,
  type DuplicateMode,
  type FileFormat,
  type ImportEntity,
  type ImportFieldInfo,
  type ImportRowError,
  type ImportRunInput,
  type ImportSummary,
} from '@crm/shared';
import type { AuthUser } from '../../common/auth.types';
import { badRequest, conflict, forbidden, notFound, validationError } from '../../common/errors';
import { Db } from '../../infra/db';
import { env } from '../../infra/env';
import { RecordScopeService } from '../access/record-scope.service';
import { DuplicateDetectionService } from '../duplicates/duplicate-detection.service';
import { AuditService } from '../audit/audit.service';
import type { Existing, ImportExportDefinition } from './definitions';
import { ImportExportRegistry } from './registry';
import { parseSpreadsheet, writeSpreadsheet, type ExportColumn } from './spreadsheet';

const MAX_STORED_ERRORS = 2000;

interface PlanItem {
  row: number;
  data: unknown;
  existing: Existing | null;
}

export interface ExportRequest {
  format: FileFormat;
  columns?: string[];
  delimiter: ',' | ';';
  filters: Record<string, unknown>;
}

export interface FileResult {
  buffer: Buffer;
  fileName: string;
  contentType: string;
}

const CONTENT_TYPES: Record<FileFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
};

function formatOf(fileName: string): FileFormat {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'xlsx' || ext === 'csv') return ext;
  throw badRequest('Formato no admitido. Suba un archivo .xlsx o .csv.');
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

/**
 * Importación y exportación transversal (Fase 2: base). Importar es de dos pasos: analizar (vista
 * previa sin escribir) y confirmar. Nada inválido se importa en silencio: cada error queda en el
 * reporte descargable. Las filas válidas se guardan una a una con un SAVEPOINT, así un error
 * inesperado en una fila no deshace las demás.
 */
@Injectable()
export class ImportExportService {
  constructor(
    private readonly db: Db,
    private readonly registry: ImportExportRegistry,
    private readonly scope: RecordScopeService,
    private readonly audit: AuditService,
    private readonly detection: DuplicateDetectionService,
  ) {}

  private storagePath(rel: string) {
    return join(resolve(env().STORAGE_DIR), rel);
  }

  private assertCan(
    user: AuthUser,
    def: ImportExportDefinition<unknown, unknown>,
    action: 'import' | 'export',
  ) {
    const actions = PERMISSION_MODULES[def.module].actions as readonly string[];
    // Monedas y tasas: importar exige además poder administrarlas.
    const extra =
      actions.includes('manage') && action === 'import'
        ? can(user.permissions, def.module, 'manage')
        : true;
    if (!can(user.permissions, def.module, action) || !extra) throw forbidden();
  }

  async fields(user: AuthUser, entity: ImportEntity): Promise<ImportFieldInfo[]> {
    const def = await this.registry.create(entity);
    this.assertCan(user, def, 'import');
    return def.fields();
  }

  async template(user: AuthUser, entity: ImportEntity, format: FileFormat): Promise<FileResult> {
    const def = await this.registry.create(entity);
    this.assertCan(user, def, 'import');
    const fields = await def.fields();
    const example = def.example();
    const columns: ExportColumn<Record<string, string>>[] = fields.map((f) => ({
      key: f.key,
      label: f.label,
      value: (r) => r[f.key] ?? '',
    }));
    return {
      buffer: await writeSpreadsheet(format, def.sheetName, columns, [example]),
      fileName: `plantilla-${entity}.${format}`,
      contentType: CONTENT_TYPES[format],
    };
  }

  /** Paso 1: sube el archivo, lo lee y propone el mapeo de columnas. */
  async upload(
    user: AuthUser,
    entity: ImportEntity,
    file: { originalname: string; buffer: Buffer },
  ) {
    const def = await this.registry.create(entity);
    this.assertCan(user, def, 'import');
    const format = formatOf(file.originalname);
    const sheet = await parseSpreadsheet(file.buffer, format);
    const fields = await def.fields();
    const job = await this.db.tx.importJob.create({
      data: {
        organizationId: user.organizationId,
        entityType: entity,
        fileName: file.originalname.slice(0, 255),
        format,
        filePath: '',
        headers: sheet.headers,
        totalRows: sheet.rows.length,
        createdById: user.id,
      },
    });
    const rel = join('imports', user.organizationId, `${job.id}.${format}`);
    await mkdir(dirname(this.storagePath(rel)), { recursive: true });
    await writeFile(this.storagePath(rel), file.buffer);
    await this.db.tx.importJob.update({ where: { id: job.id }, data: { filePath: rel } });

    const byName = new Map<string, string>();
    for (const f of fields) {
      byName.set(normalizeText(f.label), f.key);
      byName.set(normalizeText(f.key), f.key);
    }
    const mapping = Object.fromEntries(
      sheet.headers.map((h) => [h, byName.get(normalizeText(h)) ?? '']),
    );
    return {
      jobId: job.id,
      fileName: job.fileName,
      totalRows: sheet.rows.length,
      headers: sheet.headers,
      fields,
      mapping,
      sample: sheet.rows.slice(0, 5),
    };
  }

  /** Quien puede ver la auditoría (administración) ve todas las importaciones; el resto, las suyas. */
  private seesAllJobs(user: AuthUser) {
    return can(user.permissions, 'audit', 'view');
  }

  private async loadJob(user: AuthUser, id: string, purpose: 'run' | 'read') {
    const job = await this.db.tx.importJob.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!job) throw notFound('La importación');
    const allowed = job.createdById === user.id || (purpose === 'read' && this.seesAllJobs(user));
    if (!allowed) throw forbidden('Solo quien subió el archivo puede continuar esta importación.');
    return job;
  }

  /** Paso 2 (vista previa) y 3 (confirmar). */
  async run(user: AuthUser, jobId: string, input: ImportRunInput, commit: boolean) {
    const job = await this.loadJob(user, jobId, 'run');
    if (job.status !== 'UPLOADED')
      throw conflict('Esta importación ya se ejecutó. Suba el archivo de nuevo.');
    const def = await this.registry.create(job.entityType as ImportEntity);
    this.assertCan(user, def, 'import');
    if (input.duplicateMode === 'UPDATE' && !can(user.permissions, def.module, def.updateAction)) {
      throw forbidden(
        'No tiene permiso para actualizar registros existentes; elija "Omitir duplicados".',
      );
    }

    const fields = await def.fields();
    const labels = new Map(fields.map((f) => [f.key, f.label]));
    const mappedKeys = new Set(Object.values(input.mapping).filter(Boolean));
    const unknown = [...mappedKeys].filter((k) => !labels.has(k));
    if (unknown.length > 0)
      throw validationError({ mapping: `Campos no válidos: ${unknown.join(', ')}.` });
    const missing = fields.filter((f) => f.required && !mappedKeys.has(f.key));
    if (missing.length > 0) {
      throw validationError({
        mapping: `Asigne una columna para: ${missing.map((f) => f.label).join(', ')}.`,
      });
    }
    const dupTargets = [...mappedKeys].filter(
      (k) => Object.values(input.mapping).filter((v) => v === k).length > 1,
    );
    if (dupTargets.length > 0) {
      throw validationError({
        mapping: `Cada campo puede recibir una sola columna: ${dupTargets.map((k) => labels.get(k)).join(', ')}.`,
      });
    }

    const sheet = await parseSpreadsheet(
      await readFile(this.storagePath(job.filePath)),
      job.format as FileFormat,
    );
    const errors: ImportRowError[] = [];
    const plan: PlanItem[] = [];
    const seen = new Map<string, number>();
    let duplicates = 0;
    let skipped = 0;
    const recordScoped = PERMISSION_MODULES[def.module].recordScoped;

    for (const [i, raw] of sheet.rows.entries()) {
      const row = i + 2; // fila 1 = encabezados
      const values: Record<string, string> = {};
      for (const [header, key] of Object.entries(input.mapping))
        if (key) values[key] = raw[header] ?? '';
      const parsed = await def.parse(values, user);
      if (!parsed.ok) {
        for (const [field, message] of Object.entries(parsed.errors)) {
          errors.push({ row, field: labels.get(field) ?? field, message });
        }
        continue;
      }
      if (parsed.key) {
        const first = seen.get(parsed.key);
        if (first !== undefined) {
          errors.push({ row, field: '—', message: `Repite el registro de la fila ${first}.` });
          continue;
        }
        seen.set(parsed.key, row);
      }
      const found = parsed.key ? await def.findExisting(parsed.data, parsed.key) : null;
      // «Crear de todos modos»: la coincidencia se informa, pero la fila se crea como nueva.
      const existing = input.duplicateMode === 'CREATE' ? null : found;
      if (found) duplicates++;
      if (existing) {
        if (input.duplicateMode === 'SKIP') {
          skipped++;
          continue;
        }
        if (
          recordScoped &&
          !(await this.scope.allows(user, def.module, def.updateAction, existing.ownerId ?? null))
        ) {
          errors.push({
            row,
            field: '—',
            message: 'Coincide con un registro fuera de su alcance: no puede actualizarlo.',
          });
          continue;
        }
      }
      try {
        await def.check(parsed.data, existing);
      } catch (e) {
        for (const [field, message] of Object.entries(ImportExportRegistry.toFieldErrors(e))) {
          errors.push({ row, field: field === '_' ? '—' : (labels.get(field) ?? field), message });
        }
        continue;
      }
      plan.push({ row, data: parsed.data, existing });
    }

    const invalidRows = new Set(errors.map((e) => e.row));
    const summary: ImportSummary = {
      total: sheet.rows.length,
      valid: plan.length,
      invalid: invalidRows.size,
      duplicates,
      toCreate: plan.filter((p) => !p.existing).length,
      toUpdate: plan.filter((p) => p.existing).length,
      toSkip: skipped,
      errors: errors.slice(0, 200),
    };

    if (!commit) {
      await this.db.tx.importJob.update({
        where: { id: job.id },
        data: {
          mapping: input.mapping,
          duplicateMode: input.duplicateMode,
          validRows: summary.valid,
          invalidRows: summary.invalid,
          errors: errors.slice(0, MAX_STORED_ERRORS) as unknown as Prisma.InputJsonValue,
        },
      });
      return summary;
    }

    if (input.atomic && errors.length > 0) {
      // Todo o nada: con errores de validación no se escribe nada y el archivo se puede corregir.
      await this.db.tx.importJob.update({
        where: { id: job.id },
        data: {
          mapping: input.mapping,
          duplicateMode: input.duplicateMode,
          validRows: summary.valid,
          invalidRows: summary.invalid,
          errors: errors.slice(0, MAX_STORED_ERRORS) as unknown as Prisma.InputJsonValue,
        },
      });
      return {
        ...summary,
        aborted: true,
        created: 0,
        updated: 0,
        skipped,
        invalid: summary.invalid,
        possibleDuplicates: 0,
      };
    }

    let created = 0;
    let updated = 0;
    if (input.atomic) await this.db.tx.$executeRaw`SAVEPOINT import_all`;
    const writes = await this.detection.runAs('IMPORT', async () => {
      for (const item of plan) {
        await this.db.tx.$executeRaw`SAVEPOINT import_row`;
        try {
          if (item.existing) {
            await def.update(user, item.existing, item.data);
            updated++;
          } else {
            await def.create(user, item.data);
            created++;
          }
          await this.db.tx.$executeRaw`RELEASE SAVEPOINT import_row`;
        } catch (e) {
          await this.db.tx.$executeRaw`ROLLBACK TO SAVEPOINT import_row`;
          const fieldErrors =
            e instanceof Error && !(e instanceof Prisma.PrismaClientKnownRequestError)
              ? safeFieldErrors(e)
              : { _: 'No se pudo guardar la fila.' };
          for (const [field, message] of Object.entries(fieldErrors)) {
            errors.push({
              row: item.row,
              field: field === '_' ? '—' : (labels.get(field) ?? field),
              message,
            });
          }
          if (input.atomic) break;
        }
      }
    });
    if (input.atomic) {
      if (errors.length > 0) {
        await this.db.tx.$executeRaw`ROLLBACK TO SAVEPOINT import_all`;
        created = 0;
        updated = 0;
      } else {
        await this.db.tx.$executeRaw`RELEASE SAVEPOINT import_all`;
      }
    }
    const invalid = new Set(errors.map((e) => e.row)).size;
    if (input.atomic && errors.length > 0) {
      // No se guardó nada: el trabajo sigue disponible para corregir el archivo y reintentar.
      await this.db.tx.importJob.update({
        where: { id: job.id },
        data: {
          mapping: input.mapping,
          duplicateMode: input.duplicateMode,
          validRows: 0,
          invalidRows: invalid,
          errors: errors.slice(0, MAX_STORED_ERRORS) as unknown as Prisma.InputJsonValue,
        },
      });
      return {
        ...summary,
        aborted: true,
        created: 0,
        updated: 0,
        skipped,
        invalid,
        errors: errors.slice(0, 200),
        possibleDuplicates: 0,
      };
    }
    await this.db.tx.importJob.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        mapping: input.mapping,
        duplicateMode: input.duplicateMode,
        validRows: created + updated,
        invalidRows: invalid,
        createdRows: created,
        updatedRows: updated,
        skippedRows: skipped,
        errors: errors.slice(0, MAX_STORED_ERRORS) as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
    await this.audit.log('IMPORT', {
      userId: user.id,
      details: { entity: job.entityType, file: job.fileName, created, updated, skipped, invalid },
    });
    return {
      ...summary,
      created,
      updated,
      skipped,
      invalid,
      errors: errors.slice(0, 200),
      possibleDuplicates: writes.created,
    };
  }

  /** Reporte de errores: fila, campo, mensaje y los valores originales de la fila. */
  async errorReport(user: AuthUser, jobId: string, format: FileFormat): Promise<FileResult> {
    const job = await this.loadJob(user, jobId, 'read');
    const errors = (Array.isArray(job.errors) ? job.errors : []) as unknown as ImportRowError[];
    const sheet = await parseSpreadsheet(
      await readFile(this.storagePath(job.filePath)),
      job.format as FileFormat,
    );
    const headers = sheet.headers;
    type Line = ImportRowError & { values: Record<string, string> };
    const lines: Line[] = errors.map((e) => ({ ...e, values: sheet.rows[e.row - 2] ?? {} }));
    const columns: ExportColumn<Line>[] = [
      { key: 'row', label: 'Fila', value: (l) => l.row },
      { key: 'field', label: 'Campo', value: (l) => l.field },
      { key: 'message', label: 'Error', value: (l) => l.message },
      ...headers.map((h, i) => ({ key: `c${i}`, label: h, value: (l: Line) => l.values[h] ?? '' })),
    ];
    return {
      buffer: await writeSpreadsheet(format, 'Errores', columns, lines),
      fileName: `errores-${job.entityType}-${stamp()}.${format}`,
      contentType: CONTENT_TYPES[format],
    };
  }

  async jobs(user: AuthUser) {
    const jobs = await this.db.tx.importJob.findMany({
      where: {
        organizationId: user.organizationId,
        ...(this.seesAllJobs(user) ? {} : { createdById: user.id }),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const users = await this.db.q.user.findMany({
      where: {
        organizationId: user.organizationId,
        id: { in: [...new Set(jobs.map((j) => j.createdById))] },
      },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return jobs.map(({ errors: _e, mapping: _m, headers: _h, filePath: _f, ...j }) => ({
      ...j,
      entityLabel: IMPORT_ENTITY_LABELS[j.entityType as ImportEntity] ?? j.entityType,
      createdByName: names.get(j.createdById) ?? null,
    }));
  }

  async export(user: AuthUser, entity: ImportEntity, req: ExportRequest): Promise<FileResult> {
    const def = await this.registry.create(entity);
    this.assertCan(user, def, 'export');
    const all = await def.exportColumns();
    const columns = req.columns?.length ? all.filter((c) => req.columns!.includes(c.key)) : all;
    if (columns.length === 0)
      throw validationError({ columns: 'Seleccione al menos una columna.' });
    const rows = await def.exportRows(user, req.filters, MAX_EXPORT_ROWS + 1);
    if (rows.length > MAX_EXPORT_ROWS) {
      throw badRequest(
        `Hay más de ${MAX_EXPORT_ROWS.toLocaleString('es-PE')} registros. Aplique filtros para exportar menos.`,
      );
    }
    await this.audit.log('EXPORT', {
      userId: user.id,
      details: {
        entity,
        format: req.format,
        rows: rows.length,
        columns: columns.map((c) => c.key),
        filters: req.filters,
      },
    });
    return {
      buffer: await writeSpreadsheet(req.format, def.sheetName, columns, rows, req.delimiter),
      fileName: `${entity}-${stamp()}.${req.format}`,
      contentType: CONTENT_TYPES[req.format],
    };
  }

  /** Columnas disponibles para el selector de exportación. */
  async exportColumns(user: AuthUser, entity: ImportEntity) {
    const def = await this.registry.create(entity);
    this.assertCan(user, def, 'export');
    return (await def.exportColumns()).map((c) => ({ key: c.key, label: c.label }));
  }
}

function safeFieldErrors(e: Error): Record<string, string> {
  try {
    return ImportExportRegistry.toFieldErrors(e);
  } catch {
    return { _: 'No se pudo guardar la fila.' };
  }
}

export type { DuplicateMode };
