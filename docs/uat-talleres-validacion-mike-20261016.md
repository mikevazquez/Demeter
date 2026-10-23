# UAT funcional de Mike — Talleres y Eventos (Sandbox)

Fecha de preparación: 2026-10-16. Rama: `feat/talleres-saldos-configurables-uat`. PR #284. Este documento es un guion de validación, NO evidencia de UAT aprobado. Usar solamente alumnos, talleres y pagos ficticios en Sandbox. No utilizar personas ni dinero reales. No promover a producción desde esta validación.

## Preparación

- Abrir el deployment Preview que corresponda al HEAD actualizado de PR #284 y confirmar conexión a Supabase Sandbox `hedouonyhynuvwbckdlg`. Nunca usar dominio de producción.
- Entrar con cuenta administrativa de prueba que tenga `schedule.read/write`, `sales.read/write` y `products.write`. Si falta acceso, marcar bloqueado y no sortear permisos.
- Navegar a `/admin/actividades/talleres`; desde ahí utilizar `Nuevo taller`.
- Crear 1 alumna sintética vigente, 1 vencida y 1 invitada sintética con identificadores de prueba. Confirmar aislamiento y que no salen mensajes externos.
- Taller de muestra: «UAT Taller Octubre», tres fechas futuras, capacidad 2 por sesión, precio completo $600, precio individual $150 por fecha, anticipo $300 o 50%, saldo restante con plazo configurable.

## Validaciones que realiza Mike (funcionales)

Usar **Aprobado / Falló / Bloqueado / No disponible** e incluir captura y observación por escenario.

| ID               | Validar como usuario                                                                                  | Resultado esperado                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| F01 / TALL-01    | Crear taller, guardar, editar nombre, fechas, disciplina, coach, espacio y aforo; regresar al listado | Taller reaparece con datos correctos, separado de las clases regulares                                               |
| F02 / TALL-02    | Elegir paquete completo y luego comprar fechas por separado, incluidas las tres fechas                | Total completo $600; individual 1/2/3 = $150/$300/$450; nunca convertir automáticamente tres individuales en paquete |
| F03 / TALL-03    | Elegir dos sesiones y registrar compra                                                                | Compra única con exactamente dos reservas; resumen correcto                                                          |
| F04 / TALL-05    | Alternar inscripción obligatoria/opcional; probar alumna vigente y vencida                            | Solo se acepta cuando se cumple la política del evento                                                               |
| F05 / TALL-06    | Simular persona externa sin inscripción en evento que lo permite                                      | Puede comprar solo cuando se habilitó esa modalidad; no se convierte en alumna regular automáticamente               |
| F06 / TALL-07    | Registrar anticipo fijo $300 y alternativa 50% para precio de $600                                    | Anticipo $300, saldo $300; la reserva solo queda confirmada después de la verificación del pago                      |
| F07 / TALL-09    | Configurar vencimiento de saldo; mirar estados antes/después de la fecha con fixture de prueba        | Estado y fecha correctos, sin acción inesperada                                                                      |
| F08 / TALL-10    | Abonar $100 y luego $200 a saldo de $300                                                              | Saldo $200 y luego $0, sin doble aplicación                                                                          |
| F09 / TALL-11    | Cancelar inscripción/compra sintética                                                                 | Se refleja correctamente la cancelación, cupos e historial; sin reembolso automático no solicitado                   |
| F10 / TALL-12    | Revisar recorrido en portal de alumna y conversación Demi                                             | Cotizaciones, accesos y reservas correctas; marcar **No disponible** si aún no hay interfaz                          |
| F11 / TALL-14/15 | Elegir «conservar y avisar» vs «liberar tras gracia»                                                  | La reserva y sus avisos siguen la política visible; ninguna liberación anticipada                                    |
| F12 / TALL-13    | Comprar/reservar una clase normal independiente                                                       | La funcionalidad ordinaria no cambia                                                                                 |
| F13 / TALL-01/02 | Usar editor, detalle y compra desde móvil                                                             | Formularios legibles, acciones utilizables, totales visibles y sin desbordamientos                                   |

**No dar por APROBADO un caso que no esté implementado o accesible en Preview.** Registrar el paso que falla, captura, usuario de prueba, hora y resultado observado.

## UAT a cargo del agente (técnicos, no requieren revisión manual de Mike)

- TALL-04: dos compradores compiten por último cupo, máximo una reserva.
- TALL-08: atomicidad venta/pago/compra/reservas, rollback e idempotencia.
- TALL-13: pruebas automatizadas y regresiones técnicas (la validación de experiencia queda con Mike).
- TALL-16: carreras entre confirmación de pago y liberación de cupo.
- TALL-17: política congelada por compra ante futuras modificaciones.
- TALL-18: aislamiento multiestudio, permisos y acceso cruzado.
- Pruebas negativas adicionales de importes, solicitud duplicada, sesión agotada, permisos y saldo.

## Criterio para presentar preview a Mike

1. Publicado desde HEAD correcto, READY y apuntando inequívocamente a Sandbox.
2. Alta/edición, listado/detalle y compra administrativa navegables y probados al menos con sesión de prueba.
3. Fixture aislado listo y pasos reproducibles.
4. Resultados técnicos con evidencia; no confundir suites locales con UAT extremo a extremo.
5. Señalar explícitamente áreas no disponibles; no marcar los 18 casos aprobados por defecto.

## Plantilla de reporte

| ID  | Estado    | Captura / observación | Fecha |
| --- | --------- | --------------------- | ----- |
| F01 | Pendiente |                       |       |
