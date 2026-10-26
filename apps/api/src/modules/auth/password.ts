import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

// argon2id (el algoritmo por defecto de @node-rs/argon2) con los parámetros mínimos
// recomendados por OWASP: 19 MiB, 2 iteraciones.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password: string): Promise<string> => hash(password, OPTIONS);

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Hash fijo para comparar cuando el correo no existe: el tiempo de respuesta no revela si existe.
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('contraseña-de-relleno-0');
  await verifyPassword(await dummyHash, password);
}

/** Token aleatorio para cookies y enlaces: se entrega en claro y se guarda solo su SHA-256. */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256(token) };
}

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
