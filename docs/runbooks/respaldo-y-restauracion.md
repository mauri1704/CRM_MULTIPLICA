# Runbook — Respaldo y restauración

Responsable de los respaldos: **por definir (D-18)**. Un respaldo que nadie prueba no existe:
la restauración se prueba al menos una vez al mes.

## Qué se respalda

- Base de datos completa (`pg_dump -Fc`): todo el negocio, historial, auditoría y cola.
- Archivos del volumen `crm_storage` (importaciones y exportaciones).

## Respaldo diario

`deploy/scripts/backup.sh` genera en `BACKUP_DIR`:

- `crm-db-AAAAMMDD-HHMMSS.dump`, `crm-files-AAAAMMDD-HHMMSS.tar.gz` y `crm-AAAAMMDD-HHMMSS.sha256`;
- comprueba que el volcado sea legible, borra los de más de `BACKUP_RETENTION_DAYS` (30) y, si
  `BACKUP_REMOTE` está definido, copia con `rsync` fuera del servidor.

Programación (cron de root):

```
15 2 * * * /opt/crm/deploy/scripts/backup.sh >> /var/log/crm-backup.log 2>&1
```

**Copia fuera del servidor:** un respaldo en el mismo disco no protege de la pérdida del servidor.
Definir `BACKUP_REMOTE` (rsync/SSH) o sincronizar `BACKUP_DIR` a un almacenamiento externo.

## Prueba de restauración (mensual, sin tocar producción)

```bash
export PGHOST=… PGUSER=… PGPASSWORD=…     # un Postgres 16 de pruebas
deploy/scripts/restore-test.sh /var/backups/crm/crm-db-AAAAMMDD-HHMMSS.dump
```

Crea una base temporal, restaura, cuenta filas de las tablas clave, verifica las migraciones y la
elimina. Debe terminar en `RESTAURACIÓN VERIFICADA`. Registrar fecha y resultado.

Prueba realizada durante el desarrollo (28/10/2026, PostgreSQL 16, datos de demostración):
volcado de 380 KB restaurado sin errores; organizaciones 1, usuarios 3, contactos 13, compañías 6,
prospectos 20, negociaciones 11, tareas 14, historial 114, 5 migraciones aplicadas.

## Restauración real (desastre)

1. Avisar a los usuarios; la restauración reemplaza todos los datos actuales.
2. Elegir el respaldo más reciente válido (`sha256sum -c crm-….sha256`).
3. `deploy/scripts/restore.sh crm-db-….dump crm-files-….tar.gz`
   (pide escribir `RESTAURAR`; detiene `api`/`worker`/`web`, recrea la base, restaura, reaplica el
   rol `crm_app` y arranca todo).
4. Verificar `/api/v1/health/ready`, iniciar sesión y revisar los últimos registros.
5. Los datos posteriores al respaldo se pierden: informar el punto de recuperación (hora del respaldo).

Objetivos sugeridos: pérdida máxima 24 h (respaldo diario) y recuperación en menos de 2 h.
Para menos pérdida, activar archivado WAL (requiere decisión de infraestructura).

## Servidor nuevo

Instalar Docker, clonar el repositorio, crear `deploy/.env` con **las mismas** contraseñas,
`docker compose … up -d db`, y ejecutar `restore.sh`. Guardar `deploy/.env` en un gestor de secretos
aparte del servidor.
