# DEV-04H · Stripe Billing Foundation

Estado: **Sandbox / en validación**
Fecha: 2026-09-26
Rama: `dev-03-studio-config`

## Objetivo

Conectar el ciclo de suscripción SaaS de Studio Flow con Stripe manteniendo:

- Stripe como fuente de verdad para eventos de pago.
- Studio Flow como fuente de verdad para autorización, módulos, límites y acceso.
- `All Access` como plan interno no vendible.
- Separación estricta entre Stripe Sandbox y Stripe Live.
- Producción sin cambios hasta autorización explícita.

## Stripe Sandbox

Contexto conectado:

- Nombre: `Entorno de prueba de Demeter Fitness`
- Stripe context/account: `acct_1TwhQF6zvrymwOJv`
- `livemode=false`

La cuenta Live `Demeter` permanece separada y no se usa para DEV-04H.

## Productos creados

### Core

- Stripe Product ID: `prod_VKnlVZYZKZbz6z`
- `plan_key=core`
- Incluye: Core + Documentos + Notificaciones
- Límites: 100 alumnas activas, 1 sede, 3 administradores, coaches ilimitados

### Growth

- Stripe Product ID: `prod_VKnl0eryvQ6MUi`
- `plan_key=growth`
- Incluye Core + Lista de espera + Recursos + Automatizaciones + Inteligencia + Integraciones
- Límites: 250 alumnas activas, 1 sede, 8 administradores, coaches ilimitados

### Pro

- Stripe Product ID: `prod_VKnlQAsCSErRjd`
- `plan_key=pro`
- Incluye Growth + Evaluaciones + Rewards
- Límites: alumnas activas bajo uso razonable, hasta 2 sedes, administradores y coaches ilimitados

## Precios

Precios mensuales oficiales de lanzamiento en MXN:

- Core: **$899 MXN/mes**
  - Price ID: `price_1UK8KS6zvrymwOJvbTUZJkDY`
  - Lookup key: `studio_flow_core_monthly_mxn`
- Growth: **$1,399 MXN/mes**
  - Price ID: `price_1UK8KT6zvrymwOJv33T5rase`
  - Lookup key: `studio_flow_growth_monthly_mxn`
- Pro: **$1,999 MXN/mes**
  - Price ID: `price_1UK8KV6zvrymwOJv0QkL82B4`
  - Lookup key: `studio_flow_pro_monthly_mxn`

Los tres Prices están activos, recurrentes mensuales, en `mxn`, con `livemode=false` y fueron asignados como `default_price` de sus respectivos productos.

Mapeo confirmado en Supabase Sandbox `saas_plan_prices`:

- `billing_interval='month'`
- `trial_days=0`
- `grace_days=3`
- `active=true`


## Stripe Sandbox · objetos de integración

### Webhook / Workbench Event Destination

- Event Destination activo: `we_1UKBoX6zvrymwOJvT7vVfqjh`
- Nombre: `Studio Flow DEV-04H Sandbox`
- Destino: `https://hedouonyhynuvwbckdlg.supabase.co/functions/v1/saas-stripe-webhook`
- API version snapshot: `2026-08-26.dahlia`
- Estado: enabled
- Entorno: Stripe Sandbox / `livemode=false`
- Endpoint v1 anterior `we_1UK8EN6zvrymwOJvdffqS0Gr`: **disabled** para evitar entregas duplicadas
- Eventos habilitados:
  - `checkout.session.completed`
  - `checkout.session.expired`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `customer.subscription.paused`
  - `customer.subscription.resumed`
  - `customer.subscription.trial_will_end`
  - `invoice.paid`
  - `invoice.payment_failed`
  - `invoice.payment_action_required`

El signing secret fue generado por Stripe y cargado exclusivamente como `STRIPE_WEBHOOK_SIGNING_SECRET` en Supabase Sandbox. **No se registra en Git ni en esta documentación**. La presencia y funcionamiento del secreto fueron verificados mediante un evento firmado real procesado con estado `completed`.

### Customer Portal

- Stripe Billing Portal Configuration ID: `bpc_1UK8Ej6zvrymwOJvydvJmLMx`
- Nombre: `Studio Flow Sandbox`
- Estado: active / default
- Retorno: preview de `/admin/suscripcion`
- Permite:
  - actualizar nombre, correo, dirección, teléfono y tax ID;
  - actualizar método de pago;
  - consultar historial de facturación;
  - cancelar al final del periodo;
  - capturar motivo de cancelación.
- Cambio de plan desde Portal: desactivado hasta que existan Prices oficiales Core/Growth/Pro.

## Integración existente en Supabase Sandbox

Ya están desarrollados y desplegados en Supabase Sandbox:

- `saas-stripe-checkout`
- `saas-stripe-portal`
- `saas-stripe-webhook`

El motor de billing contempla:

- Checkout idempotente
- Customer Portal
- Webhook firmado
- Ledger de eventos
- Protección contra eventos duplicados y desordenados
- Mapeo Stripe -> estados de suscripción
- Gracia configurable
- Historial/auditoría de cambios
- Restricción fail-closed si faltan secretos o precios

## Pendientes para E2E real en Sandbox

1. ~~Definir importes comerciales Core/Growth/Pro.~~ Completado.
2. ~~Crear Stripe Prices en MXN.~~ Completado.
3. ~~Registrar los Price IDs en `saas_plan_prices`.~~ Completado.
4. ~~Configurar `STRIPE_SECRET_KEY` del Sandbox en Supabase Sandbox.~~ Completado.
5. ~~Configurar `STRIPE_WEBHOOK_SIGNING_SECRET`.~~ Completado.
6. ~~Configurar `SAAS_BILLING_RETURN_ORIGINS` con el origen permitido de Preview.~~ Completado.

> Limitación operativa actual: el conector de Supabase disponible en esta sesión permite operar DB y Edge Functions, pero no expone gestión de secretos de Edge Functions. No se debe sustituir esto por guardar secretos en código o tablas públicas.
7. ~~Crear/configurar el endpoint webhook de Stripe Sandbox.~~ Completado.
8. ~~Crear configuración base de Customer Portal.~~ Completado.
9. Ejecutar Checkout real de prueba desde la UI autenticada del owner.
10. Validar pago fallido + recuperación mediante checkout/renovación controlada si se desea cerrar ese caso con Stripe real de Sandbox.
11. Mantener producción intacta hasta aprobación explícita.


## Tenant UAT aislado

Para evitar que la primera compra de prueba modifique Demeter/All Access, se creó un tenant exclusivo de billing en Supabase Sandbox:

- Nombre: `Studio Flow Billing UAT`
- Slug: `studio-flow-billing-uat`
- Studio ID: `086b590c-43de-4e44-bae1-bf0fb15ece45`
- Owner: mismo usuario owner de Demeter en Sandbox
- Plan inicial: Core
- Suscripción: `active`
- Effective status: `active`
- Access mode: `full`
- Billing provider: null hasta que Stripe confirme el primer checkout
- Módulos efectivos verificados: `core`, `documents`, `notifications`

El tenant se usará únicamente para DEV-04H/UAT y evita conectar una suscripción Stripe de prueba al tenant Demeter.


## UAT funcional · primera suscripción de prueba

Se ejecutó una compra técnica de prueba directamente en Stripe Sandbox para validar el canal Stripe → webhook → Studio Flow sin tocar Demeter.

Objetos de prueba:

- Customer: `cus_VKr7xXGBMFuPeO`
- Subscription: `sub_1UKBPn6zvrymwOJvcWzrbcNe`
- Invoice: `in_1UKBPn6zvrymwOJvDRANTvHX`
- Plan: Core
- Importe: **$899 MXN**
- Invoice status: `paid`
- Stripe subscription status: `active`
- `livemode=false`

Resultado inicial y resolución:

- Stripe entregó eventos al endpoint de Supabase correctamente.
- La primera entrega respondió `503 billing_not_configured`.
- Diagnóstico temporal en Sandbox confirmó:
  - `STRIPE_SECRET_KEY`: presente
  - `STRIPE_WEBHOOK_SIGNING_SECRET`: inicialmente ausente
  - `SUPABASE_URL`: presente
  - `SUPABASE_SERVICE_ROLE_KEY`: presente
  - `SAAS_BILLING_RETURN_ORIGINS`: presente
- La versión diagnóstica temporal fue retirada inmediatamente y `saas-stripe-webhook` fue restaurada al código canónico del repositorio.
- Se creó un Event Destination v2 visible en Workbench y se deshabilitó el endpoint v1 anterior.
- Después de cargar el signing secret correcto, se generó un evento real `customer.subscription.updated`:
  - webhook ledger status: `completed`
  - error_code: null
  - tenant UAT sincronizado con customer, subscription, price y periodos de Stripe.
- Se probó `cancel_at_period_end=true` y posterior reversión a `false`; ambos eventos quedaron `completed` y Studio Flow reflejó correctamente el estado.
- La suscripción UAT quedó finalmente:
  - plan: Core
  - status: active
  - provider_status: active
  - cancel_at_period_end: false
  - billing_provider: stripe
- Se creó una sesión válida de Customer Portal en Sandbox con la configuración `bpc_1UK8Ej6zvrymwOJvydvJmLMx`.
- Se creó una invoice técnica de $20 MXN para explorar `invoice.paid`; como la API conectada no expone una acción para forzar el pago inmediato, la invoice fue anulada y no dejó deuda UAT.

## Regla de seguridad

No registrar claves secretas de Stripe en Git, documentación, tablas públicas o código cliente.
