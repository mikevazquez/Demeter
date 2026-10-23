# Demi · continuación del 22 oct 2026

**La carrera antes de una acción ya pasa con base y efectos reales en Sandbox.**
La regresión comercial nueva detectó dos fallos, conservados en b98d14ee, y la
corrección55f59c2c pasa los diez turnos repetidos. UAT funcional y matriz operativa
completa pendientes; piloto bloqueado e inactivo. Release No listo.

## Versiones

Único backend: `hedouonyhynuvwbckdlg`. Receptor heredado de #366:
`8575eec3d4aa100c929508ba8b02bff9a16f45fd`. Rama/PR de trabajo:
`codex/demi-handoff-uat-20261022`, [#367](https://github.com/mikevazquez/Demeter/pull/367), borrador.

| Superficie                      | SHA exacto                               | Preview / deployment                                                          |
| ------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------- |
| Cancelación real y retractación | 80e5ada6a8f426b243c4b35e4c24bbe8d7ce345e | demeterbueno-62qnuy7gh-demeter3.vercel.app / dpl_J6pnc3xTV4Dgb4DwyzPxxrVgm4E9 |
| Regresión comercial fallida     | b98d14eea7640753023082331630529830928626 | demeterbueno-qbosq8z9s-demeter3.vercel.app / dpl_2DBvqZXw7Kkf6tgezY2CbjntkQE4 |
| Corrección comercial repetida   | 55f59c2cef805908d45748a06c205dcc8ad60a67 | demeterbueno-1cg95i7da-demeter3.vercel.app / dpl_Es8n4iWdKMW1xZpfAx3eE8urq7E2 |

Los tres Previews están READY. El CI documental antes pendiente39712824141 pasó
para b496bb34. El CI del runtime55f59c2c se registra en Notion/PR al terminar.
No se atribuyen a55f59c2c las métricas de velocidad de4cc41e22; esa corrida anterior
y la aceptación por total de Mike siguen conservadas. No se inició otra candidata
de velocidad ni se repitieron migraciones anteriores.

## Carrera con una cancelación que sí produciría un efecto

La ampliación del banco añade dos variantes acotadas. Deriva el contacto de
`trial_reserved` del run, conserva autenticación/propiedad/lease y el scope de captura.
No modifica el receptor ni el motor ni introduce un hook de prueba en el canal.
La reserva ficticia inicia a seis horas, con política real de cancelación de cinco.

Mensaje idéntico en ambos casos: «Antes de cancelar, consulta la política de
cancelación. Después cancela mi única reserva de Pole Fitness porque no podré asistir.»

| Caso                           | Run / tenant                                                                | Estado observado                                                   |
| ------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Retractación durante ejecución | 09a8f7b4-f70e-4bc2-8b7e-26a54abbd702 / 85047764-1dfa-46c5-8d5e-fb6a51f0b36b | Primera ejecución ignored/before_action; reserva y ledger intactos |
| Control sin retractación       | 637ac31b-367e-46aa-8a28-c71824688026 / e14e57ec-52c7-436f-a353-5c622080cd65 | Cancelación real, devolución única de1crédito                      |

En el primer caso se observa una llamada de modelo y la petición aún pendiente.
A las03:06:07.626UTC se envía «Espera, ya no quiero cancelar. Mantén mi reserva;
sí podré asistir.»; el evento nuevo queda recibido a03:06:07.989661UTC. El anterior
termina a03:06:09.575UTC con `superseded_before_action`, fase `before_action`.
Sólo se ejecuta la lectura `get_policy_information`; ninguna cancelación. Reserva
`e749e932-9d8d-426b-9584-e65c1dd2e943` idéntica y reserved; cero movimientos nuevos.
Única respuesta: «Tu reserva ... se mantiene activa». Replay de la solicitud vieja
`duplicate_already_handled`, sin otra respuesta ni efecto.

El control invoca `prepare_cancellation`, ejecuta `service_cancel_reservation` real
y deja `26a95a8e-230d-40b3-93fc-01d01b7d4c71` en `cancelled_on_time` a03:06:37.733846UTC.
Exactamente un movimiento `release`, cantidad1, ID
`f964b327-bc8c-4917-938b-45a5c6272d21`. Cambia coherentemente trial_status a cancelled.
Replay ignorado; un único recibo capturado. Otra reserva, ventas y pagos intactos.

**Ambos casos PASAN en esta intercalación.** Esto prueba la barrera antes del efecto
frente a una cancelación operativa posible y comprobada por control. No certifica
cada flujo operativo ni entrega por Meta a una persona. Se conserva la evidencia
anterior de supresión post_assistant y nueve variantes sin reemplazarla.

Datos: `burst-stale_cancellation-80e5ada6.json`,
`burst-cancellation_control-80e5ada6.json`, `cancellation-summary-80e5ada6.json`.

## Fallos comerciales encontrados y corrección

La corrida b98d14ee tiene ocho turnos HTTP200/ok:true, pero **FALLA calidad S12**:
al recibir el comprobante dice «el paquete queda activado provisionalmente» mientras
el estado todavía era awaiting_profile. El perfil se completó sólo en el turno
siguiente. Además S14 intentó `prepare_transfer_package_choice`, que devuelve
`simulation_not_supported`: criterio auxiliar BLOQUEADO, aunque el texto comercial
se recuperó. Datos completos en `bank-live-b98d14ee.json` y `bank-tools-b98d14ee.json`.

Cambios de55f59c2c:

- El contexto awaiting_profile declara comprobante recibido, perfil pendiente y
  derechos aún inactivos. Sólo `complete_purchase_profile` exitoso permite anunciar
  activación provisional. Refleja el estado existente; no cambia el motor.
- Los fixtures comerciales S11–S15 no ofrecen la elección de transferencia no
  simulada. Conservan preparación por producto elegido y demás acciones existentes.
- La simulación sólo ofrece seguimiento a prospecto y personas de prueba admitidas
  por su contrato; no a alumnas/exalumnas. El ejecutor mantiene sus validaciones.

La primera versión80c0268d tuvo un error de tipos en una prueba: usaba la persona
de fixtures DB `trial_reserved` donde el workbench requiere `trial_pending_reserved`.
Vercel falló el build. Corregido en b98d14ee, con tipos y pruebas repetidos. Otro
error de tipos en la nueva prueba de contexto se corrigió antes de publicar55f59c2c.
Ninguna versión fallida se declara aprobada.

## Repetición exacta en55f59c2c: PASA los criterios probados

Mismo demo `54dd112f-12ab-4e77-928c-877b12276eb2`, modelo gpt-5.6-luna/medium,
instrucciones candidatas versionadas, UI y acción autenticada del workbench.
**10/10 turnos HTTP200/ok:true**, respuestas y herramientas auditadas:

| Caso        | Conversación                         | Resultado                                                                                                                                |
| ----------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| S12,5turnos | 535a6286-da7b-40ff-bb24-9df5cd074825 | 600+200=800, negativa no prepara, aceptación prepara, comprobante pide tres datos sin afirmar activación, perfil activa provisionalmente |
| S13,2turnos | 9f7b3fea-6185-4155-87d8-548f9caeb9ce | Comprobante sembrado pide los tres datos sin activar; perfil completo activa provisionalmente                                            |
| S14,3turnos | bd77e5bb-1962-45d3-ad57-f928a35421bf | Mismo desglose/aceptación; comprobante activa provisionalmente los derechos de la alumna ya identificada                                 |

Once herramientas auditadas: **cero simulation_not_supported, cero followups para
la alumna**, un followup válido de prospecto simulated:true y dos perfiles completados
sólo por la herramienta simulada. Las negativas de inscripción antes de aceptar son
esperadas y conservan enrollment_confirmation_required. No se presentan los estados
simulados como compras reales. S03/S11/S15 conservan la corrida anterior identificada
en e601859e; no se les atribuye una repetición nueva en55f59c2c.

Datos: `bank-live-55f59c2c.json`, `bank-tools-55f59c2c.json`,
`continuation-summary-55f59c2c.json`. Local55f59c2c: **235 archivos/1764 pruebas pasan**,
tipos pasan, formato pasa, lint sin errores (una advertencia preexistente en orquestador).

```sh
python scripts/uat/verify_demi_continuation.py
```

## Limpieza comprobada

Nueva cuenta temporal `698199c9-6874-44fe-80fc-d839b394a353` disabled/banned;
0membresías activas,0sesiones y0refresh tokens. Login nuevo400/user_banned; navegador
anterior vuelve a `/login/studio`. Siete archivos privados de acceso borrados.
Las cuentas anteriores permanecen revocadas.

Se cancelaron14 followups futuros de nuestros12tenants sintéticos de estas dos rondas,
con reason_code uat_complete; ninguno queda pending/processing. El demo y cuentas
reales no se modifican con esa limpieza. Los snapshots originales y reservas/ledger
se conservan. Las70tentativas automáticas de notificación de esos fixtures se auditaron:
70capturadas con IDs uat:/captured:true y0IDs de proveedor externo. El worker existente
intercepta UAT antes de cualquier adapter; no fue necesario cambiarlo.

Auditorías: `race-access-cleanup.json`, `continuation-cleanup-audit.json`. Revocación
y limpieza registradas en artefactos de los runs. No nuevas migraciones en esta
continuación; producción, variables productivas, canales/adapters y piloto intactos.

## Siguiente acción

Revisión funcional de Mike y matriz operativa completa; hasta entonces ninguna tarea
integral ni Release queda Done/Ready to deploy. Para revisar el banco: cuenta propia,
[Preview55f59c2c](https://demeterbueno-1cg95i7da-demeter3.vercel.app/admin/mas/demi),
estudio Demi UAT·66f7d517. Para reproducir la carrera: banco UAT, ejecución nueva y
«Retractar cancelación durante ejecución»; control en otra ejecución nueva.
No usar envío externo de Meta ni activar DEMI-PILOT-01.
