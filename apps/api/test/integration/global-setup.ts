import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

/** Deja la base de pruebas vacía y le aplica las migraciones antes de la corrida. */
export default async function setup() {
  try {
    process.loadEnvFile('.env');
  } catch {
    // En CI las variables vienen del entorno.
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Defina TEST_DATABASE_URL.');
  if (!/test/i.test(new URL(url).pathname)) {
    throw new Error('TEST_DATABASE_URL debe apuntar a una base cuyo nombre contenga "test".');
  }
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    await db.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await db.$executeRawUnsafe('CREATE SCHEMA public');
  } finally {
    await db.$disconnect();
  }
  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
