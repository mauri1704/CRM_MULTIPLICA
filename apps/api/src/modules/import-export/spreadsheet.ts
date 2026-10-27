import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import ExcelJS from 'exceljs';
import { MAX_IMPORT_ROWS, type FileFormat } from '@crm/shared';
import { badRequest } from '../../common/errors';

export interface ParsedSheet {
  headers: string[];
  /** Una fila por registro: encabezado → texto. Las filas vacías se descartan. */
  rows: Record<string, string>[];
}

export interface ExportColumn<T> {
  key: string;
  label: string;
  /** Texto, número o fecha: el XLSX conserva el tipo; el CSV escribe texto. */
  value: (row: T) => string | number | Date | null | undefined;
  /** Formato numérico de Excel (ej.: '#,##0.00'). */
  numFmt?: string;
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v && typeof v.text === 'string') return v.text;
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('hyperlink' in v && typeof v.hyperlink === 'string') return v.hyperlink;
    return '';
  }
  return String(v);
}

export async function parseSpreadsheet(buffer: Buffer, format: FileFormat): Promise<ParsedSheet> {
  let matrix: string[][];
  if (format === 'csv') {
    const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
    const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
    const delimiter =
      (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
    try {
      matrix = parse(text, {
        delimiter,
        relax_column_count: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch {
      throw badRequest(
        'No se pudo leer el CSV. Verifique que esté en UTF-8 y separado por comas o punto y coma.',
      );
    }
  } else {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw badRequest('No se pudo leer el archivo Excel. Use formato .xlsx.');
    }
    const ws = wb.worksheets[0];
    if (!ws) throw badRequest('El archivo no tiene hojas.');
    matrix = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) values.push(cellText(row.getCell(c).value).trim());
      matrix.push(values);
    });
  }
  const [head, ...body] = matrix;
  if (!head || head.every((h) => !h))
    throw badRequest('El archivo no tiene encabezados en la primera fila.');
  const headers = head.map((h, i) => h || `Columna ${i + 1}`);
  if (new Set(headers).size !== headers.length)
    throw badRequest('Hay columnas con el mismo encabezado.');
  const rows = body
    .filter((r) => r.some((v) => v !== ''))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
  if (rows.length === 0) throw badRequest('El archivo no tiene filas de datos.');
  if (rows.length > MAX_IMPORT_ROWS) {
    throw badRequest(
      `El archivo tiene ${rows.length} filas; el máximo por importación es ${MAX_IMPORT_ROWS}. Divídalo.`,
    );
  }
  return { headers, rows };
}

export async function writeSpreadsheet<T>(
  format: FileFormat,
  sheetName: string,
  columns: ExportColumn<T>[],
  rows: T[],
  csvDelimiter: ',' | ';' = ',',
): Promise<Buffer> {
  if (format === 'csv') {
    const data = rows.map((r) =>
      columns.map((c) => {
        const v = c.value(r);
        if (v === null || v === undefined) return '';
        if (v instanceof Date) return v.toISOString();
        return String(v);
      }),
    );
    // BOM para que Excel abra el UTF-8 con tildes correctamente.
    return Buffer.from(
      `\uFEFF${stringify([columns.map((c) => c.label), ...data], { delimiter: csvDelimiter })}`,
      'utf8',
    );
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CRM Multiplica';
  const ws = wb.addWorksheet(sheetName.slice(0, 31));
  ws.columns = columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: Math.max(12, Math.min(40, c.label.length + 4)),
  }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of rows)
    ws.addRow(Object.fromEntries(columns.map((c) => [c.key, c.value(r) ?? null])));
  columns.forEach((c, i) => {
    if (c.numFmt) ws.getColumn(i + 1).numFmt = c.numFmt;
  });
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
