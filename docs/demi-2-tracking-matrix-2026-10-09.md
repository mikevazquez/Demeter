# Matriz de seguimiento Demi 2.0 — 9 octubre 2026

**18 casos maestros parciales; ninguno aprobado integralmente.** Cada fila distingue variantes que pasaron de lo que falta para cerrar el caso. Las correcciones detectadas se detallan debajo.

Validación: 1103/1103 pruebas automáticas, typecheck y compilación correctos; lint sin errores (un aviso preexistente). Histórico: 97 variantes SQL; nueva ejecución de 24 controles de Mercado Pago, nueve motivos humanos y nueve controles de seguimiento con el rol real service_role. Estos conjuntos se solapan y no se suman como casos maestros. Se creó una orden real de prueba de Mercado Pago; compra pendiente del usuario.

## Resumen para promover a producción

| Medida | Resultado | Interpretación |
| --- | --- | --- |
| Casos maestros aprobados integralmente | 0/18 (0 %) | Ningún caso tiene todavía toda la evidencia necesaria para su cierre. |
| Casos maestros parciales | 18/18 (100 %) | Todos tienen verificaciones aprobadas y pendientes identificados. |
| Casos maestros por cerrar | 18/18 (100 %) | Porcentaje de cierres pendientes, no de esfuerzo ni de implementación restante. |
| Pruebas automáticas aprobadas en la última ejecución registrada | 1103/1103 (100 %) | Regresión técnica; no son 1086 casos UAT de negocio. |
| Verificaciones SQL registradas | 97 | Evidencia técnica acumulada; no existe un total exhaustivo de variantes pendientes para calcular su porcentaje. |
| Decisión de promoción | No lista | Faltan pagos nuevos, transporte externo y variantes de negocio. No se ha publicado esta rama en producción. |

Los resultados son los de la última ejecución guardada, no una nueva corrida de pruebas. No se registran casos maestros cerrados como fallidos: los 18 permanecen parciales; los defectos encontrados y corregidos conservan su historial.

### Política de pagos confirmada con el usuario

- **Bancomer:** transferencia y depósito realizado en OXXO directamente a la cuenta Bancomer. Comprobante y revisión manual. OXXO no se ofrece dentro de Mercado Pago.
- **Mercado Pago:** pago por liga o checkout, ingresando a Mercado Pago. Para la nueva ruta automática de Demi se requiere una liga por solicitud asociada a la conversación y confirmación verificada del proveedor. No se pide comprobante en esa ruta una vez integrada y probada.
- La liga estática y la revisión de comprobante ya verificadas **no equivalen** a la automatización nueva. Las ligas creadas desde el panel de Mercado Pago no permiten configurar estas notificaciones según su documentación; se requiere la integración mediante API. La conexión existente del checkout de alumnas no cierra por sí sola la ruta de prospectos de Demi.

### Bloqueos y orden de cierre

1. **De mi lado, pago automático de prospectos:** La solicitud/liga individual, asociación, webhook autenticado, verificación e idempotencia ya están implementados en Sandbox. Completar la compra de prueba y comprobar su notificación real. Probar aprobado, pendiente, rechazado y repetido; sin ficha/reserva prematura ni doble cobro. Afecta M05 y el cierre de las variantes de pago de M06–M09, M11, M15 y M16.
2. **De mi lado, variantes de negocio restantes:** completar las conversaciones, rechazo de inscripción/paquete, reintentos, cupo, cancelación, renovación y atención humana de cada fila. Registrar evidencia para aprobar o fallar cada variante.
3. **Compartido, pruebas externas:** recepción y respuesta nuevas de WhatsApp/Facebook, audio/adjuntos, seguimientos y entrega de acceso/QR. La bienvenida WhatsApp sí fue recibida; Facebook fue probado mediante entrada inyectada/salida capturada. La conexión actual de Meta tiene el receptor en producción: falta una ruta segura de prueba sin desviar mensajes de clientes.
4. **Del usuario, Instagram:** conectar la cuenta y después ejecutar UAT de ese canal. En la evidencia actual no consta conectado; no se da por hecho que siga desconectado sin una nueva comprobación.
5. **Compartido, proveedor de pagos:** ejecutar un pago nuevo de prueba para comprobar notificación y aplicación. La ejecución de devoluciones y reembolsos queda fuera del alcance: Demi canaliza el caso y el equipo humano lo resuelve manualmente. Los antecedentes y las simulaciones no sustituyen esta evidencia. Solicitaré participación o acceso únicamente cuando el recorrido esté preparado y exista una necesidad concreta.

La actualización de esta matriz no aprueba un caso ni sustituye su ejecución. Para promover, cerrar los pendientes del alcance acordado, repetir la regresión sobre la versión candidata y documentar cualquier exclusión explícita; no se excluye Instagram automáticamente.

| Caso                       | Estado  | Ya pasó                                                                                                                           | Pendiente de mi lado                                                                 | Accionable de tu lado                                        |
| -------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| M01 Canales                | Parcial | Bienvenida WhatsApp recibida; Facebook integrado y recorrido interno completo.                                                    | Entrada y entrega reales de Meta en los canales conectados.                          | Conectar Instagram.                                          |
| M02 Identidad              | Parcial | Cruces de estudio/conversación y apropiación de teléfonos existentes bloqueados.                                                  | Ambigüedad conversacional y vínculo verificado entre canales.                        | Ninguno por ahora.                                           |
| M03 No clasifica           | Parcial | Rechazo con motivo, parada de seguimientos y reactivación ante respuesta.                                                         | Objeción sin rechazo y consultas configuradas restantes.                             | Ninguno por ahora.                                           |
| M04 Seguimientos           | Parcial | Dos mensajes, intervalos, deduplicación y cancelación de pendientes/reclamados.                                                   | Recorrido conversacional completo y entrega real de seguimientos.                    | Ninguno por ahora.                                           |
| M05 Pago antes de datos    | Parcial | WhatsApp/Facebook: comprobante antes de ficha/reserva; enlace público con siete controles SQL y formulario verificado.            | Liga individual y validación automática MP implementadas; 24 controles nativos pasaron. Falta pago nuevo y webhook real. Bancomer/OXXO a Bancomer mantienen comprobante y revisión manual. | Participar en pago de prueba cuando la ruta esté preparada, si se requiere. |
| M06 Grupo                  | Parcial | Pagador separado, participantes mixtos, reservas individuales, total conciliado y reenvío sin duplicados.                         | Variantes conversacionales restantes y canalización del importe no asignado a revisión humana.           | Ninguno por ahora.                                           |
| M07 Cupo/reembolso         | Parcial | Sin cupo no se prepara cobro; solicitud persistente de reembolso y atención humana.                                               | Alternativas conversacionales y referencias para devolución manual después de pago.        | Ninguno por ahora.                                           |
| M08 Primera reserva        | Parcial | Una ficha/reserva/pago; repetición conserva validación. QR nativo y portal propio, sin QR de otra alumna.                         | Entrega de acceso/QR por los canales externos.                                       | Ninguno por ahora.                                           |
| M09 Fallos/reintentos      | Parcial | Tres intentos, sin cuarto envío; evento repetido no duplica turnos/llamadas; resultados desconocidos requieren revisión.          | Timeout de reserva y entrega externa bajo fallos.                                    | Ninguno por ahora.                                           |
| M10 Cancelación            | Parcial | Corte exacto de cinco horas; tardía consume una vez. Prueba inicia en primera clase y conserva vencimiento al mover/cancelar.     | Recordatorio y cancelación completos por transporte externo.                         | Ninguno por ahora.                                           |
| M11 Asistencia/inscripción | Parcial | Asistencia real; conversión mediante venta interna. Activación y cambio de contraseña llegan al portal sin inscripción pagada.    | Inscripción externa y dos seguimientos conversacionales.                             | Ninguno por ahora.                                           |
| M12 Rechazo                | Parcial | Revisión rechazada revoca reserva de prueba y conserva histórico.                                                                 | Rechazo de inscripción/paquete y entrega del aviso.                                  | Ninguno por ahora.                                           |
| M13 Alumna                 | Parcial | Reserva/crédito únicos; ausencia consume una vez. Efectivo crea deuda, primera reserva permitida y segunda bloqueada hasta cobro. | Exclusiones y variantes conversacionales restantes.                                  | Ninguno por ahora.                                           |
| M14 Recuperación           | Parcial | Motor 7/15/30, inactividad 14 días, deduplicación y parada al renovar.                                                            | Recorridos y entrega real de avisos Meta.                                            | Ninguno por ahora.                                           |
| M15 Inscripción vencida    | Parcial | Inscripción vencida bloquea reserva con ocho créditos vigentes; clasificación conservada.                                         | Resto de variantes y renovación por pago externo.                                    | Ninguno por ahora.                                           |
| M16 Retorno                | Parcial | Renovación interna recupera reserva; parada de recuperación con vigencia activa.                                                  | Retorno después de un pago nuevo del proveedor.                                      | Ninguno por ahora.                                           |
| M17 Atención humana        | Parcial | Caso, asignación, pausa sin llamadas/respuestas y devolución con nota; reembolso/seguridad persistentes.                          | Los nueve motivos permitidos pasaron con modelo, asignación, pausa y resolución; falta entrega externa de avisos.                                   | Ninguno por ahora.                                           |
| M18 Multimedia             | Parcial | Audio OpenAI y OCR reales en preview; comprobante Facebook y respuesta natural.                                                   | Recepción real de audio/adjuntos Meta y variantes de formato.                        | Conectar Instagram para probar ese canal.                    |

## Correcciones y su seguimiento

| Hallazgo                                                                          | Corrección                                                                             | Verificación                                                                                               |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Facebook usaba un flujo distinto                                                  | Adaptador integrado al comprobante antes de datos y reserva nativa                     | Recorrido completo con OCR/modelo real pasó en preview 565c72.                                             |
| Aviso de cancelación repetido cuando la condición iba primero                     | Reconocimiento de ambas formas de la frase                                             | Regresión automática pasó.                                                                                 |
| No existía configuración de enlace público para primera clase                     | Formulario por clase y RPC con importe, moneda, dominio y permisos                     | Siete controles SQL; página HTTP 200; dominio ajeno rechazado HTTP 303. Enlace real pendiente.             |
| Enlaces de acceso apuntaban al dominio ficticio del banco y Facebook no tenía URL | Origen del preview y URL de activación habilitada en Facebook                          | Enlace del preview, formulario, cambio de contraseña y entrada al portal pasaron.                          |
| Las herramientas de acceso no estaban disponibles para Demi                       | Preparación y ejecución de activación expuestas con validación de asistencia/identidad | Generación, confirmación y cuenta activa pasaron.                                                          |
| Demi pidió datos al compartir Mercado Pago                                        | Instrucción de pago controlada: comprobante primero, datos después                     | Pruebas automáticas y repetición conversacional final pasaron: sin datos ni reserva antes del comprobante. |
| Demi confundió inscripción pendiente con acceso bloqueado                         | Confirmación de acceso independiente del cobro de inscripción                          | Preparación con una confirmación y cuenta activa sin inscripción pagada pasaron.                           |

## Evidencia y límites

Facebook: run `63d7ae35-5a9f-480a-aea7-9bea8439e509`, comprobante antes de datos, una ficha/reserva/pago y repetición sin duplicados. Entrada inyectada y salida capturada por el adaptador real: falta transporte externo de Meta.

Acceso: run `b691ac79-2848-4273-8c2b-d1f708bc1037`, cuenta sintética activa, contraseña elegida y portal HTTP 200. El portal renderizó el QR propio y ocultó el de otra alumna. Cuatro controles nativos QR verificaron estabilidad, estudio, revocación y permisos sin revelar tokens.

Mercado Pago: enlace ficticio sólo en un estudio aislado UAT, advertencia de no pagar y comprobante requerido en la ruta previamente probada. La nueva ruta automática está implementada en Sandbox y pasó 24 controles nativos; su compra y notificación externa siguen pendientes. La conexión existente para compras de alumnas no proporciona por sí sola un enlace público de primera clase. Los controles SQL se ejecutaron con ROLLBACK; no equivalen a una compra ante el proveedor.

Los pendientes externos no cierran con pruebas internas. El receptor de producción conserva su configuración. Cambios disponibles en el PR #259, sin merge a producción.

## Avance adicional — 23:02 UTC

- Mercado Pago: orden de prueba creada correctamente en cuenta mexicana de prueba; enlace de $150 enviado al usuario, quien confirmó que lo probará. Sin pago confirmado ni reserva creada. No se autoriza dinero real.
- Atención humana: nueve motivos configurados pasaron conversaciones reales del modelo en estudios sintéticos; nueve verificaciones nativas adicionales comprueban referencias, repetición, asignación, pausa, resolución y permisos. Las devoluciones se canalizan, no se ejecutan automáticamente.
- Se corrigió un permiso faltante del rol de servicio para guardar la baja de mensajes. Nueve controles de seguimiento pasaron usando SET LOCAL ROLE service_role.
- El rechazo con motivo seguido de baja de mensajes ahora conserva No clasifica y su razón. Al reactivarse, conserva el histórico de calificación en una tabla protegida.
- Se corrigieron instrucciones que aún exigían comprobante para Mercado Pago automático. Bancomer y OXXO a Bancomer mantienen comprobante y validación manual.
- Se detectó consejo genérico de preparación sin configuración oficial; el getter y el prompt ahora requieren first_class_preparation configurado. Pendiente repetición conversacional en el siguiente preview.
- Typecheck pasó; regresión específica: 26/26 y regresión completa posterior: 1103/1103. El lint completo detectó un error preexistente en el editor Demi; se corrigió y el lint de los archivos afectados pasó sin errores.

Se conservan 0/18 cierres integrales hasta terminar las variantes y el transporte externo que corresponden. No se ha promovido producción.
