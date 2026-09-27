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

### Webhook

- Stripe Webhook Endpoint ID: `we_1UK8EN6zvrymwOJvdffqS0Gr`
- Destino: `https://hedouonyhynuvwbckdlg.supabase.co/functions/v1/saas-stripe-webhook`
- API version: `2026-08-26.dahlia`
- Estado: enabled
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

El signing secret fue generado por Stripe, pero **no se registra en Git ni en esta documentación**. Debe cargarse exclusivamente como secreto de Supabase Sandbox.

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
4. Configurar `STRIPE_SECRET_KEY` del Sandbox en Supabase Sandbox.
5. Configurar `STRIPE_WEBHOOK_SIGNING_SECRET`.
6. Configurar `SAAS_BILLING_RETURN_ORIGINS` con el origen permitido de Preview.

> Limitación operativa actual: el conector de Supabase disponible en esta sesión permite operar DB y Edge Functions, pero no expone gestión de secretos de Edge Functions. No se debe sustituir esto por guardar secretos en código o tablas públicas.
7. ~~Crear/configurar el endpoint webhook de Stripe Sandbox.~~ Completado.
8. ~~Crear configuración base de Customer Portal.~~ Completado.
9. Ejecutar Checkout real de prueba.
10. Validar pago exitoso, pago fallido, recuperación, cancelación, duplicados y Customer Portal.
11. Mantener producción intacta hasta aprobación explícita.

## Regla de seguridad

No registrar claves secretas de Stripe en Git, documentación, tablas públicas o código cliente.
