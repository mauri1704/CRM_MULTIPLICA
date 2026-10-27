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

async function newLead(page: Page, title: string) {
  await menu(page, 'Prospectos').click();
  await page.getByRole('button', { name: 'Nuevo prospecto' }).click();
  await page.getByRole('dialog').getByLabel('Nombre del prospecto').fill(title);
  await page.getByRole('button', { name: 'Crear prospecto' }).click();
  await expect(toast(page, 'Prospecto creado.')).toBeVisible();
  return page.getByRole('button', { name: new RegExp(title) });
}

test('prospecto con productos se convierte en negociación, se gana y se reabre', async ({
  page,
}) => {
  const title = `E2E Prospecto ${uid()}`;
  await login(page);
  const card = await newLead(page, title);
  await card.click();
  const drawer = page.getByRole('dialog', { name: title });
  await drawer.getByRole('tab', { name: /Productos/ }).click();
  await drawer.getByRole('button', { name: 'Agregar producto' }).click();
  const line = page.getByRole('dialog', { name: 'Agregar producto' });
  await line.getByRole('button', { name: 'Producto' }).click();
  await page.getByRole('combobox', { name: 'Buscar' }).fill('SRV-CAP');
  await page.getByRole('option', { name: /Capacitación por hora/ }).click();
  await line.getByLabel('Cantidad').fill('10');
  await line.getByRole('button', { name: 'Guardar' }).click();
  await expect(drawer.getByRole('cell', { name: /^Capacitación por hora SRV/ })).toBeVisible();
  await expect(drawer.getByRole('definition').last()).toContainText('1,800.00');

  await drawer.getByRole('tab', { name: 'Comentarios' }).click();
  await drawer.getByPlaceholder('Escriba un comentario…').fill('Cliente pide propuesta formal.');
  await drawer.getByRole('button', { name: 'Comentar' }).click();
  await expect(drawer.getByText('Cliente pide propuesta formal.')).toBeVisible();

  await drawer.getByRole('button', { name: 'Convertir en negociación' }).click();
  const convert = page.getByRole('dialog', { name: 'Convertir en negociación' });
  await expect(convert.getByText('Capacitación por hora')).toBeVisible();
  await convert.getByRole('button', { name: 'Convertir', exact: true }).click();
  await expect(page).toHaveURL(/\/negociaciones\?id=/);
  const deal = page.getByRole('dialog', { name: title });
  await expect(deal.getByText(/Prospecto PRO-\d+/)).toBeVisible();
  await deal.getByRole('tab', { name: /Productos \(1\)/ }).click();
  await expect(deal.getByRole('cell', { name: /^Capacitación por hora SRV/ })).toBeVisible();

  await deal.getByRole('button', { name: 'Ganar' }).click();
  const win = page.getByRole('dialog', { name: 'Marcar negociación como ganada' });
  await expect(win.getByLabel(/Valor final/)).toHaveValue('1800');
  await win.getByRole('button', { name: 'Confirmar venta' }).click();
  await expect(toast(page, '¡Negociación ganada!')).toBeVisible();

  await page.getByRole('button', { name: 'Lista' }).click();
  await page.getByRole('row', { name: new RegExp(title) }).click();
  const won = page.getByRole('dialog', { name: title });
  await expect(won.getByText('Ganada').first()).toBeVisible();
  await won.getByRole('button', { name: 'Reabrir' }).click();
  await page
    .getByRole('dialog', { name: 'Reabrir negociación' })
    .getByRole('button', { name: 'Reabrir' })
    .click();
  await expect(toast(page, 'Negociación reabierta.')).toBeVisible();
  await expect(won.getByRole('button', { name: 'Ganar' })).toBeVisible();
  await won.getByRole('button', { name: 'Cerrar' }).click();
  await page.getByRole('button', { name: 'Tablero' }).click();

  // El prospecto queda convertido y en solo lectura, enlazado a la negociación.
  await menu(page, 'Prospectos').click();
  await page.getByRole('button', { name: 'Lista' }).click();
  await page.getByRole('row', { name: new RegExp(title) }).click();
  await expect(page.getByRole('dialog', { name: title }).getByText(/Convertido el/)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Tablero' }).click();
});

test('descartar un prospecto arrastrándolo pide el motivo de pérdida', async ({ page }) => {
  const title = `E2E Descarte ${uid()}`;
  await login(page);
  const card = await newLead(page, title);
  const target = page.getByRole('listitem', { name: /^Descartado/ });
  const from = await card.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('Sin posiciones');
  await page.mouse.move(from.x + from.width / 2, from.y + 20);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + 30, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 20 });
  await page.mouse.up();
  const loss = page.getByRole('dialog', { name: 'Descartar prospecto' });
  await expect(loss).toBeVisible();
  await expect(loss.getByRole('button', { name: 'Confirmar' })).toBeDisabled();
  await loss.getByLabel('Motivo de pérdida').selectOption({ label: 'No responde' });
  await loss.getByRole('button', { name: 'Confirmar' }).click();
  await expect(target.getByRole('button', { name: new RegExp(title) })).toBeVisible();
});
