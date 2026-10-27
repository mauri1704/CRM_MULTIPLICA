import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, createOrg, login, ownerDb, type Agent, type TestOrg } from './helpers';

let app: INestApplication;
let db: PrismaClient;
let org: TestOrg;
let admin: Agent;

beforeAll(async () => {
  db = ownerDb();
  app = await createApp();
  org = await createOrg(db, 'Import');
  admin = await login(app, org.adminEmail);
  await admin.post('/companies', { legalName: 'Andes SAC', taxId: '20131312955' });
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

const csv = (lines: string[]) => Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8');

async function readXlsx(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0]!;
  const rows: unknown[][] = [];
  ws.eachRow((r) => rows.push((r.values as unknown[]).slice(1)));
  return rows;
}

describe('importación', () => {
  it('descarga una plantilla con los encabezados y una fila de ejemplo', async () => {
    const res = await admin.download('/import-export/contacts/template?format=xlsx');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('plantilla-contacts.xlsx');
    const rows = await readXlsx(res.body as Buffer);
    expect(rows[0]).toEqual(
      expect.arrayContaining(['Nombre', 'Correo', 'Compañía', 'Responsable']),
    );
    expect(rows[1]).toEqual(expect.arrayContaining(['Ana']));
  });

  it('flujo completo: subir, mapear, analizar sin escribir, confirmar y reporte de errores', async () => {
    const file = csv([
      'Nombre;Apellidos;Correo;Compañía;Tipo de documento;Número de documento;Columna extra',
      'Ana;Torres;ana@x.pe;20131312955;DNI;45879632;ignorar',
      'Beto;;correo-malo;;;;',
      'Carla;;carla@x.pe;Empresa inexistente;;;',
      'Ana bis;;ANA@x.pe;;;;',
      ';SinNombre;sin@x.pe;;;;',
      'Dario;;dario@x.pe;andes sac;DNI;123;',
    ]);
    const up = await admin.upload('/import-export/contacts/upload', file, 'contactos.csv');
    expect(up.status).toBe(201);
    expect(up.body.totalRows).toBe(6);
    expect(up.body.mapping).toMatchObject({
      Nombre: 'firstName',
      Correo: 'email',
      Compañía: 'company',
      'Columna extra': '',
    });

    const mapping = up.body.mapping as Record<string, string>;
    const preview = await admin.post(`/import-export/jobs/${up.body.jobId}/analyze`, {
      mapping,
      duplicateMode: 'SKIP',
    });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ total: 6, valid: 1, invalid: 5, toCreate: 1 });
    const messages = (preview.body.errors as { row: number; field: string; message: string }[]).map(
      (e) => `${e.row}|${e.field}|${e.message}`,
    );
    expect(messages).toEqual(
      expect.arrayContaining([
        '3|Correo|Ingrese un correo válido.',
        '4|Compañía|No se encontró la compañía «Empresa inexistente».',
        '5|—|Repite el registro de la fila 2.',
        '6|Nombre|Ingrese el nombre.',
        '7|Número de documento|El número no tiene el formato de DNI.',
      ]),
    );
    // La vista previa no escribe.
    expect((await admin.get('/contacts')).body.total).toBe(0);

    const done = await admin.post(`/import-export/jobs/${up.body.jobId}/confirm`, {
      mapping,
      duplicateMode: 'SKIP',
    });
    expect(done.body).toMatchObject({ created: 1, updated: 0, invalid: 5 });
    const contacts = (await admin.get('/contacts')).body.items;
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      fullName: 'Ana Torres',
      company: { legalName: 'Andes SAC' },
      documentNumber: '45879632',
    });
    expect((await admin.get(`/history/CONTACT/${contacts[0].id}`)).body[0].action).toBe('CREATE');

    const report = await admin.download(`/import-export/jobs/${up.body.jobId}/errors?format=csv`);
    const text = (report.body as Buffer).toString('utf8');
    expect(text.split('\n')[0]).toContain('Fila,Campo,Error,Nombre');
    expect(text).toContain('correo-malo');

    expect(
      (await admin.post(`/import-export/jobs/${up.body.jobId}/confirm`, { mapping })).status,
    ).toBe(409);
    const jobs = (await admin.get('/import-export/jobs')).body;
    expect(jobs[0]).toMatchObject({
      status: 'COMPLETED',
      createdRows: 1,
      invalidRows: 5,
      entityLabel: 'Contactos',
    });
    expect((await admin.get('/audit?event=IMPORT')).body.total).toBe(1);
  });

  it('exige asignar los campos obligatorios', async () => {
    const up = await admin.upload(
      '/import-export/contacts/upload',
      csv(['Correo', 'a@b.pe']),
      'x.csv',
    );
    const res = await admin.post(`/import-export/jobs/${up.body.jobId}/analyze`, {
      mapping: up.body.mapping,
    });
    expect(res.status).toBe(400);
    expect(res.body.details.mapping).toBe('Asigne una columna para: Nombre.');
  });

  it('con "actualizar" modifica el registro existente por su clave (SKU) y respeta el historial', async () => {
    await admin.post('/products', { sku: 'P-1', name: 'Viejo', price: '10', currencyCode: 'PEN' });
    const file = csv([
      'SKU,Nombre,Precio,Moneda,Activo',
      'p-1,Nuevo nombre,"1.234,50",PEN,Sí',
      'P-2,Otro,99.9,USD,No',
    ]);
    const up = await admin.upload('/import-export/products/upload', file, 'productos.csv');
    const skip = await admin.post(`/import-export/jobs/${up.body.jobId}/analyze`, {
      mapping: up.body.mapping,
      duplicateMode: 'SKIP',
    });
    expect(skip.body).toMatchObject({ duplicates: 1, toSkip: 1, toCreate: 1 });
    const done = await admin.post(`/import-export/jobs/${up.body.jobId}/confirm`, {
      mapping: up.body.mapping,
      duplicateMode: 'UPDATE',
    });
    expect(done.body).toMatchObject({ created: 1, updated: 1 });
    const all = (await admin.get('/products?active=all&sort=sku')).body.items;
    expect(
      all.map((p: { sku: string; name: string; price: string; active: boolean }) => [
        p.sku,
        p.name,
        p.price,
        p.active,
      ]),
    ).toEqual([
      ['P-1', 'Nuevo nombre', '1234.5000', true],
      ['P-2', 'Otro', '99.9000', false],
    ]);
  });

  it('importa tipos de cambio con fechas dd/mm/aaaa desde Excel', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Tasas');
    ws.addRows([
      ['Fecha', 'Moneda origen', 'Moneda destino', 'Tipo de cambio'],
      ['02/06/2026', 'USD', 'PEN', 3.701],
      [new Date('2026-06-03T00:00:00Z'), 'USD', 'PEN', '3,705'],
      ['03/06/2026', 'USD', 'XXX', 3.7],
    ]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const up = await admin.upload('/import-export/exchange-rates/upload', buf, 'tasas.xlsx');
    const done = await admin.post(`/import-export/jobs/${up.body.jobId}/confirm`, {
      mapping: up.body.mapping,
    });
    expect(done.body).toMatchObject({ created: 2, invalid: 1 });
    expect(done.body.errors[0].message).toMatch(/XXX no está registrada/);
    const list = (await admin.get('/exchange-rates?from=2026-06-01&to=2026-06-30')).body.items;
    expect(
      list.map(
        (r: { rateDate: string; rate: string; source: string }) =>
          `${r.rateDate}=${r.rate}:${r.source}`,
      ),
    ).toEqual(['2026-06-03=3.705:IMPORT', '2026-06-02=3.701:IMPORT']);
  });

  it('rechaza archivos de otro formato y a usuarios sin permiso de importar', async () => {
    expect(
      (await admin.upload('/import-export/contacts/upload', Buffer.from('x'), 'datos.pdf')).status,
    ).toBe(400);
    const sales = await login(app, (await org.addUser('SALES')).email);
    expect(
      (await sales.upload('/import-export/contacts/upload', csv(['Nombre', 'X']), 'x.csv')).status,
    ).toBe(403);
    expect((await sales.get('/import-export/contacts/template')).status).toBe(403);
  });
});

describe('exportación', () => {
  it('exporta en Excel con columnas elegidas y tipos correctos', async () => {
    const res = await admin.download(
      '/import-export/products/export?format=xlsx&columns=sku,price,currencyCode&active=all',
    );
    expect(res.status).toBe(200);
    const rows = await readXlsx(res.body as Buffer);
    expect(rows[0]).toEqual(['SKU', 'Precio', 'Moneda']);
    expect(rows).toContainEqual(['P-1', 1234.5, 'PEN']);
    expect((await admin.get('/audit?event=EXPORT')).body.total).toBeGreaterThan(0);
  });

  it('exporta en CSV con BOM, separador elegido, filtros y campos personalizados', async () => {
    await admin.post('/custom-fields', {
      entityType: 'COMPANY',
      key: 'tamano',
      label: 'Tamaño',
      type: 'SELECT',
      options: [{ value: 'grande', label: 'Grande' }],
    });
    await admin.post('/companies', {
      legalName: 'Filtrada SAC',
      city: 'Cusco',
      customFields: { tamano: 'grande' },
    });
    const res = await admin.download(
      '/import-export/companies/export?format=csv&delimiter=;&city=Cusco',
    );
    const text = (res.body as Buffer).toString('utf8');
    expect(text.startsWith('\uFEFF')).toBe(true);
    const [header, row, extra] =
      text.replace('\uFEFF', '').trim().split('\r\n').length > 1
        ? text.replace('\uFEFF', '').trim().split('\r\n')
        : text.replace('\uFEFF', '').trim().split('\n');
    expect(header).toContain('Razón social;');
    expect(header).toContain('Tamaño');
    expect(row).toContain('Filtrada SAC');
    expect(row).toContain('grande');
    expect(extra).toBeUndefined();
  });

  it('respeta el alcance: un Comercial exporta solo sus contactos', async () => {
    const salesUser = await org.addUser('SALES');
    const sales = await login(app, salesUser.email);
    await sales.post('/contacts', { firstName: 'Propio' });
    const res = await sales.download('/import-export/contacts/export?format=csv');
    const text = (res.body as Buffer).toString('utf8');
    expect(text).toContain('Propio');
    expect(text).not.toContain('Ana');
  });
});
