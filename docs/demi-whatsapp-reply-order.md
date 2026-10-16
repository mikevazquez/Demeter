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
comportamiento existente. No se ha confirmado cuál de estos síntomas corresponde
al ejemplo específico del usuario.

Validación local: 1,283 de 1,283 pruebas aprobadas en la suite completa. Siete
pruebas ejecutan el webhook con solicitudes controladas y transporte simulado.
El primer CI detectó que el cargador aislado de las pruebas de comprobantes no
reconocía las dos dependencias nuevas; se añadieron al cargador y las seis
pruebas de comprobantes volvieron a pasar, sin cambiar sus aserciones.
TypeScript y lint de los archivos modificados aprobados.

El preview `demeterbueno-smyyzeb5s-demeter3.vercel.app`, commit
`66bb81ef528b6ac75324450650221038bad634c6`, quedó READY en Vercel. El endpoint
responde `400 invalid_studio` sin identificador de estudio, como corresponde.
Esto no acredita el flujo autenticado ni una conversación real de WhatsApp.
El acceso autorizado al panel UAT redirige al inicio de sesión del estudio; no
se dispone de una sesión de aplicación para realizar la prueba conversacional.

La validación SQL `tests/demi-whatsapp-reply-order-uat.sql` se ejecutó en Studio
Flow Sandbox con el rol `service_role`: nueve aserciones aprobadas. Verifica
el texto preparado más reciente, la exclusión de medios, de eventos todavía
sin turno y de otras conversaciones/estudios, y el rechazo de una adquisición
que usa un número de intento antiguo. Los registros sintéticos se crearon en
una transacción con rollback. Una consulta posterior confirmó cero eventos y
cero conversaciones de prueba persistentes.

CI del commit `66bb81ef528b6ac75324450650221038bad634c6`: formato, lint,
TypeScript, comparación de la suite completa con main y build aprobados.
No se enviaron mensajes de prueba a personas ni se modificó producción.
Falta la prueba conversacional con sesión de estudio; la autorización de esta
validación se limita a Sandbox y no incluye promoción a producción.
