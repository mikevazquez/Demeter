# Revisión del alcance de producción — 10 octubre 2026

El usuario separó la aprobación de Demi → Studio Flow de la habilitación de cada canal. Instagram queda expresamente pendiente y fuera de la primera promoción. Un nuevo canal requiere probar autenticación, identificación, entrada/salida, formatos soportados y entrega; no repetir todo el UAT de negocio si no cambia el núcleo. Un fallo de adaptación que altere una operación de negocio sí exige repetir las pruebas afectadas.

## Validación de identidad ejecutada

Se ejecutó `tests/demi-2-identity-uat.sql` en Sandbox con roles reales service_role y authenticated; nueve grupos de controles pasaron. La transacción terminó con ROLLBACK, sin conservar fichas ni operaciones sintéticas. No se modificó el comportamiento de Demi.

- Facebook e Instagram crean prospectos sin teléfono ni ficha de alumno, reutilizan la identidad al repetir el contacto y mantienen espacios de identificadores separados por canal/cuenta.
- Teléfonos inválidos se rechazan; el teléfono declarado se normaliza sin considerarlo autenticación.
- Un teléfono existente localiza candidatos sin exponer datos ni crear otro alumno. La vinculación actual requiere verificación humana documentada.
- La vinculación conserva exactamente la ficha del alumno, ventas, reservas y adquisiciones; conserva historial de conversación y genera una sola auditoría.
- Después de verificar y resolver el caso, otro mensaje por el mismo canal reconoce el mismo alumno y conversación.
- Los controles entre estudios rechazan referencias ajenas.

La vinculación completamente automática por teléfono declarado **no está implementada ni acreditada**. El flujo vigente utiliza verificación presencial, WhatsApp verificado o portal existente, registrada por el equipo. Registrar un nombre de usuario de red social en el perfil no equivale a verificar el identificador de mensajería.

## Tres casos parciales y efecto en producción

| Caso                    | Alcance pendiente                                                                                                                                                                                                                  | Decisión                                                                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M01 Canales             | Recepción/respuesta externa de cada canal; Facebook tiene token invalidado por Meta (190/460); Instagram sin habilitación final; bienvenida saliente de WhatsApp acreditada, recorrido entrante de la versión candidata pendiente. | No bloquea publicar el núcleo con canales inactivos. Sí bloquea habilitar Demi en un canal no validado. Instagram queda diferido explícitamente.                     |
| M05 Pago antes de datos | Aprobado: nuevo pago detectado por cron, continuación automática, una reserva y aviso capturado. Webhook firmado pendiente como variante.                                                                                          | La consulta periódica autenticada es el mecanismo probado; el aviso WhatsApp real se valida en M01. No exigir un webhook para el recorrido que ya pasó por consulta. |
| M18 Audio/archivos      | Audio externo Facebook aprobado; imagen recibida sin pago pendiente; asociación positiva de archivo pendiente. Audio/archivos internos aprobados; transporte WhatsApp e Instagram pendiente.                                       | No bloquea publicar el núcleo aislado. Sí bloquea habilitar los formatos correspondientes del canal hasta acreditar su transporte. Instagram queda diferido.         |

El conteo íntegro vigente es **16/18 aprobados, 2 parciales**. M05 pasó con detección periódica autenticada, reserva automática y aviso capturado en el nuevo pago de prueba; no se acredita webhook firmado. Excluir Instagram no convierte automáticamente M01/M18 en aprobados. No se ha promovido producción ni habilitado el relevo piloto WhatsApp #261.

Recomendación: preparar la promoción de Demi → Studio Flow, conservar Instagram deshabilitado y cerrar M05 antes de activar la automatización MP. Comprobar entrada/salida de la versión candidata en WhatsApp antes de habilitarlo para clientes. Facebook requiere renovar su token; esta dependencia pertenece al canal.

Actualización de salida: la plantilla nueva de seguimiento está APPROVED en Meta. Preparación de activación probada con ROLLBACK en Sandbox: producto nuevo $150/7 días, 21 claves de plantilla y seguimientos deshabilitados durante el piloto. No ejecutar configuración de producción antes de autorización.
