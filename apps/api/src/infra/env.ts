import { z } from 'zod';

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  /** Rol sin superusuario ni BYPASSRLS (crm_app). */
  APP_DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().int().default(3001),
  WEB_URL: z.string().url().default('http://localhost:5173'),
  SMTP_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  MAIL_FROM: z.string().default('CRM Multiplica <no-reply@multiplica.test>'),
  STORAGE_DIR: z.string().default('./storage'),
  /** Valor de `trust proxy` de Express: detrás del proxy, para leer la IP real. */
  TRUST_PROXY: z.string().default('loopback'),
  /** Intentos por minuto y por IP en login y recuperación de contraseña. */
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(10),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Variables de entorno validadas. Falla al arrancar si falta alguna obligatoria. */
export function env(): Env {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Variables de entorno inválidas: ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** Solo para pruebas: fuerza a releer process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}

export function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Sin archivo .env: se usan las variables del entorno.
  }
}
