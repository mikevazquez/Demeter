# CRM — contrato de estados Demi

Fuente revisada: https://demi-configuracion.btpxf7mkxc.chatgpt.site
Commit de referencia: 3f3ab862e191e53cf1172cb484e1e622915b9d7e (8 oct 2026).

## Campos independientes

| Campo              | Valores                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------- |
| Tipo               | Prospecto, Prueba, Alumna, Exalumna                                                     |
| Etapa de Prospecto | Resolviendo dudas, Espera de comprobante, Espera de datos, No agendó, No clasifica      |
| Etapa de Prueba    | Agendada, Asistió, No asistió, Pago rechazado                                           |
| Etapa de Alumna    | Inscripción vigente                                                                     |
| Etapa de Exalumna  | Inscripción vencida                                                                     |
| Calificación       | Pendiente, Apta, No clasifica; motivo obligatorio al no clasificar                      |
| Pago               | Sin pago, espera de comprobante, en validación, validado, rechazado, efectivo pendiente |
| Paquete            | Activo, vencido, inexistente (independiente del tipo)                                   |
| Atención humana    | Motivo y resumen, sin sustituir tipo/etapa                                              |

## Transiciones

- Reserva creada y verificada: Prospecto → Prueba. Comprobante, datos completos y cupo son requisitos; recibir comprobante no basta.
- Asistencia: mantiene Prueba. Tras asistir, una nueva reserva requiere inscripción.
- Inscripción activada con pago verificado: Alumna. No exigir que asistencia y pago ocurran en el mismo evento.
- Paquete vencido: mantiene Alumna y propone renovación de paquete.
- Inscripción vencida: Exalumna; conserva paquete activo y demás históricos.
- Renovar inscripción: vuelve a Alumna.
- No agendó: sigue Prospecto. No usar para datos incompletos, que mantienen Espera de datos.
- No clasifica: sigue Prospecto; motivo obligatorio. Pausar seguimiento/promoción.
- Nuevo mensaje: reabrir Prospecto cerrado, sin duplicar contacto; calificación pendiente de reevaluación y motivo anterior conservado en historial.
- Atención humana: capa transversal; pausa automatización mientras el equipo atiende y conserva contexto.

## Evidencia y límites

`lib/crm/demi-state.ts` implementa el contrato como un reductor puro con eventos identificados, fechas y resultados verificados. No modifica créditos, reservas o pagos; los efectos se mantienen en sus servicios actuales. Doce pruebas verifican transiciones, bloqueos, idempotencia y conservación del historial.

Integración implementada en `/admin/crm` y `/admin/crm/[personId]` sobre Studio Flow, rama `feat/crm-demi-state-model` basada en main. Usa la sesión administrativa y `students.read`/`students.write`; todas las consultas se limitan al estudio seleccionado. Personas compartidas entre prospectos y alumnas aparecen una sola vez.

El tipo y paquete se proyectan desde inscripciones, reservas y adquisiciones reales, sin editar movimientos financieros. La ficha integra el expediente operativo existente, reservas y asistencia; las ventas y altas conservan sus flujos actuales. También muestra conversaciones de Demi vinculadas por IDs, sin enlazar por coincidencias de teléfono ni enviar mensajes.

La migración `20261009160000_crm_demi_followup.sql` se aplicó únicamente a `hedouonyhynuvwbckdlg` (Studio Flow Sandbox). Persiste calificación, motivo, ubicación, interés, notas, próxima acción y solicitud humana. Cada guardado genera una auditoría atómica e inmutable para los usuarios de la aplicación. El RPC valida permisos, pertenencia al estudio y revisión para prevenir actualizaciones perdidas. No se aplicó a producción.

Los registros heredados de alumnas regulares sin inscripción comprobable se muestran como **Por verificar**, fuera de los contadores de etapas, con próxima acción de conciliar inscripción; no se convierten en prospectos por falta de datos.

Evidencia: 25 pruebas de contrato/proyección; typecheck y lint del alcance; pruebas SQL con rollback de guardado/auditoría, motivo obligatorio, conflicto de revisión, rechazo entre estudios y escritura anónima. El build Preview valida URL y hash de clave pública del sandbox.

Límites de esta versión: el historial nuevo registra cambios de seguimiento; los históricos de pagos, ventas, reservas e inscripción están disponibles en Perfil y Actividad dentro de la ficha CRM. La pausa y atención humana son estados de seguimiento en el CRM. No se activaron secuencias comerciales, ni se conectó este estado a todos los proveedores salientes. La reapertura automática ante nuevos mensajes y secuencias de seguimiento necesitan integración de eventos y UAT adicional. No presentar esta versión como automatización completa de Demi.

El documento también cambia reglas de inasistencia/crédito frente a políticas anteriores. Esta integración no aplica esas reglas financieras ni borra historial. Su implementación requiere un alcance de UAT propio y autorización de promoción.
