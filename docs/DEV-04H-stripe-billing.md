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

Todavía **no se han creado precios en Stripe**.

Motivo: existen propuestas históricas distintas y no hay importes Core/Growth/Pro comercialmente cerrados en el proyecto. No se deben inventar montos.

Cuando se aprueben, crear precios recurrentes en Stripe Sandbox y registrar sus `provider_product_id` / `provider_price_id` en `saas_plan_prices`.

## Integración existente en Sandbox

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

1. Definir importes comerciales Core/Growth/Pro.
2. Crear Stripe Prices en MXN.
3. Registrar los Price IDs en `saas_plan_prices`.
4. Configurar `STRIPE_SECRET_KEY` del Sandbox en Supabase Sandbox.
5. Configurar `STRIPE_WEBHOOK_SIGNING_SECRET`.
6. Configurar `SAAS_BILLING_RETURN_ORIGINS` con el origen permitido de Preview.
7. Crear/configurar el endpoint webhook de Stripe Sandbox.
8. Ejecutar Checkout real de prueba.
9. Validar pago exitoso, pago fallido, recuperación, cancelación, duplicados y Customer Portal.
10. Mantener producción intacta hasta aprobación explícita.

## Regla de seguridad

No registrar claves secretas de Stripe en Git, documentación, tablas públicas o código cliente.
