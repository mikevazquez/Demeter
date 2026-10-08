# Demi: atención y conversión

Estado: Preview `cad46e6` en estado READY, en la rama de desarrollo y aislado a Studio Flow Sandbox. UAT parcial; no valida conversaciones reales de WhatsApp.

## Objetivo

Resolver preguntas de prospectos y alumnas con Studio Flow como fuente de verdad. Una consulta informativa puede avanzar a una primera visita cuando la persona muestra interés. El agradecimiento no autoriza ninguna acción ni obliga a insistir.

## Cambio inicial

La orientación de primera visita ahora incluye trial_pending, trial_cancelled y trial_no_show, aunque tengan una ficha de alumna. Se excluyen trial_attended, student, former_student e identidades no resueltas. El simulador respeta la persona seleccionada.

El comportamiento indica responder la pregunta primero, proponer un siguiente paso pertinente en esa misma respuesta y respetar despedidas. Conserva reservas existentes, confirmaciones y validaciones oficiales.

La revisión de conversaciones reales encontró varios pedidos explícitos de agendar que terminaban después de pedir el nombre, sin consulta registrada de horarios ni opciones ofrecidas. La orientación ahora prioriza consultar disponibilidad en ese mismo turno y pedir los datos de reserva después de que el prospecto elija una opción. Esto mejora la instrucción del agente; el UAT debe verificar que el modelo ejecute la herramienta.

En una muestra histórica, la consulta de domicilio devolvió un dato vacío. La dirección principal ya aparece configurada en Studio Flow; el chat observado fue anterior a la aplicación de esa configuración. Se conserva como caso de regresión, no como falla vigente confirmada.

## UAT conversacional pendiente

| Persona / secuencia                                                | Resultado requerido                                                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Prospecto interesado en Pole Fitness pregunta domicilio            | Consulta datos actuales, entrega dirección y propone revisar horarios de Pole Fitness una sola vez.       |
| Responde gracias después de esa invitación                         | Agradecimiento breve; no repite la invitación ni reserva.                                                 |
| Solo solicita domicilio y dice que no quiere clases                | Resuelve ubicación; respeta su decisión.                                                                  |
| Acepta ver horarios y elige uno                                    | Consulta cupo real, pide solo datos faltantes, prepara reserva y espera confirmación según Studio Flow.   |
| Prospecto dice directamente «quiero agendar» y aún no eligió clase | Consulta disponibilidad en ese turno, ofrece opciones reales y solicita nombre al avanzar con una opción. |
| Prueba pendiente con ficha y reserva existente pregunta qué llevar | Consulta información vigente, prepara su visita; no ofrece otra reserva.                                  |
| Prueba cancelada o con ausencia quiere regresar                    | Conserva orientación de primera visita; Studio Flow determina elegibilidad y prepago.                     |
| Primera visita ya asistida quiere continuar                        | Consulta paquete e inscripción vigentes; no ofrece nuevamente la excepción.                               |
| Alumna activa pregunta créditos y vencimiento                      | Consulta su paquete y responde directamente; no inicia venta de primera clase.                            |
| Exalumna solicita regresar                                         | Consulta situación real y opciones vigentes; no asume beneficio de primer ingreso.                        |
| Identidad no resuelta                                              | Responde información pública; no revela datos personales ni ejecuta acciones dependientes de identidad.   |
| Alumna pide cancelar o reagendar                                   | Mantiene las reglas y confirmaciones oficiales, explica consecuencias reales.                             |
| Consulta ambigua o fuera del catálogo                              | Aclara solo lo necesario; no inventa servicios, precios ni resultados.                                    |

## Siguiente evidencia necesaria

Ampliar la revisión de conversaciones de Studio Flow, separada por prospecto, prueba y alumna. Para cada fallo registrar intención, contexto disponible, herramientas llamadas, resultado y punto de abandono. Este cambio corrige una condición de código y mejora instrucciones; no prueba por sí solo la causa de cada conversación reportada.

Medir por separado dudas resueltas, ofrecimiento pertinente, selección de horario, reserva realmente creada, asistencia y conversión a paquete. Una prueba que encuentra una frase en el código no demuestra una conversación exitosa.

## Desarrollo y promoción

Ejecutar UAT con acciones simuladas y entorno aislado. Validar fuentes faltantes para requisitos de disciplinas y preguntas frecuentes antes de afirmar cobertura completa. No activar seguimientos ni enviar mensajes reales durante las pruebas. UAT aprobado y autorización de promoción son pasos separados.

## Validación prepromoción

- Quince pruebas focalizadas de Demi aprobadas; typecheck aprobado; lint focalizado sin errores (una advertencia preexistente en `orchestrator.ts`).
- La suite completa queda en 809/891 aprobadas. Las mismas 82 pruebas fallan en la rama base `origin/main`; la comparación no encontró fallos nuevos.
- La verificación Prettier pasa en `orchestrator.ts` y `tests/demi-prompt-workbench.test.ts`. `action-tools.ts` tiene deriva de formato previa; el chequeo global tampoco está limpio.
- El build de Vercel compiló, pasó TypeScript y verificó aislamiento hacia Studio Flow Sandbox.
- Acceso validado: el login llegó al selector, la selección de Demeter abrió Admin y la sesión sobrevivió una recarga en Preview. El rebote anterior no se reprodujo; no hay evidencia para atribuirlo a un defecto persistente de autenticación.
- UAT del banco de pruebas: una consulta de domicilio/interés en Pole Fitness devolvió la dirección configurada y horarios actuales; “gracias” recibió una cortesía breve sin insistencia. Una petición directa de agendar consultó horarios reales y ofreció opciones.
- UAT del banco de pruebas: una alumna ficticia preguntó por créditos y vencimiento. Demi consultó el paquete simulado, reportó 8 créditos y dijo que no había fecha de vencimiento configurada, sin inventarla. También consultó horarios actuales y preparó una reserva simulada.
- Se detectó que el modo simulación podía pedir dos confirmaciones para reserva y cancelación: no aplicaba el encaminamiento determinista que usa el flujo de WhatsApp. Se alineó el simulador con esa ruta y hay pruebas unitarias para que cada acción simulada se ejecute tras una sola confirmación explícita. Falta repetir el UAT conversacional en el nuevo Preview; el acceso SSO de este host no se pudo completar en esta sesión.
- Al elegir horario, Demi pidió el nombre completo; después presentó resumen y pidió confirmación. Se corrigió la simulación para representar el nombre pendiente de un prospecto nuevo.
- La respuesta “Sí, confirmo.” inicialmente no ejecutó la reserva simulada porque no estaba reconocida como confirmación explícita. Se agregó esa forma al validador y se verificó en Preview: Demi confirmó la reserva simulada correctamente.
- Todas las acciones de ese recorrido ocurrieron en la simulación de Sandbox. No se creó una reserva comercial real ni se envió ningún mensaje a clientes.
- UAT aún pendiente: probar más consultas y acciones de alumnas activas; exalumnas; pruebas canceladas/no-show; exclusiones de elegibilidad; cancelación a tiempo y tardía; reglas de pago/prepago. El banco actual solo ofrece los perfiles de prospecto nuevo y alumna con paquete ficticio, y no modela esos estados ni la elegibilidad real. Se requiere ampliar el banco o hacer UAT operativo controlado en Sandbox antes de afirmar cobertura. No aprobar ni promover hasta cerrar esos casos; “UAT aprobado” y “Autorizo promoción” siguen siendo pasos separados.
