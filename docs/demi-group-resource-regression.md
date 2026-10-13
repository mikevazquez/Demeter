# Demi: regresión de dos primeras clases con poles

Revisión del 12 de octubre de 2026. Alcance: el caso reportado y sus barreras de comprobante/datos. No se modificó producción.

## Hallazgo

La conversación de las 15:05–15:15 (Ciudad de México) quedó bloqueada por `group_resource_selection_required`. El despliegue de stickers ocurrió a las 15:26, después del incidente. `prepare_group_booking` prepara el cobro; no crea reservas. En la conversación reportada no se creó ningún grupo por esta herramienta.

El módulo `lib/assistant/group-booking.ts` conserva el mismo blob `ca0b16a0d063f3c15a439bdfbd38f381c4e23f5c` antes y después de las promociones de información temporal y stickers (revisiones 20fece92, 2651151b, 6b4b3f0e, 9fd4cb5d y 5d2e163e). La función de producción también contiene el rechazo de grupos en sesiones que requieren recursos. La evidencia apunta a una limitación previa, no a una regresión introducida por esos despliegues.

## Prueba dirigida en sandbox

Ejecutada mediante `scripts/demi-group-resource-regression.sql`, con comprobante y personas sintéticos dentro de BEGIN/ROLLBACK. Todos los datos de prueba se revirtieron. No prueba reconocimiento visual de un comprobante, conversación con modelo ni transferencia bancaria real.

| Paso                                     | Resultado observado                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| Dos primeras clases, sesión con poles    | Reproduce `group_resource_selection_required`; cero reservas. Caso funcional pendiente. |
| Mismo grupo, sin recursos                | Prepara cobro de $300 MXN; cero reservas y perfiles.                                    |
| Intentar completar antes del comprobante | Bloquea con `receipt_required_before_participants`; cero reservas y perfiles.           |
| Registrar comprobante sintético          | Pasa a `awaiting_participants`; cero reservas y perfiles.                               |
| Completar sin nombres/teléfonos          | Bloquea con `participant_data_required`; cero reservas.                                 |
| Comprobante y datos completos            | Crea dos reservas provisionales, sujetas a validación del pago.                         |

Las seis aserciones técnicas pasaron. La primera verifica la reproducción del fallo, no su corrección ni aprobación UAT.

## Pendiente

Resolver en sandbox el flujo grupal con selección de poles, mantener comprobante → datos → reservas y evitar que Demi anuncie una reserva o una escalación nueva sin evidencia. La traza reutilizó un caso de revisión de medios abierto previamente; requiere revisar también esa respuesta. Validar conversación completa con dos personas, luego UAT y autorización específica antes de promover una corrección.
