import { expect, test, type Page } from '@playwright/test';

const ADMIN = { email: 'admin@multiplica.test', password: 'Admin12345' };
const SALES = { email: 'comercial@multiplica.test', password: 'Venta12345' };

/** Enlace del menú lateral (la página de inicio repite algunos como accesos directos). */
const menu = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Menú principal' }).getByRole('link', { name, exact: true });

/** Radix Toast duplica el texto para lectores de pantalla: se toma la primera aparición. */
const toast = (page: Page, text: string | RegExp) => page.getByText(text).first();

async function login(page: Page, user: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Correo').fill(user.email);
  await page.getByLabel('Contraseña').fill(user.password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Hola/ })).toBeVisible();
}

test('muestra un error comprensible con credenciales inválidas', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Correo').fill('admin@multiplica.test');
  await page.getByLabel('Contraseña').fill('incorrecta1');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('alert')).toContainText('Correo o contraseña incorrectos.');
});

test('una ruta privada sin sesión lleva al login y luego vuelve a la ruta pedida', async ({
  page,
}) => {
  await page.goto('/admin/equipos');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Correo').fill(ADMIN.email);
  await page.getByLabel('Contraseña').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Equipos' })).toBeVisible();
});

test('crear un equipo, enviarlo a la papelera y restaurarlo', async ({ page }) => {
  const name = `E2E ${Date.now()}`;
  await login(page, ADMIN);
  await menu(page, 'Equipos').click();
  await page.getByRole('button', { name: 'Nuevo equipo' }).click();
  await page.getByRole('dialog').getByLabel('Nombre').fill(name);
  await page.getByLabel('Supervisor', { exact: true }).selectOption({ label: 'Sofía Supervisora' });
  await page.getByRole('checkbox', { name: /Carlos Comercial/ }).check();
  await page.getByRole('button', { name: 'Crear equipo' }).click();
  await expect(toast(page, 'Equipo creado.')).toBeVisible();

  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row).toContainText('Sofía Supervisora');
  await row.click();
  await page.getByRole('button', { name: 'Enviar a papelera' }).click();
  await page
    .getByRole('dialog', { name: 'Enviar equipo a la papelera' })
    .getByRole('button', { name: 'Enviar a papelera' })
    .click();
  await expect(page.getByRole('row', { name: new RegExp(name) })).toHaveCount(0);

  await menu(page, 'Papelera').click();
  await page.getByRole('row', { name: new RegExp(name) }).click();
  await page.getByRole('button', { name: 'Restaurar' }).click();
  await expect(toast(page, '1 registro(s) restaurado(s).')).toBeVisible();

  await menu(page, 'Equipos').click();
  await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible();
});

test('un Comercial no ve la administración ni puede entrar por URL', async ({ page }) => {
  await login(page, SALES);
  await expect(menu(page, 'Usuarios')).toHaveCount(0);
  await page.goto('/admin/usuarios');
  await expect(page.getByText('No tiene acceso a esta sección')).toBeVisible();
});

test('la matriz de permisos se puede editar y guardar', async ({ page }) => {
  await login(page, ADMIN);
  await menu(page, 'Roles y permisos').click();
  await page.getByRole('option', { name: /Supervisor/ }).click();
  const cell = page.getByLabel('Auditoría: Ver');
  const original = await cell.inputValue();
  await cell.selectOption(original === 'ALL' ? 'NONE' : 'ALL');
  await page.getByRole('button', { name: 'Guardar permisos' }).click();
  await expect(toast(page, /Permisos guardados/)).toBeVisible();
  // Se deja como estaba.
  await cell.selectOption(original);
  await page.getByRole('button', { name: 'Guardar permisos' }).click();
  await expect(page.getByRole('button', { name: 'Guardar permisos' })).toBeDisabled();
});

test('el modo oscuro se aplica y se recuerda', async ({ page }) => {
  await login(page, ADMIN);
  await page.getByRole('button', { name: 'Menú de perfil' }).click();
  await page.getByRole('menuitemradio', { name: 'Oscuro' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('button', { name: 'Menú de perfil' }).click();
  await page.getByRole('menuitemradio', { name: 'Claro' }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});

test('@movil el menú lateral se abre como cajón', async ({ page }) => {
  await login(page, ADMIN);
  await page.getByRole('button', { name: 'Abrir menú' }).click();
  await menu(page, 'Catálogos').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Catálogos' })).toBeVisible();
  await expect(page.getByText('Urgente')).toBeVisible();
});
