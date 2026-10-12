# Demi: grupos con poles e indicaciones de clase

Estado: corrección en sandbox. UAT conversacional pendiente; promoción no autorizada para este alcance.

## Información guardada

Se verificó en producción, sin escritura, que el prompt activo conserva 20,020 caracteres y fue actualizado el 11 de octubre de 2026 a las 02:42:48 UTC. Incluye para Exotic: «rodilleras (indispensables, porque se trabaja mucho en el piso), ropa cómoda que deje la piel en contacto con el tubo».

La herramienta devolvió `first_class_preparation=null` a las 21:51:28 UTC del 12 de octubre porque sólo consultaba la regla específica `first_class_preparation`, ausente. El orquestador prohibía usar otra fuente. El prompt no se perdió: sus instrucciones quedaron ignoradas por esa restricción.

La corrección da prioridad a la regla específica y, si está vacía, extrae exclusivamente las líneas explícitas «Qué llevar» del prompt activo para disciplinas activas. No extrae precios, horarios, cupos ni políticas antiguas. Conserva la respuesta de dato faltante cuando no existe una indicación explícita.

## Reservas

Nuevo orden para grupos con poles: preparar pago → recibir comprobante → nombres y teléfonos juntos → selección individual de poles → reservas provisionales sujetas a revisión. La selección devuelve etiquetas y capacidad reales. Se validan todas las elecciones antes de crear perfiles o reservas. Los reintentos recuperan las reservas existentes.

Se corrigieron dos requisitos detectados al ejecutar la prueba: el trigger de recursos ahora conserva el uso de valores del salón cuando no existe la tabla de valores de actividad; el preview de primera clase reconoce un recurso válido durante la activación de un intento de pago. El preview ordinario continúa exigiendo selección. Estas correcciones sólo se aplicaron a sandbox.

## Matriz de UAT

| Caso                                               | Validación técnica                                      | UAT conversacional                                                         |
| -------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------- |
| GRP-A: dos primeras clases con poles, pago primero | Aprobada en DB; no crea fichas ni reservas              | Pendiente: recibir total/datos de pago sin pedir poles ni datos personales |
| GRP-B: completar sin comprobante                   | Aprobada; bloquea creación                              | Pendiente: Demi pide comprobante sin anunciar reserva                      |
| GRP-C: comprobante sin datos personales            | Aprobada; cero fichas y reservas                        | Pendiente: pide juntos nombres y teléfonos de diez dígitos                 |
| GRP-D: elegir un pole por participante             | Aprobada; dos opciones reales y dos asignaciones        | Pendiente: presenta opciones y conserva datos al elegir                    |
| GRP-E: capacidad y reintento                       | Aprobada; rechaza sobreocupación y evita duplicados     | Pendiente: explica nueva elección sin falsa escalación                     |
| GRP-F: mismo caso sin poles                        | Aprobada en DB; conserva flujo previo                   | Pendiente: completar conversación                                          |
| INF-A: ropa para Exotic guardada en prompt         | Aprobada en runtime; fuentes moderna y legacy           | Pendiente: responde rodilleras y ropa indicada sin «no configurada»        |
| INF-B: prioridad y dato ausente                    | Aprobada en runtime; regla específica gana y no inventa | Pendiente: confirmar ambas respuestas                                      |

Pruebas de DB: 9 aserciones con poles y 5 sin poles, comprobante y personas sintéticos, BEGIN/ROLLBACK. No se enviaron mensajes WhatsApp reales. Estas pruebas no validan reconocimiento de imagen ni comportamiento de modelo real.

Scripts: `scripts/demi-group-resource-fix-uat.sql` y `scripts/demi-group-no-resource-regression.sql`. El script `scripts/demi-group-resource-regression.sql` conserva la reproducción anterior y no debe usarse como prueba de aceptación tras la corrección.

## Promoción y reversión

No se modificó producción. Antes de promover: UAT de esta matriz, autorización específica y comprobar las definiciones vigentes. Las migraciones abortan si cambió el fragmento esperado; conservan las reglas de precios e identidad de cada entorno. Exportar las cuatro definiciones modificadas como reversión antes de aplicar a producción y restaurar sólo código si se requiere, sin borrar comprobantes, ventas, participantes ni reservas históricas.
