# 06 — Plan de desarrollo por fases y dependencias técnicas

## 1. Orden y dependencias

```
Fase 0  Aprobación de decisiones (07) ──► andamiaje del repo, CI, BD
   │
Fase 1  Base: auth · usuarios · equipos · roles/permisos · configuración · catálogos ·
   │    campos personalizados · historial/auditoría · papelera base · layout
   │
Fase 2  Contactos · compañías · productos · monedas · tipos de cambio · import/export base
   │         (depende de: permisos, campos personalizados, papelera, historial)
   │
Fase 3  Prospectos · negociaciones · Kanban · prioridades · productos asociados ·
   │    cálculos · conversión
   │         (depende de: contactos, compañías, productos, monedas y tasas)
   │
Fase 4  Tareas · participantes/observadores · asociación CRM · proyectos · calendario ·
   │    notificaciones
   │         (depende de: entidades CRM de fases 2–3)
   │
Fase 5  Duplicados · comparación · fusión · importación avanzada · papelera completa
   │         (depende de: todas las entidades y sus relaciones)
   │
Fase 6  Dashboard · reportes · pruebas integrales · pulido UX · documentación · despliegue
```

Cada fase termina con: migraciones revisadas, pruebas en verde en CI, demo funcional sobre datos
reales sembrados y revisión del usuario funcional antes de pasar a la siguiente.

## 2. Entregables por fase

| Fase | Entregable verificable |
| ---- | ---------------------- |
| 0 | Repo con monorepo, lint/format/typecheck, CI, Postgres en Docker, `pnpm dev` levanta api + web + worker, semilla mínima |
| 1 | Se puede entrar, administrar usuarios/equipos/roles y configurar catálogos; permisos probados |
| 2 | Contactos, compañías, productos, monedas y tasas operativos con import/export |
| 3 | Ciclo comercial completo: prospecto → negociación → ganada/perdida, con productos y totales |
| 4 | Gestor de tareas con tres vistas, vinculado a CRM y proyectos |
| 5 | Duplicados con fusión segura; papelera con restauración y purga |
| 6 | Dashboard y reportes; E2E completos; listo para desplegar |

## 3. Dependencias técnicas

| Dependencia | Necesaria desde | Quién la provee |
| ----------- | --------------- | --------------- |
| Aprobación de decisiones [07] | Fase 0 | Negocio / responsable técnico |
| Escritura de Claude en este repo (GitHub App instalada) | Fase 0 | Dueño del repo `mauri1704/CRM_MULTIPLICA` |
| Servidor, dominio/subdominio, puerto y red en el proxy [D-03] | Fase 6 (entorno de pruebas antes, si se desea) | Infraestructura |
| Base de datos PostgreSQL 16 dedicada (con `pg_trgm`, `unaccent`, `citext`) | Fase 0 local · Fase 6 producción | Infraestructura |
| Servicio de correo (SMTP) para recuperar contraseña [D-22] | Fase 1 | Multiplica |
| Volumen persistente para archivos de import/export [D-04] | Fase 2 | Infraestructura |
| Respaldos de base de datos [D-18] | Fase 6 | Infraestructura |
| Datos reales o de muestra para la demo (tasas PEN/USD, productos) | Fase 2 | Negocio |

## 4. Riesgos

| Riesgo | Mitigación |
| ------ | ---------- |
| Alcance muy amplio (≈ 60 historias) | Entregas por fase con demo; no empezar una fase sin cerrar la anterior |
| Errores de dinero o tasas | Decimal exacto, casos de prueba tabulados aprobados por negocio, totales guardados |
| Fusión o restauración que rompa relaciones | Transacciones, vista previa obligatoria, instantáneas en `merge_history`, pruebas de integración |
| Rendimiento con importaciones grandes | Procesamiento en worker por lotes y en streaming |
| Compartir servidor con otras apps | BD, usuario, red y límites de memoria propios; sin puertos expuestos salvo el proxy |
