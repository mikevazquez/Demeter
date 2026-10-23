# Demi · F01: confirmación con fecha y hora

**F01 pasa las seis variantes probadas en Sandbox.** La frase que antes fallaba confirma ahora una sola reserva, descuenta un crédito y no vuelve a preguntar. El UAT integral y la revisión funcional siguen pendientes.

## Versiones y cambio

- Runtime/fuente: `5feefafb38a98e57a91b749e514a52c0a1212a8b`, sobre evidencia histórica `daa32acebfa4b7cdef92fb6145991c761ee0628a`.
- Única base: `hedouonyhynuvwbckdlg`. Preview `demeterbueno-jmlwna66v-demeter3.vercel.app`, deployment `dpl_C9X83NHvNyoGqRYQ8LAxf5BrpPhP`.
- Rama `codex/demi-handoff-uat-20261022`, [PR #367](https://github.com/mikevazquez/Demeter/pull/367), borrador. Sin merge.

`isExplicitAssistantConfirmation` conserva las frases cortas y reconoce un formato acotado de confirmación detallada sólo cuando recibe el resumen de una reserva pendiente: día/mes y hora local coincidentes, año/día de semana si se mencionan y cobertura `package_covered` si dice «con mi paquete». Rechaza cláusulas adicionales, condiciones y contradicciones. También rechaza interrogación incompleta con «¿».

La ruta determinista y el ejecutor comprueban ese mismo resumen. Compras, cancelaciones, cambios y espera no reciben esta ampliación. Se conservan turno nuevo, vencimiento, identidad y barrera contra entradas obsoletas. El simulador usa el mismo reconocimiento y deriva la cobertura de su fixture de alumna con créditos. No se modifican reglas comerciales, DB, migraciones, canales ni adapters.

## Pruebas y efectos

Local: **236 archivos / 1809 pruebas pasan**, tipos y formato pasan, lint0errores/1warning previo. Se añadieron45pruebas: reconocimiento positivo/negativo, resumen incompatible, mismo turno, vencimiento, identidad, paridad del simulador y rutas de acciones. La primera preparación local tuvo errores de persona (`student_active` es fixture DB; simulador usa `student`) y tipado del doble de DB; se corrigieron antes de publicar.

[CI39726267691](https://github.com/mikevazquez/Demeter/actions/runs/39726267691) y [Governance Supervisor39726267689](https://github.com/mikevazquez/Demeter/actions/runs/39726267689) **SUCCESS para5feefafb**. Incluye formato, lint, tipos, pruebas contra base y build. Preview READY.

Receptor/RPC/PostgreSQL reales; modelo real en preparación y negativos, **0llamadas de modelo en las confirmaciones válidas**, que usan la ruta determinista. Salida capturada; no prueba entrega externa por Meta.

| Variante            | Resultado y efectos                                                                                         | Run                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Coincidencia exacta | Una reserva, un débito, saldo7; sin nueva pregunta. Replay ignorado sin efectos ni respuesta nuevos         | `78e6c9a9-76ed-4207-9210-165f92b3f0a4` |
| Fecha diferente     | No ejecuta el pendiente anterior; prepara alternativa y pide nueva confirmación. Sin reserva/débito, saldo8 | `b6b0ba98-8736-430d-b6fd-b56827037ba7` |
| Hora diferente      | No ejecuta; informa que19:00no existe y vuelve a pedir confirmar18:00. Saldo8                               | `89ff0258-355d-4860-9ebf-36671650a1eb` |
| Negación            | No reserva; reconoce negativa y conserva saldo8                                                             | `be377b53-2ab7-4646-aa24-dcde7fd5180a` |
| Condición           | Prepara/pide confirmación; no reserva ni descuenta. Saldo8                                                  | `f3b810a9-1d0c-432c-bef8-8b70b9453d04` |
| Confirmación corta  | Sigue creando una sola reserva y débito, sin pregunta nueva. Saldo7                                         | `a64edba7-b1b2-4078-a3a2-d3c6632da749` |

**13 solicitudes,12eventos nuevos,12respuestas capturadas;49invariantes verificadas.** Los cuatro negativos preservan las seis tablas comerciales completas. Reservas reales de los positivos: `4f74429e-9dc9-440c-a641-94ecb16c3807` y `81302d3f-c178-4a11-8152-af79b72ea661`.

Verificador offline: `python scripts/uat/verify_demi_f01.py`; detalle en `summary.json` y JSON de cada variante. El banco conserva los snapshots completos de33tablas y sus artefactos. Los JSON versionados retienen14tablas relevantes y enumeran todas las consultadas; el cliente rechaza errores de snapshot. No se ocultan errores de consulta.

## Historia, cierre y límites

La corrida se retomó tras reinicio del entorno: se verificaron eventos/artefactos existentes y no se repitió el caso ya completado. Cada ejecución deriva fechas locales de su propio fixture; no se fijan las fechas de un run en otro. Un intento de crear el fixture de condición dio500/statement timeout antes de crear run/eventos; se verificó la ausencia y se retomó sólo lo faltante. No se cuenta como prueba aprobada ni turno de negocio. Sin ajustes de reglas/timeouts.

La falla original55f59c2c sigue conservada en `docs/uat/demi-operational-20261022`. Sólo se supera F01 en esta candidata; **M13 integral queda parcial**, igual que M07/M09/M10. Quedan A05/A06/A07, matriz restante y revisión funcional de Mike. No se repite velocidad aceptada.

Auditoría de acceso, notificaciones y seguimientos al cierre: `cleanup-audit.json`, `access-cleanup.json`. Se conservan los estados y artefactos de negocio. Producción, sus variables y despliegues intactos; DEMI-PILOT-01 bloqueado e inactivo. Release No listo.

Cuenta sintética `67aade3a-3ac1-4186-85d1-06ba3a217c84` disabled/banned;0membresías activas/sesiones/refresh y0seguimientos pendientes. Sesión vieja denegada y login400 user_banned.4archivos privados retirados.35intentos automáticos de notificación auditados, todos capturados/uat:,0externos.
