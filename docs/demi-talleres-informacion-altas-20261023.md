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
transferencia. Para una persona nueva que solicita inscribirse, Demi recoge el
nombre completo faltante y registra una participante vinculada al contacto propio
del canal. Comprueba oferta para invitadas, turno, nombre, teléfono e identidad;
coincidencias con otra ficha requieren verificación. Después usa el mismo checkout.
No se modificó el motor financiero ni se crearon derechos regulares.

La ficha nueva reutiliza la representación no regular existente, con origen
`demi_workshop_guest` y sin estado de primera clase pendiente. Demi la identifica
como `workshop_guest`; no vende una clase de prueba por el registro. El RPC no
crea Auth, inscripción, paquete, créditos, compra, pago ni reserva. Una auditoría
privada y bloqueos por conversación/contacto/teléfono protegen replay y concurrencia.

## Evidencia técnica

- Vitest: **2.021/2.021**, 262 archivos, versión final de este incremento.
- PostgreSQL 17 aislado: **74/74** escenarios, imagen fijada por digest,
  sin red ni base remota. Incluye recuperación después de pago y baja, rechazo,
  vencimiento, ausencia de efectos financieros en lecturas y acceso cruzado.
- TypeScript, formato y build Next.js aprobados. ESLint focalizado: cero errores,
  dos advertencias preexistentes en los archivos revisados.
- Sandbox `hedouonyhynuvwbckdlg`:
  `scripts/uat/demi-workshop-context-rollback-20261023.sql`, **21/21** comprobaciones
  con roles reales y reversión integral del fixture. No usa Auth, modelo, OCR,
  WhatsApp ni dinero real. Incluye alta de invitada nueva, replay, ausencia de
  derechos regulares y compra después de revisión. Cero estudios del fixture
  después de la prueba.
- Migración fuente `20261023134522_demi_workshop_conversation_context.sql`,
  aplicada exclusivamente en Sandbox como `20261023135418`.
  RPC de lectura, sin cambios a RPC de compra/revisión.
- Migración de invitadas `20261023140144_demi_workshop_guest_registration.sql`,
  aplicada sólo en Sandbox como `20261023141002`. RPC exclusivo de service_role;
  la auditoría privada tiene RLS y ninguna concesión directa a clientes o service_role.
  Advisors: sin nuevas funciones expuestas a anon/authenticated. El aviso
  [RLS sin política](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
  pasa 38→39 por esa auditoría interna, deliberadamente accesible sólo desde el RPC.
- Tras las pruebas reversibles: cero estudios con Demi de talleres habilitado.
  La preparación del banco habilita exclusivamente su estudio sintético nuevo.
  No se configura canal, presupuesto, credenciales ni desvío de WhatsApp.

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

## Banco capturado preparado

Mike confirmó que el alta incluye personas nuevas y alumnas existentes.
`scripts/uat/prepare-demi-workshop-run-20261023.sql` prepara una ejecución del banco
existente con etiqueta `DEMI-TALL`, estudio aislado y personas sintéticas. Repetir
la preparación recupera la misma ejecución y conserva evidencia. La candidata se
proporciona en `uat.demi_workshop_candidate` antes de ejecutarla; IDs/resultados
quedan en Notion, sin inventarlos en este documento.

En el Preview, seleccionar **Demeter Fitness Studio** y abrir
`/admin/mas/demi/uat`; recuperar la ejecución identificada en Notion. El banco
requiere el mismo owner que tiene acceso administrativo en esta sesión. Elegir
**prospecto** para la persona nueva o **alumna con paquete vigente** para la
existente. Este banco usa el receptor y operaciones de Sandbox con salida
capturada; no modifica los canales externos ni activa el piloto WhatsApp personal.

Taller: **Demi UAT · Taller completo 600**, tres fechas futuras a las 10:00 CDMX,
completo 600 MXN, individuales 150 MXN, anticipo fijo máximo 300 MXN, cupo cuatro.
El estudio de esa ejecución es el único habilitado por la preparación; la cuenta
bancaria del fixture muestra **UAT · NO TRANSFERIR**, sin CLABE/cuenta/tarjeta real.
Los snapshots del banco añaden `workshop_context` mediante el RPC restringido y
conservan fichas, ventas y pagos para verificar efectos, sin dar acceso directo
a apartados privados ni auditoría de identidad.

Primer recorrido: «¿Qué talleres tienen?» → «Quiero inscribirme en el taller
completo» → nombre completo solicitado → revisar cotización → «Sí, acepto».
Debe detenerse pidiendo comprobante sintético, sin afirmar pago recibido ni
inscripción confirmada. Revisar después completo/individual, alumnas existentes
y los estados de recibo con evidencia. La prueba con modelo todavía requiere
ejecutarse; crear fixtures no la acredita.

Casos adicionales: DT11 registra una participante nueva sin derechos regulares;
DT12 rechaza teléfono ajeno, nombre inventado y replay alterado sin duplicar
fichas. Se comprobaron en las suites técnica/SQL; la conversación nueva con
modelo conserva su validación separada.

## Reversión

La aplicación puede volver a la candidata de #317; la función de lectura nueva
no altera sus rutas existentes. Mientras conserve consumidores no se elimina
el RPC. No hay datos comerciales ni tablas que revertir. Producción no recibió
esta migración ni despliegue ni autorización de promoción.
