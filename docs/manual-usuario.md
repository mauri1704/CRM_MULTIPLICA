# Manual de usuario — CRM Web Comercial

Guía para el equipo comercial. Lo que usted ve depende de su rol: si una opción no aparece en el
menú, su rol no tiene ese permiso (consulte a su administrador).

## 1. Primeros pasos

- **Ingresar:** correo y contraseña. Tras 5 intentos fallidos la cuenta se bloquea un tiempo.
- **Olvidé mi contraseña:** «¿Olvidó su contraseña?» envía un enlace de un solo uso a su correo.
- **Sesión:** se cierra sola tras un periodo de inactividad.
- **Menú lateral:** Comercial, Operación, Análisis, Datos y Configuración. En el celular se abre
  con el botón de menú. Modo claro/oscuro en la barra superior.
- **Búsqueda global:** `Ctrl+K` busca contactos, compañías, productos, prospectos, negociaciones,
  tareas y proyectos (solo los que usted puede ver).
- **Campana:** avisos de asignaciones, menciones y tareas vencidas.

## 2. Contactos, compañías y productos

- **Crear:** botón _Crear_; los campos obligatorios se marcan. Al guardar, si hay un posible
  duplicado, se le avisa con un enlace: usted decide si continúa.
- **Ficha:** al hacer clic en una fila se abre el panel con datos, tareas, actividad e historial.
- **Compañías:** el RUC se valida (11 dígitos con verificador). Un contacto puede tener una compañía
  principal y otras relacionadas.
- **Productos:** SKU único, precio y moneda, descuento máximo permitido.
- **Eliminar:** _Enviar a papelera_ (se puede restaurar). Ver §9.

## 3. Prospectos y negociaciones

- **Tablero (Kanban):** arrastre una tarjeta a otra columna para cambiar de etapa (también con
  teclado: espacio, flechas, espacio). Cada columna muestra su suma por moneda.
- **Lista:** filtros, orden y paginación. Cambie entre _Tablero_ y _Lista_ arriba a la derecha.
- **Pérdida:** al pasar a «Perdida» o «Descartado» se pide el **motivo**.
- **Ganar:** se pide valor final y fecha de cierre; luego importes y tasas quedan congelados.
- **Reabrir** una negociación cerrada requiere permiso y queda en la auditoría.
- **Productos de la negociación:** cantidad, precio, descuento (importe o %). Si el producto está en
  otra moneda se usa la tasa vigente; _Actualizar tasas_ la refresca mientras esté abierta.
- **Convertir prospecto → negociación:** _Convertir_ muestra una vista previa de lo que se copia.
  Solo se puede convertir una vez; el prospecto queda en solo lectura y enlazado.
- **Comentarios:** escriba `@` para mencionar a alguien y notificarle.

## 4. Tareas, proyectos y actividades

- **Tareas:** responsable, participantes (cambian el estado y comentan) y observadores (solo ven y
  comentan). Vistas: tablero por estado, lista y calendario (arrastrar cambia fechas).
- **Filtros:** Mis tareas, Participo, Observo, Todas.
- **Proyectos:** agrupan tareas; tienen responsable, estado y fechas.
- **Actividad:** en cada ficha, registre llamadas, reuniones, correos y notas.
- **Aviso de vencidas:** cada día recibe una notificación de sus tareas vencidas.

## 5. Dashboard (Inicio)

Muestra, para el periodo elegido (por defecto, últimos 30 días): prospectos activos y nuevos,
negociaciones abiertas / ganadas / perdidas, valor del pipeline, ventas cerradas, tareas pendientes
y vencidas, distribución por responsable, evolución de resultados y actividad reciente.

- **Filtros:** rango de fechas, pipeline, equipo, responsable y moneda. Quedan en la dirección web:
  puede guardar o compartir la vista.
- **Alcance:** usted ve solo lo que su rol permite (propios, equipo o todos).
- **Monedas:** al elegir una moneda, los importes de otras monedas se convierten con las tasas
  registradas. Bajo los indicadores se informa la **moneda base, el criterio de tasa y la fecha**. Los
  importes sin tasa disponible **no se suman** y se avisa cuántos quedaron fuera.
  - _Criterio «fecha de corte»:_ todo se convierte con la tasa del último día del periodo.
  - _Criterio «fecha de cierre»:_ cada venta usa la tasa de su día de cierre.

## 6. Reportes

_Análisis → Reportes_. Cada reporte acepta los mismos filtros y se exporta a **Excel o CSV** con
el botón _Exportar_ (incluye totales, moneda, criterio, periodo y nota de importes excluidos). La
exportación respeta su alcance y queda en la auditoría.

| Grupo      | Reportes                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| Comercial  | Prospectos por etapa · Negociaciones por etapa · Conversión de prospectos · Valor de pipeline          |
| Resultados | Ventas ganadas · Ventas perdidas · Motivos de pérdida · Productos vendidos · Desempeño por responsable |
| Tareas     | Tareas pendientes · Tareas vencidas                                                                    |
| Control    | Registros duplicados detectados · Registros eliminados y restaurados (requieren permiso propio)        |

## 7. Duplicados

_Datos → Duplicados_: use **Buscar duplicados** por módulo. Cada pareja muestra el parecido y por
qué coincide. Abra la comparación para: **fusionar** (elige el registro que se conserva y, campo a
campo, qué valor queda; las relaciones se mueven), **conservar ambos** o marcar **revisado**.
La fusión es definitiva en datos, pero el registro absorbido va a la papelera con la marca
«Fusionado» y queda el historial. Nada se fusiona solo. Las reglas (exacta, normalizada, aproximada)
las administra quien tiene el permiso de gestión.

## 8. Importar y exportar

_Datos → Importaciones_: elija el módulo, descargue la **plantilla**, súbala (Excel/CSV), asigne
columnas y revise la **vista previa** (válidos / inválidos) antes de confirmar. Para duplicados elija
omitir, actualizar o crear. Las filas con error se descargan en un reporte. Máximo 5 000 filas por
importación. Las exportaciones de cada listado respetan filtros y permisos.

## 9. Papelera

_Datos → Papelera_: lista lo eliminado con quién y cuándo. **Restaurar** valida conflictos (p. ej.
un SKU que ya existe). **Eliminar definitivamente** exige escribir la confirmación y permiso. Se
purga sola pasada la retención configurada.

## 10. Administración (según permisos)

- **Usuarios y equipos:** altas, activar/desactivar (cierra sus sesiones), equipos con supervisor.
- **Roles y permisos:** matriz módulo × acción × alcance (propios / equipo / todos).
- **Configuración:** organización, pipelines y etapas, prioridades, orígenes, motivos de pérdida,
  sectores, estados de tarea, campos personalizados, monedas y tipos de cambio.
- **Tipos de cambio:** una tasa activa por día y par; al editar se pide motivo y queda historial.
- **Auditoría:** eventos sensibles (accesos, cambios de permisos, exportaciones, reaperturas…),
  no editables.

## 11. Preguntas frecuentes

- **No veo un registro que un colega sí:** su alcance es «propios» o «equipo».
- **«Otra persona modificó este registro»:** recargue y vuelva a aplicar su cambio (control de
  ediciones simultáneas).
- **Un importe no aparece en el dashboard:** falta tipo de cambio para su fecha; regístrelo en
  _Configuración → Tipos de cambio_.
- **Recibí un aviso de duplicado:** puede continuar; revise el enlace antes de crear otro registro.
