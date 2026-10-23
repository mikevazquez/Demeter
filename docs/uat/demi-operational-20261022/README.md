# Demi · matriz operativa · 22 oct 2026

**Resultado parcial con un fallo conversacional abierto.** Los efectos operativos probados son correctos; una confirmación que incluye fecha/hora vuelve a pedir confirmación. UAT integral y Release sin aprobar. DEMI-PILOT-01 bloqueado e inactivo.

## Versiones y alcance

- Fuente de scripts: `0d3020e73d49afbf998be717583761b3edfb54f5`.
- Runtime: `55f59c2cef805908d45748a06c205dcc8ad60a67`.
- Preview: `demeterbueno-1cg95i7da-demeter3.vercel.app`; deployment `dpl_Es8n4iWdKMW1xZpfAx3eE8urq7E2`.
- Única base: Sandbox `hedouonyhynuvwbckdlg`.
- Rama `codex/demi-handoff-uat-20261022`, [PR #367](https://github.com/mikevazquez/Demeter/pull/367), borrador.
- Sin cambios de aplicación, reglas, migraciones, canales o adapters en este bloque. No se repiten migraciones ni velocidad previamente aceptada. Producción sin cambios.

Las conversaciones usan el banco autenticado y receptor real; modelo, PostgreSQL, herramientas y RPC reales. Salida capturada en scope UAT, sin entrega externa de Meta. Pasos iniciales por formulario del navegador y posteriores mediante la misma acción autenticada con FormData.

## SQL: 36 comprobaciones pasan

| Script                                       | Comprobaciones | Alcance                                                                                                                      |
| -------------------------------------------- | -------------: | ---------------------------------------------------------------------------------------------------------------------------- |
| `tests/demi-2-operational-uat.sql`           |             10 | Reserva/duplicado, corte5h, tardía, inscripción, retorno, atención humana, fallos capturados, ausencia, asistencia y rechazo |
| `tests/demi-trial-enrollment-credit-uat.sql` |             13 | Pago validado/mismo día/actor válido, inscripción50 + paquete íntegro, rechazo atómico y replay                              |
| `tests/demi-2-trial-credit-uat.sql`          |             13 | Grupo/pago antes de datos, pago parcial, asignación única, vigencia, cambio, corte5h, agotamiento y nuevo pago               |

Los tres scripts se ejecutaron íntegros, en tenants sintéticos, con rollback y sin ajustes. El cambio de regla de tenant del segundo script vive dentro de la transacción revertida. No sustituyen conversaciones A05/A06 ni toda la matriz A07. Datos: `sql-results.json`, `trial-credit-results.json`.

## Conversaciones y efectos

Run de reserva `01ed1730-11bd-43ac-b685-134ddd22ba52`; tenant `7102672b-ad3e-496d-bda8-355c19665c0c`.

| Paso                                  | Efecto observado                                                                  | Saldo |
| ------------------------------------- | --------------------------------------------------------------------------------- | ----: |
| Solicitar jueves22oct18:00            | Prepara; no reserva                                                               |     8 |
| Confirmar con fecha/hora y paquete    | **F01 FALLA**: `explicit_confirmation_required`; prepara otra vez                 |     8 |
| «Sí, confirmo»                        | Una reserva `b06b7363-bb55-4755-a3c7-536ff94716c6`, un débito                     |     7 |
| Cancelar con motivo                   | `cancelled_on_time`, devolución única                                             |     8 |
| Solicitar viernes23oct18:00           | Prepara; no reserva                                                               |     8 |
| Confirmar con fallo previo            | Fallo comunicado; sin reserva ni débito                                           |     8 |
| Confirmar con timeout posterior       | Una reserva `cbd77d24-1db7-425b-8733-b06cbe755de0`; resultado incierto comunicado |     7 |
| Retirar fallo y confirmar             | Recupera la MISMA reserva, sin otro débito                                        |     7 |
| Repetir ID de confirmación del jueves | Ignorado; sin turnos/modelo/delivery ni efectos nuevos                            |     7 |

Se usaron las flags existentes `booking_uat_failure_before` y `booking_uat_timeout_after` de ese run ficticio, con artefactos `operational_fault_setup`. Ambas claves se restauraron a ausentes. El estado final conserva reserva vieja cancelada y nueva reservada, con un crédito usado neto. A04 pasa esta secuencia; A03 pasa la cancelación oportuna capturada y variantes SQL, con recordatorios completos pendientes.

Run negativo `cf463ea9-be76-41a0-a763-562bc3334e83`; tenant `5622a67b-a35c-40ea-89ad-5add48e1cd50`.

- Clase llena: confirmación crea sólo lista de espera, sin reserva ni débito. Se movió únicamente la sesión ficticia full a +24h con el control existente para distinguirla de available.
- Paquete vencido: identifica vencimiento y ofrece clase150 o paquete600, sin reservar, consumir ni renovar.
- Sin créditos: identifica falta de cobertura y ofrece transferencia, sin reservar ni cobrar.

Los cuatro pasos negativos preservan las seis tablas comerciales: reservas, ledger, adquisiciones, inscripciones, ventas y pagos. A02 pasa estos negativos y los fallos previos/posteriores en el alcance capturado.

**13 solicitudes conversacionales, 12 eventos nuevos y un replay; 12 respuestas capturadas.** Datos: `booking.json`, `negatives.json`. Los snapshots previos al cierre se conservan; la auditoría posterior registra revocación y verificación de seguimientos pendientes.

## F01 y pendientes

Mensaje fallido: «Sí, confirmo la reserva del jueves 22 de octubre a las 18:00 con mi paquete.» El allowlist exacto de `isExplicitAssistantConfirmation` rechaza la frase completa; Demi busca/prepara y vuelve a preguntar. «Sí, confirmo» pasa después. **M13 queda fallido por esta variante**; M09/M10/M07 parciales.

Siguiente: definir y corregir F01 manteniendo turno nuevo, identidad/resumen pendientes y rechazos de negación, contradicción o cambio de fecha. No se amplió el parser durante estas pruebas. Repetir la variante y seguir A05/A06 y resto de A07. Falta revisión funcional de Mike y matriz operativa completa; UAT integral sin aprobar.

La automatización se bloqueó en `response.finished()` tras un evento persistido y tuvo un timeout al cargar el selector. Se recuperaron artefactos sin repetir eventos procesados. Intentos multipart iniciales dieron500 `demi_uat_run_not_found` por codificación/orden de FormData, antes de generar eventos. Se corrigió sólo el cliente privado según el formulario: campos `_1_...` antes de raíz `0`. Esos fallos de automatización no cuentan como casos aprobados ni respuestas de negocio. Ningún script SQL se ajustó.

Verificación offline: `python scripts/uat/verify_demi_operational.py`. `summary.json` conserva `PARTIAL_WITH_FAILURE`; exige efectos seguros y evidencia del fallo abierto. Limpieza: `cleanup-audit.json`, `access-cleanup.json`.

La cuenta sintética `efe87ea5-2b5e-416e-9239-50156c5497d0` quedó disabled/banned, con0membresías activas/sesiones/refresh. Login400 user_banned y sesión antigua a login. Se retiraron5archivos privados. Cero seguimientos pendientes;16intentos automáticos de notificación auditados, todos capturados/uat:, cero externos.
