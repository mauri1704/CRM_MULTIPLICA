import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, createOrg, login, ownerDb, type Agent, type TestOrg } from './helpers';

let app: INestApplication;
let db: PrismaClient;
let org: TestOrg;
let admin: Agent;
let docTypes: Record<string, string>;

beforeAll(async () => {
  db = ownerDb();
  app = await createApp();
  org = await createOrg(db, 'CRM');
  admin = await login(app, org.adminEmail);
  const types = (await admin.get('/catalogs/document-types')).body as {
    id: string;
    code: string;
  }[];
  docTypes = Object.fromEntries(types.map((t) => [t.code, t.id]));
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

describe('compañías', () => {
  it('crea con código correlativo, asume RUC y valida su dígito verificador', async () => {
    const ok = await admin.post('/companies', {
      legalName: 'Andes SAC',
      taxId: '20131312955',
      website: 'andes.pe',
    });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({
      code: 'CIA-000001',
      taxIdType: { code: 'RUC' },
      website: 'https://andes.pe',
      country: 'PE',
    });
    const bad = await admin.post('/companies', { legalName: 'Mala SAC', taxId: '20131312956' });
    expect(bad.status).toBe(400);
    expect(bad.body.details.taxId).toMatch(/RUC no válido/);
    const dup = await admin.post('/companies', { legalName: 'Copia SAC', taxId: '2013-1312-955' });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toMatch(/Andes SAC/);
  });

  it('enviarla a la papelera conserva sus contactos y bloquea restaurarlos hasta restaurarla', async () => {
    const company = (await admin.post('/companies', { legalName: 'Temporal SAC' })).body;
    const contact = (await admin.post('/contacts', { firstName: 'Tomás', companyId: company.id }))
      .body;
    const del = await admin.delete(`/companies/${company.id}`);
    expect(del.body).toEqual({ contacts: 1 });
    expect((await admin.get(`/contacts/${contact.id}`)).body.company).toBeNull();

    await admin.delete(`/contacts/${contact.id}`);
    const trash = (await admin.get('/trash?pageSize=100')).body.items as {
      id: string;
      entityId: string;
    }[];
    const contactEntry = trash.find((t) => t.entityId === contact.id)!;
    const companyEntry = trash.find((t) => t.entityId === company.id)!;
    const blocked = await admin.post('/trash/restore', { ids: [contactEntry.id] });
    expect(blocked.body.conflicts[0].reasons[0]).toMatch(/Temporal SAC.*papelera/);
    // La compañía no se puede eliminar definitivamente mientras un contacto la tenga como principal.
    expect((await admin.get(`/trash/${companyEntry.id}`)).body.purgeBlockers[0]).toMatch(
      /1 contacto/,
    );

    const both = await admin.post('/trash/restore', { ids: [companyEntry.id, contactEntry.id] });
    expect(both.body.restored).toHaveLength(2);
    expect((await admin.get(`/contacts/${contact.id}`)).body.company.legalName).toBe(
      'Temporal SAC',
    );
  });

  it('la ficha muestra contactos principales y relacionados', async () => {
    const c1 = (await admin.post('/companies', { legalName: 'Principal SAC' })).body;
    const c2 = (await admin.post('/companies', { legalName: 'Relacionada SAC' })).body;
    await admin.post('/contacts', {
      firstName: 'Rita',
      companyId: c1.id,
      relatedCompanyIds: [c2.id],
    });
    expect(
      (await admin.get(`/companies/${c1.id}`)).body.contacts.map(
        (c: { firstName: string }) => c.firstName,
      ),
    ).toEqual(['Rita']);
    expect(
      (await admin.get(`/companies/${c2.id}`)).body.relatedContacts.map(
        (c: { firstName: string }) => c.firstName,
      ),
    ).toEqual(['Rita']);
    const filtered = await admin.get(`/contacts?companyId=${c2.id}`);
    expect(filtered.body.total).toBe(1);
  });
});

describe('contactos', () => {
  it('valida el documento según su tipo y normaliza correo y búsqueda', async () => {
    const bad = await admin.post('/contacts', {
      firstName: 'Ana',
      documentTypeId: docTypes.DNI,
      documentNumber: '123',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.details.documentNumber).toMatch(/formato de DNI/);
    const noType = await admin.post('/contacts', { firstName: 'Ana', documentNumber: '12345678' });
    expect(noType.body.details.documentTypeId).toBe('Indique el tipo de documento.');
    const ok = await admin.post('/contacts', {
      firstName: 'Ána',
      lastName: 'Núñez',
      documentTypeId: docTypes.DNI,
      documentNumber: '12345678',
      email: ' ANA@Empresa.PE ',
      phone: '987 654 321',
    });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ email: 'ana@empresa.pe', fullName: 'Ána Núñez' });
    expect(ok.body.code).toMatch(/^CON-\d{6}$/);
    const found = await admin.get('/search?q=ana nunez');
    expect(found.body.contacts.map((c: { id: string }) => c.id)).toContain(ok.body.id);
    expect(
      (await admin.get('/search?q=987654321')).body.contacts.map((c: { id: string }) => c.id),
    ).toContain(ok.body.id);
  });

  it('guarda campos personalizados validados', async () => {
    await admin.post('/custom-fields', {
      entityType: 'CONTACT',
      key: 'hobby',
      label: 'Hobby',
      type: 'TEXT',
      required: true,
    });
    const missing = await admin.post('/contacts', { firstName: 'Sin hobby' });
    expect(missing.status).toBe(400);
    expect(missing.body.details['customFields.hobby']).toBe('Hobby es obligatorio.');
    const ok = await admin.post('/contacts', {
      firstName: 'Con hobby',
      customFields: { hobby: 'Ajedrez', otro: 'x' },
    });
    expect(ok.body.customFields).toEqual({ hobby: 'Ajedrez' });
    await admin.patch(
      `/custom-fields/${(await admin.get('/custom-fields?entityType=CONTACT')).body[0].id}`,
      { active: false },
    );
  });

  it('detecta ediciones concurrentes (control de versión)', async () => {
    const c = (await admin.post('/contacts', { firstName: 'Versión' })).body;
    expect(
      (await admin.patch(`/contacts/${c.id}`, { jobTitle: 'Uno', version: c.version })).status,
    ).toBe(200);
    const stale = await admin.patch(`/contacts/${c.id}`, { jobTitle: 'Dos', version: c.version });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_VERSION');
    const history = (await admin.get(`/history/CONTACT/${c.id}`)).body;
    expect(history[0].changes).toEqual({ jobTitle: { from: null, to: 'Uno' } });
  });

  it('aplica el alcance: un Comercial ve todos los contactos pero solo edita y borra los suyos', async () => {
    const salesUser = await org.addUser('SALES');
    const sales = await login(app, salesUser.email);
    const others = (await admin.post('/contacts', { firstName: 'De otro' })).body;
    expect((await sales.get(`/contacts/${others.id}`)).status).toBe(200);
    expect((await sales.patch(`/contacts/${others.id}`, { jobTitle: 'X' })).status).toBe(403);
    expect((await sales.delete(`/contacts/${others.id}`)).status).toBe(403);
    expect(
      (await sales.post('/contacts', { firstName: 'Asignado', ownerId: org.adminUserId })).status,
    ).toBe(403);
    const mine = await sales.post('/contacts', { firstName: 'Mío' });
    expect(mine.body.owner.id).toBe(salesUser.id);
    expect((await sales.patch(`/contacts/${mine.body.id}`, { jobTitle: 'Comprador' })).status).toBe(
      200,
    );
    expect((await sales.delete(`/contacts/${mine.body.id}`)).status).toBe(200);
  });
});

describe('productos', () => {
  it('SKU único normalizado, moneda activa y precio exacto', async () => {
    const p = await admin.post('/products', {
      sku: 'LIC-01',
      name: 'Licencia',
      price: '1234.5678',
      currencyCode: 'usd',
    });
    expect(p.status).toBe(201);
    expect(p.body).toMatchObject({
      price: '1234.5678',
      currencyCode: 'USD',
      maxDiscountPct: '0.00',
    });
    expect(
      (
        await admin.post('/products', {
          sku: 'lic_01',
          name: 'Copia',
          price: '1',
          currencyCode: 'USD',
        })
      ).status,
    ).toBe(409);
    const badPrice = await admin.post('/products', {
      sku: 'X1',
      name: 'Malo',
      price: '1.23456',
      currencyCode: 'USD',
    });
    expect(badPrice.body.details.price).toMatch(/4 decimales/);
    expect(
      (
        await admin.post('/products', {
          sku: 'X2',
          name: 'Sin moneda',
          price: '1',
          currencyCode: 'EUR',
        })
      ).body.details.currencyCode,
    ).toMatch(/no está registrada/);
  });

  it('desactivar, enviar a papelera y conflicto de SKU al restaurar', async () => {
    const p = (
      await admin.post('/products', {
        sku: 'REST-1',
        name: 'Restaurable',
        price: '5',
        currencyCode: 'PEN',
      })
    ).body;
    expect((await admin.patch(`/products/${p.id}`, { active: false })).body.active).toBe(false);
    expect((await admin.get('/products?q=restaurable')).body.total).toBe(0);
    expect((await admin.get('/products?q=restaurable&active=all')).body.total).toBe(1);
    await admin.delete(`/products/${p.id}`);
    await admin.post('/products', {
      sku: 'rest-1',
      name: 'Nuevo con el mismo SKU',
      price: '5',
      currencyCode: 'PEN',
    });
    const entry = (await admin.get('/trash')).body.items.find(
      (t: { entityId: string }) => t.entityId === p.id,
    );
    const res = await admin.post('/trash/restore', { ids: [entry.id] });
    expect(res.body.conflicts[0].reasons[0]).toMatch(/SKU REST-1/);
  });

  it('un Comercial ve el catálogo pero no lo modifica', async () => {
    const sales = await login(app, (await org.addUser('SALES')).email);
    expect((await sales.get('/products')).status).toBe(200);
    expect(
      (await sales.post('/products', { sku: 'S1', name: 'S', price: '1', currencyCode: 'PEN' }))
        .status,
    ).toBe(403);
  });
});

describe('monedas', () => {
  it('registra monedas, protege la principal y cambia la principal de la organización', async () => {
    const eur = await admin.post('/currencies', {
      code: 'eur',
      name: 'Euro',
      symbol: '€',
      decimals: 2,
    });
    expect(eur.status).toBe(201);
    expect(
      (await admin.post('/currencies', { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2 }))
        .status,
    ).toBe(409);
    const list = (await admin.get('/currencies')).body as {
      id: string;
      code: string;
      isBase: boolean;
    }[];
    const pen = list.find((c) => c.code === 'PEN')!;
    expect(pen.isBase).toBe(true);
    expect((await admin.patch(`/currencies/${pen.id}`, { active: false })).status).toBe(409);
    expect((await admin.post(`/currencies/${eur.body.id}/base`)).status).toBe(200);
    expect((await admin.get('/organization')).body.baseCurrencyCode).toBe('EUR');
    await admin.post(`/currencies/${pen.id}/base`);
    expect((await admin.get('/organization')).body.baseCurrencyCode).toBe('PEN');
  });

  it('un Supervisor no administra monedas ni tipos de cambio', async () => {
    const sup = await login(app, (await org.addUser('SUPERVISOR')).email);
    expect(
      (await sup.post('/currencies', { code: 'GBP', name: 'Libra', symbol: '£', decimals: 2 }))
        .status,
    ).toBe(403);
    expect(
      (
        await sup.post('/exchange-rates', {
          date: '2026-01-02',
          fromCurrency: 'USD',
          toCurrency: 'PEN',
          rate: '3.7',
        })
      ).status,
    ).toBe(403);
    expect((await sup.get('/exchange-rates')).status).toBe(200);
  });
});

describe('tipos de cambio', () => {
  const r = (date: string, rate: string, from = 'USD', to = 'PEN') =>
    admin.post('/exchange-rates', { date, fromCurrency: from, toCurrency: to, rate });

  it('valida tasas positivas y una sola tasa activa por fecha y par', async () => {
    expect((await r('2026-03-02', '3.7123')).status).toBe(201);
    const dup = await r('2026-03-02', '3.8');
    expect(dup.status).toBe(409);
    expect(dup.body.message).toMatch(/Ya existe una tasa activa USD→PEN para el 2026-03-02/);
    expect((await r('2026-03-02', '0')).status).toBe(400);
    expect((await r('2026-03-02', '3.7', 'USD', 'USD')).body.details.toCurrency).toBe(
      'Las monedas deben ser distintas.',
    );
  });

  it('editar exige motivo, deja historial y auditoría', async () => {
    const created = (await r('2026-03-03', '3.70')).body;
    expect((await admin.patch(`/exchange-rates/${created.id}`, { rate: '3.71' })).status).toBe(400);
    const res = await admin.patch(`/exchange-rates/${created.id}`, {
      rate: '3.71',
      reason: 'Corrección SBS',
    });
    expect(res.body.rate).toBe('3.71');
    const hist = (await admin.get(`/exchange-rates/${created.id}/history`)).body;
    expect(hist[0]).toMatchObject({ oldRate: '3.7', newRate: '3.71', reason: 'Corrección SBS' });
    expect((await admin.get('/audit?event=EXCHANGE_RATE_CHANGED')).body.total).toBeGreaterThan(0);
  });

  it('aplica la regla de selección: del día, la anterior dentro del plazo, inversa y nunca inventa', async () => {
    await r('2026-04-06', '3.6500'); // lunes
    const exact = (
      await admin.get('/exchange-rates/resolve?from=USD&to=PEN&date=2026-04-06&amount=100')
    ).body;
    expect(exact).toMatchObject({
      found: true,
      rateDate: '2026-04-06',
      inverse: false,
      ageDays: 0,
      converted: '365.00',
    });
    const weekend = (await admin.get('/exchange-rates/resolve?from=USD&to=PEN&date=2026-04-08'))
      .body;
    expect(weekend).toMatchObject({ found: true, rateDate: '2026-04-06', ageDays: 2 });
    const tooOld = (await admin.get('/exchange-rates/resolve?from=USD&to=PEN&date=2026-04-20'))
      .body;
    expect(tooOld.found).toBe(false);
    expect(tooOld.message).toMatch(/Registre la tasa/);
    const inverse = (
      await admin.get('/exchange-rates/resolve?from=PEN&to=USD&date=2026-04-06&amount=365')
    ).body;
    expect(inverse).toMatchObject({
      found: true,
      inverse: true,
      rate: '0.2739726027',
      converted: '100.00',
    });

    await admin.patch('/organization', { settings: { exchangeRateAllowInverse: false } });
    expect(
      (await admin.get('/exchange-rates/resolve?from=PEN&to=USD&date=2026-04-06')).body.found,
    ).toBe(false);
    await admin.patch('/organization', { settings: { exchangeRateAllowInverse: true } });
  });

  it('una tasa desactivada no se usa y se puede registrar otra para la misma fecha', async () => {
    const t = (await r('2026-05-04', '3.50')).body;
    await admin.patch(`/exchange-rates/${t.id}`, { active: false, reason: 'Tasa errónea' });
    expect(
      (await admin.get('/exchange-rates/resolve?from=USD&to=PEN&date=2026-05-04')).body.found,
    ).toBe(false);
    expect((await r('2026-05-04', '3.55')).status).toBe(201);
    expect(
      (await admin.patch(`/exchange-rates/${t.id}`, { active: true, reason: 'Reactivar' })).status,
    ).toBe(409);
    const list = (await admin.get('/exchange-rates?from=2026-05-01&to=2026-05-31')).body;
    expect(
      list.items.map((i: { rate: string; status: string }) => `${i.rate}:${i.status}`).sort(),
    ).toEqual(['3.55:ACTIVE', '3.5:INACTIVE']);
  });
});
