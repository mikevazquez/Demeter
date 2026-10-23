# Demi · Información y recuperación de altas de Talleres

Incremento separado de Talleres administrativo ya aceptado. Base: PR #317,
`617fa2d51d730209dd4a2ec2c893817c358304bb`. Definición y tareas:
[DEMI-TALL en Notion](https://app.notion.com/p/402d78f714638118a8e3cbd265da0a47).

Demi consulta precios y cupos del motor existente y presenta fechas en la zona
horaria del estudio. Distingue altas deshabilitadas de un catálogo vacío. La
misma consulta recupera únicamente la solicitud de la conversación actual y
distingue cotización, comprobante pendiente, apartado provisional, confirmado,
rechazado, vencido y baja. Tras pagos o cancelación en la app recupera el saldo
y estado actuales; un comprobante y una afirmación de pago no confirman ingresos.

El alta de una alumna vinculada conserva los RPC existentes: cotizar selección,
aceptar condiciones en otro turno, recibir comprobante, apartar provisionalmente
y esperar revisión autorizada. Errores de solicitud pendiente no invitan a otra
transferencia. No se modificó el motor financiero ni la identidad.

## Evidencia técnica

- Vitest: **2.016/2.016**, 262 archivos, versión final de este incremento.
- PostgreSQL 17 aislado: **69/69** escenarios, imagen fijada por digest,
  sin red ni base remota. Incluye recuperación después de pago y baja, rechazo,
  vencimiento, ausencia de efectos financieros en lecturas y acceso cruzado.
- TypeScript, formato y build Next.js aprobados. ESLint focalizado: cero errores,
  dos advertencias preexistentes en los archivos revisados.
- Sandbox `hedouonyhynuvwbckdlg`:
  `scripts/uat/demi-workshop-context-rollback-20261023.sql`, **16/16** comprobaciones
  con roles reales y reversión integral del fixture. No usa Auth, modelo, OCR,
  WhatsApp ni dinero real. Cero estudios de ese fixture después de la prueba.
- Migración fuente `20261023134522_demi_workshop_conversation_context.sql`,
  aplicada exclusivamente en Sandbox como `20261023135418`.
  RPC de lectura, sin tablas nuevas ni cambios a RPC de compra/revisión.
  Sin EXECUTE para anon/authenticated. Advisors antes/después sin cambios
  y sin hallazgos para este RPC.
- Tras las pruebas: cero estudios con Demi de talleres habilitado. No se
  configuró canal, presupuesto, credenciales ni desvío de WhatsApp.

La rama y el PR dependientes no cambian #317 ni su candidata aceptada. El workflow
CI actual escucha PR hacia main; un PR cuya base es la rama de #317 no dispara
esa CI. No confundir los checks de #317 con checks de este incremento. Al
integrar la dependencia y retargetear a main se ejecutarán los checks remotos
de la nueva candidata.

## Casos preparados para la integración de Demi

Estos casos son del incremento conversacional. No reabren la UAT administrativa.
Usar sólo estudio y participantes sintéticos de Sandbox; la configuración debe
estar habilitada expresamente para ese fixture antes de una conversación.

| Caso | Mensajes y estado                                | Resultado requerido                                                                                                 |
| ---- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| DT01 | «¿Qué talleres hay y cuánto cuestan?»            | Herramienta de Talleres; precio oficial, fechas y hora local; sin pedir datos personales ni vender paquete regular. |
| DT02 | «Quiero el completo» / elegir dos fechas         | Cotización del modo exacto, anticipo y saldo; ninguna reserva o pago antes de aceptar.                              |
| DT03 | «¿Sí?» frente a «Sí, acepto» en otro turno       | Pregunta no acepta condiciones; aceptación expresa devuelve instrucciones sin afirmar inscripción confirmada.       |
| DT04 | «Ya pagué» sin comprobante registrado            | Consulta estado actual; no asume pago ni crea otro cobro.                                                           |
| DT05 | Comprobante registrado, luego «¿Ya quedé?»       | Apartado provisional y pago en revisión; ninguna confirmación definitiva.                                           |
| DT06 | Equipo aprueba y luego recibe abono desde la app | Recupera compra confirmada y saldo actual; un único pago por solicitud.                                             |
| DT07 | Rechazo, vencimiento o fecha sin cupo            | Estado comprobado; no promete inscripción, devolución ni reserva disponible.                                        |
| DT08 | Baja desde ficha, luego pregunta por inscripción | Baja actual, sin reservas activas; conserva pagos y deuda.                                                          |
| DT09 | Altas por Demi deshabilitadas                    | Explica indisponibilidad de altas automáticas, sin afirmar que el estudio no ofrece talleres.                       |
| DT10 | Otra conversación/otro estudio                   | No recupera solicitud ajena; sin datos personales de otra ficha.                                                    |

La suite SQL acredita los estados y límites, y Vitest las herramientas y guía.
No se ejecutó una conversación nueva con modelo, OCR o transporte externo. El
banco general simula acciones y no acredita una compra real de este incremento.
No presentar estos casos como UAT conversacional ya ejecutada.

## Decisión pendiente: personas nuevas

El alta actual requiere una ficha vinculada. Mike tiene pendiente responder si
este incremento incluye personas nuevas sin ficha. DEMI-TALL-03 conserva
Discovery. Antes de implementar ese subflujo se definirá cómo reutilizar la
identidad de canal/CRM, pedir sólo datos necesarios y evitar duplicados o una
conversión indebida en alumna regular. No usar el registro de paquetes ni crear
cuentas Auth para sortear ese requisito.

## Reversión

La aplicación puede volver a la candidata de #317; la función de lectura nueva
no altera sus rutas existentes. Mientras conserve consumidores no se elimina
el RPC. No hay datos comerciales ni tablas que revertir. Producción no recibió
esta migración ni despliegue ni autorización de promoción.
