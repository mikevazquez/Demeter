# S08 · Stripe Sandbox · 2026-10-11

Estado: **bloqueado por configuración de origen de retorno**. S08 no está cerrado.

## Conexión y catálogo

La conexión reautenticada apunta a `acct_1TwhQF6zvrymwOJv`, Entorno de prueba de Demeter Fitness, `livemode=false`. Los tres precios históricos fueron recuperados directamente de Stripe: activos, recurrentes mensuales, MXN, con productos y metadata de Core/Growth/Pro coincidentes con DEV-04H.

| Plan   | MXN/mes | Stripe Price                     |
| ------ | ------: | -------------------------------- |
| Core   |     899 | `price_1UK8KS6zvrymwOJvbTUZJkDY` |
| Growth |    1399 | `price_1UK8KT6zvrymwOJv33T5rase` |
| Pro    |    1999 | `price_1UK8KV6zvrymwOJv0QkL82B4` |

Supabase Sandbox `hedouonyhynuvwbckdlg` tenía cero filas en `saas_plan_prices`. Se insertaron y releyeron los tres mapeos con `trial_days=0`, `grace_days=3`, `active=true`. No se crearon precios anuales ni se cambió Stripe Live. Los IDs de prueba no deben incorporarse a migraciones destinadas a producción.

El webhook `we_1UKBoX6zvrymwOJvT7vVfqjh` permanece enabled hacia `saas-stripe-webhook` de Sandbox, API `2026-08-26.dahlia`; el endpoint anterior está disabled. La configuración de portal `bpc_1UK8Ej6zvrymwOJvydvJmLMx` está activa, con historial, actualización de método y cancelación al final del periodo. Su retorno predeterminado todavía apunta a la rama histórica; el portal de la aplicación envía un retorno explícito.

## Recorrido y defecto corregido

Se creó un estudio vacío independiente mediante `service_provision_studio_v3`:

- Nombre: Studio Flow S08 Stripe UAT.
- Slug: `studio-flow-s08-stripe-uat-20261011`.
- ID: `774945b0-ea16-4d26-a4f7-e6107a2ff330`.
- Owner: cuenta administradora existente de Sandbox; plan inicial Core.

El navegador autenticó al owner, seleccionó el estudio y mostró los tres precios en `/admin/suscripcion`. «Elegir Core» preservó la sesión pero mostró el error de cobro; no se insertó ningún intento de Checkout.

La función v4 devolvía `401 unauthenticated` para un JWT que `auth.getUser(token)` aceptaba. Se reprodujo la pérdida de autorización con el SDK real: el encabezado global `authorization` en minúsculas colisiona con el `Authorization` predeterminado. El helper ahora valida Bearer, usa `Authorization` canónico y entrega el token explícitamente a `getUser(token)`.

La prueba de regresión ejecuta el helper de Deno con el SDK Supabase instalado y simula únicamente HTTP, env e imports npm. Antes del cambio fallaron 3/5 casos; después pasan 5/5, incluyendo token válido, credenciales ausentes/malformadas y rechazo de Auth. Typecheck y ESLint del test pasan. También pasan las suites existentes de contexto de plan, cliente multiestudio y activación (17 pruebas en total con la nueva suite).

Suite completa después del cambio: 190 archivos y 1251 pruebas aprobadas (`npm test -- --reporter=dot`).

`saas-stripe-checkout` y `saas-stripe-portal` se desplegaron como v5 únicamente en Sandbox, conservando `verify_jwt=true`. El webhook no se redesplegó.

## Bloqueo actual y acción necesaria

Tras corregir Auth, una llamada autenticada completa devuelve `400 {"error":"invalid_request"}`. El cuerpo tiene UUIDs válidos, `planKey=core`, `billingInterval=month`; el origen del Preview es rechazado por `validateReturnBaseUrl`. La comprobación de la UI continúa mostrando `checkout_unavailable` y cero intentos de Checkout. Una comprobación del origen histórico también fue rechazada.

En Supabase Sandbox → Edge Functions → Secrets, agregar este origen a `SAAS_BILLING_RETURN_ORIGINS`, conservando los otros orígenes aprobados y usando coma como separador:

```text
https://demeterbueno-git-feat-saas-reconciliation-demeter3.vercel.app
```

No incluye ruta, barra final ni wildcard. Las herramientas conectadas no exponen edición de secretos de Edge Functions y el entorno no dispone de credencial CLI de Supabase. No se relajó la allowlist en código.

Después del ajuste, repetir desde el owner del estudio S08: «Elegir Core», pago con tarjeta de prueba, retorno al Preview, sesión Checkout completada, invoice pagada, ledger de webhook `completed`, asignación/periodos reflejados en la UI y «Administrar cobro». Duplicados, renovación y recuperación corresponden al cierre de S09.

No se creó Checkout, suscripción ni cargo durante esta ejecución. Producción no recibió cambios; PR #270 conserva estado draft y requiere aceptación funcional antes de promoción.
