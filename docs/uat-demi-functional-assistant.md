# Demi: atención y conversión

Estado: cambio local en rama feat/demi-commercial-lifecycle. Sin despliegue ni escritura en bases de datos. No es una validación de comportamiento del modelo en WhatsApp.

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

- Catorce pruebas focalizadas de Demi aprobadas; typecheck aprobado; lint global sin errores y con 19 advertencias.
- La suite completa queda en 805/887 aprobadas. Las mismas 82 pruebas fallan en la rama base `origin/main` (801/883); la comparación no encontró fallos nuevos y las cuatro pruebas añadidas pasan.
- El formato global falla en 16 archivos que no pertenecen al diff de Demi; todos los archivos modificados por este cambio pasan Prettier.
- El deployment de Preview `054a9b7` quedó `READY`. El build de Vercel completó compilación y TypeScript, y verificó aislamiento hacia Studio Flow Sandbox.
- Acceso de Preview revalidado: el inicio de sesión llegó al selector, la selección de Demeter abrió Admin y una recarga conservó la sesión. El rebote anterior no se reprodujo; no se hizo cambio de código de autenticación, por lo que su causa original sigue sin confirmarse.
- UAT en el banco de pruebas de Demi: una consulta de domicilio/interés en Pole Fitness devolvió la dirección configurada y tres horarios consultados; al responder “gracias”, Demi cerró con una cortesía breve sin insistir. Una petición directa de agendar consultó horarios reales y ofreció opciones.
- Bloqueo de validación comercial: al seleccionar un horario, la prueba preparó la reserva sin pedir nombre. El flujo real sí tiene una validación `identityNeedsName`, pero el banco de pruebas no establece ese estado para su prospecto ficticio ni simula la captura del nombre. Por ello, este resultado no permite aprobar el flujo real de reserva; hay que corregir la simulación o validar ese caso mediante un recorrido aislado que cubra identidad.
- Las pruebas conversacionales se ejecutaron en Preview/Sandbox y simularon acciones; no se creó una reserva comercial ni se envió ningún mensaje a clientes.
- Antes de promover falta completar el UAT con modelo y herramientas en Preview, incluyendo identidad/nombre, confirmación de reserva y reglas de pago. Las pruebas automatizadas no verifican por sí solas reservas reales de extremo a extremo. UAT aprobado y autorización de promoción son pasos separados.
