# Runbook — Desplegar el CRM

Pendiente de decisión (docs/plan/07): **D-03** dominio y servidor, **D-18** responsable de los
respaldos. Este runbook usa `crm.ejemplo.com` y rutas de ejemplo; ajústelos cuando se definan.
El despliegue real en el servidor lo ejecuta infraestructura: el pipeline solo publica imágenes.

## Qué se despliega

| Servicio  | Imagen            | Función                                    |
| --------- | ----------------- | ------------------------------------------ |
| `db`      | postgres:16       | Base de datos (volumen propio, sin puerto) |
| `migrate` | `crm-api`         | Crea el rol `crm_app` y aplica migraciones |
| `api`     | `crm-api`         | API REST (127.0.0.1:3001)                  |
| `worker`  | `crm-api`         | Importación/exportación, purga, avisos     |
| `web`     | `crm-web` (nginx) | Interfaz (127.0.0.1:8081)                  |

El proxy del servidor (Caddy) publica el dominio: `deploy/Caddyfile.snippet`.

## Primera instalación

1. Instalar Docker y Compose. Clonar el repositorio en `/opt/crm` (solo se usa `deploy/`).
2. `cp deploy/.env.example deploy/.env` y completar: contraseñas (`openssl rand -base64 24`),
   `WEB_URL` (https), `SMTP_URL`/`MAIL_FROM` (sin correo no hay recuperación de contraseña), versión de
   las imágenes. `chmod 600 deploy/.env`.
3. `docker login ghcr.io` (si las imágenes son privadas).
4. `docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yml up -d`
5. Comprobar: `curl -s http://127.0.0.1:3001/api/v1/health/ready` → `{"status":"ok",...}`.
6. Agregar el bloque de `Caddyfile.snippet` al Caddy, `caddy reload`.
7. Crear la primera organización y administrador (ver «Alta inicial»).
8. Programar respaldos (runbook de respaldo) y **hacer una prueba de restauración**.

### Alta inicial

La base nace vacía. Crear la organización y su administrador con el script de alta (no crea datos
de demostración; el seed de desarrollo se niega a correr con `NODE_ENV=production`):

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yml run --rm --no-deps \
  -e ORG_NAME="Mi Empresa S.A.C." -e ADMIN_NAME="Ana Pérez" -e ADMIN_EMAIL=ana@empresa.com \
  migrate pnpm org:create
```

- Sin `ADMIN_PASSWORD` genera una contraseña aleatoria y la muestra **una sola vez**; con ella,
  debe cumplir la política (≥ 10 caracteres, letras y números).
- Crea roles del sistema y permisos, pipelines, catálogos, prioridades, estados de tarea y reglas de
  duplicados iniciales. Se niega si el correo o el nombre de la organización ya existen.
- El administrador entra, cambia la contraseña (Perfil) y crea usuarios y equipos. Para otro cliente,
  repetir el comando con otros datos.

## Actualizar a una versión nueva

1. Publicar tag `vX.Y.Z` (el workflow _Release_ construye y sube las imágenes).
2. **Respaldar antes**: `deploy/scripts/backup.sh`.
3. Cambiar `CRM_API_IMAGE`/`CRM_WEB_IMAGE` en `deploy/.env`.
4. `docker compose --env-file deploy/.env -f deploy/docker-compose.prod.yml pull && … up -d`
   (el servicio `migrate` aplica las migraciones antes de arrancar `api` y `worker`).
5. Verificar `/health/ready`, entrar a la web y abrir el dashboard.

## Revertir

Las migraciones solo van hacia adelante. Si la versión nueva falla:

- Sin migraciones nuevas: volver a las imágenes anteriores en `deploy/.env` y `up -d`.
- Con migraciones nuevas: restaurar el respaldo previo a la actualización
  (`deploy/scripts/restore.sh`) y volver a las imágenes anteriores. Se pierden los datos
  escritos después del respaldo.

## Monitoreo básico

- Salud: `GET /api/v1/health` (vivo) y `/api/v1/health/ready` (base y almacenamiento; responde 503
  si falla). Docker los usa como `healthcheck`.
- Un monitor externo (UptimeRobot, Uptime Kuma, etc.) sobre `https://DOMINIO/api/v1/health/ready`
  con aviso por correo si falla 2 veces seguidas.
- Logs JSON (pino): `docker compose … logs -f api worker`. Rotación: configurar
  `/etc/docker/daemon.json` con `{"log-driver":"json-file","log-opts":{"max-size":"20m","max-file":"5"}}`.
- Disco: alertar al 80 % (la base, el volumen `crm_storage` y `BACKUP_DIR`).
- Worker: si importaciones/exportaciones quedan «en proceso» o no llegan avisos de vencimiento,
  revisar `docker compose … logs worker` y reiniciarlo (`restart worker`).

## Referencias

- Respaldo y restauración: `docs/runbooks/respaldo-y-restauracion.md`.
- API: `/api/docs` (Swagger) y `docs/openapi.json`. Regenerar: `apps/api/scripts/export-openapi.sh`.
