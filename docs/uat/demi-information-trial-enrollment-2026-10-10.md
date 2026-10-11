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

Esta entrega configura la comunicación de la excepción. No introduce una reasignación contable automática ni cambia el cobro administrativo. La operación de abono requiere implementación y UAT propios antes de activar la excepción en producción; conservar y referenciar el pago original, aplicación única, fecha local de clase, pago válido y venta de paquete.

## Matriz UAT

| Caso                                                                | Esperado                                                          | Verificación técnica                                    | UAT usuario              |
| ------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------- | ------------------------ |
| D01 Pregunta por más información después de recibir datos bancarios | Responder información; conservar solicitud y evitar otro cobro    | Pruebas automatizadas pasan                             | Pendiente                |
| D02 Pregunta por ubicación, requisitos o precio                     | Permitir consultas y bloquear preparación del pago                | Pruebas automatizadas pasan                             | Pendiente                |
| D03 Pregunta y solicita reservar explícitamente                     | Mantener herramientas normales disponibles                        | Pruebas automatizadas pasan                             | Pendiente                |
| D04 Unsupported con texto recuperable y referencia de anuncio       | Procesar texto real y conservar referencia                        | Pruebas automatizadas pasan                             | Pendiente                |
| D05 Unsupported sin texto ni referencia, como captura               | Continuar con pregunta útil; no inventar intención                | Código revisado; falta recorrido por webhook de sandbox | Pendiente                |
| D06 Comprobante bancario recibido                                   | Pedir datos juntos; reserva condicionada a validación y cupo      | Mensaje y regresiones de comprobantes pasan             | Pendiente                |
| D07 Quiere pagar paquete el día de la clase                         | Explicar anticipo y abono a inscripción                           | Regla persistida y verificada en sandbox                | Pendiente conversacional |
| D08 Compra paquete ese día                                          | Aplicar $150 una sola vez a inscripción; cobrar resto más paquete | Pendiente implementación del abono administrativo       | Pendiente                |
| D09 No compra paquete ese día                                       | Mantener $150 como primera clase                                  | Regla configurada; pendiente recorrido                  | Pendiente                |

Verificación: 55 pruebas en 9 archivos, TypeScript sin errores. ESLint de archivos modificados sin errores. No hay despliegue del nuevo código ni UAT end to end aprobado. No promover hasta cerrar pendientes y recibir Autorizo promoción para la versión revisada.

## Ampliación: efectivo pendiente

Caso de efectivo diferido inspeccionado sólo en lectura: el paquete quedó pendiente de cobro sin reservas; la fecha guardada no coincidía con el día prometido. El registro real permanece intacto.

Cambios preparados:

- Panel Efectivo por cobrar en Hoy, independiente de reservas y del día de clase; enlace a la venta para registrar el cobro.
- Aviso de efectivo pendiente con importe en roster de Hoy y detalle de Agenda. No reutiliza el cobro de clase suelta para cobrar paquetes.
- Saldo calculado desde pagos y devoluciones; pago parcial muestra restante y pago completo elimina el pendiente.
- Función service_create_demi_cash_purchase_with_due_date aplicada exclusivamente en sandbox, mediante migración 20261011002732_demi_cash_promised_payment_date.sql. Conserva fecha prometida y nota, rechaza fechas pasadas o superiores a 90 días y no modifica la promesa en reintentos.
- Herramienta prepare_cash_package_purchase solicita fecha prometida en formato local; null cuando no se indicó. Confirmación muestra la fecha registrada.

| Caso                            | Esperado                                                                                  | Resultado observado                           | UAT integral                       |
| ------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------- |
| C01 Fecha prometida de efectivo | Conservar lunes como fecha local, no fecha de creación                                    | Aprobado en SQL sandbox para fecha explícita  | Falta conversacional con lunes     |
| C02 Paquete sin reserva         | Adeudo visible, sin cobro ni reserva ficticios                                            | Aprobado en SQL sandbox y pruebas de consulta | Falta visual en Hoy                |
| C03 Reintento                   | Una sola venta y misma fecha                                                              | Aprobado en SQL sandbox                       | Pendiente recorrido conversacional |
| C04 Fecha pasada                | Rechazar antes de crear venta                                                             | Aprobado en SQL sandbox                       | Aprobado técnico                   |
| C05 Primera reserva             | Permitir una y comenzar vigencia                                                          | Aprobado en SQL sandbox                       | Falta visual del aviso             |
| C06 Segunda reserva con deuda   | Bloquear hasta cobrar                                                                     | Aprobado en SQL sandbox                       | Pendiente conversación             |
| C07 Cobro completo              | Registrar pago real, quitar pendiente y permitir siguiente reserva sin reiniciar vigencia | Aprobado en SQL sandbox y prueba de consulta  | Pendiente pantalla administrativa  |
| C08 Cobro parcial               | Mostrar sólo saldo restante                                                               | Aprobado en prueba de consulta                | Pendiente pantalla administrativa  |
| C09 Error de consulta           | Mostrar error, no afirmar saldo cero                                                      | Aprobado en prueba de consulta                | Pendiente visual                   |

SQL ejecutado: tests/demi-2-cash-human-uat.sql (7 verificaciones) y tests/demi-cash-promised-date-uat.sql (4 verificaciones), ambos en sandbox con rollback de fixtures. La migración de fecha queda aplicada en sandbox.

El código de pantallas y conversación todavía no se ha desplegado. Acceso directo Vercel: conexión principal devolvió 403 de acceso al equipo; conexión alternativa 404 de proyecto. Sin CLI Vercel autenticado disponible. Esto impide afirmar UAT conversacional/visual ejecutado. La matriz conserva pendientes; no existe autorización de producción para este alcance.
