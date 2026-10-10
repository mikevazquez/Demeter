# Double check de candidata y pagos — 10 octubre 2026

Candidata de código revisada: 5e32bad, con corrección posterior sólo del aislamiento de la prueba SQL Mercado Pago. Facebook e Instagram diferidos expresamente por el usuario; no se repiten los quince casos de negocio.

## Resultado

- Regresión: 1159/1159 pruebas, 179 archivos. Typecheck y build de producción finalizaron con código 0.
- Identidad: nueve grupos nativos aprobados en Sandbox; prospecto sin teléfono, vinculación verificada, ficha/ventas/reservas/adquisiciones conservadas y reconocimiento posterior.
- Mercado Pago: 24 controles nativos y siete controles del enlace público aprobados, con datos sintéticos y ROLLBACK. La prueba de 24 controles dependía de un grupo histórico ya procesado; ahora crea su propio estudio/conversación/grupo aislados. No se cambió el comportamiento productivo para hacerla pasar.
- Consulta del estado persistido: pago externo primera clase $150, solicitud ec322d58-ba7b-4c78-9656-436696e1c10d, aprobado/processed/accredited. Un aviso enviado a captura UAT, un intento. Inscripción $200, intento 79a7d407-055b-4e0d-ab2a-99fc429f1987, aprobado/processed/accredited, venta f2bc8291-015e-46e2-b392-87f2021c00d4. En los checkout aprobados de los estudios UAT de este origen sólo aparece la inscripción; no se encontró evidencia de compra externa de paquete.
- Estas consultas corroboran el estado local y la evidencia previa de consulta autenticada al proveedor; no son una nueva consulta directa al proveedor. Cero eventos webhook auditados para los dos pedidos. last_webhook_at del checkout no acredita un evento firmado: la función de aplicación también escribe ese campo.
- El trabajador incluye reconciliación autenticada del proveedor y hay cron studio_flow_demi_payments activo cada cinco minutos en Sandbox. Los estudios UAT se excluyen del cron y capturan salidas: la ejecución de cron de extremo a extremo con un pago nuevo no quedó acreditada por estas pruebas.
- Audio: transcripción compartida entre los tres adaptadores; regresión incluye límites, clasificación y MP4 anunciado como OGG. Facebook externo pasó previamente. Transporte externo WhatsApp de esta candidata y entrega real de su aviso de pago permanecen sin acreditar.

## Alcance de aprobación

M05 conserva aprobación de sus componentes de negocio ya probados (comprobante antes de datos y pagos externos consultados/aplicados). La ruta de notificación externa y entrega real permanece parcial. Un webhook no es el único mecanismo posible de automatización, porque existe reconciliación periódica, pero no se aprueba funcionamiento autónomo externo sólo por tener código o cron activo.

M01/M18 pueden diferirse por canal según el alcance acordado; no se convierten en pruebas externas aprobadas. El conteo íntegro sigue 15/18. El núcleo no se modificó durante la validación, excepto la prueba aislada.

## Promoción pendiente

Consulta de producción de sólo lectura: todavía no existen demi_payment_requests, demi_identity_link_audit ni demi_receipt_review_notices. Se necesita promover las migraciones y trabajadores/configuración junto con el código; publicar sólo el frontend no completa Demi 2.0. No se aplicaron migraciones ni se publicó producción durante este double check.

Antes de habilitar atención real: comprobar salida/entrada de la candidata en WhatsApp y confirmar la ruta automática de aviso de pago, o excluir esa automatización efectivamente del lanzamiento. Facebook requiere renovar autorización; Instagram queda pendiente. No se afirma que esos transportes pasaron por la existencia de las pruebas internas.
