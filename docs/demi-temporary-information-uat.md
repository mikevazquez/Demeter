# Demi: información temporal de eventos y promociones

## Alcance

Demi consulta información temporal guardada por cada estudio. La promoción inicia en `promotion_starts_on`. La respuesta termina en `registration_deadline` cuando existe; si se deja vacío, termina en `event_ends_on`. Los límites son inclusivos y se calculan con la zona horaria del estudio. La información vencida se conserva para historial y deja de ofrecerse.

La consulta usa el orquestador compartido de canales. No envía promociones de forma proactiva.

## Matriz de seguimiento UAT

“Aprobado automático” significa que pasó la prueba técnica indicada; no representa aceptación conversacional del usuario. La UAT final sigue pendiente hasta probar el preview/canal.

| ID      | Caso                                                                                                 | Resultado técnico                                                                                                     | UAT conversacional / UI | Siguiente paso                                                                           |
| ------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| TEMP-01 | Taller anunciado el 2026-10-01; ocurre del 2026-11-01 al 2026-11-30, sin fecha límite de inscripción | **Aprobado automático**: disponible desde el inicio de promoción y hasta el último día del taller; se excluye después | Pendiente               | Probar preguntas antes, durante y después de la vigencia                                 |
| TEMP-02 | Evento hasta 2026-11-30 con inscripción cerrada el 2026-11-10                                        | **Aprobado automático**: disponible hasta el 10 inclusive; se excluye desde el 11                                     | Pendiente               | Confirmar la respuesta en conversación en la fecha límite y al día siguiente             |
| TEMP-03 | Preguntar horario del taller de aro                                                                  | **Aprobado automático**: devuelve los datos almacenados; el runtime no agrega hechos ausentes                         | Pendiente               | Confirmar que Demi redacte correctamente el horario cargado                              |
| TEMP-04 | Preguntar por el evento antes de `promotion_starts_on`                                               | **Aprobado automático**: el evento todavía no se ofrece                                                               | Pendiente               | Confirmar el comportamiento con una pregunta real                                        |
| TEMP-05 | Evento vencido, en borrador o archivado; conservarlo en historial                                    | **Aprobado automático** para excluir esos estados; revisión de código confirma archivado trazable sin borrado         | Pendiente               | Verificar en la interfaz que el archivado conserva el registro y no aparece como vigente |
| TEMP-06 | Consultar la misma información desde canales de Demi                                                 | **Aprobado automático** para el dispatcher compartido                                                                 | Pendiente               | Ejecutar al menos una conversación por cada canal habilitado                             |
| TEMP-07 | Preguntar por un dato que no se cargó, como el precio                                                | **Aprobado automático** para el payload: sólo expone hechos guardados                                                 | Pendiente               | Confirmar que la respuesta conversacional admita que ese dato no está disponible         |
| TEMP-08 | Límites inclusivos en la zona horaria del estudio                                                    | **Aprobado automático**: se verificó el cambio de fecha local y el límite inclusivo                                   | Pendiente               | Confirmar en una conversación cerca del cambio de día local                              |

## Evidencia técnica

- 12 pruebas automatizadas del feature: 4 de reglas/datos y 8 del runtime compartido.
- Suite completa: 187 archivos y 1,241 pruebas aprobadas.
- `npm run lint` y `npm run typecheck` aprobados; lint reporta advertencias preexistentes en archivos ajenos a este cambio.
- `git diff --check` y formato Prettier aprobados.
- Base de datos y código modificados sólo en sandbox/develop. No se desplegó a producción.

## Pendiente para completar UAT

No hay un preview con conexión a sandbox que se haya podido verificar: las variables de entorno de Vercel aparecen cifradas y no es posible confirmar el destino de la base de datos. Para ejecutar la parte manual necesito una URL de preview configurada al sandbox y acceso de prueba por el flujo habitual de la aplicación. No compartas secretos en el chat. Después se registrará aquí el resultado por caso; cualquier promoción seguirá requiriendo autorización explícita.
