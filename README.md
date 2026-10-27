# CRM Web Comercial — Multiplica

CRM web para gestionar el ciclo comercial de una organización: desde el registro de un prospecto
hasta el cierre de una negociación. Incluye contactos, compañías, prospectos, negociaciones,
catálogo de productos, monedas y tipos de cambio, tareas, proyectos básicos, usuarios, equipos,
permisos, reportes, control de duplicados, importación/exportación y papelera de reciclaje.

**Fuera de alcance:** integraciones con WhatsApp, SUNAT, facturación electrónica y cualquier
motor de automatizaciones comerciales.

## Estado

| Fase                                                          | Estado                   |
| ------------------------------------------------------------- | ------------------------ |
| 0 — Diseño y andamiaje                                        | ✅ Decisiones aprobadas  |
| 1 — Base del sistema                                          | ✅ Entregada (ver abajo) |
| 2 — Contactos, compañías, productos, monedas, tipos de cambio | ✅ Entregada (ver abajo) |
| 3 — Prospectos, negociaciones, conversión                     | ✅ Entregada (ver abajo) |
| 4 — Tareas y proyectos                                        | Siguiente                |
| 5 y 6                                                         | Pendientes               |

### Fase 1 — qué incluye

- **Acceso:** inicio de sesión con cookie de sesión en servidor, contraseñas argon2id, bloqueo tras
  5 intentos, recuperación por correo con enlace de un solo uso, cambio de contraseña, cierre de
  sesión por inactividad, protección CSRF y límite de intentos.
- **Usuarios, equipos y roles:** altas, edición, activación/desactivación (cierra sesiones), equipos
  con supervisor y miembros, roles del sistema (Administrador, Supervisor, Comercial) y roles propios
  con matriz de permisos módulo × acción × alcance (propios / equipo / todos), validada en la API.
- **Configuración:** organización y parámetros generales, pipelines y etapas (prospectos y
  negociaciones), prioridades con color + ícono + texto, orígenes, motivos de pérdida, tipos de
  documento, sectores, estados de tarea y campos personalizados por módulo.
- **Papelera base:** eliminación lógica, restauración con detección de conflictos, eliminación
  definitiva con confirmación escrita y permiso, purga diaria por retención (worker).
- **Trazabilidad:** historial de cambios por registro y auditoría de eventos sensibles (solo
  inserción a nivel de base de datos).
- **Aislamiento entre organizaciones:** `organization_id` en todas las tablas + Row-Level Security
  en PostgreSQL con un rol de aplicación sin privilegios.
- **Interfaz:** menú lateral, barra superior con notificaciones y perfil, modo claro/oscuro,
  diseño adaptable a móvil, formularios con validación en español.
- **Calidad:** pruebas unitarias, de integración (API + PostgreSQL real + RLS) y E2E
  (Playwright), CI en GitHub Actions.

### Fase 2 — qué incluye

- **Contactos y compañías:** alta, edición, ficha en panel lateral, papelera e historial; código
  correlativo (`CON-`, `CIA-`); RUC validado con su dígito verificador y único entre compañías
  vigentes; documentos validados según su tipo; compañía principal y compañías relacionadas;
  responsable con alcance por registro (propios / equipo / todos) aplicado en la API; campos
  personalizados; control de ediciones concurrentes.
- **Productos:** SKU único (normalizado), categorías, precio decimal exacto con moneda, descuento
  máximo, activo/inactivo, papelera con detección de SKU repetido al restaurar.
- **Monedas:** maestro con código ISO, símbolo, decimales y posición; una sola principal (se
  sincroniza con la organización); PEN y USD iniciales.
- **Tipos de cambio:** maestro diario sin servicios externos, una tasa activa por fecha y par, edición
  con motivo e historial propio, auditoría, y la regla de selección aprobada (D-05): tasa del día,
  la anterior dentro del plazo configurable, inversa opcional; si no hay, se informa y no se inventa.
- **Importación y exportación (Excel y CSV):** plantilla descargable, mapeo de columnas, vista previa
  con válidos/inválidos sin escribir, duplicados omitir/actualizar por clave (correo/documento, RUC,
  SKU, código, fecha+par), reporte de errores descargable, historial de importaciones; exportación de
  todos o filtrados, con columnas a elección y campos personalizados, respetando permisos y alcance.
  Máximo 5.000 filas por importación y 50.000 por exportación (lo mayor irá al worker en la Fase 5).
- **Búsqueda global** (Ctrl+K) en contactos, compañías y productos, según permisos.
- **Calidad:** 72 pruebas de integración y 12 E2E.

### Fase 3 — qué incluye

- **Prospectos y negociaciones:** tablero Kanban por pipeline (arrastrar con ratón, táctil o
  teclado) y vista de lista con filtros, orden y paginación; sumas por columna y por moneda;
  prioridades con texto + ícono + color; código correlativo (`PRO-`, `NEG-`); responsable con
  alcance por registro; campos personalizados; papelera e historial.
- **Cierre:** pasar a «Perdida/Descartado» exige motivo; ganar pide valor final y fecha de cierre y
  congela importes y tasas; reabrir requiere permiso de equipo y queda en la auditoría.
- **Productos asociados:** cantidad, precio, descuento por importe o porcentaje (con el máximo del
  producto), decimal exacto y redondeo por línea; productos en otra moneda con la tasa vigente
  (D-05) guardada en la línea, tasa manual con motivo para usuarios autorizados y «Actualizar
  tasas» mientras la negociación esté abierta.
- **Conversión (D-07):** vista previa de lo que se copia (contacto principal, compañía,
  responsable, prioridad, productos reconvertidos y campos personalizados equivalentes); una sola
  negociación por prospecto, aun con conversiones simultáneas; el prospecto queda en solo lectura
  y enlazado.
- **Comentarios** con menciones que notifican; búsqueda global e importación/exportación también
  para prospectos y negociaciones.
- **Calidad:** 90 pruebas de integración y 14 E2E.

## Puesta en marcha

Ver [CLAUDE.md](CLAUDE.md#puesta-en-marcha-local). API documentada en `http://localhost:3001/api/docs`.

## Documentos de diseño

| Documento                                                     | Contenido                                           |
| ------------------------------------------------------------- | --------------------------------------------------- |
| [01 — Arquitectura](docs/plan/01-arquitectura.md)             | Stack, componentes, seguridad, despliegue           |
| [02 — Modelo de datos](docs/plan/02-modelo-datos.md)          | Entidades, relaciones (ER), índices, transacciones  |
| [03 — Navegación y UX/UI](docs/plan/03-navegacion-ux.md)      | Mapa de navegación, pantallas, sistema visual       |
| [04 — Reglas de negocio](docs/plan/04-reglas-negocio.md)      | Cálculos, monedas, conversión, papelera, duplicados |
| [05 — Backlog y criterios](docs/plan/05-backlog-criterios.md) | Historias por fase y criterios de aceptación        |
| [06 — Plan por fases](docs/plan/06-plan-fases.md)             | Fases, dependencias técnicas, entregables, pruebas  |
| [07 — Decisiones](docs/plan/07-decisiones-pendientes.md)      | Decisiones aprobadas y preguntas abiertas           |
