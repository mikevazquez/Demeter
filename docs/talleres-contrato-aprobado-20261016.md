# Talleres: reconciliación del contrato aprobado (16 octubre 2026)

Estado: contrato de diseño aprobado; implementación y UAT **pendientes**. Rama aislada basada en PR #284; NO MERGE / NO PRODUCCIÓN.

## Fuente de verdad y separación de módulos
- Actividades configura talleres, eventos y master class; Agenda configura cada sesión, instructor, espacio y cupo.
- Hoy registra asistencia y pagos; Alumnas muestra compras especiales, saldo e historial. Agenda **no** ofrece cobros, listado de alumnas ni asistencia. Reutilizar el motor de pagos existente, sin duplicar ingresos.
- Demi informa con datos vigentes de Studio Flow y contenido temporal administrable, realiza compras y seguimiento, pero no reprograma sesiones.

## Compra completa
- Anticipo mínimo configurable y explícitamente aceptado; reserva todas las sesiones de la compra completa.
- Saldo íntegro exigible en la primera sesión; ausencia no condona saldo, no repone sesión ni devuelve anticipo.
- Asistencia posterior a liquidación: faltar no genera reposición ni devolución.
- Abandono confirmado: cancelar **solo reservas futuras de esa persona**, liberar cupos, preservar pagos, compra y deuda conforme a términos aceptados. Si no responde, no liberar sin política explícita.

## Compra de sesión individual
- Solo cuando la oferta habilita precio individual; reservar únicamente sesión adquirida, no todo el taller.
- Cobro y validación siguen el mismo motor, sin afectar paquetes ordinarios.

## Transferencia de Demi: máquina de estados separada
1. Comprobante recibido: evidencia no verificada, idempotency key y referencia únicas; no registrar ingreso confirmado.
2. Reserva provisional: bloquear capacidad para todas las sesiones seleccionadas **atómicamente**; marcar estado provisional y vencimiento/revisión. Informar a alumna que está sujeto a validación.
3. Validación aprobada por actor autorizado: convertir provisional a confirmada, aplicar pago una sola vez al ledger, actualizar saldo sin duplicar compra ni cupos.
4. Rechazo: no reconocer ingreso; aplicar política de expiración/liberación de reservas provisionales, registrar motivo y notificar sin duplicación.
5. Reintentos, comprobantes duplicados y concurrencia por último cupo: idempotentes y sin sobreventa. Revisión tardía nunca convierte una reserva liberada en confirmada sin revalidar cupos y política.

**Importante:** este contrato NO autoriza modificar el gate de pago verificado actual sin una implementación segura, tests y UAT. El flujo administrativo de efectivo/transferencia verificada sigue separado del comprobante provisional de Demi.

## Demi: ausencias y seguimiento
- Si la primera sesión se pierde y existe saldo pendiente, preguntar continuidad solo si no hay respuesta ya registrada; recordatorio del saldo completo y de la sesión perdida.
- Sí continúa: conservar reservas, responder una vez y dar seguimiento a saldo.
- No continúa: informar anticipo no reembolsable según condiciones aceptadas, liberar exclusivamente reservas futuras, preservar saldo/historial.
- Alumna liquidada: no enviar preguntas repetidas por ausencias posteriores.
- Reutilizar WhatsApp existente; deduplicar eventos, envíos y acciones.

## Desajustes identificados en PR #284
- `docs/talleres-contrato-transaccional.md` y UAT TALL-07/TALL-12 exigen pago verificado antes de reservar. Ampliar UAT para distinguir reservas confirmadas de provisionales; jamás marcar un comprobante como pago validado.
- `app/admin/agenda/[sessionId]/page.tsx` y `app/admin/hoy/workshop-abono-actions.ts` requieren revisión de ubicación de cobro. Mover UI a Hoy/Alumnas conservando lógica reutilizable.
- Verificar si la implementación actual admite reprogramación posterior a compras sin romper reservas y políticas.
- No certificar las 18 pruebas UAT originales: siguen 0/18 aprobadas. Añadir casos de provisional, rechazo, concurrencia, ausencia, abandono, transferencia individual y deduplicación.

## Definition of Done del siguiente bloque técnico
1. Inventario exacto de RPC, tablas, acciones y pantallas afectadas; revisión de concurrencia y RLS.
2. Contrato de estados y migración compatible, aislada en Sandbox, con rollback definido.
3. Pruebas automatizadas de última plaza, doble comprobante, validación tardía, abono, cancelación y ausencia.
4. UAT autenticada de punta a punta en Sandbox/Preview con evidencia de SHA y resultados.
5. Ningún despliegue o promoción a producción sin autorización explícita «Autorizo promoción».
