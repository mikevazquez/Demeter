# UAT talleres — especificación ejecutable de los 18 casos

**Entorno:** exclusivamente Supabase Sandbox `hedouonyhynuvwbckdlg`, rama `feat/talleres-saldos-configurables-uat`. **Producción prohibida sin «autorizo promoción».** Datos sintéticos; ningún cobro real. Cada caso requiere evidencia de ejecución (IDs de fixtures, consulta/log, resultado esperado/obtenido y commit) antes de `APROBADO`. Tests unitarios y documentos no equivalen a aprobación funcional.

## TALL-01 — Catálogo

- **Criterio de aceptación:** Admin crea, edita y consulta taller independiente de clase normal; sesiones se muestran correctamente.
- **Procedimiento:** Crear oferta sintética, editar título/disciplina, verificar agenda y que clases ordinarias no cambian.
- **Dependencia a resolver:** Admin y agenda Sandbox.
- **Estado inicial:** PENDIENTE / PARCIAL según matriz principal. No aprobado.
- **Evidencia requerida:** resultado reproducible en Sandbox, aserciones positivas y negativas, comprobación de persistencia y ausencia de efectos laterales.

## TALL-02 — Precios

- **Criterio de aceptación:** Precio completo y selección individual producen totales correctos, sin sumar indebidamente precios individuales al comprar completo.
- **Procedimiento:** Oferta con 3 sesiones: completo 60000, dos individuales 30000; validar cotización, persistencia y UI.
- **Dependencia a resolver:** UI y checkout integrado.
- **Estado inicial:** PENDIENTE / PARCIAL según matriz principal. No aprobado.
- **Evidencia requerida:** resultado reproducible en Sandbox, aserciones positivas y negativas, comprobación de persistencia y ausencia de efectos laterales.

## TALL-03 — Compra múltiple

- **Criterio de aceptación:** Una compra selecciona 2+ sesiones; una venta, pago y reservas vinculadas; fallo de una sesión revierte todas.
- **Procedimiento:** Crear oferta 3 sesiones, adquirir 2 y luego forzar una agotada; comprobar conteos y rollback.
- **Dependencia a resolver:** Fixtures multi-sesión.
- **Estado inicial:** PENDIENTE / PARCIAL según matriz principal. No aprobado.
- **Evidencia requerida:** resultado reproducible en Sandbox, aserciones positivas y negativas, comprobación de persistencia y ausencia de efectos laterales.

## TALL-04 — Capacidad

- **Criterio de aceptación:** Último cupo se adjudica una vez, rechazo íntegro al segundo comprador.
- **Procedimiento:** Dos clientes independientes contra sesión de capacidad 1, una compra exitosa y una `session_full`.
- **Dependencia a resolver:** Ejecutor seguro de concurrencia.
- **Estado inicial:** PENDIENTE / PARCIAL según matriz principal. No aprobado.
- **Evidencia requerida:** resultado reproducible en Sandbox, aserciones positivas y negativas, comprobación de persistencia y ausencia de efectos laterales.

## TALL-05 — Inscripción

- **Criterio de aceptación:** Exigencia por estudio con override de oferta; inscripción vigente habilita, vencida bloquea.
- **Procedimiento:** Variar política en Sandbox y probar 4 combinaciones con alumno vigente/vencido.
- **Dependencia a resolver:** Verificador de inscripción.
- **Estado inicial:** PENDIENTE / PARCIAL según matriz principal. No aprobado.
- **Evidencia requerida:** resultado reproducible en Sandbox, aserciones positivas y negativas, comprobación de persistencia y ausencia de efectos laterales.

## TALL-06 — Invitados externos

- **Criterio de aceptación:** Prospecto/invitado puede comprar taller permitido sin inscripción y sin convertirse indebidamente en alumna activa.
- **Procedimiento:** Crear invitado sintético, comprar, comprobar identidad, cupo y restricciones.
- **Dependencia a resolver:** Flujo de invitados.
- **Estado inicial:** PENDIENTE / PARCIAL según matriz principal. No aprobado.
- **Evidencia requerida:** resultado reproducible en Sandbox, aserciones positivas y negativas, comprobación de persistencia y ausencia de efectos laterales.

## TALL-07 — Anticipo

- **Criterio de aceptación:** Anticipo fijo/porcentaje calcula saldo exacto; solo pago verificado reserva cupo.
- **Procedimiento:** 60000 total, 30000 fijo y 50%; pendiente transferencia no reserva; aprobado sí.
- **Dependencia a resolver:** Autorización de pago confiable.
- **Estado inicial:** PENDIENTE / PARCIAL según matriz principal. No aprobado.
- **Evidencia requerida:** resultado reproducible en Sandbox, aserciones positivas y negativas, comprobación de persistencia y ausencia de efectos laterales.

## TALL-08 — Atomicidad

- **Criterio de aceptación:** Venta, pago, compra y reservas se crean o revierten como unidad; reintentos idempotentes.
- **Procedimiento:** Forzar error después de insertar venta/pago y verificar cero efectos; repetir misma clave.
- **Dependencia a resolver:** Integración multi-sesión.
- **Estado inicial:** PENDIENTE / PARCIAL según matriz principal. No aprobado.
- **Evidencia requerida:** resultado reproducible en Sandbox, aserciones positivas y negativas, comprobación de persistencia y ausencia de efectos laterales.

## TALL-09 — Vencimiento

- **Criterio de aceptación:** Saldo, fecha y estado vencido se calculan según zona horaria/política; sin liberar prematuramente.
- **Procedimiento:** Simular antes, en y después de vencimiento y verificar estados.
- **Dependencia a resolver:** Motor de vencimientos.
- **Estado inicial:** PENDIENTE / PARCIAL según matriz principal. No aprobado.
- **Evidencia requerida:** resultado reproducible en Sandbox, aserciones positivas y negativas, comprobación de persistencia y ausencia de efectos laterales.

## TALL-10 — Abonos

- **Criterio de aceptación:** Abonos posteriores se registran una sola vez y actualizan saldo sin sobrepago.
- **Procedimiento:** Anticipo 30000, abono 10000, liquidación 20000; repetir evento; rechazar exceso.
- **Dependencia a resolver:** API abonos y ledger.
- **Estado inicial:** PENDIENTE / PARCIAL según matriz principal. No aprobado.
- **Evidencia requerida:** resultado reproducible en Sandbox, aserciones positivas y negativas, comprobación de persistencia y ausencia de efectos laterales.

## TALL-11 — Cancelación

- **Criterio de aceptación:** Cancelación actualiza compra/reservas y capacidad sin borrar históricos ni reembolsar automáticamente.
- **Procedimiento:** Cancelar compra sintética, verificar registros y políticas.
- **Dependencia a resolver:** Flujo cancelación.
- **Estado inicial:** PENDIENTE / PARCIAL según matriz principal. No aprobado.
- **Evidencia requerida:** resultado reproducible en Sandbox, aserciones positivas y negativas, comprobación de persistencia y ausencia de efectos laterales.

## TALL-12 — Demi y portal

- **Criterio de aceptación:** Portal y Demi informan, cotizan y reservan únicamente tras pago verificado; acceso por rol.
- **Procedimiento:** Probar conversación y UI de taller completo, parcial, agotado y pendiente.
- **Dependencia a resolver:** Integraciones y UAT conversacional.
- **Estado inicial:** PENDIENTE / PARCIAL según matriz principal. No aprobado.
- **Evidencia requerida:** resultado reproducible en Sandbox, aserciones positivas y negativas, comprobación de persistencia y ausencia de efectos laterales.

## TALL-13 — Regresión

- **Criterio de aceptación:** Smoke admin/alumna/Demi, pagos y reservas ordinarias siguen funcionando.
- **Procedimiento:** Suite SQL + smoke navegable y tests existentes.
- **Dependencia a resolver:** Smoke integrado.
- **Estado inicial:** PENDIENTE / PARCIAL según matriz principal. No aprobado.
- **Evidencia requerida:** resultado reproducible en Sandbox, aserciones positivas y negativas, comprobación de persistencia y ausencia de efectos laterales.

## TALL-14 — Conservar y avisar

- **Criterio de aceptación:** Saldo vencido conserva cupo, genera aviso idempotente y no duplica notificaciones.
- **Procedimiento:** Simular vencimiento dos veces, comprobar reserva y un aviso.
- **Dependencia a resolver:** Job y entrega notificación.
- **Estado inicial:** PENDIENTE / PARCIAL según matriz principal. No aprobado.
- **Evidencia requerida:** resultado reproducible en Sandbox, aserciones positivas y negativas, comprobación de persistencia y ausencia de efectos laterales.

## TALL-15 — Liberar tras gracia

- **Criterio de aceptación:** Solo tras gracia se libera cupo; pago tardío no genera doble asignación ni reembolso automático.
- **Procedimiento:** Antes/dentro/después de gracia; competir pago y liberación.
- **Dependencia a resolver:** Job transaccional.
- **Estado inicial:** PENDIENTE / PARCIAL según matriz principal. No aprobado.
- **Evidencia requerida:** resultado reproducible en Sandbox, aserciones positivas y negativas, comprobación de persistencia y ausencia de efectos laterales.

## TALL-16 — Carrera con pago

- **Criterio de aceptación:** Pago confirmado y liberación/cupo concurrentes mantienen integridad, sin doble cargo ni sobreventa.
- **Procedimiento:** Dos conexiones y eventos de pago/release simultáneos.
- **Dependencia a resolver:** Autorización real y runner.
- **Estado inicial:** PENDIENTE / PARCIAL según matriz principal. No aprobado.
- **Evidencia requerida:** resultado reproducible en Sandbox, aserciones positivas y negativas, comprobación de persistencia y ausencia de efectos laterales.

## TALL-17 — Política histórica

- **Criterio de aceptación:** Compra conserva snapshot de reglas aunque cambie configuración de estudio/oferta.
- **Procedimiento:** Crear compra, modificar reglas y comparar snapshot/decisión.
- **Dependencia a resolver:** Prueba DB sobre snapshot.
- **Estado inicial:** PENDIENTE / PARCIAL según matriz principal. No aprobado.
- **Evidencia requerida:** resultado reproducible en Sandbox, aserciones positivas y negativas, comprobación de persistencia y ausencia de efectos laterales.

## TALL-18 — Multiestudio

- **Criterio de aceptación:** Ningún usuario, oferta, sesión, venta o pago de otro tenant puede consultarse o modificarse.
- **Procedimiento:** Crear tenant B sintético y ejecutar accesos cruzados y RLS.
- **Dependencia a resolver:** Fixture segundo tenant y permisos.
- **Estado inicial:** PENDIENTE / PARCIAL según matriz principal. No aprobado.
- **Evidencia requerida:** resultado reproducible en Sandbox, aserciones positivas y negativas, comprobación de persistencia y ausencia de efectos laterales.

## Protocolo de cierre

1. Preparar fixture y comprobar precondiciones; abortar si no es Sandbox.
2. Ejecutar escenarios positivos y negativos, incluyendo idempotencia y permisos cuando corresponda.
3. Comprobar efectos en DB y UI/WhatsApp si forman parte del criterio.
4. Corregir fallo en rama, repetir y adjuntar evidencia.
5. Marcar `APROBADO` solo si todos los criterios están probados; de lo contrario `PARCIAL`, `FALLÓ` o `BLOQUEADO`.
6. No merge, no promoción y no manipular pagos reales.
