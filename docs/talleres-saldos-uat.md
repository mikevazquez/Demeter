# Talleres y eventos: reglas aprobadas

Solo Sandbox. Produccion protegida.

- Catalogo de disciplinas independiente de sesiones.
- Precio completo o seleccion de varias sesiones individuales.
- Inscripcion opcional configurable por estudio y taller.
- Anticipo fijo o porcentual, con saldo y vencimiento.
- Reserva atomica tras confirmacion del pago y verificacion de todos los cupos.
- Saldo vencido: conservar y avisar, o liberar tras gracia configurable.
- Politica historica congelada por compra; pagos y reservas idempotentes.

## Matriz UAT pendiente

TALL-01 catalogo; 02 precios; 03 compra multiple; 04 capacidad; 05 inscripcion; 06 publico externo; 07 anticipo; 08 reserva atomica; 09 vencimiento; 10 abonos; 11 cancelacion; 12 Demi/portal; 13 regresion; 14 conservar y avisar; 15 liberar tras gracia; 16 carrera con pago; 17 politica historica; 18 aislamiento multiestudio.

Todos PENDIENTES. No promover sin autorizacion explicita.

## Evidencia tecnica parcial — Sandbox (2026-10-14)

**UAT cerrados: 0/18.** Los siguientes resultados no equivalen a aprobacion integral del caso.

| Caso                    | Evidencia verificada                                                                             | Estado del caso                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| TALL-04 capacidad       | Segunda compra sintetica rechazo con `session_full`; 0 compras, ventas y reservas nuevas         | Parcial; falta carrera real por ultimo cupo           |
| TALL-07 anticipo        | Compra sintetica de $600 con $300 registrado y saldo de $300; venta, pago y reserva vinculados   | Parcial; falta integrar pago verificado y UI          |
| TALL-08 reserva atomica | Primera compra genero 1 compra, 1 venta, 1 pago y 1 reserva; rechazo por cupo no persistio datos | Parcial; faltan fallos inducidos y multiples sesiones |
| TALL-13 regresion       | Seis consultas de integridad devolvieron true; RPC anon/authenticated sin permiso de ejecucion   | Parcial; falta suite automatizada y smoke completo    |

Idempotencia: reintento identico devolvio `replayed: true` sin duplicar registros. El 2026-10-14 se comprobo que importe diferente con la misma clave devuelve `idempotency_conflict` y que seleccion duplicada devuelve `duplicate_session`. Las compras concurrentes siguen pendientes.

Fixture de prueba: `scripts/uat/workshop-checkout-sandbox.sql` (solo lectura; ejecutar exclusivamente en Sandbox). Registro sintetico: compra `52389716-de8c-4330-88d6-a5398ab60c05`, venta `080f5a7c-8d3f-4abd-b77b-6be37a7f2569`.

**Bloqueador critico:** `workshop_checkout_confirm` acepta `p_confirmed_amount_minor` y `p_payment_method` suministrados por el invocador; el permiso `service_role` no verifica por si solo que el dinero haya sido recibido. No exponer el RPC a rutas de cliente, portal o Demi hasta reemplazar este contrato por evidencia de pago validada en backend. Inscripcion obligatoria falla cerrada, pendiente de integrar.

No merge, no despliegue a produccion, no promocion sin autorizacion explicita.

### Evidencia adicional de atomicidad — 2026-10-14 (Sandbox)

Se ejecutó un bloque PL/pgSQL de prueba con una elevación temporal de capacidad dentro de una subtransacción que se revierte al terminar. Se llamó a `workshop_checkout_confirm` para una alumna que ya tenía reserva activa, con clave sintética `55555555-5555-4555-8555-555555555555`. El RPC devolvió `student_already_reserved`; las aserciones verificaron ausencia de compra y venta persistidas para la clave y restauración de capacidad original a 1. El bloque terminó sin excepción. **Prueba técnica superada; no cierra UAT completo ni prueba concurrencia real.**

### Regresión SQL integrada — 2026-10-14

Se ejecutó íntegramente `scripts/uat/workshop-checkout-sandbox.sql` mediante Supabase MCP `execute_sql` en el proyecto Sandbox `hedouonyhynuvwbckdlg`. Resultado: bloque DO completado sin excepción (`[]`), lo que confirma todas las aserciones del script, incluidas integridad de compra/venta/pago/reserva, capacidad, permisos RPC, selección duplicada e idempotencia conflictiva. **No equivale a una prueba concurrente de dos conexiones, a autorización real de pago ni a aprobación formal de TALL-01–18.**

## Clasificación de cierre por caso — 2026-10-14

Regla: `APROBADO` solo con criterios completos y evidencia de ejecución; tests unitarios por sí solos no validan integración. Ningún caso aprobado aún.

| Caso                             | Estado    | Evidencia existente                          | Falta para aprobar                                        |
| -------------------------------- | --------- | -------------------------------------------- | --------------------------------------------------------- |
| TALL-01 catálogo                 | Pendiente | Tabla `workshop_offers` en Sandbox           | Flujo administrativo de alta/edición y separación visible |
| TALL-02 precios                  | Parcial   | Test unitario de cotización full/individual  | Integración de selección y precios persistidos            |
| TALL-03 compra múltiple          | Parcial   | Test unitario de dos sesiones                | Checkout real de varias sesiones y rollback               |
| TALL-04 capacidad                | Parcial   | Rechazo `session_full`                       | Dos conexiones concurrentes independientes                |
| TALL-05 inscripción              | Bloqueado | RPC falla cerrado si se requiere inscripción | Verificación de inscripción real                          |
| TALL-06 público externo          | Pendiente | Ninguna prueba integral                      | Compra de invitado sin inscripción si política permite    |
| TALL-07 anticipo                 | Parcial   | Compra sintética $600/$300                   | Confirmación de pago confiable y UI                       |
| TALL-08 reserva atómica          | Parcial   | Integridad y rollback de duplicado           | Compra de varias sesiones y fallos inducidos              |
| TALL-09 vencimiento              | Pendiente | Fecha de saldo en compra                     | Ciclo de vencimiento extremo a extremo                    |
| TALL-10 abonos                   | Pendiente | Pago inicial vinculado                       | Abonos posteriores e idempotencia                         |
| TALL-11 cancelación              | Pendiente | Sin evidencia                                | Cancelación y liberación correctas                        |
| TALL-12 Demi/portal              | Pendiente | Sin evidencia                                | Flujos reales y permisos                                  |
| TALL-13 regresión                | Parcial   | SQL integrado superado                       | Smoke y regresión funcional completos                     |
| TALL-14 conservar/avisar         | Parcial   | Test unitario de política                    | Ejecución real y notificación                             |
| TALL-15 liberar/gracia           | Parcial   | Test unitario de política                    | Liberación real, cupos y pagos tardíos                    |
| TALL-16 carrera con pago         | Bloqueado | Ejecutador preparado                         | Carrera real y autorización de pago confiable             |
| TALL-17 política histórica       | Parcial   | Snapshot al crear compra                     | Cambio posterior de política y verificación               |
| TALL-18 aislamiento multiestudio | Pendiente | RPC valida estudio                           | Pruebas negativas cruzadas en DB y portal                 |

**Orden de ejecución:** TALL-02, 03, 17 y 18 (pruebas SQL/negativas), luego 01, 05–12, 14–15; TALL-04/16 requieren ejecutor concurrente. No confundir avance parcial con cierre.

### Continuación TALL-02 · 14 octubre 2026

PARCIAL, 0/18 aprobados. Se reprodujo y corrigió en RPC v2 el error de seleccionar todas las sesiones individuales: 45000 esperado, 60000 obtenido en RPC original. Pruebas SQL v2: completo 60000, individuales 15000/30000/45000, coincidencia compra/venta/pago y reservas; idempotencia, snapshots y negativos pasaron con rollback de fixtures. Vitest 17/17. Evidencia, scripts, migración aplicada y límites en el apartado «Bloque TALL-02» de `docs/uat-talleres-18-casos-ejecucion.md`. Faltan autorización de pago confiable, interfaz integrada y persistencia durable; navegador requiere sesión administrativa de Sandbox. No certificar ni promover.
