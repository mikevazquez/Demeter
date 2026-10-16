# Demi: respuestas de texto simultáneas en WhatsApp

La revisión del 16 de octubre de 2026 encontró tres mensajes distintos recibidos
en cinco segundos a las 05:19, hora de Ciudad de México. Cada evento tuvo un
intento y una entrega aceptada; las tres respuestas se enviaron casi al mismo
tiempo. Esto acredita procesamiento solapado, no un reintento del mismo evento.
El diagnóstico utilizó metadatos y huellas, sin copiar conversaciones privadas.

El webhook ahora comprueba el último evento de texto preparado de la misma
conversación antes de generar y antes de enviar una respuesta informativa. Si
otro texto lo reemplazó, conserva el turno entrante y marca el evento anterior
como `ignored / superseded_by_newer_text`. El turno más reciente lee el historial
con ambos mensajes. El orden usa la recepción local; Meta sólo ofrece precisión
de segundos para la fecha del mensaje.

Los resultados de acciones se conservan: una reserva ejecutada necesita su
confirmación aunque llegue otro texto. Los acuses de archivos, comprobantes y
reintentos de entrega mantienen su flujo. La adquisición de un evento compara
también `attempt_count`, para impedir que una solicitud con una lectura antigua
adquiera un intento posterior.

Si falla la consulta de orden, no se envía la respuesta. Si el modelo ya terminó,
su respuesta se guarda para reintentar sólo la entrega, sin ejecutar otra vez
las acciones.

La comprobación no es una cola ni serializa acciones. No agrupa mensajes que
llegan después de iniciar el envío a Meta, ni los mensajes de un mismo payload
que el webhook ya procesa secuencialmente. Las reacciones y ediciones siguen el
comportamiento existente.

Validación local: 1,283 de 1,283 pruebas aprobadas en la suite completa. Siete
pruebas ejecutan el webhook con solicitudes controladas y transporte simulado.
TypeScript y lint de los archivos modificados aprobados.

El preview `demeterbueno-d84dpfu7l-demeter3.vercel.app`, commit
`d7fecc97d85d4dbe851d97314c0c481ec1600d93`, quedó READY en Vercel. Ejecutó
`scripts/demi-whatsapp-order-live-uat.mjs --sandbox-capture-only` después del
build, con el webhook, el modelo real, Supabase Sandbox y el transporte capturado.
La ejecución creó un estudio sintético nuevo y no requirió iniciar sesión en
el panel. Conserva los resultados en el run `079b4e1d-9655-4729-b927-7cbbcd95ec4b`.

Los cinco escenarios pasaron:

| Escenario                               | Resultado verificado                                              |
| --------------------------------------- | ----------------------------------------------------------------- |
| Texto normal                            | Una respuesta capturada                                           |
| Dos textos solapados                    | Una respuesta; el texto anterior quedó `superseded_by_newer_text` |
| Reenvío de los dos eventos              | Cero respuestas adicionales                                       |
| Nueva pregunta después de la ráfaga     | Una respuesta conservando el contexto de Pole Fitness             |
| Dos copias simultáneas del mismo evento | Un intento y una respuesta                                        |

La ejecución hizo nueve llamadas al modelo y guardó cuatro entregas, todas con
referencia `uat:`. La revisión de la conversación confirmó que la respuesta
combinada explicó qué llevar a Pole Fitness y que la siguiente respuesta mantuvo
esa disciplina como contexto. La instrucción de no reservar fue respetada.
Las ventas, pagos, reservas, créditos e intenciones comerciales conservaron sus
conteos iniciales. La reserva de ejecución se liberó al terminar.

El script requiere activación explícita, entorno preview, la rama exacta del PR
y la URL aprobada de Sandbox. Además bloquea HTTP hacia Meta y cualquier host
ajeno a Sandbox/OpenAI. Los cinco controles locales de aislamiento pasaron.

La validación SQL `tests/demi-whatsapp-reply-order-uat.sql` se ejecutó en Studio
Flow Sandbox con el rol `service_role`: nueve aserciones aprobadas. Verifica
el texto preparado más reciente, la exclusión de medios, de eventos todavía
sin turno y de otras conversaciones/estudios, y el rechazo de una adquisición
que usa un número de intento antiguo. Los registros sintéticos se crearon en
una transacción con rollback. Una consulta posterior confirmó cero eventos y
cero conversaciones de prueba persistentes.

CI del commit `d7fecc97d85d4dbe851d97314c0c481ec1600d93`: formato, lint,
TypeScript, comparación de la suite completa con main y build aprobados.
No se enviaron mensajes de prueba a personas ni se modificó producción.
La prueba conversacional del backend en Sandbox está aprobada. La entrega real
por Meta queda fuera de esta validación; la autorización se limita a Sandbox
y no incluye promoción a producción.
