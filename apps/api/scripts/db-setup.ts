/**
 * Crea (o actualiza la contraseña de) el rol `crm_app` con el que corre la aplicación.
 * Se ejecuta con el rol dueño del esquema (DATABASE_URL), una vez por entorno y antes de las
 * migraciones: las migraciones le otorgan permisos a `crm_app` si existe.
 *
 * `crm_app` no es superusuario ni tiene BYPASSRLS: Row-Level Security se le aplica siempre.
 *
 * Uso: pnpm db:setup [--url postgresql://...]   (por defecto DATABASE_URL y TEST_DATABASE_URL)
 */
import { PrismaClient } from '@prisma/client';

async function setup(url: string, password: string) {
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const first = <T>(rows: T[]): T => {
      if (!rows[0]) throw new Error('Consulta sin resultado.');
      return rows[0];
    };
    const { sql } = first(
      await db.$queryRaw<{ sql: string }[]>`
      SELECT CASE
        WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app')
          THEN format('ALTER ROLE crm_app WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L', ${password}::text)
        ELSE format('CREATE ROLE crm_app WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L', ${password}::text)
      END AS sql`,
    );
    await db.$executeRawUnsafe(sql);
    const { dbname } = first(
      await db.$queryRaw<{ dbname: string }[]>`SELECT current_database() AS dbname`,
    );
    const { grant } = first(
      await db.$queryRaw<{ grant: string }[]>`
        SELECT format('GRANT CONNECT ON DATABASE %I TO crm_app', ${dbname}::text) AS grant`,
    );
    await db.$executeRawUnsafe(grant);
    await db.$executeRaw`GRANT USAGE ON SCHEMA public TO crm_app`;
    console.log(`Rol crm_app listo en la base ${dbname}.`);
  } finally {
    await db.$disconnect();
  }
}

async function main() {
  const password = process.env.APP_DB_PASSWORD;
  if (!password) throw new Error('Defina APP_DB_PASSWORD.');
  const i = process.argv.indexOf('--url');
  const explicit = i >= 0 ? process.argv[i + 1] : undefined;
  const urls = explicit
    ? [explicit]
    : [process.env.DATABASE_URL, process.env.TEST_DATABASE_URL].filter((u): u is string => !!u);
  if (urls.length === 0) throw new Error('Defina DATABASE_URL.');
  for (const url of urls) await setup(url, password);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
