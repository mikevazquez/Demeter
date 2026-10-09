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

Preparación local en rama `feat/crm-demi-state-model`. Sin migración ejecutada, sin activación de automatizaciones, sin publicación de Studio Flow ni cambios en producción. El prototipo Sites permite revisar la organización y guardar ejemplos locales.

Pendiente para integración real: persistencia tenant-scoped y RLS; adaptación explícita desde `crm_contacts.lifecycle_status` y estado de inscripción vigente (no reutilizar `students.lifecycle_status` como tipo CRM); enlace de eventos verificados de reservas, asistencia, pagos e inscripción; emisión de historial; lectura por directorio/ficha/Demi; configuración de secuencias y UAT con base sandbox aislada.

El documento también cambia reglas de inasistencia/crédito frente a políticas anteriores. Esta preparación no aplica esas reglas financieras ni borra historial. Su implementación requiere un alcance de UAT propio y autorización de promoción.
