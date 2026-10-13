# S09 · Ciclo Stripe · 2026-10-11

Estado: **verificado técnicamente en Sandbox**. Aceptación funcional de Mike pendiente. Producción y Stripe Live sin cambios.

## Aislamiento y método

Se creó el estudio vacío `Studio Flow S09 Lifecycle UAT`, slug `studio-flow-s09-lifecycle-uat-20261011`, ID `acefe723-4eb9-4289-9be9-8a0fd7ceda87`, con el owner existente de Sandbox y plan Core. La suscripción de S08 y los estudios Demeter no se modificaron.

La cuenta Stripe usada fue `acct_1TwhQF6zvrymwOJv`, `livemode=false`. Un reloj de pruebas permitió avanzar ciclos mensuales sin esperar fechas reales. Todos los importes fueron sintéticos: $899 MXN por ciclo.

El conector expone la creación de relojes pero no las operaciones de avance, adjuntar tarjetas o pagar facturas. Se usó temporalmente el runtime de `saas-stripe-checkout`, con JWT obligatorio, validación de owner del estudio S09, precio de Sandbox y acciones finitas sobre el cliente/reloj/suscripción de ese fixture. No se expusieron claves ni signing secrets. Se restauró la función canónica al terminar como v17, `verify_jwt=true`, SHA `f1de5772b976a7516333c7725a4fe86806f306a176976fe2a7ea8f93c048c221`, idéntico al Checkout normal previo. Webhook y portal no se modificaron en S09.

## Objetos de prueba

- Test clock: `clock_1UPZvR6zvrymwOJv7OAN9gmE`.
- Customer: `cus_VQQn632M1TpQLC`.
- Subscription: `sub_1UPZvT6zvrymwOJvb7NB58ws`.
- Precio: `price_1UK8KS6zvrymwOJvbTUZJkDY`.
- Pago inicial: `in_1UPZvT6zvrymwOJvtDEOoyYQ`.
- Renovación pagada: `in_1UPZvk6zvrymwOJvodg06OL1`.
- Renovación fallida y luego recuperada: `in_1UPZwZ6zvrymwOJvlW1xg4FO`.

Se adjuntaron las tarjetas sintéticas oficiales `pm_card_visa` y `pm_card_chargeCustomerFail`. No se usaron números de tarjeta reales ni se enviaron correos a clientes para estas pruebas.

## Resultados

| Caso                     | Resultado y evidencia                                                                                                                                                                                                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alta técnica             | Suscripción active, invoice inicial paid, asignación Core activa por webhook.                                                                                                                                                                                                                                                                  |
| Renovación automática    | Reloj avanzado al siguiente periodo más dos horas. Invoice `subscription_cycle`, paid, `amount_paid=89900`, primer intento. El periodo de Studio Flow avanzó de octubre/noviembre a noviembre/diciembre simulado.                                                                                                                              |
| Renovación fallida       | Tarjeta de fallo configurada y siguiente ciclo avanzado. Invoice open, pagado 0, adeudo 89900; Stripe y Studio Flow en past_due. `invoice.payment_failed` procesado sin error.                                                                                                                                                                 |
| Gracia                   | Acceso full, `grace_ends_at` tres días después del evento de fallo. El reloj afecta periodos de Stripe; los eventos tienen fecha real de emisión.                                                                                                                                                                                              |
| Gracia vencida           | En transacción, mover gracia a un segundo antes de `now()` devolvió restricted. La transacción terminó con rollback. No se cambió el reloj del backend ni quedó un vencimiento artificial persistido.                                                                                                                                          |
| Evento antiguo           | En la misma transacción, aplicar estado active con fecha un segundo anterior al último evento devolvió ignored / stale_event. La fila completa permaneció idéntica. Rollback.                                                                                                                                                                  |
| Duplicado firmado        | Se recuperó de Stripe el evento real `evt_1UPZwe6zvrymwOJvEdqLBg4k`, se firmó su payload exacto usando el signing secret dentro del runtime y se reenvió al webhook. HTTP 200, `duplicate=true`. Antes y después: fingerprint de asignación `2d3b785d8d28ca7b920cb2b4d16b2ea1`, 2 filas de auditoría, 8 filas del ledger. No se añadió efecto. |
| Recuperación             | Restablecer la tarjeta válida y pagar la misma invoice fallida produjo paid. El webhook restauró active/full, borró gracia y fallo y guardó la misma invoice como último pago.                                                                                                                                                                 |
| Cancelación programada   | `cancel_at_period_end=true`: estado active/full, siguiente cobro null.                                                                                                                                                                                                                                                                         |
| Reversión de cancelación | `cancel_at_period_end=false`: active y siguiente cobro restaurado.                                                                                                                                                                                                                                                                             |
| Cancelación al término   | Programar de nuevo y avanzar al fin del periodo produjo `customer.subscription.deleted` y estado cancelled/restricted. La suscripción de prueba terminó cancelada.                                                                                                                                                                             |
| UI y sesión              | Owner autenticado abrió `/admin/suscripcion` del estudio S09 después de cancelar: muestra Suscripción cancelada, próximo cobro no configurado y opciones de contratación/portal. La sesión permanece válida. `current_studio_capabilities` devuelve únicamente `admin.portal`.                                                                 |

## Ledger final

Los 15 eventos del estudio S09 quedaron `completed`, todos con `error_code=null`:

- 1 `customer.subscription.created`.
- 9 `customer.subscription.updated`.
- 1 `customer.subscription.deleted`.
- 3 `invoice.paid`.
- 1 `invoice.payment_failed`.

La prueba de gracia y evento antiguo no pretende ser una entrega antigua de Stripe: prueba el motor SQL vigente dentro de una transacción reversible. La prueba duplicada sí atraviesa el endpoint HTTP, firma y ledger actuales. No se realizaron pruebas de caída del proceso durante `processing` ni entregas simultáneas, y no se debe extender la evidencia a esos casos.

## Estado de continuación

El estudio S09 permanece vacío, con suscripción sintética cancelada y reloj de pruebas detenido. S08 conserva su suscripción de prueba activa. El siguiente frente es S11: clases y reservas en el recorrido integral, antes de preparar S12/Stripe Live. La preparación productiva debe incluir impuestos y registros aplicables; estas pruebas no habilitaron `automatic_tax` ni verificaron configuración fiscal.

S09 no cambia código productivo: documenta pruebas reales del ciclo y verificaciones transaccionales sobre el backend actual. La aprobación funcional y la promoción permanecen separadas.
