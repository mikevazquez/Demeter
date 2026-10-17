# UAT Sandbox — cupos provisionales, rollback e idempotencia (2026-10-16)

Entorno exclusivo: Supabase Sandbox `hedouonyhynuvwbckdlg`, sin cambios a producción.

## Resultados ejecutados (SQL en Sandbox)
1. **Cupo provisional / bloqueo de checkout / liberación — APROBADO.** Taller fixture `ce031122-3892-4e63-8b7b-78394f7a6094`, sesión `ea9f5e96-080c-42cb-9b78-1d0f848fa1c9`, capacidad 1, ocupación inicial 0. En un bloque PL/pgSQL con subtransacción y rollback controlado: se creó hold con `private.workshop_create_provisional_hold`, `private.workshop_capacity_seats_taken` devolvió 1, `public.workshop_checkout_preflight` rechazó la reserva por `session_full`, y `private.workshop_close_provisional_hold(...,'reject',...)` devolvió `rejected` y dejó ocupación 0. El bloque terminó sin error; todos sus cambios se revirtieron.
2. **Conflicto de idempotencia — APROBADO.** En una segunda subtransacción con rollback se creó un hold con `request_id` único, se constató una sola fila y se intentó reutilizar la misma solicitud con importe diferente; devolvió `idempotency_conflict` como se esperaba. No quedaron registros persistidos.
3. **Integridad posterior — VERIFICADA.** Conteos: 0 holds, 0 hold_sessions, 6 workshop_purchases, 83 payments, 326 reservations. Los tres últimos coinciden con línea base anterior.
4. **Autorización negativa — ver evidencia anterior.** La función de aprobación devolvió `forbidden` fuera de una sesión autenticada y el rol anon no puede ejecutarla.

## Sin aprobar todavía
- Aprobación **positiva** por una sesión real de personal, asiento reservado, autorización financiera y solo un pago, con replay seguro.
- Dos transacciones concurrentes reales disputando último lugar.
- Integración de Demi con transferencia, recordatorios, interfaz administrativa, portal y comprobante validado.
- Rutas no-taller de reservas/edición de capacidad; CI/Vitest/Browser UAT.
- Mantener Sandbox hasta autorización expresa `Autorizo promoción`.

Estas pruebas **no** son aprobación completa de los 18 casos UAT originales.
