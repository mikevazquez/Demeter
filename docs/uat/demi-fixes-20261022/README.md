# Demi · correcciones de efectivo, derivación y validación · 22 oct 2026

**Verificación técnica aprobada en las superficies indicadas; UAT integral continúa BLOQUEADO.** Base `776537bbe92624cddb26727709f31b5e34a0e5e7`, candidata `56607e7e366cf8ea02cf6e34e8a8d477cba8d73f`, [PR #367 borrador](https://github.com/mikevazquez/Demeter/pull/367). Único backend: Studio Flow Sandbox `hedouonyhynuvwbckdlg`. No se atribuyen conversaciones del runtime anterior `5feefafb` a esta candidata.

## Cambios y evidencia

| Defecto                                                            | Corrección                                                                                                                                                                                                             | Verificación y límite                                                                                                                                                                                                                              |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MATRIX-F01: alta de paquete en efectivo falla42501                 | `service_create_demi_cash_purchase` usa `public.service_product_purchase_eligibility`, API de servicio ya existente, en lugar del helper privado. Compra sigue SECURITY INVOKER; sin grants, cambios de ACL ni reglas. | Error reproducido antes en ambas suites con rol DB real. Después pasan25controles con rollback: efectivo/humano7, fecha prometida4 y límites de elegibilidad/acceso14. No equivale a repetir la conversación del modelo.                           |
| MATRIX-F02: políticas de Demi y Polina confundidas                 | Consulta acotada a `assistant_key=demi`. Compatibilidad antigua sólo ante42703 que identifica esa columna ausente; no hace fallback por permisos, errores ajenos o múltiples filas.                                    | Ocho casos de regresión de consulta/compatibilidad. Nueve motivos pasan RPC real, con referencias, claim/resolve/replay y controles de aislamiento/permisos. Prueba de modelo capturado pendiente.                                                 |
| MATRIX-F03: texto mantiene validación pendiente después de aprobar | Orquestador lee la última intención de paquete de la misma alumna, estudio y conversación, en paralelo con las lecturas existentes. Informa al modelo estado validado o provisional, sin inventar reserva.             | Cinco casos de contexto: validado/provisional y tres estados que no acreditan validación. Lectura real del fixture A05 confirma validated. Se verificó entrada al modelo con un doble; no se declara aprobada su respuesta real en esta candidata. |

Suite local completa: **236 archivos / 1.822 pruebas pasan**. Tipos/formato pasan; lint de archivos afectados: cero errores y una advertencia preexistente en `modelCallId`. Resultados y controles concretos en [results.json](results.json).

## Efectivo: reglas conservadas

La compra crea deuda y derechos, sin pago ficticio ni reserva automática. Primera reserva inicia vigencia; segunda bloqueada hasta cobrar. No_show mantiene la deuda y consume una sola vez; cobro habilita la siguiente reserva sin reiniciar fechas. Fecha prometida persiste y replay no la cambia. Se conservan precio, identidad, elegibilidad de persona nueva, límite de compra, restricción de inscripción incluida y método de pago habilitado. Roles anon/authenticated no ejecutan las compras incluso con claims de servicio; el helper privado sigue inaccesible a servicio.

Prospecto puede acudir a pagar al estudio sin reserva ni garantía de lugar. La ruta de alumna y sus advertencias se conserva. Elegir efectivo no crea atención humana por sí solo; la prueba SQL acredita ausencia de efecto automático, no toda la política conversacional de derivación. **X y qué cuenta como intento están pendientes de aclaración; no se traslada el límite3 de reservas.** A07 sigue manual y fuera de automatización de Demi.

## Migración y ajustes de arnés

Migración aplicada únicamente en Sandbox: `20261022144842_demi_cash_purchase_service_eligibility.sql`, SQL desarrollado en `cc00036a`. CLI creó primero el archivo con versión `20261022144555`; MCP asignó `20261022144842` al aplicar y se alineó el nombre local con esa versión, sin alterar SQL ni historial DB. Se contrastó el cuerpo con la definición viva: cambia una llamada y se hace explícito el SECURITY INVOKER ya vigente. ACL y helper privado sin cambios.

`demi-handoff-all-reasons-uat.sql` inicialmente encontró18políticas al incluir a Polina; se acotó sólo el selector del script a Demi y pasan sus9motivos. Auditoría auxiliar intentó una columna `label` inexistente en `demi_uat_runs`; tras inspeccionar el esquema se comprobó rollback por `baseline.commit`, con cero fixtures persistidos. No se cambiaron reglas para aprobar.

Asesores de seguridad antes/después:313hallazgos preexistentes, cero nuevos. Se conservan conteos y [enlaces de remediación de Supabase](https://supabase.com/docs/guides/database/database-advisors) en el JSON; no se afirma resuelto el backlog previo.

## Estado y siguiente acción

MATRIX-F01 supera su error SQL sólo en esta candidata/migración. MATRIX-F02/F03 tienen corrección y regresión local, pendientes de repetición capturada. El informe histórico de la matriz sigue inalterado y su verificador conserva FAILED_WITH_BLOCKERS.

Repetir las conversaciones afectadas en una sesión administrativa UAT válida, con fixture de perfil completo, y verificar deuda/fechas/saldos, caso humano y texto de pago validado. No se reutilizaron cuentas revocadas ni se crearon cuentas temporales en este bloque. Preparar aceptación funcional de Mike; piloto sigue inactivo.

MATRIX-F06 sigue FALLIDO. Investigación de código: las dos reglas de reserva/reprogramación usan claves por evento/regla y la reprogramación invalida avisos pendientes. Cambiar sólo la clave no basta para demostrar una corrección segura; quedan pendientes orden de eventos, cancelación/reprogramación y concurrencia. No se modificó motor de notificaciones, canal ni adapter. Elegibilidad/timeouts siguen pendientes de investigación.

Producción, variables y despliegues productivos intactos. SQL de UAT revertido; sólo permanece la migración indicada. No merge ni activación de DEMI-PILOT-01. Candidata56607e7e: [CI39800450094](https://github.com/mikevazquez/Demeter/actions/runs/39800450094) y [Supervisor39800450060](https://github.com/mikevazquez/Demeter/actions/runs/39800450060) SUCCESS. [Preview](https://demeterbueno-br1jt47v7-demeter3.vercel.app/admin/mas/demi) READY, deployment `dpl_C7zVro8L5qsgR6NSdyZw8cNYNioL`. Eso no aprueba las conversaciones pendientes ni el UAT funcional.
