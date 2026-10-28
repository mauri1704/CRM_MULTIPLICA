import { expect, test, type Page } from '@playwright/test';

const USERS = {
  admin: { email: 'admin@multiplica.test', password: 'Admin12345' },
  sales: { email: 'comercial@multiplica.test', password: 'Venta12345' },
};
const menu = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Menú principal' }).getByRole('link', { name, exact: true });
const toast = (page: Page, text: string | RegExp) => page.getByText(text).first();
const uid = () => Date.now().toString().slice(-6);

async function login(page: Page, who: keyof typeof USERS = 'admin') {
  await page.goto('/login');
  await page.getByLabel('Correo').fill(USERS[who].email);
  await page.getByLabel('Contraseña').fill(USERS[who].password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Hola/ })).toBeVisible();
}

test('tarea con participante y observador, asociada a una negociación, se completa en el tablero', async ({
  page,
}) => {
  const title = `E2E Tarea ${uid()}`;
  await login(page);
  await menu(page, 'Tareas').click();
  await page.getByRole('tab', { name: 'Mis tareas' }).click();
  await page.getByRole('button', { name: 'Tablero' }).click();
  await page.getByRole('button', { name: 'Nueva tarea' }).click();
  const drawer = page.getByRole('dialog', { name: 'Nueva tarea' });
  await drawer.getByLabel('Título').fill(title);
  await drawer.getByLabel('Agregar a participantes').selectOption({ label: 'Carlos Comercial' });
  await drawer.getByLabel('Agregar a observadores').selectOption({ label: 'Sofía Supervisora' });
  await drawer.getByLabel('Vencimiento').fill('2026-11-20T10:30');
  await drawer.getByLabel('Tipo').selectOption({ label: 'Negociación' });
  await drawer.getByRole('button', { name: 'Negociación' }).click();
  await page.getByRole('combobox', { name: 'Buscar' }).fill('Pacífico');
  await page
    .getByRole('listbox')
    .getByRole('option', { name: /Implementación CRM Pacífico/ })
    .first()
    .click();
  await drawer.getByRole('button', { name: 'Crear tarea' }).click();
  await expect(toast(page, 'Tarea creada.')).toBeVisible();

  const card = page.getByRole('button', { name: new RegExp(title) });
  await expect(card).toContainText('Negociación: Implementación CRM Pacífico');
  await expect(card).toContainText('20/11/26');

  // Arrastrar a «Completada».
  const target = page.getByRole('listitem', { name: /^Completada/ });
  const from = await card.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('Sin posiciones');
  await page.mouse.move(from.x + from.width / 2, from.y + 20);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + 30, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 20 });
  await page.mouse.up();
  await expect(target.getByRole('button', { name: new RegExp(title) })).toBeVisible();

  // Aparece en la ficha de la negociación.
  await menu(page, 'Negociaciones').click();
  await page
    .getByRole('button', { name: /Implementación CRM Pacífico/ })
    .first()
    .click();
  const deal = page.getByRole('dialog', { name: 'Implementación CRM Pacífico' });
  await deal.getByRole('tab', { name: 'Tareas' }).click();
  await deal.getByLabel('Solo abiertas').uncheck();
  await expect(deal.getByRole('button', { name: new RegExp(title) })).toContainText('Completada');
});

test('el participante cambia el estado pero no edita; el calendario muestra sus tareas', async ({
  page,
}) => {
  await login(page, 'sales');
  await menu(page, 'Tareas').click();
  await page.getByRole('tab', { name: 'Participo' }).click();
  await page.getByRole('button', { name: 'Lista' }).click();
  await page.getByRole('row', { name: /Enviar propuesta técnica/ }).click();
  const drawer = page.getByRole('dialog', { name: 'Enviar propuesta técnica' });
  await expect(drawer.getByText(/Usted es participante/)).toBeVisible();
  await expect(drawer.getByLabel('Título')).toBeDisabled();
  await expect(drawer.getByRole('button', { name: 'Guardar cambios' })).toHaveCount(0);
  await drawer.getByLabel('Estado').first().selectOption({ label: 'En revisión' });
  await expect(toast(page, 'Estado actualizado.')).toBeVisible();
  await drawer.getByRole('button', { name: 'Cerrar' }).click();
  await expect(page.getByRole('row', { name: /Enviar propuesta técnica/ })).toContainText(
    'En revisión',
  );

  await page.getByRole('tab', { name: 'Mis tareas' }).click();
  await page.getByRole('button', { name: 'Calendario' }).click();
  await expect(page.getByRole('button', { name: 'Mes', exact: true })).toBeVisible();
  await expect(page.locator('.fc-event').first()).toBeVisible();
  await page.getByRole('button', { name: 'Lista' }).click();
});

test('proyecto con tareas y actividad registrada en un contacto', async ({ page }) => {
  const n = uid();
  await login(page);
  await menu(page, 'Proyectos').click();
  await page.getByRole('button', { name: 'Nuevo proyecto' }).click();
  const drawer = page.getByRole('dialog', { name: 'Nuevo proyecto' });
  await drawer.getByLabel('Nombre').fill(`E2E Proyecto ${n}`);
  await drawer.getByLabel('Inicio').fill('2026-12-10');
  await drawer.getByLabel('Fin').fill('2026-12-01');
  await drawer.getByRole('button', { name: 'Crear proyecto' }).click();
  await expect(
    drawer.getByText('La fecha de fin no puede ser anterior a la de inicio.'),
  ).toBeVisible();
  await drawer.getByLabel('Fin').fill('2026-12-31');
  await drawer.getByRole('button', { name: 'Crear proyecto' }).click();
  await expect(toast(page, 'Proyecto creado.')).toBeVisible();

  await page.getByRole('row', { name: new RegExp(`E2E Proyecto ${n}`) }).click();
  const project = page.getByRole('dialog', { name: `E2E Proyecto ${n}` });
  await project.getByRole('button', { name: 'Nueva tarea' }).click();
  const task = page.getByRole('dialog', { name: 'Nueva tarea' });
  await task.getByLabel('Título').fill(`Tarea del proyecto ${n}`);
  await task.getByRole('button', { name: 'Crear tarea' }).click();
  await expect(
    project.getByRole('button', { name: new RegExp(`Tarea del proyecto ${n}`) }),
  ).toBeVisible();
  await project.getByRole('button', { name: 'Cerrar' }).click();

  await menu(page, 'Contactos').click();
  await page.getByRole('row').nth(1).click();
  const contact = page.getByRole('dialog').first();
  await contact.getByRole('tab', { name: 'Actividad' }).click();
  await contact.getByLabel('Tipo', { exact: true }).selectOption({ label: 'Reunión' });
  await contact.getByLabel('Asunto').fill(`Reunión E2E ${n}`);
  await contact.getByRole('button', { name: 'Registrar' }).click();
  await expect(toast(page, 'Actividad registrada.')).toBeVisible();
  await expect(contact.getByText(`Reunión E2E ${n}`)).toBeVisible();
});
