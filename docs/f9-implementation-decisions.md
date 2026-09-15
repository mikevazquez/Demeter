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

### Decisión aprobada — efecto del reembolso

Se permiten dos tipos de reembolso: **total** y **parcial**.

#### Reembolso total

- Se registra el reembolso por el total reembolsable de la venta.
- La ProductAcquisition/paquete **no se elimina**.
- La adquisición se marca como **reembolsada/inactiva** y deja de ser utilizable inmediatamente.
- Los créditos futuros o todavía disponibles dejan de poder utilizarse.
- Los créditos ya utilizados, consumidos o con historia previa permanecen en el ledger exclusivamente como histórico.
- No se borran movimientos anteriores del ledger ni se reescribe la historia de uso.

#### Reembolso parcial

- Se registra únicamente el monto elegido, siempre limitado por el monto reembolsable disponible.
- La ProductAcquisition/paquete **tampoco se elimina**.
- Aun siendo parcial, la adquisición se marca como **reembolsada/inactiva** y deja de ser utilizable inmediatamente.
- Los créditos futuros o disponibles dejan de poder utilizarse.
- Los créditos ya utilizados permanecen únicamente como histórico.
- El monto no reembolsado permanece como parte del historial económico de la venta; el reembolso no modifica retrospectivamente los pagos originales.

#### Reservas y crédito

- Un paquete reembolsado no puede utilizarse para crear nuevas reservas.
- El ledger es histórico: no se eliminan `grant`, `reserve`, `release` ni `consume` existentes.
- La implementación debe invalidar el derecho futuro de uso de la adquisición sin borrar consumo histórico.
- Antes de aplicar un reembolso, el sistema deberá resolver de forma explícita cualquier reserva futura todavía activa que esté sostenida por esa adquisición, para evitar que quede una reserva respaldada por un paquete inactivo. La mecánica concreta de esa resolución debe reutilizar las reglas de cancelación/liberación existentes y conservar historia.

### Método de reembolso — MVP y futuro

**MVP:**

- El reembolso es una operación **manual** registrada por administración.
- No existe integración automática con procesadores de pago.
- Se registra monto, método, motivo, fecha y usuario que realizó la operación.
- Ejemplo válido: devolución en efectivo registrada manualmente.

**Futuro:**

- Cuando existan integraciones de pago, el sistema podrá ejecutar el reembolso directamente al método/origen compatible de la transacción original.
- Ejemplo: una compra realizada con tarjeta podrá reembolsarse directamente a esa misma tarjeta cuando el proveedor de pagos lo permita.
- La integración futura no cambia el modelo de dominio: Refund seguirá siendo una operación separada e histórica vinculada a la venta/pago original.

### Anulación

La anulación sigue siendo una corrección comercial distinta del reembolso:

- requiere motivo obligatorio y confirmación;
- conserva venta, líneas, pagos y adquisiciones como historia;
- no borra registros;
- cualquier efecto sobre una adquisición ya utilizada debe ser explícito y trazable, nunca un overwrite silencioso.

## SF-093 — inscripción configurable

### Decisión aprobada

La inscripción **no tendrá reglas globales fijas de Studio Flow**. Cada estudio define su propia política y el sistema debe permitir configurarla.

La inscripción se modelará como una política/configuración del estudio que puede participar tanto en el flujo comercial como en eligibility.

Debe poder determinar, mediante configuración del estudio:

- si la inscripción está habilitada o no;
- si es obligatoria para reservar;
- qué compras/productos requieren inscripción;
- si existen excepciones por tipo de producto o tipo de compra;
- vigencia de la inscripción;
- importe de inscripción cuando corresponda;
- condiciones de primera compra/primera clase;
- reglas de renovación;
- comportamiento cuando la inscripción está vencida;
- si una venta puede incluir el cobro de inscripción junto con otros productos.

El estado de inscripción pertenece a la alumna/persona y debe conservar al menos estado, fecha de inicio, fecha de vencimiento y origen comercial cuando exista.

Eligibility consultará la política del estudio y el estado vigente de la alumna; no debe contener reglas hardcodeadas específicas de Demeter ni de otro estudio.

La edición completa de estas políticas pertenece funcionalmente a Configuración/F12, mientras que F9 implementará la capacidad comercial mínima necesaria para cobrar/registrar inscripción conforme a la configuración vigente.

## Estado de F9

F9 permanece **ABIERTA**.

El bloque SF-083–SF-090 está implementado técnicamente. Las decisiones de negocio principales de SF-091, SF-092 y SF-093 ya están cerradas a nivel funcional. Falta implementar esos flujos, cubrir QA funcional/UAT comercial y realizar el cierre formal de la fase.
