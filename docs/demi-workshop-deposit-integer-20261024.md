# Demi · Anticipo fijo decimal impide preparar inscripción

## Evidencia y alcance

Tras promover #397, Mike confirma por WhatsApp que Demi ya informa el taller.
Al elegir «Completo», la preparación falla y Demi anuncia revisión humana.
Log PostgreSQL productivo 2026-10-24 05:46:20.186 UTC:
`invalid input syntax for type integer: "30000.00"`.
La ejecución de `prepare_workshop_purchase` devuelve `workshop_prepare_blocked`.
La conversación conserva cero intenciones de taller; el fallo revierte su transacción.
No se reejecutó la compra ni se envió ningún mensaje para investigar.

`private.workshop_payment_quote` valida importes enteros en centavos pero devuelve
`minimum_minor` como numeric. En un anticipo fijo con escala decimal, el JSON
contiene 30000.00. Sus consumidores usan `(q->>'minimum_minor')::integer`, que
rechaza ese texto. La función productiva coincide con la fuente versionada.

## Corrección

La migración `20261024054746_demi_workshop_integer_deposit_quote.sql` cambia
únicamente el tipo serializado de `minimum_minor` a integer, después de validar
que no tiene fracciones. Conserva fórmulas, anticipo máximo al total, porcentaje
redondeado hacia arriba, inscripción, bloqueos, cupo, identidad, ACL y pagos.
No cambia los precios ni el anticipo comercial y no modifica filas existentes.

DoD: reproducir el error exacto usando editor y funciones reales, comprobar
cotización → aceptación explícita → comprobante sintético → revisión autorizada,
un solo pago, sin reserva confirmada prematura, y preservar modos fijo/porcentaje/
completo, límite al total y rechazo de fracciones de centavo. No alterar la
atención humana preexistente del chat ni crear una compra de prueba productiva.

## Pruebas y entrega

Antes de la corrección, la regresión reproduce el error exacto 30000.00 en la
inserción de `demi_workshop_purchase_intents`. Evidencia final de pruebas, SHA,
CI y promoción: consultar el PR de esta corrección.

PostgreSQL aislado usa contratos externos reducidos y funciones reales; no
acredita entrega WhatsApp, OCR ni dinero real. La validación productiva elegible
es consultar la cotización sin persistir intenciones, con identidad actual.
Esta corrección es posterior a la candidata de #397: su autorización no se
extiende automáticamente a una versión nueva.

Rollback: restaurar sólo `private.workshop_payment_quote` desde
`20261019041433_workshop_operational_contract.sql`, conservando permisos y datos.
El rollback recupera también el fallo de anticipos con escala decimal.
