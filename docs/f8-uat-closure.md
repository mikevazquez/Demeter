# Studio Flow · Cierre UAT F8 — Asistencia

Fecha de aprobación: 2026-09-15

Fuente funcional: `StudioFlow_Documento_Maestro_TOTAL_v3_con_mockups.docx`.

## Estado

**F8 · Asistencia: CERRADA / APROBADA POR UAT.**

La aprobación funcional fue confirmada por el propietario del producto en producción después de validar los flujos principales de asistencia.

## Alcance validado

- SF-073 Roster de clase.
- SF-074 Marcar `attended`.
- SF-075 Marcar `no_show`.
- SF-076 Agregar walk-in existente, incluyendo alumna sin adquisición vigente como operación pendiente de resolución comercial.
- SF-077 Alta mínima de nueva alumna walk-in.
- SF-078 Resumen de asistencia.
- SF-079 Finalizar asistencia.
- SF-080 Efectos correctos sobre créditos usando el snapshot `credits_held`.
- SF-081 Corrección posterior autorizada, con motivo y trazabilidad.
- SF-082 Contratos/tests de reglas de asistencia.

## Reglas confirmadas

1. `no_show` permanece visible en el roster pero no ocupa cupo.
2. `attended` y `no_show` quedan visualmente marcados en la UI.
3. Una reserva finita no pierde crédito dos veces al finalizar: el hold se libera y se convierte en un único consumo.
4. Membresías ilimitadas no generan movimientos finitos de consumo.
5. Finalizar es idempotente y no duplica consumo.
6. Correcciones `attended ↔ no_show` posteriores a finalizar requieren motivo y generan traza; no modifican nuevamente el ledger.
7. Un walk-in existente sin paquete puede agregarse a la clase sin inventar venta, pago o adquisición. La resolución comercial pertenece a F9.
8. Un walk-in nuevo crea expediente mínimo y reserva sin adquisición vinculada; la venta/producto se resuelve después.

## Validación técnica final

- Supabase: migraciones F8 aplicadas, incluyendo `f8_existing_walkin_without_package`.
- Seguridad: funciones F8 requieren sesión autenticada y capabilities correspondientes; no se expusieron a `anon`.
- CI: format, lint, typecheck, unit tests y build en verde.
- Vercel: deployment de producción exitoso.
- UAT producción: aprobado por producto.

## Siguiente fase

La siguiente fase habilitada por orden del backlog es **F9 · Ventas/Pagos (SF-083–SF-093)**. F9 no forma parte del cierre de F8.
