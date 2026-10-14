# SF-OS-001 B02 — Inventario de efectos externos (revisión estática)

Fecha: 2026-10-14. Estado: **PARCIAL / NO CERTIFICADO**. Fuente: rama `governance/sf-gov-001-release-gates` de PR #278.

Este documento no prueba configuración efectiva de secretos ni cobertura integral de todas las rutas de la aplicación. No realizar llamadas reales a proveedores para UAT.

| Ruta / módulo                                               | Destino o efecto                     | Barrera localizada                                                                                               | Evidencia restante                                         |
| ----------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `lib/assistant/meta-whatsapp-channel.ts`                    | Meta mensaje WhatsApp                | `assertCandidateRuntimeExternalEffectAllowed('meta_whatsapp_send')`                                              | Candidate runtime Next.js; rutas invocantes                |
| `lib/assistant/meta-inbox-channel.ts`                       | Meta Instagram/Facebook mensaje      | `assertCandidateRuntimeExternalEffectAllowed('meta_inbox_send')`                                                 | Candidate runtime Next.js                                  |
| `lib/assistant/meta-whatsapp-channel.ts`                    | Meta metadata/archivo                | `meta_whatsapp_media_read`, después del mock UAT                                                                 | Negativo de red en CI; Candidate runtime                   |
| `lib/assistant/meta-inbox-channel.ts`                       | Meta CDN archivo                     | `meta_inbox_media_read`, después del mock UAT                                                                    | Negativo de red en CI; Candidate runtime                   |
| `lib/assistant/orchestrator.ts`                             | OpenAI responses                     | `openai_responses` antes de fetch                                                                                | Candidate runtime Next.js                                  |
| `lib/assistant/audio-transcription.ts`                      | OpenAI transcripciones               | `openai_transcription` antes de fetch                                                                            | Candidate runtime Next.js                                  |
| `supabase/functions/create-mercadopago-order/index.ts`      | Mercado Pago crea orden              | `candidateExternalEffectsBlocked(flag, SUPABASE_URL)`                                                            | Deploy y negativo HTTP seguro                              |
| `supabase/functions/create-demi-mercadopago-order/index.ts` | Mercado Pago crea orden Demi         | Igual                                                                                                            | Deploy y negativo                                          |
| `supabase/functions/mercadopago-webhook/index.ts`           | Verifica cobros y consulta proveedor | Igual en handler antes de parseo                                                                                 | Deploy y negativo                                          |
| `supabase/functions/reconcile-mercadopago-order/index.ts`   | Consulta proveedor Mercado Pago      | Igual en handler                                                                                                 | Deploy y negativo                                          |
| `supabase/functions/demi-payment-worker/index.ts`           | Mercado Pago y envíos Meta           | Igual al principio de handler                                                                                    | Deploy y negativo                                          |
| `supabase/functions/demi-followup-worker/index.ts`          | Seguimiento vía Meta                 | Igual al principio de handler                                                                                    | Deploy y negativo                                          |
| `supabase/functions/send-push-notification/index.ts`        | Push                                 | Igual                                                                                                            | Deploy y negativo                                          |
| `supabase/functions/notification-delivery-worker/index.ts`  | Push/WhatsApp/Asistian; correo       | Igual en handler. `sendEmail()` **actualmente retorna skipped / email_provider_not_configured**, no envía correo | Inspección global de rutas de email y deploy               |
| `supabase/functions/_shared/meta-whatsapp.ts`               | Mensajes y subida QR a Meta          | Igual en `sendMetaWhatsAppTemplate`; upload interno después                                                      | Verificar que ningún otro caller invoque helper sin guarda |
| `supabase/functions/_shared/asistian-messaging.ts`          | Webhook Asistian firmado             | Igual en `sendAsistianWebhook`                                                                                   | Verificar todos los callers                                |
| `supabase/functions/sf-gov-candidate-denial-probe/index.ts` | Diagnóstico local, sin proveedor     | Comprueba identidad Candidate por `SUPABASE_URL`, result `PASS`/503                                              | Petición autenticada en Candidate, sin datos reales        |

## Evidencia CI

- `11d98f1088aa10de4e8d3b9c2dc76ab737b5557d` — CI #3350 **success** (tests estáticos, negative checks y build): https://github.com/mikevazquez/Demeter/actions/runs/38623772638
- `tests/sf-gov-candidate-edge-policy.test.ts` comprueba existencia de guardas en ocho entrypoints Edge y dos adaptadores compartidos. Es una prueba **de presencia de texto**, no prueba de flujo ni despliegue.
- `tests/sf-gov-candidate-meta-media-reads.test.ts` comprueba bloqueo de las dos rutas de descarga antes de `fetch` sintético.
- `tests/sf-gov-candidate-runtime-probe.test.ts` ejercita la política compartida, pero **localmente**, no certifica HTTP remoto.

## Bloqueos que impiden cerrar B02

1. Vercel `demeterbueno`: Preview expone secretos globales; no hay Custom Environment Candidate. Deben verificarse scopes y efecto de cambios antes de tocar configuración.
2. GitHub ruleset de `main`: check `quality`, pero revisión humana obligatoria sin acreditar; `failure` del denial probe no basta.
3. Candidate `sdmxtlgjkodidjtvikng`: únicamente `sf-gov-candidate-denial-probe` aparece ACTIVE v1 con `verify_jwt=true`; el resto de código Edge de esta rama no constituye runtime desplegado. No efectuar llamadas a servicios reales.
4. Faltan prueba HTTP autenticada segura y enumeración completa del resto de funciones/crons/webhooks/rutas para demostrar cobertura universal.

Ver lista DoD, propiedad y traspaso en issue #287: https://github.com/mikevazquez/Demeter/issues/287. Nada de producción sin `Autorizo promoción` explícita ligada al SHA.
