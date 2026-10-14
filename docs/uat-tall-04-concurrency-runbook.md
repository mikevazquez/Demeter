# TALL-04 — Ejecución de concurrencia en Sandbox

Estado: **LISTO PARA EJECUTAR, NO APROBADO**.

El 2026-10-14 se verificó en Sandbox:
- Estudio: `9fe23cfa-fb47-4670-afeb-ed4a56433772`
- Oferta sintética exclusiva: `a5f0cf20-803a-4524-b78b-5e68d5a413c4`
- Sesión sintética exclusiva: `25e4a80d-4b8c-4986-9d8a-20530c3d54cb`
- Capacidad: 1; reservas activas: 0; estado: scheduled; `assistant_visible=false`
- Precio: 60000 centavos MXN; depósito: full
- Compradores sintéticos: `b2fb771e-206e-46cb-84dc-cc4c16722778` y `12c2f581-4c1c-468d-9173-adff76ffc5b7`

Ejecutor: `scripts/uat/workshop-concurrency-sandbox.mjs`. Necesita dos clientes Supabase independientes y una clave service_role **solo de Sandbox**, inyectada como secreto de entorno; nunca en GitHub, mensajes ni salida de CI.

Variables no secretas:
```dotenv
WORKSHOP_UAT_SUPABASE_URL=https://hedouonyhynuvwbckdlg.supabase.co
WORKSHOP_UAT_STUDIO_ID=9fe23cfa-fb47-4670-afeb-ed4a56433772
WORKSHOP_UAT_OFFER_ID=a5f0cf20-803a-4524-b78b-5e68d5a413c4
WORKSHOP_UAT_SESSION_ID=25e4a80d-4b8c-4986-9d8a-20530c3d54cb
WORKSHOP_UAT_STUDENT_A_ID=b2fb771e-206e-46cb-84dc-cc4c16722778
WORKSHOP_UAT_STUDENT_B_ID=12c2f581-4c1c-468d-9173-adff76ffc5b7
WORKSHOP_UAT_IDEMPOTENCY_A=33333333-3333-4333-8333-333333333333
WORKSHOP_UAT_IDEMPOTENCY_B=44444444-4444-4444-8444-444444444444
```

Secret: `WORKSHOP_UAT_SERVICE_ROLE_KEY` (Sandbox only). Run `node scripts/uat/workshop-concurrency-sandbox.mjs` in an isolated trusted runner with these variables.

**Pass criteria:** exactly one successful checkout, exactly one `session_full` rejection, exactly one active reservation, one synthetic purchase/sale/payment, and no purchase for the losing idempotency key. Confirm SQL independently after execution.

**Critical limitation:** This test uses the existing checkout RPC, which records a synthetic cash payment without independent payment verification. It must never be exposed to end users. Test-only credentials and data. Production remains protected.


## Segundo fixture listo (2026-10-14)

El primer fixture ya tiene una reserva activa y **no** debe reutilizarse para probar una carrera con cupo vacio. Se creo otro fixture aislado:

- Oferta B: `9ac9cde5-d679-4207-91ac-7bf9da273a34`
- Sesion B: `812c71b9-2e1f-496c-9131-fa9fe7c1fd6f`
- Precio completo: 60000 centavos; capacidad 1; sesion no visible a Demi.
- Compradores: los mismos dos estudiantes sinteticos.
- Usar claves de idempotencia **nuevas** para la carrera B.

La ejecucion paralela real sigue pendiente; no marcar TALL-04 como aprobado.
