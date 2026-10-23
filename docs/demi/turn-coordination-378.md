# DEMI-378 — contrato de coordinación de turnos
Estado: diseño técnico; bloqueo atómico NO implementado.

## Invariantes
- Aislamiento por studio_id, provider y contact_wa_id.
- Ingesta y aumento monotónico de generación en una transacción.
- Solo la generación vigente puede adquirir un claim de envío atómico en PostgreSQL.
- Nunca mantener transacción abierta durante la llamada externa a Meta.
- Reintentos de cached_reply pasan por el mismo claim.
- Envío con resultado incierto requiere reconciliación, no reenvío ciego.
- Una respuesta ya enviada no se puede retirar; un mensaje posterior inicia otro turno.
- Reservas y pagos requieren idempotencia independiente y validación al confirmar.
- Media, audio y comprobantes no se descartan por batching de texto.

## UAT requerido
- Dos workers concurrentes; mensaje durante generación; mensaje entre lectura y claim.
- Replay de webhook; timeout de Meta; fallo entre claim y confirmación.
- Aislamiento de estudios y protección de acciones con efectos externos.
- Meta simulado y Sandbox aislado; ninguna comunicación real.

## Limitación
El chequeo pre-delivery del PR #380 sigue sujeto a TOCTOU. No aprobar merge hasta implementar claim y verificar carreras.
