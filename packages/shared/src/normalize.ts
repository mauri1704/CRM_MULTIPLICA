/**
 * Normalización para búsqueda y detección de duplicados (coincidencia "normalizada").
 * La API guarda estas formas en columnas `*_norm` al escribir.
 */

/** Minúsculas, sin tildes, sin signos y con espacios simples. */
export function normalizeText(v: string | null | undefined): string {
  if (!v) return '';
  return v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9@.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Nombres de personas y empresas para detectar duplicados: como `normalizeText` pero sin puntos,
 * de modo que «S.A.C.» y «SAC» o «E.I.R.L.» y «EIRL» coincidan.
 */
export function normalizeName(v: string | null | undefined): string {
  return normalizeText(v).replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

export function normalizeEmail(v: string | null | undefined): string | null {
  const s = v?.trim().toLowerCase();
  return s ? s : null;
}

/** Solo dígitos. Un celular peruano de 9 dígitos recibe el prefijo 51. */
export function normalizePhone(v: string | null | undefined): string | null {
  const digits = (v ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 9 && digits.startsWith('9')) return `51${digits}`;
  return digits;
}

/** Identificadores (RUC, DNI, SKU): sin espacios, guiones ni puntos, en mayúsculas. */
export function normalizeIdentifier(v: string | null | undefined): string | null {
  const s = (v ?? '').replace(/[\s.\-_/]/g, '').toUpperCase();
  return s ? s : null;
}

/** RUC peruano: 11 dígitos, prefijo válido y dígito verificador (módulo 11). */
export function isValidRuc(v: string): boolean {
  if (!/^(10|15|16|17|20)\d{9}$/.test(v)) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(v[i]), 0);
  const r = 11 - (sum % 11);
  const check = r === 10 ? 0 : r === 11 ? 1 : r;
  return check === Number(v[10]);
}
