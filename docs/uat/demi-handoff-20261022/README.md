# Demi · relevo de Claude · Sandbox · 22 oct 2026

**Los casos técnicos ejecutados pasan; el UAT integral sigue sin aprobar.**
Pendientes: experiencia funcional de Mike, regresión operativa completa y carrera
antes de una acción contra la base real. DEMI-PILOT-01 continúa bloqueado e inactivo.

## Versiones y alcance

- Único backend usado: Studio Flow Sandbox `hedouonyhynuvwbckdlg`.
- #365 exacto **e601859ead9e370dc8c5f53017c5e6ef337c0cf8**:
  [Preview del banco](https://demeterbueno-6zxtk1tma-demeter3.vercel.app/admin/mas/demi),
  deployment `dpl_B2jmxggTzbvh5BU19wbsPuzEfKhT`, CI39686775178 success.
- Receptor de #366 **8575eec3d4aa100c929508ba8b02bff9a16f45fd**.
- Harness de [PR #367](https://github.com/mikevazquez/Demeter/pull/367), runtime
  **3bf191dd57a00b7ee59130e7c70394e75aef3a05**:
  [Preview de ráfagas](https://demeterbueno-d16eyneye-demeter3.vercel.app/admin/mas/demi/uat),
  deployment `dpl_23rkHxDf34jjnTBUFdSRy1vFgbZ1`, CI39711446882 success.
- **0b289c8e093d9a3f51269feba2439a3d61896e05** añade únicamente pruebas:
  seis casos que ejecutan la barrera real del orquestador y replay del primer texto
  de una ráfaga. No hay diferencias de aplicación respecto de3bf191dd.
- Stack pendiente #356→#358→#359→#360→#361→#363→#364→#365→#366→#367.
  #362 conserva aparte el fixture SQL; #357 pertenece al piloto posterior.
  Ningún PR integrado ni despliegue productivo.

#367 sólo añade el control de pruebas autenticado y el índice solicitado. La acción
recibe un run propio y una variante enumerada; deriva destinatarios de sus fixtures,
crea firmas en servidor y ejecuta las solicitudes concurrentes dentro del scope de
captura existente. Conserva lease durante las solicitudes y evidencia antes/después.
No acepta destinos, secretos, teléfonos o payloads arbitrarios. Rechaza producción,
run ajeno/ocupado y configuración de reenvío piloto. No modifica receptor ni adapters.

## #365: banco conversacional

Mismo demo sintético `54dd112f-12ab-4e77-928c-877b12276eb2`, run
`66f7d517-5aff-44e7-96b6-ce15db70b7ba`, modelo gpt-5.6-luna / medium e instrucciones
candidatas versionadas. UI verificada y acción normal del workbench autenticado.
**13/13 turnos HTTP200/ok:true.** Las operaciones de esta superficie son simuladas.

| Caso | Resultado                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------ |
| S03  | 8 créditos y vencimiento15nov2026, fecha local del fixture+25días                                                        |
| S11  | Pase499, inscripción incluida, sin datos prematuros                                                                      |
| S12  | 600+200=800; negativa no prepara; aceptación prepara; comprobante pide tres datos; perfil válido activa provisionalmente |
| S13  | Nombre completo, fecha de nacimiento y correo después del comprobante sembrado                                           |
| S14  | Alumna sin inscripción: mismo desglose y recepción provisional del comprobante                                           |
| S15  | «hola» reconoce8 créditos y no menciona el pago cerrado                                                                  |

Dos `update_contact_followup` de prospecto devuelven `simulated:true`,
`status:simulated`. Cero filas nuevas de `demi_followups` y cero modificaciones de
`crm_followups` en el demo durante la ventana auditada. No se programa ni envía.
El modelo también intentó seguimiento para la alumna S14: el simulador lo rechazó
correctamente con `followup_not_applicable`. Se conserva como observación de calidad;
no se acredita seguimiento de alumna aprobado. Las negativas `invalid_stage`,
`reason_required` y `followup_not_applicable` pasan en pruebas automatizadas.

Respuestas/estados: `bank-live-e601859e.json`; herramientas:
`bank-tools-e601859e.json`; auditoría: `sandbox-audit.json`.

## Índice

Creado por CLI: `20261022022254_demi_whatsapp_events_contact_received_index.sql`.
Aplicado en Sandbox como **20261022022315**:
`assistant_whatsapp_events_contact_received_idx(studio_id,contact_wa_id,received_at)`.
Catálogo confirma índice válido. EXPLAIN con `enable_seqscan=off` dentro de
BEGIN/ROLLBACK confirma aplicabilidad; no demuestra una mejora de latencia.
Asesores antes/después conservan las mismas categorías y niveles preexistentes.
No se alteran reglas, RLS, grants ni filas de negocio.
Las tres migraciones comerciales anteriores y sus18 pruebas SQL conservan su
resultado previo; no se reaplican.

## #366: solicitudes firmadas, PostgreSQL y modelo reales, salida capturada

Una ejecución ficticia nueva por variante, mismo source demo, ventana2500ms,
configuración/modelo clonados y sin proveedor de comunicación externo. Se llama al
receptor real dentro del proceso del Preview; no se entra por Meta ni se entrega
WhatsApp a personas. Los IDs aceptados empiezan por `uat:`. Cada archivo conserva
peticiones, respuestas HTTP, eventos, turnos, llamadas, recibos y snapshots antes/después.

| Variante                                   | Run                                  | Eventos / respuestas capturadas | Resultado                                                               |
| ------------------------------------------ | ------------------------------------ | ------------------------------- | ----------------------------------------------------------------------- |
| Tres textos separados400ms                 | 0352f010-3f9b-4d5a-b440-b4d27dbb1d71 | 3/1                             | Dos superseded/debounce; historial completo y ordenado                  |
| Tres textos en un payload, igual timestamp | fd849557-687e-4944-87d6-3ba6857e5448 | 3/1                             | Dos superseded/same_payload; historial completo                         |
| Contactos intercalados                     | aed2ded7-b5fc-4ff4-bb33-292f031a39d6 | 2/2                             | Dos conversaciones y destinatarios separados                            |
| Texto e imagen                             | 4395766b-4680-40c8-a07c-57a77db5f1fa | 2/2                             | Imagen conservada en handoff; texto no anulado                          |
| Nuevo texto durante ejecución              | 4460be29-adc1-45e1-9bc5-228daa48fc38 | 2/1                             | Respuesta anterior suprimida en post_assistant; sólo responde ubicación |
| Replay de evento procesado                 | c865ca9f-ee9b-484a-a1e2-003ad236aba1 | 1/1                             | duplicate_already_handled; recibo aceptado conservado                   |
| Fuera de ventana                           | 4525ef71-fb48-4b9b-9fd0-2fb9eaecd343 | 2/2                             | Dos turnos y respuestas                                                 |
| Tenant distinto del scope                  | 7f0b71a7-bc00-4c53-a1a0-276ba807564f | 0/0                             | HTTP503 antes de capturar                                               |
| Firma inválida                             | 06bfa9e9-deb4-4db0-8723-8e131e468dba | 0/0                             | HTTP401 antes de capturar                                               |

**9/9 variantes conformes a su expectativa.** Después se repitió por UI el primer
texto ya superado del run0352f010: HTTP200/duplicate_already_handled, mismos cuatro
turnos, tres llamadas de modelo y único recibo aceptado, sin cambios de negocio.
Archivo `burst-older_replay-3bf191dd.json`.

En todas las variantes permanecen idénticas las filas de reservas, adquisiciones,
inscripciones, ledger, ventas y pagos respecto de su snapshot. Los followups de los
flujos reales de prospecto se conservan en sus tenants ficticios, sin ejecutar workers.

La prueba de obsolescencia observó una llamada de modelo terminada mientras la
primera petición seguía pendiente; el texto nuevo llegó durante esa ejecución,
antes de que produjera respuesta. La anterior quedó ignored/post_assistant; sólo
se persistió la respuesta actual. No afirma que ambos modelos estuvieran generando
en el mismo instante. No hubo una acción financiera solicitada en ese caso.

Tiempos de servidor desde envío interno hasta captura: ráfaga13,072s desde el primer
texto y12,268s desde el último; mismo payload12,599s; obsolescencia38,794s/20,000s.
Incluyen ventana/red/modelo/herramientas y esperas de DB; no son recepción observable
por WhatsApp ni una comparación de velocidad. Una muestra por variante: sin p95.
Tokens/calls por caso están en `burst-summary-3bf191dd.json`.

### Fallos y límites conservados

- Primera creación del fixture siguiente a stale falló HTTP500 el22oct02:33:54UTC,
  digest226521140: Vercel confirma `canceling statement due to statement timeout`.
  No quedó run parcial. Repetida creación normal después, las cuatro variantes
  restantes terminaron. No se cambió timeout ni función/reglas para ocultar el fallo.
- El primer capturador RSC no entendió un bloque de texto con longitud, aunque el
  run d53673b5-e06c-418d-9c4a-4c4bf219d1c4 sí fue creado. Se ajustó sólo el parser;
  ese run sin mensajes se conserva y no se cuenta como caso aprobado.
- La imagen es sintética y vacía: demuestra conservación/handoff, no validación ni
  activación de un comprobante financiero real.
- B8 de Claude sólo buscaba cadenas en fuente. Se añaden seis pruebas de ejecución
  del orquestador: turno válido ejecuta una vez; entrada nueva durante modelo
  diferido evita invocar el executor; confirmaciones antiguas de reserva,
  cancelación, cambio y compra en efectivo se rechazan antes de invocarlo.
  Usan DB/modelo/executor dobles identificados. **Carrera antes de una acción con DB
  real: BLOQUEADA / pendiente de ejercicio**, no sustituida por esos dobles.
- UAT funcional de Mike y regresión operativa completa siguen pendientes. El piloto
  está prohibido en este bloque; ninguna entrega externa queda certificada.

## Verificación y reproducción

Local en0b289c8e: **235 archivos /1754 pruebas pasan**; formato de los cambios,
lint0 errores y tipos pasan. CI3bf191dd:39711446882 success, incluye build y ratchet.
El CI de la cabeza documental se registra en Notion y el PR una vez termine.

```sh
npx vitest run tests/demi-workbench-bench-gaps.test.ts tests/demi-message-batching.test.ts tests/demi-webhook-replay-regression.test.ts tests/demi-burst-uat-action.test.ts tests/demi-operational-uat-environment.test.ts tests/demi-prompt-workbench.test.ts
python scripts/uat/summarize_demi_handoff.py
```

Para reproducir las variantes en vivo: entrar con cuenta administradora propia al
Preview #367, seleccionar el demo **Demi UAT ·66f7d517**, abrir banco UAT, crear una
nueva ejecución por variante y usar «Ráfagas sintéticas». Revisar/exportar evidencia.
No usar el botón de envío externo de Meta ni activar el piloto.

## Demo funcional preparado y siguiente acción

En el mismo demo, abrir «Probar a Demi» y los casos S11–S15 para revisar el tono,
producto/importes, aceptación previa, petición conjunta de los tres datos y saludo
sin cobro viejo. Revisar S03 como alumna. Esto prueba conversación simulada.
Las operaciones reales se revisan aparte con los fixtures aislados del banco UAT;
recibir un comprobante no equivale a aprobarlo ni a liberar producción.

Siguiente para Claude/Codex: reproducir la carrera antes de una acción contra DB
real mediante un escenario UAT acotado y revisar el intento innecesario de followup
S14. Después, Mike valida calidad con el demo y se completa la matriz operativa.
No desarrollar otra candidata de velocidad: Mike aceptó el agregado de4cc41e22
el21oct16:48 (−12,3% mediana/−5,6%p95); métricas por tipo y tokens siguen preservadas
en `docs/uat/demi-latency-20261021`.

## Limpieza y límites de entorno

Cuenta temporal edfdfe25-5df1-40f1-bfee-a1a8f136a62f disabled/banned, cero membresías
activas, sesiones y refresh tokens. Login nuevo400/user_banned; navegador anterior
redirige a `/login/studio`. Siete archivos privados de acceso borrados. Los runs y
trazas se retienen como evidencia sintética. `temporary-access-cleanup.json` y
`sandbox-audit.json` conservan la verificación; revocación registrada en los runs.

Producción `qfhojvgvhrbautvczffq`, sus despliegues y variables sin cambios. No se
modificaron canales/adapters, no se enviaron mensajes a terceros y no se activó
DEMI-PILOT-01. Release permanece **No listo**.
