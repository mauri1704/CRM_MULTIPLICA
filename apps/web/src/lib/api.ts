import type { ApiError as ApiErrorBody } from '@crm/shared';

/** Error devuelto por la API con su mensaje en español y el detalle por campo. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, string> = {},
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

function buildUrl(path: string, query?: Query): string {
  const url = `/api/v1${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

/** Se llama cuando la sesión expira (401) para volver al login. */
let onUnauthorized: (() => void) | undefined;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        // Cabecera anti-CSRF que exige la API en toda petición que modifica.
        'X-CRM-Request': '1',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'No se pudo conectar con el servidor. Revise su conexión.');
  }
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const err = (data ?? {}) as Partial<ApiErrorBody>;
    if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me') onUnauthorized?.();
    throw new ApiError(
      res.status,
      err.code ?? `HTTP_${res.status}`,
      err.message ?? 'Ocurrió un error inesperado.',
      err.details ?? {},
    );
  }
  return data as T;
}

/** Sube un archivo (multipart) al endpoint indicado. */
async function upload<T>(path: string, file: File): Promise<T> {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch(buildUrl(path), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-CRM-Request': '1', Accept: 'application/json' },
    body,
  });
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const err = (data ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(
      res.status,
      err.code ?? `HTTP_${res.status}`,
      err.message ?? 'No se pudo subir el archivo.',
      err.details ?? {},
    );
  }
  return data as T;
}

/** Descarga un archivo de la API y lo guarda con el nombre que indica el servidor. */
async function download(path: string, query?: Query): Promise<void> {
  const res = await fetch(buildUrl(path, query), {
    credentials: 'same-origin',
    headers: { 'X-CRM-Request': '1' },
  });
  if (!res.ok) {
    const err = ((await res.json().catch(() => ({}))) ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(
      res.status,
      err.code ?? `HTTP_${res.status}`,
      err.message ?? 'No se pudo descargar el archivo.',
      err.details ?? {},
    );
  }
  const name =
    /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'archivo';
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  upload,
  download,
  get: <T>(path: string, query?: Query) => request<T>('GET', path, undefined, query),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Ocurrió un error inesperado.';
}
