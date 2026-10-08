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

- Catorce pruebas focalizadas de Demi aprobadas; typecheck aprobado; lint focalizado sin errores (una advertencia preexistente en `orchestrator.ts`).
- La suite completa queda en 809/891 aprobadas. Las mismas 82 pruebas fallan en la rama base `origin/main`; la comparación no encontró fallos nuevos.
- La verificación Prettier pasa en `orchestrator.ts` y `tests/demi-prompt-workbench.test.ts`. `action-tools.ts` tiene deriva de formato previa; el chequeo global tampoco está limpio.
- El build de Vercel compiló, pasó TypeScript y verificó aislamiento hacia Studio Flow Sandbox.
- Acceso validado: el login llegó al selector, la selección de Demeter abrió Admin y la sesión sobrevivió una recarga en Preview. El rebote anterior no se reprodujo; no hay evidencia para atribuirlo a un defecto persistente de autenticación.
- UAT del banco de pruebas: una consulta de domicilio/interés en Pole Fitness devolvió la dirección configurada y horarios actuales; “gracias” recibió una cortesía breve sin insistencia. Una petición directa de agendar consultó horarios reales y ofreció opciones.
- UAT del banco de pruebas: una alumna ficticia preguntó por créditos y vencimiento. Demi consultó el paquete simulado, reportó 8 créditos y dijo que no había fecha de vencimiento configurada, sin inventarla. También consultó horarios actuales y preparó una reserva simulada.
- El usuario confirmó en el Preview que una sola respuesta “Sí, confirmo” cierra el paso de confirmación. Esa validación no demuestra que el prepago del prospecto se respete: el simulador no estaba aplicando la política de Sandbox y podía marcar la reserva como confirmada antes de la transferencia.
- La corrección actual hace que la simulación consulte la política efectiva de prepago. Si exige transferencia, después de la confirmación no crea una reserva ni genera un pago; informa que el lugar solo se confirma cuando se valide la transferencia. Se agregaron pruebas para este caso.
- Al elegir horario, Demi pidió el nombre completo; después presentó resumen y pidió confirmación. Se corrigió la simulación para representar el nombre pendiente de un prospecto nuevo.
- Todas las acciones de ese recorrido ocurren en la simulación de Sandbox. No se crea una reserva comercial ni se genera o valida un pago real; no se envían mensajes a clientes.
- UAT aún pendiente: probar más consultas y acciones de alumnas activas; exalumnas; pruebas canceladas/no-show; exclusiones de elegibilidad; cancelación a tiempo y tardía; reglas de pago/prepago. El banco actual solo ofrece los perfiles de prospecto nuevo y alumna con paquete ficticio, y no modela esos estados ni la elegibilidad real. Se requiere ampliar el banco o hacer UAT operativo controlado en Sandbox antes de afirmar cobertura. No aprobar ni promover hasta cerrar esos casos; “UAT aprobado” y “Autorizo promoción” siguen siendo pasos separados.

## UAT conversacional adicional — 2026-10-08

Pruebas manuales en la pestaña Preview ya autenticada `demeterbueno-3mayhk3r0-demeter3.vercel.app/admin/integraciones/demi`. La pantalla indica que no se envían mensajes y que las acciones/datos de alumna se simulan. El Preview abierto mostraba “Modo Pilot”; no se verificó que corresponda a la última compilación que mostró “Modo Demo”, así que estos resultados son evidencia de conversación en ese Preview, no certificación de la versión más reciente.

| Caso                                                                                          | Resultado observado                                                                                                                                                                                 | Estado                                                                             |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Prospecto pide solo domicilio y aclara que no quiere clases                                   | Demi respondió con la dirección configurada y no ofreció horarios ni insistió.                                                                                                                      | Aprobado                                                                           |
| Consulta fuera de catálogo y ambigua: box acuático, promoción de cumpleaños y membresía anual | Demi dijo que box acuático no aparece en el catálogo, que no había promoción de cumpleaños configurada y respondió opciones/precios anuales. No inventó que existiera la actividad ni la promoción. | Aprobado conversacional; verificar los precios contra catálogo antes de promover   |
| Alumna ficticia pide cancelar la clase de mañana y reagendar; pregunta por el crédito         | Demi dijo que no encontraba una reserva activa para mañana, explicó la regla de cancelación y pidió actividad/hora y nuevo horario. No afirmó haber cancelado o reagendado.                         | Parcial: el perfil no tiene reserva real y no permite probar el efecto del crédito |

### Revalidación en Preview actualizado

Se amplió el selector de Sandbox con perfiles ficticios para prueba pendiente, cancelada, no-show y asistida; alumna con reserva; exalumna; e identidad no resuelta. En el Preview del commit `1b196fe4cbec0fcb4d5b1afc5137d2b6a46d5e11`, bajo `/admin/integraciones/demi`, se ejecutaron estas conversaciones:

| Caso                                                                           | Resultado observado                                                                                                                                                  | Estado                                                                     |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Prueba pendiente con reserva pregunta qué llevar                               | Demi encontró la reserva ficticia, informó que no había instrucciones específicas de la clase y dio preparación general. No duplicó la reserva.                      | Aprobado conversacional                                                    |
| Prueba cancelada pregunta si puede regresar y si debe transferir               | Ofreció revisar otra clase; dijo que Studio Flow determina elegibilidad y que el prepago se revisa al elegir una clase.                                              | Aprobado conversacional; elegibilidad y pago no verificados operativamente |
| Prueba no-show pregunta si puede volver a tomar una clase                      | Ofreció revisar otra visita y condicionó la regla de prepago a la clase seleccionada.                                                                                | Aprobado conversacional; elegibilidad y pago no verificados operativamente |
| Prueba asistida pregunta por paquetes                                          | Consultó opciones vigentes de paquetes y preguntó cuál le interesa; no volvió a ofrecer la excepción de primera clase.                                               | Aprobado conversacional                                                    |
| Exalumna pregunta por promoción de primera clase                               | No asumió elegibilidad; explicó que no veía esa promoción para su perfil y ofreció revisar clases/precios vigentes.                                                  | Aprobado conversacional; elegibilidad real no verificada                   |
| Identidad no resuelta consulta créditos y vencimiento                          | Tras corregir una frase que exponía jerga interna de identidad simulada, Demi explicó que debe verificar la cuenta asociada al número antes de consultar esos datos. | Aprobado tras corrección                                                   |
| Alumna con reserva solicita cancelar, indica motivo y confirma “Sí, cancélala” | Demi encontró la reserva ficticia, explicó el crédito esperado y completó la acción tras una sola confirmación natural.                                              | Aprobado conversacional; efecto de crédito simulado                        |
| Alumna con reserva solicita reagendar y confirma “Sí, reagéndala”              | Demi resumió el nuevo horario solicitado y completó la acción tras una sola confirmación natural.                                                                    | Aprobado conversacional; cambio simulado                                   |

La prueba de cancelación solo cubrió una reserva para el día siguiente, fuera del límite de cancelación tardía. El simulador no tiene una reserva ficticia dentro de ese límite, por lo que no se probó la consecuencia del crédito en una cancelación tardía. Tampoco se validaron contra operación real la elegibilidad de pruebas/exalumnas, la confirmación de transferencias, la reserva comercial ni los saldos de crédito. Esos puntos requieren UAT operativo separado en Sandbox. No se enviaron mensajes ni se alteraron reservas, pagos o créditos reales.

El caso anterior de consulta ambigua/fuera del catálogo y el de domicilio con rechazo de clases también se ejecutaron en un Preview previo; los precios concretos deben cotejarse con catálogo antes de promover. La promoción sigue pendiente de cerrar las verificaciones operativas y la autorización correspondiente.

### Revisión de pendientes operativos — 2026-10-08

- En el Supabase Sandbox del Preview, la política de cancelación está configurada a 300 minutos y consume crédito cuando la cancelación es tardía. La política de primera clase requiere prepago para prospectos; la regla de prueba tiene `require_payment_before_booking=false`. La selección de política para prospectos se complementa con `assistant_booking_behaviors.prospect_require_payment_before_booking=true`.
- El RPC de elegibilidad se ejecutó en solo lectura sobre una sesión futura; devolvió razones consistentes con fichas de prueba sin inscripción, documentos requeridos y estudiantes no operables. No se identificaron personas en el reporte agregado.
- `npm run typecheck` pasó y 29 pruebas focalizadas de conversación, booking, cancelación, créditos, comprobantes y elegibilidad pasaron. Una corrida amplia dio 100 pruebas aprobadas; sus cinco aserciones fallidas y una suite sin migración se reprodujeron también en `origin/main`, así que no son fallos nuevos de esta rama.
- No se ejecutó cancelación, reserva, cobro, activación de paquete ni comprobante en el Sandbox. El simulador marca explícitamente esas consecuencias como simuladas.
- El Sandbox contiene 48 fichas de estudiantes; solo 13 tienen correo `example.invalid` y 21 teléfono `+999`. No puedo asegurar que el resto sea sintético, pese a la documentación histórica del seed. Por eso se detuvieron las pruebas con escritura; no es seguro usar ese proyecto para alterar créditos, pagos o reservas hasta aislar una base limpia.

Estado: UAT conversacional aprobado para los casos simulados; UAT operativo de cancelación tardía, efecto en crédito, elegibilidad efectiva y transferencia/comprobante bloqueado por falta de un entorno de datos seguro. No listo para promover. No se modificó producción.

### UAT en tenant vacío y corrección de nombre — 2026-10-08

Se usó el tenant vacío `Studio Flow Billing UAT` del proyecto Supabase Sandbox (`hedouonyhynuvwbckdlg`), no el tenant Demeter ni el proyecto de producción. Se agregaron una sede, una clase ficticia a $150 MXN, una sesión futura y la política de prepago para probar consultas reales del catálogo. No se configuraron datos bancarios.

| Caso                                                 | Resultado observado                                                                                                                                                                                                                            | Estado                                                                                                                  |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Prospecto pregunta horario y precio de primera clase | Encontró la clase del 9 de octubre, pero primero dijo que no veía precio; después de completar el nombre respondió $150 MXN. La primera respuesta fue inconsistente sobre el precio.                                                           | Falla de conversación en el Preview probado                                                                             |
| Nombre e intención de reservar en un mismo mensaje   | El simulador volvió a pedir el nombre completo.                                                                                                                                                                                                | Falla reproducida; se corrigió `confirmSimulatedProspectName` para reconocer el nombre antes de una frase de intención. |
| Prepago de prospecto antes de reservar               | Con dos confirmaciones, Demi indicó que faltaban datos de transferencia y que el lugar solo se confirma tras validar el pago. El texto que afirmaba haber enviado comprobante sin adjuntar archivo recibió la petición correcta de reenviarlo. | El control de pago simulado se mantuvo; el Preview probado pidió una confirmación adicional y no tenía datos bancarios. |
| Prospecto consulta domicilio                         | Contestó el domicilio ficticio del tenant UAT y ofreció revisar horarios.                                                                                                                                                                      | Aprobado conversacional                                                                                                 |
| Alumna ficticia consulta créditos                    | Respondió 8 créditos disponibles.                                                                                                                                                                                                              | Aprobado conversacional                                                                                                 |

La cuenta de transferencia se dejó sin configurar deliberadamente; no se usaron datos bancarios reales ni inventados. Al terminar, las tablas del tenant registraron cero reservas, pagos, ventas, intentos de transferencia o acciones pendientes.

La corrección del simulador está en el commit local `bed02aab`. Las pruebas enfocadas pasan 20/20, `npm run typecheck` pasa y Prettier pasa en los archivos cambiados; lint no tiene errores y mantiene advertencias preexistentes. Ese commit aún no está en el Preview. La publicación de la rama a GitHub no pudo completarse: la red local no conectó y el CLI no tenía credenciales. El auto-review pidió autorización específica para publicar a la rama pública `mikevazquez/Demeter`; se verificó que el usuario autenticado es propietario y tiene permisos de escritura. Falta autorización para esa publicación y un Preview actualizado para repetir el UAT corregido.

### Revisión de release — 2026-10-08

- Producción Vercel apunta a `main`, commit `323e1bb7` (`READY`). El Preview UAT apunta a `codex/demi-prospect-prepay-uat`, commit `1b196fe4` (`READY`).
- La rama UAT y `main` están divergidas: 19 commits solo en UAT y 14 commits solo en `main`; no hay PR abierto. No promover el Preview ni mezclar la rama directamente: primero hay que integrar selectivamente el cambio de Demi sobre `main` reciente, desplegar Preview nuevo y repetir las pruebas.
- Este entorno no tiene Docker ni Supabase CLI para levantar una base local aislada. Crear un nuevo proyecto Supabase requiere seleccionar organización y revisar/confirmar el costo antes de crearlo.
- La instrucción recibida fue preparar el envío a producción, pero no incluyó la frase requerida `Autorizo promoción`. La promoción permanece bloqueada tanto por esa autorización como por los gates técnicos anteriores.

### Demi compartida y UAT de prospectos — 2026-10-08

- La publicación a la rama pública fue autorizada. Se publicaron `8d89e83f` (configuración compartida) y `0662aea4` (precio de clase suelta y confirmación de transferencia). Preview `demeterbueno-lcunvnu1r-demeter3.vercel.app`, READY, probado en Studio Flow Billing UAT, Sandbox `hedouonyhynuvwbckdlg`. Producción sin modificar.
- `loadDemiRuntimeConfig` centraliza la configuración por `studio_id`, utilizada por WhatsApp y el banco de pruebas. La personalidad, modelo, herramientas y políticas no se duplican por canal. El prompt exige identidad verificada y prohíbe vincular fichas por nombre de redes sociales. No se implementaron ni activaron adaptadores de Instagram/Facebook; el único webhook externo presente en este repositorio es WhatsApp.
- Primera consulta de horario y precio: respondió viernes 9 de octubre de 18:00 a 19:00 y $150 MXN. La corrección consulta el precio de clase suelta de Studio Flow aun cuando no existan paquetes.
- Nombre más intención en el mismo mensaje: «Me llamo Valeria Demo y sí quiero reservar esa clase» fue aceptado sin volver a pedir el nombre.
- «Sí, prepárame los datos para transferir»: una sola confirmación avanzó al requisito de pago, sin crear reserva ni pago. El tenant no tiene cuenta bancaria configurada; Demi reconoció que faltaban los datos y no inventó una cuenta.
- Verificación automática: 25 pruebas de workbench/audiencia/precios/horarios y 14 de contratos comerciales/nombre/transferencia aprobaron. Las pruebas de comprobante son contratos de código, no una carga real de archivo.
- El banco actual no permite adjuntar comprobantes; su ejecución simula operaciones. No acredita recepción/validación de imagen/PDF ni creación operativa de la reserva. Ese tramo sigue pendiente de UAT operativo aislado. No presentar estos resultados como validación integral del pago real ni como autorización de promoción.

- Comprobante declarado sin adjunto: «Ya mandé el comprobante, confírmame la reserva» recibió «No veo ningún comprobante adjunto... no puedo validar el pago ni confirmar tu reserva», y pidió imagen/PDF. Aprobado conversacional.
