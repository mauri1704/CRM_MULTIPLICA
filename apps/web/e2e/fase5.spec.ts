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

async function newContact(page: Page, first: string, email: string) {
  await menu(page, 'Contactos').click();
  await page.getByRole('button', { name: 'Nuevo contacto' }).click();
  const drawer = page.getByRole('dialog', { name: 'Nuevo contacto' });
  await drawer.getByRole('textbox', { name: 'Nombre', exact: true }).fill(first);
  await drawer.getByLabel('Correo').fill(email);
  await drawer.getByRole('button', { name: 'Crear contacto' }).click();
  return drawer;
}

test('avisa de un posible duplicado al crear, y la fusión mueve el registro a la papelera', async ({
  page,
}) => {
  const n = uid();
  const email = `dup${n}@e2e.pe`;
  await login(page);
  await newContact(page, `Marta ${n}`, email);
  await expect(toast(page, 'Contacto creado.')).toBeVisible();

  // El segundo contacto con el mismo correo (en mayúsculas) dispara el aviso.
  await newContact(page, `Marta Duplicada ${n}`, email.toUpperCase());
  const warning = page.getByRole('dialog', { name: 'Posibles duplicados' });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('Mismo correo');
  await expect(warning).toContainText(`Marta ${n}`);
  await warning.getByRole('button', { name: 'Guardar de todas formas' }).click();
  await expect(toast(page, 'Contacto creado.')).toBeVisible();

  // Aparece en Duplicados con su comparación.
  await menu(page, 'Duplicados').click();
  await page.getByRole('tab', { name: /Contactos/ }).click();
  await page.getByRole('button', { name: 'Buscar duplicados' }).click();
  await expect(toast(page, /coincidencia/)).toBeVisible();
  await page.getByRole('row', { name: new RegExp(`Marta Duplicada ${n}`) }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Comparar contactos/ })).toBeVisible();
  await expect(page.getByText('Distinto').first()).toBeVisible();

  // Se conserva el original (el de nombre más corto) y se toma el nombre del duplicado.
  await page.getByRole('radio', { name: 'Conservar este' }).first().check();
  const survivorName = page.getByRole('row', { name: /^Nombre/ });
  await survivorName.getByRole('radio').nth(1).check();
  await page.getByRole('button', { name: 'Fusionar…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Fusionar registros' });
  await expect(confirm).toContainText('irá a la papelera marcado como fusionado');
  await confirm.getByRole('button', { name: 'Fusionar', exact: true }).click();
  await expect(toast(page, /Fusionado:/)).toBeVisible();

  // En la papelera queda marcado como fusionado.
  await menu(page, 'Papelera').click();
  await page.getByPlaceholder(/Buscar/).fill(`Marta`);
  await expect(page.getByText(/Fusionado en/).first()).toBeVisible();
});

test('el administrador crea y elimina una regla; un comercial no ve Duplicados', async ({
  page,
}) => {
  const n = uid();
  await login(page);
  await menu(page, 'Duplicados').click();
  await page.getByRole('link', { name: 'Reglas' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Reglas de duplicados' })).toBeVisible();
  await expect(page.getByText('Mismo documento')).toBeVisible();
  await page.getByRole('button', { name: 'Nueva regla' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nueva regla' });
  await dialog.getByLabel('Nombre').fill(`Regla E2E ${n}`);
  await dialog.getByLabel('Coincidencia de la condición 1').selectOption({ label: 'Normalizada' });
  await dialog.getByRole('button', { name: 'Guardar' }).click();
  await expect(toast(page, 'Regla guardada.')).toBeVisible();
  const item = page.getByRole('listitem').filter({ hasText: `Regla E2E ${n}` });
  await expect(item).toContainText('Avisar al guardar');
  await item.getByRole('button', { name: `Eliminar Regla E2E ${n}` }).click();
  await page
    .getByRole('dialog', { name: 'Eliminar regla' })
    .getByRole('button', { name: 'Eliminar' })
    .click();
  await expect(toast(page, 'Regla eliminada.')).toBeVisible();
});

test('un comercial no ve el menú Duplicados', async ({ page }) => {
  await login(page, 'sales');
  await expect(menu(page, 'Duplicados')).toHaveCount(0);
  await expect(menu(page, 'Tareas')).toBeVisible();
});
