# Talleres: contrato de integración transaccional (Sandbox)

Estado: **pendiente de implementación y UAT**. No invocar este documento como evidencia de pruebas.

## Flujo obligatorio de confirmación

1. Identificar al actor autorizado y el estudio. No confiar en studioId enviado por el cliente.
2. Verificar que la oferta, disciplina, sesiones y alumna/prospecto pertenecen al mismo estudio.
3. Resolver inscripción obligatoria con la configuración efectiva del estudio y la oferta.
4. Resolver precios desde la base de datos, no desde el navegador ni desde Demi.
5. Al recibir **confirmación verificable del pago**, iniciar una única transacción de base de datos. El comprobante de transferencia pendiente de revisión no cuenta como pago confirmado.
6. Bloquear en orden determinista las sesiones seleccionadas (FOR UPDATE), recontar reservas activas y verificar cupo en **todas**. Si falla una, revertir toda la operación.
7. Crear o reutilizar la venta por idempotency_key, registrar el pago confirmado y las reservas de todas las sesiones. Guardar snapshot de política, gracia y vencimiento en la compra.
8. Confirmar la transacción y solo después enviar mensajes por canal asíncrono con idempotencia. No enviar confirmación de cupo antes del commit.

## Vencimientos

- Tomar el saldo desde los movimientos financieros confirmados; no confiar en un paid_minor enviado por el cliente.
- Para liberar cupos, bloquear compra, pagos y reservas en transacción, recalcular el saldo, comparar vencimiento+gracia y cancelar únicamente las reservas activas vinculadas a la compra.
- No borrar reservas ni pagos históricos, no reembolsar automáticamente.
- Si la política es mantener, generar aviso deduplicado al administrador.
- No liberar cupos si se registró un pago suficiente antes del cierre de la transacción.
- Reintentos de cron y webhooks deben ser idempotentes.

## Bloqueos actuales

- Falta identificar las rutas reales de ventas, agenda, portal y Demi en el repositorio.
- Falta definir y conectar autorización por tenant y actor en el backend real.
- Faltan endpoints y funciones transaccionales implementados y verificados.
- Faltan preview, CI y 18 escenarios UAT. **No promover**.

## Pruebas críticas

Dos compradores compitiendo por el último cupo; compra de tres sesiones con una llena; doble webhook; comprobante pendiente; pago concurrente con vencimiento; cron repetido; políticas históricas; acceso cruzado entre estudios.
