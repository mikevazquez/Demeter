# Matriz de seguimiento Demi 2.0 — 9 octubre 2026

**8/18 casos maestros aprobados (44.4 %); 10 parciales (55.6 %).** M02, M03, M04, M06, M07, M09, M13 y M17 pasaron sus criterios de negocio. El transporte externo permanece en M01 y no se da por aprobado. Cada fila distingue variantes que pasaron de lo que falta para cerrar el caso. Las correcciones detectadas se detallan debajo.

Validación: 1146/1146 pruebas automáticas, typecheck y compilación correctos; lint sin errores. Histórico: 97 variantes SQL; nueva ejecución de 24 controles de Mercado Pago, nueve motivos humanos y nueve controles de seguimiento con el rol real service_role. Estos conjuntos se solapan y no se suman como casos maestros. El usuario completó el pago de prueba de $150 MXN: verificado contra Mercado Pago como processed/accredited y asociado a su solicitud. Webhook externo y entrega real del aviso aún pendientes.

## Resumen para promover a producción

| Medida | Resultado | Interpretación |
| --- | --- | --- |
| Casos maestros aprobados integralmente | 8/18 (44.4 %) | M02, M03, M04, M06, M07, M09, M13 y M17 tienen evidencia de V1–V3; ver documento de evidencia específico. |
| Casos maestros parciales | 10/18 (55.6 %) | Los restantes tienen verificaciones aprobadas y pendientes identificados. |
| Casos maestros por cerrar | 10/18 (55.6 %) | Porcentaje de cierres pendientes, no de esfuerzo ni de implementación restante. |
| Pruebas automáticas aprobadas en la última ejecución registrada | 1146/1146 (100 %) | Regresión técnica; no son 1146 casos UAT de negocio. |
| Verificaciones SQL registradas | 97 | Evidencia técnica acumulada; no existe un total exhaustivo de variantes pendientes para calcular su porcentaje. |
| Decisión de promoción | No lista | Faltan pagos nuevos, transporte externo y variantes de negocio. No se ha publicado esta rama en producción. |

Los resultados son los de la última ejecución guardada, no una nueva corrida de pruebas. No se registran casos maestros cerrados como fallidos: M02, M03, M04, M06, M07, M09, M13 y M17 pasaron y 10 permanecen parciales; los defectos encontrados y corregidos conservan su historial.

### Política de pagos confirmada con el usuario

- **Bancomer:** transferencia y depósito realizado en OXXO directamente a la cuenta Bancomer. Comprobante y revisión manual. OXXO no se ofrece dentro de Mercado Pago.
- **Mercado Pago:** pago por liga o checkout, ingresando a Mercado Pago. Para la nueva ruta automática de Demi se requiere una liga por solicitud asociada a la conversación y confirmación verificada del proveedor. No se pide comprobante en esa ruta una vez integrada y probada.
- La liga estática y la revisión de comprobante ya verificadas **no equivalen** a la automatización nueva. Las ligas creadas desde el panel de Mercado Pago no permiten configurar estas notificaciones según su documentación; se requiere la integración mediante API. La conexión existente del checkout de alumnas no cierra por sí sola la ruta de prospectos de Demi.

### Bloqueos y orden de cierre

1. **De mi lado, pago automático de prospectos:** La solicitud/liga individual, asociación, webhook autenticado, verificación e idempotencia ya están implementados en Sandbox. La compra de prueba ya fue verificada por consulta al proveedor; comprobar el webhook externo y la entrega real del aviso. Probar aprobado, pendiente, rechazado y repetido; sin ficha/reserva prematura ni doble cobro. Afecta M05 y el cierre de las variantes de pago de M06–M09, M11, M15 y M16.
2. **De mi lado, variantes de negocio restantes:** completar las conversaciones, rechazo de inscripción/paquete, reintentos, cupo, cancelación, renovación y atención humana de cada fila. Registrar evidencia para aprobar o fallar cada variante.
3. **Compartido, pruebas externas:** recepción y respuesta nuevas de WhatsApp/Facebook, audio/adjuntos, seguimientos y entrega de acceso/QR. La bienvenida WhatsApp sí fue recibida; Facebook fue probado mediante entrada inyectada/salida capturada. La conexión actual de Meta tiene el receptor en producción: falta una ruta segura de prueba sin desviar mensajes de clientes.
4. **Del usuario, Instagram:** conectar la cuenta y después ejecutar UAT de ese canal. En la evidencia actual no consta conectado; no se da por hecho que siga desconectado sin una nueva comprobación.
5. **Compartido, proveedor de pagos:** ejecutar un pago nuevo de prueba para comprobar notificación y aplicación. La ejecución de devoluciones y reembolsos queda fuera del alcance: Demi canaliza el caso y el equipo humano lo resuelve manualmente. Los antecedentes y las simulaciones no sustituyen esta evidencia. Solicitaré participación o acceso únicamente cuando el recorrido esté preparado y exista una necesidad concreta.

La actualización de esta matriz no aprueba un caso ni sustituye su ejecución. Para promover, cerrar los pendientes del alcance acordado, repetir la regresión sobre la versión candidata y documentar cualquier exclusión explícita; no se excluye Instagram automáticamente.

| Caso                       | Estado  | Ya pasó                                                                                                                           | Pendiente de mi lado                                                                 | Accionable de tu lado                                        |
| -------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| M01 Canales                | Parcial | Bienvenida WhatsApp recibida; Facebook integrado y recorrido interno completo.                                                    | Entrada y entrega reales de Meta en los canales conectados.                          | Conectar Instagram.                                          |
| M02 Identidad | Aprobado | Búsqueda mínima, número inválido y normalizado; ficha existente sólo tras verificación humana en interfaz; ocho créditos recuperados sin duplicar perfil ni perder historial. | Ninguno en V1–V3; transporte externo en M01. | Ninguno. |
| M03 No clasifica           | Aprobado | V1–V3: configuración oficial, disciplina distinta, distancia sin descarte, rechazo/opt-out y retorno con histórico; faltantes canalizados. | Ninguno en el caso de negocio; transporte externo se sigue en M01. | Ninguno por ahora.                                           |
| M04 Seguimientos | Aprobado | Dos tiempos 24/48 h, No agendó, máximo dos mensajes; comprobante y datos faltantes correctos. Repetición y paradas nativas verificadas. | Transporte externo se valida en M01. | Ninguno. |
| M05 Pago antes de datos    | Parcial | WhatsApp/Facebook: comprobante antes de ficha/reserva; enlace público con siete controles SQL y formulario verificado.            | Liga individual y validación automática MP implementadas; 24 controles nativos pasaron. Pago nuevo de $150 verificado por consulta al proveedor; falta webhook real y entrega externa del aviso. Bancomer/OXXO a Bancomer mantienen comprobante y revisión manual. | Pago de prueba completado; sin nueva acción solicitada por ahora. |
| M06 Grupo | Aprobado | D15–D20 y V1–V3: documentos conjuntos/separados, pagador externo al grupo, crédito propio, datos/pagos parciales, teléfono compartido y cupo cambiado con éxito parcial preservado y caso humano. Revisión manual y repetición sin doble pago. | Ninguno de negocio en las variantes definidas; Mercado Pago nuevo en M05 y transporte en M01/M18. | Ninguno. |
| M07 Cupo/devolución manual | Aprobado | Clase llena y alternativa real; cupo ocupado después del comprobante detectado; refund_request real con documento, pago y sesión, sin sobrecupo ni devolución automática. | Ninguno en V1–V3; devolución ejecutada manualmente por el equipo. | Ninguno para el UAT. |
| M08 Primera reserva        | Parcial | Una ficha/reserva/pago; repetición conserva validación. QR nativo y portal propio, sin QR de otra alumna.                         | Entrega de acceso/QR por los canales externos.                                       | Ninguno por ahora.                                           |
| M09 Fallos/reintentos | Aprobado | V1–V3: tres fallos previos sin reserva/débito, timeout recuperado sin duplicados, salida fallida auditada y caso humano al tercero; cuarto evento sin nueva ejecución. WhatsApp y Facebook. | Ninguno de negocio; transporte externo en M01. | Ninguno. |
| M10 Cancelación            | Parcial | Corte exacto de cinco horas; tardía consume una vez. Prueba inicia en primera clase y conserva vencimiento al mover/cancelar.     | Recordatorio y cancelación completos por transporte externo.                         | Ninguno por ahora.                                           |
| M11 Asistencia/inscripción | Parcial | Asistencia real; conversión mediante venta interna. Activación y cambio de contraseña llegan al portal sin inscripción pagada.    | Inscripción externa y dos seguimientos conversacionales.                             | Ninguno por ahora.                                           |
| M12 Rechazo                | Parcial | Revisión rechazada revoca reserva de prueba y conserva histórico.                                                                 | Rechazo de inscripción/paquete y entrega del aviso.                                  | Ninguno por ahora.                                           |
| M13 Alumna | Aprobado | Tres confirmaciones; falta de paquete, vencimiento, créditos agotados y clase excluida; efectivo con una venta, primera reserva, adeudo y ausencia sin doble descuento. | Ninguno en V1–V3; transporte externo se sigue en M01. | Ninguno por ahora. |
| M14 Recuperación           | Parcial | Motor 7/15/30, inactividad 14 días, deduplicación y parada al renovar.                                                            | Recorridos y entrega real de avisos Meta.                                            | Ninguno por ahora.                                           |
| M15 Inscripción vencida    | Parcial | Inscripción vencida bloquea reserva con ocho créditos vigentes; clasificación conservada.                                         | Resto de variantes y renovación por pago externo.                                    | Ninguno por ahora.                                           |
| M16 Retorno                | Parcial | Renovación interna recupera reserva; parada de recuperación con vigencia activa.                                                  | Retorno después de un pago nuevo del proveedor.                                      | Ninguno por ahora.                                           |
| M17 Atención humana | Aprobado | Nueve motivos; referencias nativas; asignación, pausa, resolución, reanudación y fallo de creación sin afirmar éxito. | Ninguno en V1–V3; transporte externo se sigue en M01. | Ninguno por ahora. |
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
- Typecheck pasó; regresión específica: 26/26 y regresión completa posterior: 1104/1104. El lint completo detectó un error preexistente en el editor Demi; se corrigió y el lint de los archivos afectados pasó sin errores.

Actualización posterior: M03 y M17 aprobados en el banco UAT; 2/18 casos (11.1 %), 16/18 por cerrar (88.9 %). Transporte externo pendiente en M01. Evidencia: demi-2-m03-evidence-2026-10-09.json. No se ha promovido producción.

La regresión posterior a la consulta completa de disciplinas pasó: 1104/1104; lint global sin errores (18 avisos preexistentes). La preparación oficial ausente también se probó sin pedir explícitamente atención humana: Demi creó technical_block y reconoció el faltante sin consejos inventados.

M13 cerrado en preview 208fa85. El bucle de confirmación en efectivo se corrigió; se validó el importe y paquete mencionados contra el resumen preparado. Regresión 1104/1104. Evidencia: demi-2-m13-confirmations-evidence-2026-10-09.json.

## Verificación de reintentos — 23:44 UTC

La regresión técnica de la versión 7da8dd0 pasó 1117/1117 pruebas. Typecheck pasó. Se conservan las respuestas originales al reintentar eventos de Meta, con toma exclusiva del evento y límite persistente de tres intentos de salida. Ante un resultado desconocido o aceptación del proveedor sin registro local, se detiene el reenvío y se canaliza a revisión humana. Pendiente la repetición conversacional en el nuevo preview; M09 permanece parcial hasta registrar esa evidencia.

Las pruebas conversacionales de fallo previo a la reserva alcanzaron tres errores y crearon un caso humano, sin reserva ni débito; el cuarto mensaje quedó pausado. La respuesta perdida después de reservar se recuperó usando la reserva existente, sin un segundo débito. No se confunden estos controles internos con transporte externo de Meta.

M09 aprobado en preview 7da8dd0: el evento repetido conservó la respuesta, no ejecutó de nuevo el modelo y registró exactamente tres salidas fallidas. El tercer fallo creó un caso técnico; el cuarto no envió nada. En WhatsApp se conservó una reserva y siete créditos en los cuatro intentos. Facebook pasó el mismo límite. Evidencia: demi-2-m09-evidence-2026-10-09.json. Avance vigente: 4/18 (22.2 %), 14/18 por cerrar (77.8 %).

Comprobantes separados: corrección aplicada exclusivamente en Sandbox; 18 controles nativos pasaron con SET LOCAL ROLE service_role y ROLLBACK. Se conserva cada archivo ilegible o válido, los importes parciales no habilitan fichas, la misma evidencia no se suma dos veces y la suma completa sigue en revisión manual. La atención humana conserva referencias a todos los documentos. M06 sigue parcial hasta la repetición conversacional.

Conversación de comprobantes separados en c516581: primero $150 y diferencia $150 sin fichas; reenvío del mismo documento mantiene $150; segundo comprobante alcanza $300 y habilita pedir datos. Datos incompletos no crean fichas ni reservas; al completarlos, dos fichas y dos reservas provisionales, sin inscribir al pagador. Se detectó D16 seleccionando la primera clase del pagador en lugar de la destinataria: se añadió recipient_mode y una validación de acción que exige prepare_group_booking para otra persona. Regresión 1119/1119, typecheck y lint sin errores. D16 sigue pendiente de repetición. Se retiraron los permisos UPDATE/DELETE heredados para conservar los documentos como evidencia inmutable.

## Variantes de grupo — 10 octubre, 00:06 UTC

D16 se repitió después de la corrección en 279a14f: una ficha y reserva sólo para la destinataria; quien paga conserva su rol de pagador. D17 creó una reserva con un crédito existente y otra primera clase de $150, sin duplicar a la alumna. Se detectaron dos respuestas incorrectas: llamar provisionales ambas reservas del grupo mixto y prometer registrar dos participantes con el mismo celular. Se corrigieron las instrucciones y se añadió una acción de revisión humana antes de cobrar cuando el teléfono compartido es explícito. Falta repetir esas respuestas y el cambio de cupo; M06 permanece parcial.

La revisión manual ahora consulta todos los documentos del grupo, muestra el total y la asignación de cada compra y no habilita validación si no carga la evidencia completa. La prueba nativa con rol authenticated comprobó cuatro documentos visibles para el responsable y cero para un usuario ajeno; UPDATE/DELETE del servicio están revocados. Regresión 1135/1135, typecheck y lint sin errores. No se ha modificado producción.

Repetición en 119d286: grupo mixto distingue reserva confirmada con crédito propio de reserva provisional por transferencia; teléfono compartido crea caso humano y pide esperar antes de pagar. La ficha de una participante muestra los dos documentos de $150, total $300 y asignación $150; ambos archivos privados abrieron HTTP 200. El cambio de cupo conserva una reserva, impide la segunda y registra $150 sin asignar con caso group_partial. Se añadió human_review_created/handoff_id al resultado nativo y se corrigió la explicación de la pausa humana; pendiente repetición de esa última respuesta. Regresión posterior 1135/1135 y 18 controles nativos pasaron, incluyendo correspondencia del handoff devuelto con el caso realmente persistido.

M06 aprobado en c6c9592: la última repetición informó la reserva parcial y el caso humano real, sin ofrecer nuevas operaciones durante su control. Un mensaje posterior no produjo llamada al modelo, respuesta, reserva ni cobro. Evidencia: demi-2-m06-evidence-2026-10-10.json. Avance vigente: 5/18 aprobados (27.8 %), 13/18 por cerrar (72.2 %).

## Seguimientos — resultado desconocido del proveedor

Se corrigió el worker para no volver a enviar ante interrupción de red, respuesta malformada, éxito sin identificador o fallo sin rechazo explícito. Conserva el lease: el mecanismo nativo vence la operación y crea revisión humana. Un rechazo explícito de Meta conserva el flujo de fallo conocido. Once pruebas del worker pasaron; regresión completa 1135/1135 y typecheck correctos. Worker versión 4 aplicado únicamente en Sandbox. M04 sigue parcial: esta corrección no acredita contenido por etapa ni transporte externo.

## Pago nuevo verificado — 9 octubre, 20:38 (Ciudad de México)

El usuario completó la compra de prueba de $150 MXN. El worker consultó directamente la orden de Mercado Pago y verificó processed/accredited, importe, moneda y referencia. La solicitud ec322d58-ba7b-4c78-9656-436696e1c10d quedó approved; el grupo quedó awaiting_participants, con cero participantes asignados. El aviso quedó capturado una vez en Sandbox, no entregado externamente. Repetir el worker devolvió cero operaciones y conservó un intento y un turno de aviso. No hay webhook auditado para esta orden: la consulta/reconciliación sí pasó, el transporte del webhook aún no. M05 permanece parcial y el total conserva 5/18.

## Cierres adicionales — 9 octubre (Ciudad de México)

M02 y M07 aprobados y registrados en el banco operativo. Avance: 7/18 (38.9 %), once casos parciales. Identidad: seis controles nativos con roles reales y 21 de canales; interfaz de verificación y conversación de retorno pasaron. Seguimientos: cuatro controles de contenido por etapa y nueve de tiempos/paradas pasaron; worker versión 5 aplicado en Sandbox. M04 permanece parcial por entrega externa y repetición completa del worker con conversaciones. El pago real de prueba de Mercado Pago continuó hasta una ficha de prueba, una reserva validada y un pago de $150; sin comprobante. Repetir el mensaje conserva esos registros. Webhook y entrega externa permanecen pendientes en M05.
