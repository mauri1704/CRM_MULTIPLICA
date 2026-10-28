import { expect, test, type Page } from '@playwright/test';
import { REPORT_KEYS } from '@crm/shared';

const USERS = {
  admin: { email: 'admin@multiplica.test', password: 'Admin12345' },
  sales: { email: 'comercial@multiplica.test', password: 'Venta12345' },
};
const menu = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Menú principal' }).getByRole('link', { name, exact: true });

async function login(page: Page, who: keyof typeof USERS = 'admin') {
  await page.goto('/login');
  await page.getByLabel('Correo').fill(USERS[who].email);
  await page.getByLabel('Contraseña').fill(USERS[who].password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Hola/ })).toBeVisible();
}

test('el dashboard muestra los indicadores, indica el criterio de conversión y cambia de moneda', async ({
  page,
}) => {
  await login(page);
  await expect(page.getByRole('heading', { name: 'Dashboard comercial' })).toBeVisible();
  for (const label of [
    'Prospectos activos',
    'Prospectos nuevos',
    'Negociaciones abiertas',
    'Negociaciones ganadas',
    'Negociaciones perdidas',
    'Valor del pipeline',
    'Ventas cerradas',
    'Tareas pendientes',
    'Tareas vencidas',
  ]) {
    await expect(page.getByRole('link', { name: new RegExp(label) })).toBeVisible();
  }
  await expect(page.getByText('Actividad comercial reciente')).toBeVisible();
  await expect(page.getByText(/Importes en PEN\./)).toContainText('Tasa de la fecha de corte');
  await page.getByLabel('Moneda').selectOption('USD');
  await expect(page.getByText(/Importes en USD\./)).toBeVisible();
  await expect(page).toHaveURL(/currency=USD/);
  // Un indicador lleva al detalle.
  await page.getByRole('link', { name: /Tareas vencidas/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Tareas vencidas' })).toBeVisible();
});

test('los 13 reportes: índice, filtros, tabla y exportación a Excel', async ({ page }) => {
  await login(page);
  await menu(page, 'Reportes').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Reportes' })).toBeVisible();
  await expect(page.locator('a[href^="/reportes/"]')).toHaveCount(REPORT_KEYS.length);

  await page.getByRole('link', { name: /Valor de pipeline/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Valor de pipeline' })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /Ponderado/ })).toBeVisible();
  await expect(page.getByText(/Importes en PEN/)).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel' }).click();
  expect((await download).suggestedFilename()).toMatch(
    /^reporte-pipeline-value-\d{4}-\d{2}-\d{2}\.xlsx$/,
  );

  // Un rango sin ventas deja el reporte vacío pero sin errores.
  await page.goto('/reportes/won-sales?from=2020-01-01&to=2020-01-31');
  await expect(page.getByText('Sin datos para estos filtros')).toBeVisible();
});

test('un comercial ve su dashboard y los reportes que le corresponden', async ({ page }) => {
  await login(page, 'sales');
  await expect(page.getByRole('heading', { name: 'Dashboard comercial' })).toBeVisible();
  await menu(page, 'Reportes').click();
  await expect(page.getByRole('link', { name: /Ventas ganadas/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Registros duplicados detectados/ })).toHaveCount(0);
  await page.goto('/reportes/duplicates');
  await expect(page.getByText(/No tiene permiso/)).toBeVisible();
});

test('@movil sin desbordes horizontales en las pantallas principales', async ({ page }) => {
  await login(page);
  for (const path of [
    '/',
    '/reportes',
    '/reportes/won-sales',
    '/prospectos',
    '/tareas',
    '/duplicados',
    '/contactos',
  ]) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate<number>(
      'document.documentElement.scrollWidth - window.innerWidth',
    );
    expect(overflow, `desborde horizontal en ${path}`).toBeLessThanOrEqual(1);
  }
});
