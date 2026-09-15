# F9 · Ventas y pagos — decisiones de implementación

Fuente funcional: `StudioFlow_Documento_Maestro_TOTAL_v3_con_mockups.docx` y documentos de predesarrollo compatibles.

Este documento registra el estado real de F9 y evita completar reglas comerciales mediante supuestos no aprobados.

## Bloque implementado

Implementado en `main`:

- SF-083 Sale / SaleLine.
- SF-084 Payment.
- SF-085 wizard de venta manual: Alumna → Productos → Pago → Confirmar.
- SF-086 registrar pago posterior.
- SF-087 total / pagado / saldo separados.
- SF-088 ProductAcquisition creada al confirmar la venta.
- SF-089 anti-duplicación: una adquisición por SaleLine; pagos posteriores no recrean adquisición ni créditos.
- SF-090 detalle de venta con productos, adquisición e historial de pagos.

Reglas técnicas vigentes:

- Dinero persistido en unidades menores.
- Sale, Payment y ProductAcquisition son entidades separadas.
- Venta manual puede iniciar con pago cero, parcial o total.
- Una línea de venta genera como máximo una ProductAcquisition.
- Productos finitos generan un único movimiento `grant` inicial; membresías ilimitadas no generan créditos finitos.
- Registrar pagos posteriores sólo afecta pagos/saldo comercial.
- Acceso comercial protegido por `sales.read` / `sales.write`, RLS y validación servidor.

## SF-091 / SF-092 — anulación y reembolso

El Documento Maestro define:

- Anular requiere motivo obligatorio, confirmación y conservación de historia.
- Reembolsar requiere monto no mayor al reembolsable, método, motivo y conservación de historia.
- La operación debe registrar el efecto comercial; no debe borrar historia.

### Regla todavía no definida por la fuente de verdad

No existe una regla aprobada que indique qué debe pasar automáticamente con una ProductAcquisition y su ledger cuando una venta se anula o reembolsa después de que sus créditos fueron reservados o consumidos.

Por lo tanto, hasta definir esa política no se implementará de forma implícita ninguna de estas conductas:

- borrar una adquisición;
- eliminar movimientos históricos del ledger;
- restaurar créditos consumidos;
- cancelar reservas existentes;
- cancelar automáticamente el paquete ante cualquier reembolso parcial o total.

SF-091/SF-092 pueden registrar historia comercial una vez que la política de efecto sobre Acquisition/créditos quede explícitamente cerrada.

## SF-093 — inscripción configurable

Las fuentes establecen que la inscripción:

- es configurable;
- tiene estado/vigencia en el perfil de la alumna;
- puede participar en eligibility y bloquear una reserva cuando sea requerida.

El modelo de predesarrollo la ubica como `enrollment/configuración`, mientras que configuración de políticas/eligibility también aparece en F12.

### Regla todavía no definida por la fuente de verdad

Aún no se especifica en F9:

- si la inscripción es un producto vendible o una entidad comercial separada;
- precio inicial y forma de cobro;
- duración/vigencia configurable;
- qué productos o tipos de compra la exigen;
- cuándo una primera clase queda exenta;
- reglas de renovación.

No se implementará SF-093 con valores o comportamientos inventados. Debe cerrarse esta definición antes de conectar inscripción con Ventas y posteriormente con eligibility/F12.

## Estado de F9

F9 permanece **ABIERTA**.

El bloque SF-083–SF-090 está implementado técnicamente. Faltan SF-091, SF-092, SF-093, QA funcional/UAT de los flujos comerciales y el cierre formal de la fase.
