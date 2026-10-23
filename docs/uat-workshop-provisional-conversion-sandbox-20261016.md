# Studio Flow — Talleres — conversión provisional (Sandbox, 2026-10-16)

## Alcance y entorno

- Supabase Sandbox: `hedouonyhynuvwbckdlg`. Producción sin cambios.
- Rama: `design/workshop-payment-contract-20261016`.
- Migración aplicada a Sandbox: `workshop_confirm_provisional_hold_staff_sandbox`.
- Fuente: `supabase/migrations/20261016220000_workshop_confirm_provisional_hold.sql`.
- Puerta financiera: `admin_authorize_workshop_payment` + `workshop_checkout_confirm_authorized`.
- Estado actual: función instalada, **sin prueba positiva real de cobro**, no activar Demi ni producción.

## Evidencia ejecutada

- `apply_migration`: `success: true`.
- Se ejecutó bloque SQL de comprobación negativa sin contexto de usuario autenticado; la llamada devolvió `forbidden` como se esperaba.
- `has_function_privilege(anon,...,'execute')=false`; `authenticated=true`, sujeto además a `sales.write`, `schedule.write`, estudio activo y cuenta activa dentro de función.
- Conteos de referencia Sandbox posteriores: 0 holds, 6 workshop purchases, 83 payments, 326 reservations, 4 workshop payment authorizations.
- No se insertaron fixtures de compra/hold en esta validación.

## Pruebas pendientes — NO APROBADAS

1. Staff real autoriza comprobante válido: una compra, un pago y reserva de todas las sesiones, y hold marcado `confirmed`.
2. Misma aprobación repetida devuelve replay y no duplica venta, pago ni reserva.
3. `p_received=false` no registra pago ni libera cupo.
4. Rechazo, vencimiento o permiso insuficiente impiden conversión.
5. Concurrencia: dos compradores disputando último lugar, solo uno reserva.
6. Cotización distinta, cupo cancelado, sesión vencida y saldo/deposito inválido revierten todos los cambios.
7. Registro y validación WhatsApp Demi + portal/acciones admin, así como impacto en agenda normal.
8. CI, lint, tipos, Vitest y UAT de navegador no se ejecutaron en este bloque.

## Riesgos abiertos

- Comprobar el flujo con sesión autenticada de personal y datos controlados antes de habilitarlo.
- Auditar los caminos de reservas normales y ajustes de capacidad fuera del checkout de talleres para evitar sobreventa global.
- La migración histórica de storage tiene distinta referencia temporal respecto a GitHub; reconciliar historial antes de despliegues.
- No hacer promoción a producción sin «Autorizo promoción».
