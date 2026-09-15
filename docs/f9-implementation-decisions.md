# F9 · Ventas y pagos — decisiones de implementación

Fuente funcional: `StudioFlow_Documento_Maestro_TOTAL_v3_con_mockups.docx` y documentos de predesarrollo compatibles.

Este documento registra el estado real de F9 y evita completar reglas comerciales mediante supuestos no aprobados.

## SF-083–SF-090 — núcleo comercial

Implementado en `main`:

- SF-083 Sale / SaleLine.
- SF-084 Payment.
- SF-085 wizard de venta manual: Alumna → Productos → Pago → Confirmar.
- SF-086 registrar pago posterior.
- SF-087 total / pagado / saldo separados.
- SF-088 ProductAcquisition creada al confirmar una línea de producto que otorga acceso a clases.
- SF-089 anti-duplicación: una adquisición por SaleLine; pagos posteriores no recrean adquisición ni créditos.
- SF-090 detalle de venta con productos, derechos adquiridos e historial de pagos.

Reglas técnicas vigentes:

- Dinero persistido en unidades menores.
- Sale, Payment y fulfillment comercial son conceptos separados.
- Venta manual puede iniciar con pago cero, parcial o total.
- Una línea de paquete/membresía/clase genera como máximo una ProductAcquisition.
- Productos finitos generan un único movimiento `grant` inicial; membresías ilimitadas no generan créditos finitos.
- Registrar pagos posteriores sólo afecta pagos/saldo comercial.
- Acceso comercial protegido por `sales.read` / `sales.write`, RLS y validación servidor.

## SF-091 / SF-092 — reembolso y anulación

Implementado e integrado en `main` mediante el bloque de reembolsos/anulaciones.

### Reembolso

Se permiten reembolsos totales o parciales de dinero por una **SaleLine concreta**.

- El monto nunca puede exceder lo todavía reembolsable de la línea ni el dinero neto efectivamente cobrado.
- Un reembolso no elimina Sale, SaleLine, Payment, ProductAcquisition, StudentEnrollment ni movimientos históricos.
- En el MVP el dinero se devuelve fuera de Studio Flow y aquí se registra manualmente método, monto, motivo, referencia/notas, fecha y usuario.
- Cualquier reembolso sobre una línea invalida su derecho futuro de uso, aunque el monto monetario sea parcial.
- Para un paquete, la ProductAcquisition queda cancelada/reembolsada y el ledger se conserva como historia.
- Para una inscripción, StudentEnrollment queda `refunded` y se conserva su origen comercial.
- Si una ProductAcquisition sostiene reservas futuras activas, el reembolso se bloquea hasta cancelar esas reservas por el flujo normal.
- El reembolso no genera deuda nueva.

La vista comercial separa **Total vendido, Cobrado, Reembolsado, Neto cobrado y Saldo**. Una línea reembolsada deja de formar parte de lo todavía cobrable.

### Anulación

La anulación es una corrección comercial distinta del reembolso.

- Requiere motivo obligatorio y confirmación.
- No mueve dinero en el MVP.
- Si existe dinero cobrado no devuelto, primero deben registrarse los reembolsos.
- Si una adquisición sostiene reservas futuras, la anulación se bloquea hasta resolverlas por el flujo normal.
- Conserva venta, líneas, pagos, derechos y ledger como historia.
- Los derechos activos vinculados a la venta quedan cancelados/inactivos al anular.

## SF-093 — inscripción configurable

### Modelo

La inscripción no tiene reglas globales hardcodeadas de Demeter ni de otro estudio.

Se modela con tres piezas distintas:

1. Un `product_template` de tipo `enrollment` define el **precio y vigencia comercial**.
2. `enrollment_policies` define la **política vigente del estudio**.
3. `student_enrollments` conserva el **estado de inscripción de cada alumna** y su origen comercial.

Una inscripción no es un paquete:

- no crea ProductAcquisition;
- no genera créditos;
- no genera movimientos en `credit_ledger`;
- no asigna disciplinas;
- conserva `starts_on`, `expires_on`, estado y Sale/SaleLine de origen.

### Política mínima implementada en F9

El estudio puede configurar:

- inscripción habilitada o deshabilitada;
- producto de inscripción activo que puede venderse;
- si una inscripción vigente es obligatoria para reservar;
- un objeto `rules` reservado para reglas avanzadas posteriores.

La pantalla administrativa mínima vive en `Ventas → Inscripción`. La edición completa y más amplia de políticas seguirá perteneciendo funcionalmente a Configuración/F12.

El campo `rules` es **infraestructura preparada**, no un motor de reglas avanzado terminado. F9 no implementa todavía excepciones detalladas por primera clase, tipo de compra, renovación especial u otras reglas que pertenezcan a F12.

### Venta de inscripción

Cuando la política está habilitada:

- sólo el producto `enrollment` seleccionado por la política puede aparecer como inscripción vendible;
- puede incluirse en una venta manual junto con otros productos;
- confirmar la venta crea `student_enrollments` para esa línea;
- la vigencia se deriva del producto de inscripción;
- no se fabrican créditos ni adquisiciones de clase.

Cuando la política está deshabilitada o no existe, un producto de tipo inscripción no puede venderse como inscripción configurada.

### Eligibility de reserva

`booking_eligibility` es la fuente canónica tanto para administración como para reserva propia de alumna.

Si `enrollment_policies.enabled=true` y `required_for_booking=true`, eligibility exige que la alumna tenga una `student_enrollments`:

- del mismo estudio;
- con estado `active`;
- iniciada a más tardar en la fecha de la clase;
- sin vencimiento anterior a la fecha de la clase.

Si no existe, responde `enrollment_required` y la reserva no continúa.

Este bloqueo **no puede convertirse automáticamente en walk-in**. El fallback administrativo de walk-in para alumna existente sigue limitado a problemas comerciales de paquete/cobertura/créditos (`no_active_product`, `outside_product`, `no_credits`).

Actualmente el portal de alumna todavía no expone un flujo activo de reservar desde su dashboard; cuando ese flujo se habilite, consumirá el mismo `booking_eligibility` y por tanto la regla ya queda centralizada en backend.

### Seguridad y trazabilidad

- `enrollment_policies` y `student_enrollments` tienen RLS.
- Mutaciones directas para authenticated están revocadas; las escrituras se realizan por funciones de dominio.
- `set_enrollment_policy` requiere `settings.write`.
- La creación de inscripción ocurre dentro de `create_manual_sale`, protegido por `sales.write`.
- Reembolso/anulación usan los mismos controles comerciales e historia que el resto de F9.

## Estado de F9

F9 permanece **ABIERTA**.

- SF-083–SF-092 están integradas en `main`.
- SF-093 está implementada técnicamente en la rama `_f9_enrollment`, incluida la integración real con `booking_eligibility`.
- Falta pasar la rama por PR/CI/Vercel, integrarla en `main`, verificar producción y ejecutar UAT comercial.
- F9 sólo podrá cerrarse formalmente después de esas verificaciones y de la aprobación de UAT del usuario.
