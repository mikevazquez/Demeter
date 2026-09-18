# FLUJO 01 · UAT · Alta completa de alumna

Entorno de validación: Vercel Preview conectado exclusivamente a Studio Flow Sandbox.

## Casos obligatorios

1. Alta nueva
   - Crear una alumna con teléfono no registrado.
   - Confirmar que Studio Flow abre el alta de la misma alumna sin volver a buscarla.
   - Terminar sin paquete y comprobar que finaliza en Perfil 360.

2. Duplicado activo
   - Intentar registrar un teléfono ya existente.
   - Confirmar que no se crea otra alumna y se abre el Perfil 360 existente.

3. Duplicado archivado
   - Intentar registrar el teléfono de una alumna archivada.
   - Confirmar que no se crea un duplicado y se ofrece resolver el expediente existente.

4. Compra inicial
   - Elegir un paquete activo.
   - Probar inicio hoy, fecha específica y primer uso.
   - Confirmar que precio, créditos y vigencia provienen del producto.

5. Primer uso / primer crédito
   - Comprar un paquete con inicio por primer uso.
   - Reservar una clase.
   - Confirmar que la reserva por sí sola no inicia la vigencia.
   - Confirmar que una cancelación a tiempo libera el crédito y no activa el paquete.
   - Confirmar que asistencia, no-show o cancelación tardía consumen el crédito y activan el paquete.
   - Confirmar que inicio y vencimiento se calculan desde la fecha de la clase que generó el primer consumo.

6. Pago total
   - Registrar el total.
   - Confirmar venta, pago, adquisición y créditos sin duplicados.

7. Pago parcial
   - Registrar un monto menor al total.
   - Capturar fecha compromiso o seguimiento.
   - Confirmar que existe un solo derecho adquirido y un saldo pendiente.

8. Pago pendiente
   - Registrar cero de pago.
   - Confirmar que el paquete no permite reservar.
   - Repetir autorizando la excepción y capturando motivo; confirmar que queda auditada.

9. Descuento o cortesía
   - Probar porcentaje, monto y cortesía total.
   - Confirmar que el precio de lista histórico se conserva y el ajuste queda registrado.

10. Consumos previos
    - Registrar créditos ya consumidos.
    - Confirmar que se crea un ajuste auditable sin inventar asistencias.

11. Inscripción
    - Cuando la política del estudio esté habilitada, confirmar que sólo se solicita si corresponde.
    - Confirmar que la UX sólo expone las dos vigencias aprobadas: 1 año y vitalicia.
    - Validar la inscripción anual con vencimiento a 365 días.
    - Validar la inscripción vitalicia sin fecha de vencimiento.
    - Confirmar que la venta conserva el producto de inscripción exacto utilizado.

12. Primera reserva
    - Desde Perfil 360 seleccionar Reservar primera clase.
    - Confirmar que la alumna permanece en contexto.
    - Verificar validaciones reales de cupo, disciplina, inscripción, pago y créditos.

13. Retroalimentación de acciones
    - Al crear alumna, completar alta, reservar o guardar cambios, el botón debe cambiar inmediatamente a estado de carga.
    - El estado de carga debe mostrar indicador visual y texto de proceso.
    - Mientras la acción está pendiente, el botón debe quedar deshabilitado para evitar doble envío.
    - Al terminar, debe aparecer la confirmación o el error correspondiente sin requerir un segundo toque.

## Criterio de aprobación

FLUJO 01 se aprueba sólo si todos los casos aplicables terminan sin duplicar alumnas, ventas, pagos, adquisiciones, inscripciones ni créditos, y toda la experiencia visible permanece en español de México.


## Estado de UAT

- Inscripción anual: aprobada.
- Inscripción vitalicia: aprobada.
- Validación de teléfono como popup: pendiente de confirmación visual.
