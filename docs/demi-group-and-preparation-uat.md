# Demi: grupos con poles e indicaciones de clase

Estado: los ocho escenarios conversacionales GRP-A–F e INF-A–B pasaron en Sandbox el 12 de octubre de 2026 (Ciudad de México), y Mike aceptó el UAT el 13 de octubre. La promoción a producción sigue pendiente de autorización explícita; producción no se modificó.

Preview verificado: https://demeterbueno-7zn7uhv7m-demeter3.vercel.app (READY, commit 0d2a95215a10f9e5906d1c9f46201817ac3c52c3). El build verificó la conexión a `hedouonyhynuvwbckdlg`. La aplicación carga y solicita la sesión del estudio.

Validación de código: 1,263/1,263 pruebas aprobadas, typecheck aprobado, lint de archivos modificados sin errores y una advertencia preexistente. Se replicó el prompt activo en la configuración de Demi del estudio fuente de sandbox, conservando la versión anterior y registrando la nueva. El esquema de producción y su guard original se verificaron intactos al cerrar.

## Información guardada

Se verificó en producción, sin escritura, que el prompt activo conserva 20,020 caracteres y fue actualizado el 11 de octubre de 2026 a las 02:42:48 UTC. Incluye para Exotic: «rodilleras (indispensables, porque se trabaja mucho en el piso), ropa cómoda que deje la piel en contacto con el tubo».

La herramienta devolvió `first_class_preparation=null` a las 21:51:28 UTC del 12 de octubre porque sólo consultaba la regla específica `first_class_preparation`, ausente. El orquestador prohibía usar otra fuente. El prompt no se perdió: sus instrucciones quedaron ignoradas por esa restricción.

La corrección da prioridad a la regla específica y, si está vacía, extrae exclusivamente las líneas explícitas «Qué llevar» del prompt activo para disciplinas activas. No extrae precios, horarios, cupos ni políticas antiguas. Conserva la respuesta de dato faltante cuando no existe una indicación explícita.

## Reservas

Nuevo orden para grupos con poles: preparar pago → recibir comprobante → nombres y teléfonos juntos → selección individual de poles → reservas provisionales sujetas a revisión. La selección devuelve etiquetas y capacidad reales. Se validan todas las elecciones antes de crear perfiles o reservas. Los reintentos recuperan las reservas existentes.

Se corrigieron dos requisitos detectados al ejecutar la prueba: el trigger de recursos ahora conserva el uso de valores del salón cuando no existe la tabla de valores de actividad; el preview de primera clase reconoce un recurso válido durante la activación de un intento de pago. El preview ordinario continúa exigiendo selección. Estas correcciones sólo se aplicaron a sandbox.

## Matriz de UAT

Mike aprobó el resultado de las pruebas técnicas de sandbox. Esta aprobación no demuestra por sí sola que se haya ejecutado una conversación real en el preview; esos resultados se conservan como pendientes para no atribuirles pruebas que no ocurrieron.

| Caso                                               | Validación técnica                                      | UAT conversacional                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| GRP-A: dos primeras clases con poles, pago primero | Aprobada en DB; no crea fichas ni reservas              | Pasó en conversación: total, horario y pago primero; no pidió poles ni datos personales antes del comprobante |
| GRP-B: completar sin comprobante                   | Aprobada; bloquea creación                              | Pasó: rechazó apartar antes del comprobante y pidió enviarlo                                                  |
| GRP-C: comprobante sin datos personales            | Aprobada; cero fichas y reservas                        | Pasó: pidió nombres completos y teléfonos de 10 dígitos; antes, cero perfiles/reservas                        |
| GRP-D: elegir un pole por participante             | Aprobada; dos opciones reales y dos asignaciones        | Pasó: ofreció 2 poles; asignó uno por persona y conservó la selección                                         |
| GRP-E: capacidad y reintento                       | Aprobada; rechaza sobreocupación y evita duplicados     | Pasó: rechazó compartir un pole con cupo 1, sugirió alternativa y reintento sin duplicados                    |
| GRP-F: mismo caso sin poles                        | Aprobada en DB; conserva flujo previo                   | Pasó: sin selección de poles, completó tras comprobante y datos                                               |
| INF-A: ropa para Exotic guardada en prompt         | Aprobada en runtime; fuentes moderna y legacy           | Pasó: respondió rodilleras y ropa del prompt, sin «no configurada»                                            |
| INF-B: prioridad y dato ausente                    | Aprobada en runtime; regla específica gana y no inventa | Pasó: regla específica reemplazó el prompt; sin color configurado, no inventó                                 |

Pruebas de DB: 9 aserciones con poles y 5 sin poles, comprobante y personas sintéticos, BEGIN/ROLLBACK. No se enviaron mensajes WhatsApp reales. Estas pruebas no validan reconocimiento de imagen ni comportamiento de modelo real.

Scripts: `scripts/demi-group-resource-fix-uat.sql` y `scripts/demi-group-no-resource-regression.sql`. El script `scripts/demi-group-resource-regression.sql` conserva la reproducción anterior y no debe usarse como prueba de aceptación tras la corrección.

## Promoción y reversión

La aprobación previa registró el UAT técnico de Sandbox. La ejecución conversacional posterior está documentada más abajo y los ocho casos pasaron; queda pendiente la aceptación final del resultado y la autorización específica de promoción. No se modificó producción. Antes de promover: matriz UAT cerrada, autorización específica y comprobar las definiciones vigentes. Las migraciones abortan si cambió el fragmento esperado; conservan las reglas de precios e identidad de cada entorno. Exportar las cuatro definiciones modificadas como reversión antes de aplicar a producción y restaurar sólo código si se requiere, sin borrar comprobantes, ventas, participantes ni reservas históricas.

## Ejecución conversacional real del preview — 12 oct 2026

Se corrigió en Sandbox la preparación del banco: la función copiaba dos veces las políticas de atención humana y fallaba con la restricción única. Migración registrada en `supabase/migrations/20261012232400_demi_uat_remove_duplicate_handoff_seed.sql`; el cambio elimina únicamente la segunda copia redundante. No toca producción.

Ejecución: `ad93f428-125f-498a-89e4-2f5da2f6572a`; estudio ficticio: `b91b5227-24bf-4b86-8cf1-044997164102`. Modelo real, transporte capturado, sin entrega externa.

| Paso                                      | Resultado                                                                                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pregunta por primera clase para dos       | Demi respondió $300 total ($150 por persona), ofreció transferencia y mostró datos ficticios con “NO TRANSFERIR”; no pidió datos de participantes.         |
| Elección de horario                       | `prepare_group_booking` creó grupo `965ebbae-7d5b-4022-a02b-13fa91566701` en `awaiting_receipt`; 2 participantes, $300 MXN, `reservation_confirmed=false`. |
| Estado de reservas en la sesión elegida   | 0 reservas vinculadas al grupo antes de recibir comprobante.                                                                                               |
| Completar sin comprobante                 | Sigue pendiente: el banco no permite simular revisión aprobada si el grupo continúa `awaiting_receipt`; no se aceptó una transferencia ni se creó reserva. |
| Recibir comprobante y pedir datos después | Pendiente de adjuntar un archivo ficticio de comprobante al mensaje.                                                                                       |
| Ropa para Exotic                          | Pendiente en conversación: el fixture aislado sólo activa Pole Fitness, por lo que no sirve para validar Exotic.                                           |

La ejecución confirma la barrera principal antes del comprobante, pero no cierra GRP-A–F ni INF-A–B. No se declara UAT conversacional aprobado. La base Sandbox conserva la ejecución y evidencia para retomar; producción no fue modificada.

## Regresión M06: estado de pago después del comprobante — 13 oct 2026

Se corrigió en Sandbox el estado comercial prematuro de las reservas grupales por transferencia: el trigger `sync_trial_transfer_commercial_status` mantiene `payment_pending` mientras el intento está `provisional_active` y sólo cambia a `paid` cuando el intento pasa a `validated`. Migración: `supabase/migrations/20261013052000_demi_trial_payment_reservation_status.sql`. No se aplicó a producción.

Ejecución conversacional del preview: `d170b680-a671-4be3-a9f1-4c0fd0d22b2f`; conversación: `bac86936-fbfb-4a83-99f3-019145e16797`; estudio ficticio: `2c3a6944-9fa2-40a3-84de-f888b5b76a61`; grupo: `d206620b-bf58-4da8-bb01-837d94a8cf85`.

| Paso                                     | Resultado                                                                                                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pregunta de grupo y selección de horario | Demi dio el costo total de $300 y datos de transferencia UAT marcados **NO TRANSFERIR**. Grupo en `awaiting_receipt`; cero reservas del grupo.                            |
| Comprobante                              | Se registró con el simulador de comprobante sintético; sin transferencia bancaria real. Grupo pasó a `awaiting_participants`.                                             |
| Nombres y teléfonos                      | Demi creó las dos reservas sólo después de recibirlos. Ambas quedaron `payment_pending`: `4e555ea6-f0d1-490f-be7b-1d0889516990` y `6bbe5a7b-16ca-4eff-a98b-bef6fb59b1c7`. |
| Validación humana ficticia               | Ambos intentos pasaron a `validated`; las reservas cambiaron a `paid` y se registraron dos pagos UAT de $150. No se movió dinero.                                         |

Las pruebas dinámicas `tests/demi-2-group-uat.sql` (19 variantes) y `tests/demi-2-rejection-scope-uat.sql` (rechazo sin marcar la reserva como pagada) pasaron con datos sintéticos y rollback. M06 quedó como **Pasó todas las variantes** en la matriz de la ejecución. No se enviaron mensajes externos de Meta. Esto cierra la regresión de M06; no aprueba automáticamente los otros casos conversacionales GRP-A–F ni INF-A–B, ni autoriza promoción.

## UAT conversacional completado — 12 oct 2026, Sandbox

Preview del PR: https://demeterbueno-git-codex-demi-group-flow-regression-demeter3.vercel.app  
Commit probado: `2996896f5e602dd5620acb04d575824204ba0e8d`.  
Ejecución aislada: `0f5db82d-c1b8-4d88-a50a-bbf61c962994`; estudio ficticio: `2738cbcc-cca7-40cb-9976-ba1fc9badba0`. Transporte interno capturado; ninguna respuesta se envió a WhatsApp/Meta.

El banco aislado sólo trae Pole Fitness sin recurso obligatorio. Para evaluar GRP-D/E se añadió únicamente a este estudio de prueba una sesión con dos poles UAT de capacidad uno. Para INF-A/B se activó Exotic Pole en este fixture; se usó el prompt clonado de 20,020 caracteres. La regla `first_class_preparation` creada para la prueba fue sintética, se desactivó al terminar y no se tocó la configuración fuente ni producción.

| Caso  | Resultado conversacional y evidencia de estado                                                                                                                                                                                   |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GRP-A | Demi cotizó $300 para dos, listó horarios y explicó transferencia primero; no solicitó datos personales ni poles antes del comprobante. Grupo `15abf68c-f9ac-4a73-b48d-9fdf93910650` quedó `awaiting_receipt`, con 0 reservas.   |
| GRP-B | Ante “apártalas aunque no tenga comprobante”, rechazó apartar y volvió a pedir el comprobante. El mismo grupo siguió sin recibo y sin reservas.                                                                                  |
| GRP-C | Tras comprobante sintético —sin transferencia real— solicitó ambos nombres y celulares de 10 dígitos juntos. Antes de compartirlos: 0 perfiles y 0 reservas; estado `awaiting_participants`.                                     |
| GRP-D | En `Pole Fitness UAT`, ofreció `Pole UAT 1` y `Pole UAT 2`; tras confirmar Ana/1 y Bety/2, las asignaciones guardadas coincidieron y se crearon exactamente dos reservas.                                                        |
| GRP-E | Rechazó que ambas usaran Pole 1 por capacidad 1, explicó el motivo y sugirió Ana/1 y Bety/2. La selección corregida creó dos reservas; el mensaje de confirmación repetido no duplicó ninguna.                                   |
| GRP-F | En la sesión sin poles, el flujo mantuvo el orden comprobante → datos y creó dos reservas sin pedir asignaciones de recurso. Las dos quedaron `payment_pending`.                                                                 |
| INF-A | Con la regla específica ausente, respondió rodilleras y ropa cómoda que deje la piel en contacto con el tubo para Exotic, usando lo guardado en el prompt.                                                                       |
| INF-B | Con regla específica sintética “únicamente camiseta azul”, contestó únicamente eso; al desactivar la regla y preguntar el color, dijo que no hay uno específico y limitó la respuesta a las indicaciones presentes en el prompt. |

Grupo sin poles: `15abf68c-f9ac-4a73-b48d-9fdf93910650`, conversación `e4599bbd-cf0f-43f7-8ddf-fbbcd784a034`, reservas `b2b3e6e9-493c-4faf-8df3-888b5050816a` y `731eef17-060c-499c-bcea-868eda134c6b`.  
Grupo con poles: `1f92f281-fc9a-4b72-9d4c-48e9789614a1`, conversación `e95aa34e-9c8b-4b58-9ce3-60a1a0d4e907`, reservas `543f9c5b-92e0-4557-96d6-f1da9fead25b` y `27566209-4863-4899-80ab-adebea6198a4`; asignaciones a Pole UAT 1/2 verificadas en `reservation_resource_assignments`.

No se validó ningún pago grupal. El comprobante fue sintético, las reservas siguen `payment_pending`, no se movió dinero, no se enviaron mensajes externos y no se modificó producción. La matriz de 18 macrocasos es una suite distinta; esta corrida cerró específicamente GRP-A–F e INF-A–B. La promoción aún requiere aceptación del resultado y autorización específica.
