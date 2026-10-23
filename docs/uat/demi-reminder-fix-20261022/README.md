# Demi · corrección del recordatorio duplicado · 22 oct 2026

**MATRIX-F06 corregido y verificado en materialización/invalidez de DB; UAT integral sigue BLOQUEADO.** Base `fb18cc826de534960285fdc43a25144aebf23fe6`, fuente `af412c40629253ea297d9618a28141abe854f213`, [PR #367 borrador](https://github.com/mikevazquez/Demeter/pull/367). Sólo Studio Flow Sandbox `hedouonyhynuvwbckdlg`. La aplicación conserva las correcciones de `56607e7e`; este bloque cambia dos funciones SQL y añade un índice parcial y pruebas.

## Problema y corrección

Reserva y reprogramación aplicaban dos reglas a la misma persona/reserva/horario con claves por evento/regla, creando dos avisos. Además, repetir una reprogramación cancelaba el aviso que ya correspondía al horario vigente.

La materialización del recordatorio `class_reminder_5h` reutiliza el aviso activo de esa reserva/persona/horario. Serializa por reserva, protege la lectura del horario de una reprogramación concurrente y mantiene un trabajo por canal. Una regla posterior puede agregar un canal faltante sin reabrir trabajos existentes. Un snapshot de horario obsoleto queda suprimido, sin trabajo de entrega. La invalidación de reprogramación conserva el aviso del horario actual y cancela el anterior.

No se cambia la configuración de reglas, tiempos, plantillas, preferencias, canales ni adapters. El nombre histórico5h conserva el horario configurado6h. Ambas funciones siguen SECURITY INVOKER y sus ACL permanecen iguales: servicio sí, anon/authenticated no. No se instala ninguna extensión ni se modifica producción.

## Verificación directa

`tests/demi-reminder-deduplication-uat.sql` usa rol DB real service_role y rollback. Antes fallaba en el paso2 al crear otro recordatorio; después pasan12controles:

- Dos reglas comparten aviso y replay con timestamp UTC equivalente no duplica.
- Canal faltante se agrega una vez; quedan un trabajo de inbox y uno de WhatsApp.
- Reprogramar cancela el anterior y crea el vigente; repetirla conserva el actual.
- Un evento de reserva tardío reutiliza el horario actual; snapshot obsoleto no entrega.
- Otra reserva y el aviso inmediato de cambio siguen independientes; se conserva supresión por horario vencido.

**Concurrencia comprobada en dos transacciones distintas.** La primera llamada creó `ef04233f-165f-4869-bdfa-ea19526e0bdd` con2trabajos; la segunda, iniciada antes de terminar la primera, devolvió ese mismo ID con created=false y0trabajos. Se observaron cinco esperas `Lock/advisory`. Ambas ejecutaron la RPC como service_role. La segunda esperó8,47s por una retención de transacción deliberada de10s: es prueba de exclusión, no una medición de latencia P01.

El conector serializó el primer intento de llamadas paralelas; **ese intento no acredita concurrencia** y se conserva. La CLI no tenía token propio. Para la prueba real se usó una tarea puntual del pg_cron ya instalado: job36 ejecutó la sesión de fondo, se retiró y terminó succeeded. No se alteraron los demás jobs. Método reproducible: setup; dos sesiones con el script call, worker a/b; cleanup. En esta sesión, el comando del job se construyó en el cliente con el mismo script call, prefijando BEGIN, unschedule del nombre único, worker=a y background=true. No se leyó ningún archivo del servidor DB.

Cinco archivos/27pruebas locales de contratos de notificación pasan. Los12controles SQL y la carrera real son la evidencia directa; esos contratos no sustituyen motor y entrega completos. [Resultados, marcas de tiempo y bloqueo observado](results.json).

## Migración y cierre

Aplicada sólo en Sandbox: `20261022183659_demi_class_reminder_deduplication.sql`. CLI creó inicialmente152828; MCP asignó183659 al aplicar y se alineó el nombre local sin alterar SQL ni historial DB. Índice parcial para buscar avisos activos por estudio/persona/reserva. Seguridad:313hallazgos antes/después,0nuevos. Rendimiento:483→482,0nuevos. No se afirma resuelto el backlog previo de asesores.

La suite de12controles se revirtió. Las dos fixtures comprometidas para usar sesiones separadas quedaron cerradas y preservan auditoría: cero entregas, avisos activos, trabajos activos y eventos pendientes. Sesiones sintéticas canceladas, leases liberados y cero tareas Cron temporales restantes. No se crearon cuentas ni se reutilizaron accesos revocados.

La auditoría inicial usó rule_id/active_version_number como columnas de notification_rules; se corrigió a id/current_version_number tras leer el esquema. Ajuste de arnés, sin modificar reglas. Se conservan la reproducción fallida y el primer intento serializado.

## Pendiente

Diagnóstico F04 adicional: logs13:43:17/20confirman SQLSTATE57014 dentro de `service_booking_eligibility`, su wrapper de deuda y el core privado. La API tiene statement_timeout8s; no se amplió. Un fixture nuevo, con rol service_role, límite8s y rollback, pasó elegibilidad en87,206ms. Eso no reproduce ni elimina el fallo anterior y no prueba su causa más profunda. [Evidencia del diagnóstico](booking-timeout-diagnostic.json); script `demi-booking-timeout-diagnostic-uat.sql`. No se modificó la elegibilidad, JIT o configuración de tiempo.

Repetir motor/entrega capturada y las conversaciones de efectivo, derivación y validación con una sesión administrativa UAT válida. No se certifican Meta externo, puntualidad real ni aceptación funcional. Falta el mecanismo seguro de acceso en este entorno; se solicitó la información sin pedir secretos por chat. X y qué cuenta como intento de efectivo siguen pendientes; A07 permanece manual fuera de Demi. Elegibilidad/timeouts y perfil vivo completo siguen abiertos.

Fuenteaf412c40: [CI39834623014](https://github.com/mikevazquez/Demeter/actions/runs/39834623014) y [Supervisor39834623075](https://github.com/mikevazquez/Demeter/actions/runs/39834623075) SUCCESS. [Preview](https://demeterbueno-mpyak4czw-demeter3.vercel.app/admin/mas/demi) READY, deployment `dpl_EaJNeHBSLFNi63iU8uPyNZ5kKCAB`. Los checks de la cabeza documental posterior se registran aparte. PR borrador, Release No listo; sin merge ni activación de DEMI-PILOT-01. Producción, sus variables/despliegues y canales/adapters intactos.
