# Studio Flow · Cierre UAT F9 — Ventas/Pagos

Fecha de aprobación: 2026-09-15

Fuente funcional: `StudioFlow_Documento_Maestro_TOTAL_v3_con_mockups.docx`.

## Estado

**F9 · Ventas/Pagos: CERRADA / APROBADA POR UAT.**

La aprobación funcional fue confirmada por el propietario del producto en producción después de validar el flujo comercial completo y su integración con reservas, asistencia e inscripción.

## Alcance validado

- SF-083 Sale / SaleLine.
- SF-084 Payment.
- SF-085 wizard de venta manual.
- SF-086 registro de pago posterior.
- SF-087 pagos parciales y saldo.
- SF-088 creación del derecho comercial correspondiente al confirmar venta.
- SF-089 anti-duplicación de adquisición/créditos.
- SF-090 detalle de venta e historial.
- SF-091 anulación con motivo, trazabilidad y preservación de historia.
- SF-092 reembolso total/parcial por línea, manual en MVP.
- SF-093 inscripción configurable por estudio.

## Reglas confirmadas

1. Sale, Payment, ProductAcquisition y StudentEnrollment permanecen separados como conceptos de dominio.
2. Una venta puede iniciar sin pago, con pago parcial o con pago total.
3. Pagos posteriores nunca recrean adquisiciones ni vuelven a otorgar créditos.
4. Reembolsos son por SaleLine y pueden ser monetariamente totales o parciales; cualquier reembolso invalida el derecho futuro asociado a esa línea sin borrar su historia.
5. Un paquete reembolsado conserva ledger, consumos y asistencias anteriores, pero deja de poder usarse.
6. Una inscripción reembolsada conserva historia pero deja de satisfacer eligibility.
7. Si una adquisición sostiene reservas futuras, reembolso/anulación se bloquean hasta resolver esas reservas por el flujo normal.
8. Anular no mueve dinero; si hay fondos cobrados sin devolver, primero deben registrarse reembolsos.
9. La inscripción es un derecho administrativo, no un paquete: no otorga clases, créditos ni disciplinas.
10. La política de inscripción pertenece al estudio y puede exigir inscripción vigente para reservar.
11. La falta de inscripción obligatoria no puede saltarse mediante el fallback de walk-in.
12. Vigencia de inscripción soporta 30 días, 3 meses, 6 meses, 1 año, días específicos y vitalicia.
13. Inscripción vitalicia se representa sin vencimiento (`validity_days = NULL`, `expires_on = NULL`), no mediante una fecha artificialmente lejana.
14. Sólo inscripción puede tener vigencia nula; los productos de clases mantienen vigencia finita.
15. El historial comercial no se elimina por reembolso ni anulación.

## UAT funcional aprobado

Se validaron en producción los siguientes bloques:

- navegación responsive y agrupación Hoy / Alumnas / Empresa;
- catálogo, creación, edición, duplicado y activación/desactivación de productos;
- inscripción como derecho administrativo;
- presets de vigencia y vitalicia;
- política de inscripción y `required_for_booking`;
- venta con uno o varios productos;
- pago inicial cero/parcial/total;
- pagos posteriores y saldo;
- adquisición y créditos correctos;
- inscripción sin créditos ni ProductAcquisition;
- detalle de venta y estados económicos;
- reembolso total y parcial de paquete;
- reembolso de inscripción;
- reembolso selectivo en venta multiproducto;
- bloqueo por reservas futuras;
- anulación y requisito de devolver fondos primero;
- inscripción obligatoria dentro de eligibility;
- interacción correcta con walk-in F8;
- conservación de historial y anti-duplicación;
- flujo integrado de punta a punta.

## Validación técnica final

- Supabase: migraciones F9 aplicadas, incluyendo ventas/pagos, reembolsos/anulaciones, inscripción, eligibility y vigencia vitalicia.
- Seguridad: RLS y capabilities aplicadas sobre operaciones comerciales/configuración.
- CI: format, lint, typecheck, unit tests y build en verde para los bloques de cierre.
- Vercel: deployments de producción exitosos para los merges aprobados.
- UAT producción: aprobado por producto.

## Regla de cierre

F9 no se reabre salvo bug/regresión o un cambio de alcance aprobado explícitamente. Las fases posteriores deben reutilizar estos contratos y no redefinirlos de forma implícita.
