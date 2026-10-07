# Demi: editor de instrucciones y pruebas

Estado: implementado en rama `feat/demi-prompt-workbench`; migración aplicada únicamente a Studio Flow Sandbox (`hedouonyhynuvwbckdlg`). Producción no modificada. UAT del usuario y promoción pendientes.

## Acceso y comportamiento

- Comunicación → Demi y también Integraciones → Demi.
- Instrucciones: carga el prompt existente; guarda borradores sin modificar `assistant_configs.personality_instructions`.
- Mejorar con IA: propone un prompt completo a partir del borrador y una petición. Requiere elegir «Usar en el borrador» y guardar; no activa cambios automáticamente.
- Pruebas: mismo modelo, instrucciones operativas y orquestador; perfil ficticio de prospecto o alumna. Consulta catálogo, precios, horarios y políticas con las herramientas existentes. Las acciones se interceptan en servidor.
- El historial conserva versiones iniciales, borradores y activaciones. Se muestran las últimas 50 versiones. Restaurar crea un nuevo borrador; no reescribe el histórico.
- La activación es explícita y atómica, con comprobación de la versión activa para evitar sobrescribir cambios concurrentes. No modifica el modo, modelo, límites ni canal de Demi.

## Aislamiento de las pruebas

El chat no llama a los ejecutores de acciones reales, ni a sus atajos de confirmación, inscripción o selección de paquete. Tampoco genera solicitudes reales de atención humana. Usa una conversación marcada `workbench`, ligada a administrador, estudio, perfil y hash del borrador. Cambiar el borrador o perfil inicia otra conversación.

La alumna tiene un paquete y saldo ficticios; las reservas simuladas viven solo en el contexto de la conversación. La demo anterior no se utiliza en esta pantalla. No se envía WhatsApp. Solo se escriben registros internos de conversación, turnos, llamadas IA y trazas.

Limitación explícita: la simulación verifica el comportamiento conversacional, no la elegibilidad operativa, cupos ni consecuencias reales de cancelación. Transferencias, selección de pole y enlaces de acceso aún devuelven una limitación de simulación y nunca ejecutan el flujo real. Estos casos requieren UAT operativo separado en sandbox.

## Validación ejecutada

- TypeScript, ESLint de los archivos cambiados y compilación Next.js.
- 7 pruebas de comportamiento: entrada del prompt; aislamiento de los atajos; intercepción de reservas; atención humana; modelo/borrador y mejora sin herramientas; presupuesto; reservas y cancelaciones ficticias sin escrituras de negocio.
- Suite completa comparada contra `d64363baca7b84f18c7cea7450d03f5e12a7e839`: 76 fallos previos, ninguna regresión nueva y ningún test previo eliminado.
- UAT transaccional en sandbox, con rollback: guardar borrador conserva versión activa, activación cambia instrucciones y registra histórico, conflicto concurrente bloqueado, borrado del histórico y acceso anónimo denegados.
- Asesores de seguridad: tabla nueva con RLS y políticas; sin hallazgos para la tabla o función nuevas. Hallazgos existentes fuera de este alcance permanecen sin modificación.

## UAT del usuario

1. Abrir Demi, editar el tono y guardar. Recargar: debe persistir el borrador y conservarse la versión activa.
2. Pedir «respuestas más breves y una sola pregunta». Revisar propuesta, descartar o usarla en borrador.
3. Probar «Nunca he hecho pole, ¿cómo empiezo?» como prospecto; después consultar horarios y preparar/confirmar una reserva simulada.
4. Cambiar a alumna; crear una reserva ficticia y cancelarla indicando motivo. Ninguna reserva ni crédito real debe cambiar.
5. Restaurar una versión anterior al editor, guardar y probarla.
6. Activar únicamente en sandbox y comprobar la versión activa. Antes de aplicar migración o desplegar en producción se requiere «Autorizo promoción» para este alcance.

## Reversión

Restaurar las instrucciones anteriores desde historial y activarlas explícitamente. Para retirar la pantalla, revertir el commit de aplicación. No borrar tablas de historial, conversaciones o trazas. La migración es aditiva y conserva las instrucciones originales.
