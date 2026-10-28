/**
 * Alta inicial de una organización y su primer administrador (producción y nuevos clientes).
 * Usa el rol dueño (DATABASE_URL) y la misma configuración inicial que el seed, sin datos de demo.
 *
 * Uso (en el contenedor):
 *   docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yml run --rm --no-deps \
 *     -e ORG_NAME="Mi Empresa S.A.C." -e ADMIN_NAME="Ana Pérez" -e ADMIN_EMAIL=ana@empresa.com \
 *     migrate pnpm org:create
 *
 * Si no define ADMIN_PASSWORD se genera una aleatoria y se muestra UNA vez al terminar.
 * El administrador debe cambiarla en su primer ingreso (Perfil → Cambiar contraseña).
 */
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { email as emailSchema, password as passwordSchema } from '@crm/shared';
import { bootstrapOrganization } from '../src/modules/bootstrap/bootstrap-organization';

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Defina ${name}.`);
  return v;
}

function generatePassword(): string {
  // 18 caracteres alfanuméricos; garantiza letras y números.
  return `${randomBytes(12).toString('base64url').replace(/[-_]/g, 'x')}7a`;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Defina DATABASE_URL.');
  const name = required('ORG_NAME');
  const adminName = required('ADMIN_NAME');
  const adminEmail = emailSchema.parse(required('ADMIN_EMAIL'));
  const given = process.env.ADMIN_PASSWORD;
  const generated = !given;
  const adminPassword = passwordSchema.parse(given ?? generatePassword());

  const db = new PrismaClient();
  try {
    if (await db.user.findFirst({ where: { email: adminEmail }, select: { id: true } })) {
      throw new Error(`Ya existe un usuario con el correo ${adminEmail}.`);
    }
    if (await db.organization.findFirst({ where: { name }, select: { id: true } })) {
      throw new Error(`Ya existe una organización llamada «${name}».`);
    }
    const { organizationId } = await bootstrapOrganization(db, {
      name,
      admin: { name: adminName, email: adminEmail, password: adminPassword },
    });
    console.log(`Organización «${name}» creada (${organizationId}).`);
    console.log(`Administrador: ${adminEmail}`);
    if (generated) {
      console.log(`Contraseña inicial (anótela ahora, no se vuelve a mostrar): ${adminPassword}`);
    }
    console.log('Pídale que la cambie en su primer ingreso.');
  } finally {
    await db.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
