# Aclaración de alcance de Mike · 22 oct 2026

**Decisión posterior:** [C07 · objeciones al anticipo](../demi-cash-objections-20261022/README.md) sustituye la interpretación histórica de X → humano que aparece abajo: primera objeción, una explicación; segunda negativa, visita sin reserva sujeta a cupo, sin derivación por ese motivo. La alumna conserva su flujo de deuda. El historial inferior no acredita la nueva conversación.

Esta decisión posterior actualiza el alcance de la matriz de `f5f9c056`; no reescribe las corridas ni convierte los fallos históricos en aprobados. Runtime observado: `5feefafb38a98e57a91b749e514a52c0a1212a8b`; único backend: Studio Flow Sandbox `hedouonyhynuvwbckdlg`. Este bloque sólo modifica documentación/evidencia y consulta datos existentes; no ejecuta nuevas compras, reservas ni mensajes.

## Efectivo y derivación

- Prospecto: después de explorar las opciones de pago anticipado, puede acudir al estudio a pagar en efectivo, sin reserva, retención ni garantía de lugar. Elegir efectivo no exige derivación humana inmediata.
- Alumna: mantener el alta del paquete con deuda y la fecha de pago acordada; advertir que la vigencia comienza con su primera clase/reserva según la regla existente aunque no asista, y que la deuda sigue pendiente. No registrar efectivo como cobrado antes de recibirlo.
- La derivación se hace al agotar X intentos, no al elegir efectivo. Mike no fijó aquí un número. El límite de tres probado en M09 corresponde exclusivamente a fallos de `booking.create`; no acredita contador ni umbral de compra en efectivo. En `confirmCashPackage` el error RPC devuelve `cash_purchase_failed` sin llamar al contador de reservas. Cobertura de X en efectivo: PENDIENTE, sin inventar un valor ni declararla aprobada.
- MATRIX-F01 continúa FALLIDO: crear el paquete de la alumna falla con 42501 sobre `private.product_purchase_eligibility`. Eso es una avería técnica de la operación acordada; no una regla de derivación por pagar en efectivo. Deuda, vigencia, no_show y cobro posterior necesitan repetirse después de corregirla.

## A07 pertenece al proceso manual

La decisión y ejecución de convertir la clase inicial en paquete, aplicar el abono y elegir A/B corresponden a una persona. Demi no ejecuta esa conversión ni presupone qué eligió la persona. A07 sale de los bloqueos para aprobar la automatización de Demi; no se pide implementar esa integración de motor en este incremento.

Las reglas comerciales A/B y el probe `a07-engine-results.json` se conservan como referencia histórica del proceso manual. Su resultado anterior `BLOCKED_ENGINE_DEPENDENCY` describe la expectativa automatizada de aquella corrida y queda superado como requisito de Demi por esta decisión. La reclasificación no aprueba ni prueba el procedimiento administrativo manual, la compatibilidad, los ilimitados o su concurrencia.

## Transferencia y reserva: débito comprobado

El caso que sí corresponde a Demi es comprar el paquete por transferencia y reservar después descontando exactamente un crédito. Ya pasó en el run `0a4a29f7-2320-4609-a4ae-8c954ca1a847`; una lectura adicional de Sandbox confirma el mismo estado. Evidencia compacta: `transfer-credit-reinspection.json`.

- Intención `14bbb6ce-06cf-4986-a8c1-9dcebaef4201`: `validated`; un pago de 80000 centavos, inscripción más paquete.
- Paquete `3cbec8c3-268c-4745-aab7-4c55a5f8a707`: alta de ocho créditos y un único movimiento `reserve` de −1; saldo siete.
- Reserva `78d34736-9cbf-4571-9a75-801af2786dbc`: `reserved`, un crédito retenido, cobertura del paquete.
- Vigencia conservada: 22 oct–21 nov 2026. Revisión administrativa repetida sin duplicar pago en la evidencia original.

El comprobante fue sintético y se validó con el RPC administrativo real de Sandbox: esto acredita el flujo observado y el débito en DB, no una transferencia bancaria/OCR reales ni Meta externo. MATRIX-F03 permanece: el texto de Demi expresaba dudas de validación pese al estado validado. No se observó falta de descuento de crédito.

## Pendientes vigentes

Corregir y repetir efectivo, consulta de política por asistente, visibilidad del pago validado y recordatorio duplicado; investigar elegibilidad/timeouts; preparar aceptación funcional de Mike. Aplicar y probar la derivación tras X intentos de efectivo sin trasladar indebidamente el contador de reservas. A07 manual no es un defecto de automatización de Demi.

CI de `f5f9c056`: workflow principal `39795089490` SUCCESS; Supervisor `39795089626` FAILURE, 153/154 pruebas, caso «checkpoint drift detected by the next independent observer prevents a second process» (`idle` observado, `uncertain` esperado). No se declara aprobación global ni se atribuye ese fallo al flujo comercial sin investigar.

No se cambió aplicación, migraciones, permisos, reglas, producción, variables, despliegues, canales o adapters. DEMI-PILOT-01 sigue bloqueado/inactivo; PR #367 sigue borrador y Release No listo.
