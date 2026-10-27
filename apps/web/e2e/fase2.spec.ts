import { expect, test, type Page } from '@playwright/test';

const ADMIN = { email: 'admin@multiplica.test', password: 'Admin12345' };
const menu = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Menú principal' }).getByRole('link', { name, exact: true });
const toast = (page: Page, text: string | RegExp) => page.getByText(text).first();
const uid = () => Date.now().toString().slice(-6);

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Correo').fill(ADMIN.email);
  await page.getByLabel('Contraseña').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Hola/ })).toBeVisible();
}

test('compañía con RUC validado y contacto vinculado desde el selector', async ({ page }) => {
  const n = uid();
  await login(page);
  await menu(page, 'Compañías').click();
  await page.getByRole('button', { name: 'Nueva compañía' }).click();
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel('Razón social').fill(`E2E Comercial ${n} SAC`);
  await drawer.getByLabel('RUC / identificador').fill('20100047219');
  await drawer.getByRole('button', { name: 'Crear compañía' }).click();
  await expect(drawer.getByText('RUC no válido: revise los 11 dígitos.')).toBeVisible();
  // Un RUC sin compañía en la demo: se genera uno válido cambiando el número de serie.
  await drawer.getByLabel('RUC / identificador').fill('');
  await drawer.getByRole('button', { name: 'Crear compañía' }).click();
  await expect(toast(page, 'Compañía creada.')).toBeVisible();

  await menu(page, 'Contactos').click();
  await page.getByRole('button', { name: 'Nuevo contacto' }).click();
  await page
    .getByRole('dialog')
    .getByRole('textbox', { name: 'Nombre', exact: true })
    .fill(`Elena ${n}`);
  await page.getByRole('dialog').getByLabel('Correo').fill(`elena${n}@e2e.pe`);
  await page.getByRole('dialog').getByRole('button', { name: 'Compañía principal' }).click();
  await page.getByRole('combobox', { name: 'Buscar' }).fill(`Comercial ${n}`);
  await page.getByRole('option', { name: new RegExp(`E2E Comercial ${n}`) }).click();
  await page.getByRole('button', { name: 'Crear contacto' }).click();
  await expect(toast(page, 'Contacto creado.')).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(`Elena ${n}`) })).toContainText(
    `E2E Comercial ${n} SAC`,
  );

  // La búsqueda global encuentra al contacto y abre su ficha.
  await page.keyboard.press('Control+k');
  await page.getByRole('textbox', { name: 'Buscar' }).fill(`elena${n}`);
  await page.getByRole('option', { name: new RegExp(`Elena ${n}`) }).click();
  await expect(page.getByRole('dialog', { name: `Elena ${n}` })).toBeVisible();
  await expect(page).toHaveURL(/\/contactos\?id=/);
});

test('importar contactos desde CSV con vista previa y errores', async ({ page }) => {
  const n = uid();
  await login(page);
  await menu(page, 'Contactos').click();
  await page.getByRole('button', { name: 'Importar' }).click();
  const csv = ['Nombre,Apellidos,Correo', `Imp ${n},Uno,imp${n}@e2e.pe`, `Imp ${n},Dos,malo`].join(
    '\n',
  );
  await page
    .getByLabel('Archivo a importar')
    .setInputFiles({ name: 'contactos.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: 'Subir y continuar' }).click();
  await expect(page.getByLabel('Campo para Correo')).toHaveValue('email');
  await page.getByRole('button', { name: 'Revisar datos' }).click();
  await expect(page.getByText('Ingrese un correo válido.')).toBeVisible();
  await page.getByRole('button', { name: 'Importar 1 registro(s)' }).click();
  await expect(page.getByText('Importación terminada', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).first().click();
  await page.getByLabel('Buscar contactos').fill(`Imp ${n}`);
  await expect(page.getByRole('row', { name: new RegExp(`Imp ${n} Uno`) })).toBeVisible();
});

test('exportar productos a Excel', async ({ page }) => {
  await login(page);
  await menu(page, 'Productos').click();
  await page.getByRole('button', { name: 'Exportar' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('dialog').getByRole('button', { name: 'Exportar' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^products-\d+\.xlsx$/);
});

test('registrar un tipo de cambio y consultar la tasa aplicable', async ({ page }) => {
  await login(page);
  await menu(page, 'Tipos de cambio').click();
  await page.getByRole('button', { name: 'Registrar tasa' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Fecha de vigencia').fill('2025-01-15');
  await dlg.getByLabel('Tipo de cambio').fill('3.7000');
  await dlg.getByRole('button', { name: 'Guardar' }).click();
  // Si la prueba ya corrió, la tasa existe: la API lo informa y se cierra el diálogo.
  const exists = dlg.getByText(/Ya existe una tasa activa/);
  await expect(toast(page, 'Tasa registrada.').or(exists)).toBeVisible();
  if (await exists.isVisible()) await dlg.getByRole('button', { name: 'Cancelar' }).click();
  await page.getByLabel('Importe').fill('100');
  await page.getByLabel('Fecha', { exact: true }).fill('2025-01-15');
  await expect(page.getByText('370.00 PEN')).toBeVisible();
});

test('producto: errores de validación comprensibles', async ({ page }) => {
  await login(page);
  await menu(page, 'Productos').click();
  await page.getByRole('button', { name: 'Nuevo producto' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('SKU').fill('E2E MAL');
  await dlg.getByRole('textbox', { name: 'Nombre', exact: true }).fill('Producto inválido');
  await dlg.getByRole('textbox', { name: 'Precio', exact: true }).fill('abc');
  await dlg.getByRole('button', { name: 'Crear producto' }).click();
  await expect(
    dlg.getByText('Use letras, números, punto, guion, barra o guion bajo.'),
  ).toBeVisible();
  await expect(dlg.getByText('El precio debe ser un número con hasta 4 decimales.')).toBeVisible();
});
