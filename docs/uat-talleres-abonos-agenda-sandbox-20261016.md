# UAT de abonos de Talleres desde Agenda — Sandbox (16 oct 2026)

Entorno: Supabase Sandbox `hedouonyhynuvwbckdlg`, Vercel preview, PR #284.
SHA desplegado y READY: `2551664d3fb547755e24fb808e939f706bb87e26`.
SHA posterior del código de Agenda: `9290e9c5774e2d3d4363d98a98a01f82f03d090f` (también READY, previo a migración).
**Ningún cambio a producción.**

## Verificación SQL de Sandbox

- Seis compras / ocho reservas; cero cruces erróneos de alumna, sesión, estudio.
- Dos compras con abono inicial $300 y saldo $300.
- Índice único `workshop_agenda_abono_reference_unique` instalado; protege la misma referencia para la misma venta.
- Trigger `workshop_paid_from_sale_payment` instalado; sincroniza `workshop_purchases.paid_minor` a partir de `payments`.
- Prueba transaccional con `DO` y subtransacción revertida: insertar abono temporal de $100, comprobar incremento, reintentar la misma referencia y verificar rechazo por `unique_violation`, revertir y comprobar saldo original: **PASÓ**.
- Prueba transaccional con `DO` y subtransacción revertida: insertar liquidación temporal del saldo, comprobar `paid_minor = total_minor`, revertir y comprobar estado original: **PASÓ**.
- Control posterior: cero pagos UAT persistidos y cero discrepancias de acumulados: **PASÓ**.

## Pruebas pendientes (NO marcarlas aprobadas)

- UAT del navegador autenticado en la tarjeta de Agenda: abrir cobro, registrar abono y comprobar refresco de la tarjeta.
- Ejecución real como usuario autenticado del RPC `register_sale_payment`; rechazo de pago mayor que saldo.
- Validación de doble clic, recarga/reenvío y comprobación de mensajes.
- Revisión de flujo de asistencia inalterado.

No se han insertado cobros permanentes. Las pruebas SQL anteriores verifican persistencia e integridad, pero no sustituyen el UAT de extremo a extremo.
