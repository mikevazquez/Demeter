# Candidata de promoción Demi 2.0 — 10 octubre 2026

**Preparada; no publicada ni autorizada todavía.** Facebook e Instagram se habilitarán por separado. No hay retención de cupo ni promesa de espacio: la solicitud sólo conserva clase/horario como contexto.

## Evidencia vigente

- Rama original con correcciones de pago: fb447a1; 1162/1162 pruebas, tipos y build aprobados.
- Candidata integrada con producción a365397: 1a2fc2a; 1174/1174 pruebas en 179 archivos, tipos y build aprobados. Se conservaron las reglas de etapa por inscripción de Demi al resolver los conflictos con la versión de CRM de main.
- Cinco recorridos SQL reales en Sandbox, con service_role y ROLLBACK: normal, pago tardío sin hold, clase pasada, clase llena y alternativa para prospecto. Datos faltantes no inventan ficha; rechazo no reserva; aprobación conserva fondos; reserva y pago se aplican una vez; alternativa usa la misma solicitud; crédito de siete días desde la primera clase reservada.
- Recordatorios de pago a 2/6 horas desde la solicitud, dos como máximo por solicitud; repetir mensajes/acciones no crea cuatro recordatorios. Se detienen al recibir pago o cuando la clase deja de admitir reservas.
- Regresiones SQL de seguimiento general, contenidos y grupos: 9 + 4 + 3 grupos aprobados. Se conserva el intervalo general 24/48 para consultas sin pago, separado de los recordatorios de pago.
- 24 controles nativos Mercado Pago aprobados. Trabajador Sandbox demi-payment-worker v6 publicado: puede continuar automáticamente con los datos ya registrados, reconocer falta de cupo/fecha pasada y añadir detalles oficiales de reservas activas al aviso.
- Tres pruebas nuevas del trabajador: datos faltantes, alternativa sin cobro adicional, confirmación con fecha/hora/dirección oficial.
- Consulta de seguridad de Sandbox: ninguna observación del asesor sobre service_reselect_demi_paid_group, service_resume_demi_paid_group o schedule_demi_payment_reminders. Las funciones nuevas son de servicio y la vinculación de identidad conserva autorización y verificación.

## Prueba externa pendiente

Se creó un pedido nuevo de prueba de $150, solicitud d800eb8a-1dd8-4528-bfca-97b2ce16ed59, pedido ORDTST01M4KZ3XY8AXXX84GA2K0CSZS5, run afa06e15-9536-42c9-8e1d-a5bb57cbe021. El comprador debe pagar con cuenta/tarjeta de prueba; no dinero real.

El cron temporal demi_uat_payment_afa06e15 revisa exclusivamente ese estudio UAT por el mismo trabajador. Se detiene después de entrega/revisión o al cumplir una hora desde la creación de la solicitud. Los primeros recorridos programados HTTP200 consultaron realmente al proveedor y preservaron el estado created sin reservar. La entrega se captura en Sandbox; **no acredita recepción de WhatsApp ni un webhook firmado**. No se aplicará el pago manualmente para hacer pasar esta prueba.

Pagos previos $150/$200 continúan acreditados; no acreditan por sí mismos esta continuación autónoma nueva. M05 permanece parcial hasta observar el nuevo recorrido aprobado. M01/M18 conservan pendientes externos de canal; Instagram está diferido por decisión del usuario.

## Paquete y orden de promoción

El manifiesto JSON enumera 68 migraciones en orden de dependencia y cuatro trabajadores. No usar un db push indiscriminado: se excluyen generadores de datos UAT, compatibilidad exclusiva de Sandbox, reparaciones SaaS y fallos sintéticos. La tabla vacía demi_uat_runs sólo permite al runtime distinguir estudios sintéticos; no se crean fixtures ni funciones de creación de UAT en producción.

Se recuperaron del historial aplicado de Sandbox seis migraciones CRM que faltaban en Git y en producción. No se aplicaron todavía a producción. La reparación SaaS de Sandbox se excluye: producción no tiene el trigger de estudiantes que necesitó esa reparación.

Producción ya tiene Demi activo y credencial WhatsApp válida (consulta Meta HTTP200). La cuenta Bancomer y el método bank_transfer están habilitados; ocho plantillas de clase tienen precio $150. Sin embargo, el producto interno de pago anticipado está inactivo y vale $0: la activación deberá preparar un producto interno nuevo de $150 sin cambiar los productos o pagos históricos. No copiar identificadores de productos ni credenciales de Sandbox.

Después de autorización: guardar estado previo; limitar temporalmente al piloto; aplicar migraciones del manifiesto; desplegar trabajadores con credenciales de producción; configurar producto/política y seguimiento; publicar la candidata; comprobar WhatsApp del piloto y la confirmación; activar alcance autorizado. Facebook/Instagram permanecen sin habilitar. El piloto de relevo #261 no se ha publicado y no es necesario para una promoción directa con piloto en el receptor nativo.

Reversión: deshabilitar automatizaciones y Demi, volver al despliegue anterior y restaurar la configuración guardada; conservar las tablas y operaciones realizadas. No borrar ventas, reservas, identidades ni pagos para revertir una publicación.
