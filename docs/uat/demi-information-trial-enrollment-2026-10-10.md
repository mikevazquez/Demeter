# Demi: consultas durante pago, primer contacto y abono a inscripción

Rama: fix/demi-information-trial-enrollment. Base: 9ed3735.
Producción inspeccionada exclusivamente en lectura. Sin autorización de promoción para este alcance.

## Evidencia

Consulta observada: al pedir más información, ejecutó get_studio_information, search_class_availability, get_commercial_options y prepare_first_class_payment. Las instrucciones deterministas de pago sustituyeron la respuesta informativa.
Primer contacto observado: recibido como unsupported, sin referencia de anuncio disponible. El contenido original no está almacenado ni puede reconstruirse de los registros disponibles.

## Cambios

- Bloquear preparación de pago y reserva ante preguntas informativas reconocidas; devolver instrucción al modelo para responder con los datos consultados. Solicitudes explícitas de acción siguen disponibles.
- Normalizar mensajes unknown/unsupported a text cuando contienen text.body real; conservar medios y referencias.
- Cuando falta contenido, responder con saludo y pregunta útil, sin inventar el contenido o la actividad del anuncio.
- Pedir datos juntos al recibir el comprobante, sin esperar validación manual definitiva; reserva siempre sujeta a disponibilidad y validación.
- Regla comercial trial_payment_towards_enrollment configurada y leída de vuelta en sandbox hedouonyhynuvwbckdlg, estudio 9fe23cfa-fb47-4670-afeb-ed4a56433772. Sin modificar reglas de producción.

## Regla comercial

Para pagar el paquete el día de la primera clase, pagar antes $150 por la primera clase y seguir el flujo vigente de reserva. Si compra el paquete ese mismo día, aplicar esos $150 a la inscripción y cobrar el resto de inscripción más el precio íntegro del paquete. Con inscripción de $200: $50 más paquete. Si no compra paquete ese día: pago por primera clase. Sin devolución automática, créditos adicionales ni doble abono.

La operación administrativa se implementó en sandbox con get_trial_enrollment_credit_options y create_package_with_trial_enrollment_credit, tabla trial_enrollment_credits y migración 20261011005124. El pago original permanece en la venta de primera clase. La inscripción de la compra recibe un ajuste comercial de $150 vinculado al comprobante original; no se crea otro ingreso por esos $150 ni se descuenta el paquete. Sólo aplica con pago validado sin devolución, clase del mismo día local, inscripción requerida sin vigencia actual y liquidación completa del restante más paquete. Aplicación única por pago, venta original y reserva. Devolución o anulación del comprobante utilizado requiere resolver la compra vinculada; no se devuelve por separado. UAT de SQL: 13 variantes pasaron con rollback, incluidas autorización, pertenencia de pago, fecha, regla por tenant, falta de liquidación, reintento, segundo uso e integridad del dinero. Falta recorrido visual antes de aprobar D08.

## Matriz UAT

| Caso                                                                | Esperado                                                          | Verificación técnica                                    | UAT usuario                                              |
| ------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------- |
| D01 Pregunta por más información después de recibir datos bancarios | Responder información; conservar solicitud y evitar otro cobro    | Pruebas automatizadas pasan                             | Pasó conversación y estado D01/D02 en ejecución 3b03aaf5 |
| D02 Pregunta por ubicación, requisitos o precio                     | Permitir consultas y bloquear preparación del pago                | Pruebas automatizadas pasan                             | Pasó conversación y estado D01/D02 en ejecución 3b03aaf5 |
| D03 Pregunta y solicita reservar explícitamente                     | Mantener herramientas normales disponibles                        | Pruebas automatizadas pasan                             | Pendiente                                                |
| D04 Unsupported con texto recuperable y referencia de anuncio       | Procesar texto real y conservar referencia                        | Pruebas automatizadas pasan                             | Pendiente                                                |
| D05 Unsupported sin texto ni referencia, como captura               | Continuar con pregunta útil; no inventar intención                | Código revisado; falta recorrido por webhook de sandbox | Pendiente                                                |
| D06 Comprobante bancario recibido                                   | Pedir datos juntos; reserva condicionada a validación y cupo      | Mensaje y regresiones de comprobantes pasan             | Pendiente                                                |
| D07 Quiere pagar paquete el día de la clase                         | Explicar anticipo y abono a inscripción                           | Regla persistida y verificada en sandbox                | Pasó: $50 inscripción + $600 paquete; $800 acumulados    |
| D08 Compra paquete ese día                                          | Aplicar $150 una sola vez a inscripción; cobrar resto más paquete | Implementado; 13 variantes SQL pasan                    | Bloqueado: falta recorrido visual                        |
| D09 No compra paquete ese día                                       | Mantener $150 como primera clase                                  | Regla configurada; pendiente recorrido                  | Pendiente                                                |

Verificación: 81 pruebas en 11 archivos, TypeScript sin errores. ESLint de archivos modificados sin errores. Preview desplegado y primeras variantes UAT ejecutadas; matriz integral todavía pendiente. No promover hasta cerrar pendientes y recibir Autorizo promoción para la versión revisada.

## Ampliación: efectivo pendiente

Caso de efectivo diferido inspeccionado sólo en lectura: el paquete quedó pendiente de cobro sin reservas; la fecha guardada no coincidía con el día prometido. El registro real permanece intacto.

Cambios preparados:

- Panel Efectivo por cobrar en Hoy, independiente de reservas y del día de clase; enlace a la venta para registrar el cobro.
- Aviso de efectivo pendiente con importe en roster de Hoy y detalle de Agenda. No reutiliza el cobro de clase suelta para cobrar paquetes.
- Saldo calculado desde pagos y devoluciones; pago parcial muestra restante y pago completo elimina el pendiente.
- Función service_create_demi_cash_purchase_with_due_date aplicada exclusivamente en sandbox, mediante migración 20261011002732_demi_cash_promised_payment_date.sql. Conserva fecha prometida y nota, rechaza fechas pasadas o superiores a 90 días y no modifica la promesa en reintentos.
- Herramienta prepare_cash_package_purchase solicita fecha prometida en formato local; null cuando no se indicó. Confirmación muestra la fecha registrada.

| Caso                            | Esperado                                                                                  | Resultado observado                           | UAT integral                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------- |
| C01 Fecha prometida de efectivo | Conservar lunes como fecha local, no fecha de creación                                    | Aprobado en SQL sandbox para fecha explícita  | Pasó conversación: lunes 12 de octubre; confirmación y venta con fecha 2026-10-12 |
| C02 Paquete sin reserva         | Adeudo visible, sin cobro ni reserva ficticios                                            | Aprobado en SQL sandbox y pruebas de consulta | Pasó visual en Hoy: $600 pendientes, 0 reservas, 0 pagos al crear                 |
| C03 Reintento                   | Una sola venta y misma fecha                                                              | Aprobado en SQL sandbox                       | Pendiente recorrido conversacional                                                |
| C04 Fecha pasada                | Rechazar antes de crear venta                                                             | Aprobado en SQL sandbox                       | Aprobado técnico                                                                  |
| C05 Primera reserva             | Permitir una y comenzar vigencia                                                          | Aprobado en SQL sandbox                       | Falta visual del aviso                                                            |
| C06 Segunda reserva con deuda   | Bloquear hasta cobrar                                                                     | Aprobado en SQL sandbox                       | Pendiente conversación                                                            |
| C07 Cobro completo              | Registrar pago real, quitar pendiente y permitir siguiente reserva sin reiniciar vigencia | Aprobado en SQL sandbox y prueba de consulta  | Cobro visual pasó; falta siguiente reserva conversacional                         |
| C08 Cobro parcial               | Mostrar sólo saldo restante                                                               | Aprobado en prueba de consulta                | Pasó visual: pago ficticio $100, saldo $500 en venta y Hoy                        |
| C09 Error de consulta           | Mostrar error, no afirmar saldo cero                                                      | Aprobado en prueba de consulta                | Pendiente visual                                                                  |

SQL ejecutado: tests/demi-2-cash-human-uat.sql (7 verificaciones) y tests/demi-cash-promised-date-uat.sql (4 verificaciones), ambos en sandbox con rollback de fixtures. La migración de fecha queda aplicada en sandbox.

## UAT de Preview: ejecución 27f9c2cb

Preview de PR #265 listo, commit 2bd2739f395d7d0e91cd01df8faaf574ccc4f96d, deployment dpl_9QF5D4ynsMJS4BkjWLiWmsXUUDhc. Autenticación y selección de estudio sandbox correctas. No se modificó producción.

Estudio ficticio eef23197-19e6-4680-ad94-7268fe09809e. Identidad ficticia student_cash. Conversación c87592a2-26a8-45d1-91c0-0b5568bb632e; compra 3d839748-0fe7-4b0c-a4e1-06c9b68dd425; venta 93458f21-5c93-4806-ae59-1271473b6aeb.

- Mensaje: Quiero comprar el paquete de 8 clases. Lo pagaré el lunes en efectivo. Demi interpreta lunes 12 de octubre, informa $600, primera reserva permitida y segunda condicionada a cobro.
- Al confirmar Sí con la misma identidad, registra compra, confirma fecha y conserva $600 pendientes. Venta confirmada con payment_due_on=2026-10-12; ninguna reserva ni pago creados automáticamente.
- Selección del estudio ficticio: Hoy muestra Efectivo por cobrar, $600 y la fecha prometida, aunque no haya reserva.
- Cobro ficticio parcial desde detalle de venta: $100 efectivo. Venta muestra $500 restantes; Hoy muestra el mismo pendiente.
- Liquidación ficticia desde detalle: $500 efectivo. Venta muestra Pagada, saldo $0 y los dos pagos históricos. El panel de Hoy deja de mostrar el adeudo liquidado. Fecha de cobro pendiente se limpia. La adquisición conserva starts_on/expires_on=null porque aún no se reservó.

Estas variantes pasaron UAT ejecutado por Codex. No equivalen a aceptación del usuario ni a la aprobación de toda la matriz. Siguen pendientes las conversaciones informativas, primer contacto, reserva/bloqueo visual y el abono administrativo de $150; no solicitar promoción hasta cerrar ese alcance.

Evidencia visual de la variante parcial: [Hoy con $500 pendientes](evidence/demi-cash-partial-2026-10-11.jpg).

## Continuación: ejecución 3b03aaf5, 11 de octubre UTC

Preview de código d9392b4eba63d57f6e30beaa929d6ae894a69ec9: READY, entorno preview (target null), deployment dpl_EGQsee3jWfH4kLtuntG4EuK4Dhid. Rama sin fusionar; producción sin cambios.

Estudio ficticio 29af8ae6-1c55-497d-b53c-d6d7b6fc828d; conversación a28e6d7a-2c48-497d-89b5-b617c7e6cd3b. Las respuestas conversacionales se observaron en el preview anterior 4b82e581, cuyo código comercial y de información es idéntico; el commit posterior agrega escenarios de Meta al banco UAT.

- D01: después de recibir instrucciones bancarias, la pregunta por más información y ubicación produjo la dirección configurada, sin repetir datos bancarios. Los requisitos no estaban configurados: Demi canalizó a atención humana sin inventarlos. El caso humano fue resuelto mediante el banco de pruebas para continuar.
- D02: consulta por precio y duración respondió paquete de 8 clases $600, 30 días, inscripción $200 anual. No creó otra solicitud de pago.
- D07: explicó pagar primero $150; si compra el paquete el día de clase, abonar una vez a inscripción, pagar $50 restantes más paquete $600: $650 nuevos y $800 acumulados.
- Estado leído después de estas consultas: exactamente un grupo 404d31c9-30b1-4dc3-bda0-8390bb472e6f en awaiting_receipt, cero pagos nuevos y cero reservas nuevas. No se activó un paquete por explicar la excepción.
- Regresión SQL reejecutada contra sandbox: 4 variantes de fecha/efectivo, 13 variantes de abono a inscripción y 7 variantes de efectivo/control humano; todas pasaron. Cada script conserva rollback, sin dejar fixtures de esas pruebas.
- Regresión automatizada actual: 73 pruebas en 10 archivos, todas pasaron. TypeScript y ESLint de los cambios habían pasado; preview de código completo READY.

### Bloqueo verificable del recorrido visual

Al abrir el selector de archivo para enviar el comprobante ficticio, el navegador rechazó la operación por retained_data_restricted tras entrega nativa de credenciales. Su recuperación indicó crear un documento nuevo; esa recuperación y el reinicio del runtime devolvieron native credential state cannot be safely resumed. No se intentó acceder a credenciales ni sustituir el navegador con peticiones fuera de su API.

El comprobante no se considera enviado ni el caso D06 aprobado. Se conservan ejecución y conversación para retomar. Pendientes integrales: D03 solicitud mixta, D04/D05 webhook sintético con formatos unsupported, D06 comprobante/datos/reserva, D08 aplicación visual del abono, D09 primera clase sin compra; C03 reintento conversacional, C05 aviso en reserva/roster, C06 segunda reserva bloqueada, C07 reserva después de liquidar y C09 presentación de error. Los resultados técnicos correspondientes no sustituyen estas evidencias.

No se solicita autorización de promoción porque la matriz integral aún no está cerrada. Reanudar desde la ejecución 3b03aaf5 una vez recuperable el navegador; solicitar Autorizo promoción sólo al finalizar las variantes pendientes.

## Reanudación del 10 de octubre, 19:20 México

El navegador sigue bloqueado antes de cargar el banco. Se intentó abrir un documento nuevo, reiniciar el kernel y seleccionar el navegador existente por su ID; todos devolvieron que el estado nativo de credenciales no puede reanudarse. No hay otro controlador de navegador disponible en esta sesión. No se enviaron comprobantes ni se modificaron registros mediante UI en esta reanudación.

Se completó verificación técnica adicional relacionada con los pendientes:

| Pendiente                 | Verificación adicional                                                                                                                  | Resultado                   | Qué falta para UAT integral           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------- |
| D03 Solicitud mixta       | demi-information-intent: solicitudes explícitas conservan acciones                                                                      | Pasó                        | Conversación real mixta               |
| D04 Texto unsupported     | Extractor real: conserva texto y referencia de anuncio                                                                                  | Pasó                        | Webhook sintético en banco            |
| D05 Unsupported vacío     | Extractor real: no fabrica texto ni referencia; contrato webhook previamente pasó                                                       | Pasó                        | Respuesta capturada por banco         |
| D06 Comprobante y datos   | Runtime de comprobante y SQL de grupo: pago antes de perfiles, datos, reserva provisional, revisión y repetición sin duplicados         | Pasó                        | Archivo y conversación desde UI       |
| D09 Sin compra de paquete | SQL de crédito de prueba: adquisición de primera clase conserva vigencia, pago y consumo; reagendar no convierte el pago en inscripción | Pasó como regresión técnica | Recorrido de esta variante sin compra |
| C09 Error al consultar    | Prueba de consulta de efectivo incluye propagación del error                                                                            | Pasó                        | Presentación del error en UI          |

Ejecutados tests/demi-2-group-uat.sql: 19 verificaciones pasaron; tests/demi-2-trial-credit-uat.sql: 13 verificaciones pasaron. Ambos en sandbox, con rollback. Son 32 comprobaciones adicionales, algunas compartidas entre scripts; no se presentan como 32 casos nuevos distintos. Reejecutadas 27 pruebas focalizadas en 5 archivos: pasaron, incluido extractor Meta real. TypeScript sin errores en el estado actual.

Estado: los pendientes visuales/conversacionales se mantienen abiertos por bloqueo del entorno; no hay autorización ni promoción de producción. La única acción externa necesaria para continuar ese recorrido es disponer de un runtime nuevo de navegador. Reiniciar sólo el kernel de esta conversación no lo recupera.

Para retomar en una conversación con navegador nuevo:

> Continúa los UAT pendientes de Demi en mikevazquez/Demeter, rama fix/demi-information-trial-enrollment, PR #265. Lee docs/uat/demi-information-trial-enrollment-2026-10-10.md. Recupera la ejecución 3b03aaf5-b014-4277-bc69-cef7aa2ba271 en el banco sandbox; no crees escenarios desde cero ni modifiques producción. Cierra D03–D06, D08–D09 y los recorridos C03/C05/C06/C07/C09 pendientes. Conserva históricos y evidencias. Los resultados SQL no sustituyen la UAT visual. Solicita autorización de promoción únicamente cuando todos los casos del alcance estén cerrados.

## Reanudación del 10 de octubre, 19:28 México

Se leyó la matriz y se verificó PR #265: borrador, abierto y sin fusionar. Código revisado: `6d2dcc57552a9adc6f86ba87d448a312b3e778e9`. El entorno cloud de esta reanudación inició correctamente, con conectividad y variables configuradas listas, pero no expuso una herramienta de navegador confiable.

La conexión mediante la skill Browser falló antes de crear o seleccionar un navegador con el mensaje literal:

```text
Browser use requires a trusted Node REPL browser service
```

Este bloqueo es distinto del error de credenciales nativas de la ejecución anterior: disponer de un entorno cloud listo no proporciona por sí solo el controlador de navegador requerido. No se usó otro mecanismo de automatización ni peticiones directas para sustituir el recorrido visual.

No fue posible recuperar en la UI la ejecución `3b03aaf5-b014-4277-bc69-cef7aa2ba271`. No se crearon escenarios, no se enviaron mensajes ni comprobantes, y no se modificaron estados de sandbox o producción. Los históricos y las evidencias previas permanecen conservados. No se atribuye ningún resultado nuevo a la ejecución.

Siguen abiertos D03–D06, D08–D09 y C03/C05/C06/C07/C09. No se solicita autorización de promoción. Para continuar hace falta una sesión que exponga la herramienta de navegador confiable indicada por la skill Browser, además del entorno cloud.

## Cierre del recorrido UAT, 10 de octubre de 2026, México

Esta sección actualiza el estado de los pendientes anteriores; conserva sus históricos, bloqueos y evidencias. Se verificó primero el control de un navegador nuevo con Chromium y Playwright, y después se recuperó desde la UI la ejecución `3b03aaf5-b014-4277-bc69-cef7aa2ba271`. No se pulsó Crear escenarios aislados ni se recrearon fixtures. Estudio conservado: `29af8ae6-1c55-497d-b53c-d6d7b6fc828d`.

Versión final de código recorrida: `6521fe45b77cbacbe339d91f4bad908ea867c4ad`, deployment Preview `dpl_6Cu1z4RJ56DmtUaAshBVVzxcWcC3`, [banco UAT](https://demeterbueno-4n8lm9xko-demeter3.vercel.app/admin/mas/demi/uat). CI completo pasó en la ejecución `38103442551`: formato, lint, TypeScript, comparación de pruebas y build. PR #265 sigue sin fusionar. No se modificó producción.

Se conservaron las descargas iniciales, intermedias y finales de la ejecución y las capturas del navegador. Las marcas de tiempo ISO de las descargas están en UTC; la fecha de esta sección y las fechas comerciales corresponden a México. El resumen verificable está en [resultados de la ejecución](evidence/demi-3b03aaf5-2026-10-10-results.json).

### Casos pendientes cerrados por Codex

| Caso                                | Resultado observado                                                                                                                                                                                                                                                                                                                                               | Estado |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| D03 Pregunta y reserva explícita    | Respondió ubicación y precio y preparó una solicitud de primera clase. Conservó instrucciones exactas, pidió comprobante antes de datos y no anunció reserva confirmada. Repetir la consulta de la misma solicitud conservó el avance. No creó pagos ni reservas por informar.                                                                                    | Pasó   |
| D04 Unsupported con texto y anuncio | Enviado desde la UI por el webhook real. El extractor lo normalizó a text con el cuerpo escrito; la evidencia captura source_type=ad, source_id=UAT-AD-POLE, título y cuerpo del anuncio. Demi respondió ubicación y precio.                                                                                                                                      | Pasó   |
| D05 Unsupported vacío               | Evidencia normalizada sin referencia, medios ni contenido del anuncio. Respondió con saludo y pregunta útil, sin inventar una actividad o intención.                                                                                                                                                                                                              | Pasó   |
| D06 Comprobante y datos             | Una imagen marcada ficticia/sin valor fue rechazada sin pago ni reserva. Una segunda imagen simulada, usada únicamente en el banco aislado, recorrió recepción: pidió nombre y celular juntos antes de validar; los datos crearon una reserva provisional con aviso de revisión y revocación. La validación del equipo desde la UI registró un solo pago de $150. | Pasó   |
| D08 Abono administrativo            | Desde Nueva venta se aplicaron $150 a inscripción: $50 de inscripción más $600 íntegros de paquete. Registró $650 nuevos, saldo cero, vínculo al pago original y un solo abono. Otra visita a Nueva venta ya no ofreció reutilizar el abono.                                                                                                                      | Pasó   |
| D09 Primera clase sin paquete       | Antes de D08, la conversación confirmó que los $150 cubrían únicamente la primera clase y no obligaban a comprar paquete o inscripción. La descarga de ese momento conservó la reserva provisional, sin compra de paquete ni inscripción para esa persona.                                                                                                        | Pasó   |
| C03 Reintento de efectivo           | Reenvío del provider_id original devolvió duplicate_already_handled. Una nueva confirmación conversacional de esa misma compra respondió que no crearía otra. Se conserva una sola compra, venta y adquisición, sin nueva preparación pendiente. La fecha prometida fue 2026-10-12; se limpió al liquidar, conforme al flujo vigente.                             | Pasó   |
| C05 Primera reserva y aviso         | La primera reserva fue permitida con $600 pendientes e inició vigencia 2026-10-10 → 2026-11-09. Hoy, el roster desplegado y el detalle de Agenda mostraron Efectivo pendiente · $600.00.                                                                                                                                                                          | Pasó   |
| C06 Segunda reserva con deuda       | Demi consultó disponibilidad y bloqueó la segunda reserva por efectivo pendiente. No creó esa reserva ni un pago para resolver el bloqueo.                                                                                                                                                                                                                        | Pasó   |
| C07 Cobro y siguiente reserva       | Cobro simulado desde venta: $100 dejó saldo $500; otros $500 liquidaron el adeudo, conservaron ambos pagos y quitaron el panel de pendiente. La conversación posterior preparó y confirmó una segunda reserva con el mismo paquete, sin reiniciar su vigencia.                                                                                                    | Pasó   |
| C09 Error al consultar              | Página real de Next.js de esta rama ejecutada localmente contra Sandbox. Se inyectó HTTP 503 sólo en la consulta de demi_cash_purchases del estudio de esta ejecución. La UI mostró No se pudieron consultar los pagos en efectivo pendientes y no afirmó saldo cero. La inyección se retiró; no se cambiaron permisos ni registros para provocar el fallo.       | Pasó   |

D01, D02 y D07 conservan sus resultados previos. C01, C02 y C08 se observaron nuevamente en esta ejecución; C04 conserva su validación técnica previa. Este cierre corresponde al alcance D/C del PR; no aprueba automáticamente las 18 categorías generales del banco ni comprueba la entrega externa de Meta o pagos reales.

### Hallazgos corregidos y trazabilidad

- La variante mixta sustituyó inicialmente la información con instrucciones de pago. Se corrigió para continuar la respuesta informativa y añadir las instrucciones exactas. El último recorrido respondió precio y ubicación sin cambiar el orden comprobante → datos → reserva provisional → revisión.
- El formulario del banco restablecía visualmente la persona al enviar. Ahora conserva la identidad seleccionada; se verificó un turno posterior sin volver a seleccionar a student_cash y otro de companion. También muestra el procesamiento desde el envío para no descargar evidencia anterior mientras aún responde Demi.
- El banco registra el mensaje de WhatsApp normalizado y el escenario utilizado, incluidos los campos de referencia de anuncio. Son datos del extractor real, junto con respuesta y estado del webhook, no respuestas prefabricadas.
- El mock del orquestador omitía la nueva dependencia information-intent; se completó y se añadieron regresiones de pregunta mixta. Se corrigió además el formato del documento que impedía pasar CI. No se eliminaron ni renombraron pruebas.
- Se conservan también los intentos bloqueados de confirmación extensa, la resolución del caso humano de prueba y el rechazo de la imagen sin valor. La compra válida se completó con una confirmación separada, Sí, confirmo. No se amplió el vocabulario de autorización de compras.

Identificadores de revisión:

- Primera clase: grupo `404d31c9-30b1-4dc3-bda0-8390bb472e6f`; reserva `812b388f-d99c-494d-8274-f49657fd7305`; venta original `18bec378-18bf-4c07-807a-57341a82def0`; pago original `4ef08f50-b6bb-4973-8b09-6251ae53604b`.
- Compra con abono: venta `715f047b-bc02-4133-8054-fc1a3fee8a21`. Lectura posterior: pago original 15000 centavos intacto, abono 15000 y pago nuevo 65000; $800 acumulados, sin descontar el paquete ni registrar otro ingreso por el abono.
- Efectivo: compra `d7b091ed-afa2-485c-a8b5-148eeae1c7b4`; venta `a0e581e4-40fc-45e8-b5e8-4a63faa20dc8`; adquisición `fefb2a2f-87c3-46d6-8027-c66439dd8917`. Reservas `fd59db1d-dd43-488e-b2ed-c495a8eeb10e` y `49cd625e-6ef8-4293-b7c4-ecc706d98020`; dos pagos de 10000 y 50000 centavos; vigencia sin cambios.

Capturas conservadas:

- [D03: información y solicitud de pago](evidence/demi-D03-new-request-final-2026-10-10.png), [D04: texto con anuncio](evidence/demi-D04-final-2026-10-10.png), [D05: mensaje vacío](evidence/demi-D05-final-2026-10-10.png).
- [D06: datos y reserva provisional](evidence/demi-D06-data-2026-10-10.png), [D08: venta con abono aplicado](evidence/demi-D08-sale-2026-10-10.png).
- [C03: confirmación sin otra compra](evidence/demi-C03-confirmation-retry-final-2026-10-10.png), [C05: roster](evidence/demi-C05-roster-open-2026-10-10.png), [C05: Agenda](evidence/demi-C05-agenda-2026-10-10.png).
- [C07: venta liquidada](evidence/demi-C07-paid-2026-10-10.png), [C07: Hoy sin adeudo](evidence/demi-C07-no-debt-2026-10-10.png), [C09: consulta fallida](evidence/demi-C09-query-error-2026-10-10.png).

Estado: pendientes visuales y conversacionales de este alcance cerrados por Codex; aceptación del usuario y promoción pendientes. La promoción requiere aprobación explícita de la versión revisada y coordinar código, las dos migraciones de esta rama y la regla comercial de producción. No se deben trasladar fixtures, comprobantes, compras, pagos ni conversaciones del banco UAT a producción.
