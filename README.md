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
| 4 — Tareas, proyectos y actividades                           | ✅ Entregada (ver abajo) |
| 5 — Duplicados, fusión, importación avanzada y papelera       | ✅ Entregada (ver abajo) |
| 6 — Dashboard, reportes y despliegue                          | Siguiente                |

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

### Fase 4 — qué incluye

- **Tareas** (`TAR-`): responsable, participantes y observadores, inicio y vencimiento (el
  vencimiento no puede ser anterior), prioridad, estado configurable (completar registra la fecha),
  proyecto y como máximo un elemento CRM asociado (contacto, compañía, prospecto o negociación).
- **Roles en la tarea, validados en la API:** el responsable (o quien tenga alcance de equipo/todos)
  edita; el participante cambia el estado y comenta; el observador ve y comenta.
- **Tres vistas:** tablero por estado (arrastrar cambia el estado), lista con orden y paginación, y
  calendario mes/semana/día donde arrastrar o estirar cambia las fechas. Filtros Mis tareas,
  Participo, Observo y Todas, más prioridad, proyecto y «solo abiertas».
- **Proyectos** (`PRY-`): responsable, estado, fechas, tareas del proyecto; papelera e historial.
- **En cada ficha CRM:** pestañas _Tareas_ (con alta ya asociada) y _Actividad_ para registrar a
  mano llamadas, reuniones, correos y notas (D-23). Al convertir un prospecto, sus tareas abiertas
  pueden pasar a la negociación.
- **Notificaciones:** asignación como responsable, participante u observador; menciones; aviso
  diario de tareas vencidas al responsable (worker, una vez por día).
- Importación/exportación y búsqueda global también para tareas y proyectos.
- **Corrección:** la migración de la fase 3 había eliminado índices creados a mano en la fase 2
  (código único de contactos y compañías, búsqueda y campos personalizados). La migración de la
  fase 4 los recrea y ahora están declarados en `schema.prisma`; una prueba verifica que existan.
- **Calidad:** 106 pruebas de integración y 17 E2E.

### Fase 5 — qué incluye

- **Reglas de duplicados** por módulo (contactos, compañías, productos, prospectos, negociaciones y
  proyectos): campos base o personalizados, combinados con «y», coincidencia **exacta**,
  **normalizada** (sin tildes, mayúsculas ni signos; «S.A.C.» = «SAC») o **aproximada** (pg_trgm,
  umbral configurable, 85 % por defecto), activables y con acción «avisar» o «impedir guardar».
  Vienen reglas iniciales; las administra quien tenga el permiso de gestión.
- **Detección:** bajo demanda («Buscar duplicados»), al guardar (aviso con enlace al posible
  duplicado; la persona decide) y al importar. Nunca elimina ni fusiona solo. El aviso no revela
  registros fuera del alcance de quien guarda. Un par marcado «revisado» o «conservar ambos» no
  vuelve a aparecer.
- **Comparación y fusión segura:** lado a lado con las diferencias resaltadas; se elige el registro
  principal y, campo por campo, qué valor conservar (o combinar textos largos); vista previa de las
  relaciones que se mueven. Todo en una transacción: valores elegidos, relaciones (contactos,
  compañías, productos, tareas, comentarios, actividades…), el absorbido va a la papelera marcado
  «fusionado», `merge_history` con instantánea completa, historial y auditoría. Dos fusiones
  simultáneas del mismo registro no se pisan: una gana y la otra recibe un conflicto.
- **Restricciones:** no se fusionan negociaciones cerradas ni de distinta moneda, ni prospectos
  convertidos o de distinta moneda. Supervisor y Administrador; con alcance de equipo, solo
  registros de su equipo.
- **Importación avanzada:** modo «Crear de todos modos» (queda por revisar como posible duplicado),
  «Todo o nada» (si una fila falla no se guarda ninguna) y aviso de coincidencias nuevas al terminar.
- **Papelera:** los registros fusionados se identifican y se avisa que restaurarlos no deshace la
  fusión.
- **Calidad:** 125 pruebas de integración (incluye concurrencia de fusión y aislamiento entre
  organizaciones) y 20 E2E.

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
