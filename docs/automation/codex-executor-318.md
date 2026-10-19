# Governance 2.0: adaptador de ejecución y evidencia histórica (#318)

Vianelis es la empresa; Governance 2.0 es su metodología autónoma. El estado actual,
la aceptación combinada #334 y la puerta de integración del PR agregado #331 están
en [la política operativa](governance2-operation.md). Los apartados siguientes
conservan los cortes históricos de #319 y las ampliaciones posteriores: sus
pendientes, IDs y comandos no son una autorización para repetir pilotos consumidos.
El uso futuro pasa por catálogo externo revisado y autoridad compartida, mediante
las API exportadas de [admisión](task-admission.md), no por el CLI de reserva legado.

Este incremento integra el laboratorio #315 con **la misma reserva, certificación e intención de publicación de #314**. No introduce otra cola, daemon, scheduler, base de datos ni publicador. Demeter aloja únicamente este piloto técnico; no se modifican funciones de Studio Flow.

## Dependencia reutilizada

En la entrega original #319, los archivos `scripts/studio-flow-minimal.mjs`, `tests/automation/studio-flow-minimal.test.mjs` y `docs/automation/studio-flow-minimal.md` se copiaron del SHA `3b48f1cb1abb2a2fb7c8776e0af1a2fac70661b5` de #314. La integración #331 conserva ese mismo supervisor con ampliaciones revisables de mutex, cierre terminal y recibos; ya no afirma identidad byte a byte con #314. Su rama original no se modifica y no se crea otro publicador. El adaptador se ejecuta desde la copia confiable del supervisor, fuera del checkout editable.

## Contrato y operación

El supervisor revisa un contrato con los campos de #314: ID, objetivo, autorización, SHA base, rutas exactas y comandos de prueba. Los únicos IDs admitidos son `continuity-315-38989415241`, `vianelis-launcher-318-v1` y `governance2-owned-code-318-v1`; la autorización es #318. El segundo es una tarea nueva autorizada por Mike tras la sonda AVAILABLE, no un reintento del ID consumido. El tercero está explícitamente autorizado por el contrato acotado de código de #318 descrito abajo. Los tres conservan `continuity.taskId=continuity-315-38989415241` como procedencia verificada, separada de la identidad de trabajo. No se aceptan IDs arbitrarios ni sufijos nuevos por inferencia. El vínculo conserva IDs de runs, SHA y comentarios dentro del **mismo** `reservation.json` protegido por el hash del contrato. La evidencia no sustituye la autorización del objetivo y archivos.

```sh
node /supervisor/scripts/automation/codex-executor.mjs verify-continuity
node /supervisor/scripts/automation/codex-executor.mjs reserve /checkout /registro /contrato-revisado.json
node /supervisor/scripts/automation/codex-executor.mjs execute /checkout /registro continuity-315-38989415241
node /supervisor/scripts/automation/codex-executor.mjs status /checkout /registro continuity-315-38989415241
```

`verify-continuity` y `reserve` consultan GitHub con `gh` y su conexión existente. Leen todas las páginas de comentarios y los runs referenciados, sin convertir errores de acceso en listas vacías. Exigen exactamente dos transiciones válidas del bot: `waiting` del run original y `complete` de otro run con evento **schedule**, mismo workflow y repositorio, ambos finalizados con éxito. Una segunda ejecución manual, una historia duplicada o un run fallido no acreditan continuidad automática. Los snapshots introducidos directamente en las funciones exportadas son entradas confiables del supervisor, igual que en #314; no son una fuente de autoridad autónoma.

`execute` invoca realmente `codex exec`, sin instalarlo, usando la sesión ChatGPT existente, configuración de usuario omitida y sandbox `workspace-write`. No selecciona un proveedor de pago ni admite claves API en el entorno del hijo. Requiere checkout limpio en el SHA reservado. El directorio exclusivo `executor/` consume el único intento **antes** de lanzar el proceso. Un segundo supervisor devuelve el resultado existente o estado `uncertain`; no regenera código. Solo un exit cero acompañado de `turn.completed` sin errores produce `candidate-ready`, que **no** significa certificado ni publicado. Timeout, falta de ejecutable, autenticación fallida o salida inválida quedan bloqueados sin reintento automático.

El entorno del hijo excluye tokens GitHub, Supabase y claves de modelo; conserva variables de proxy y certificados necesarias para la red y la ubicación de autenticación de Codex. Esto no oculta archivos accesibles del host ni sustituye aislamiento del sistema operativo. El código revisado del piloto es inocuo; para tareas no confiables hace falta un entorno aislado que limite también lecturas, credenciales en disco y red. No habilitar ejecución desatendida de código arbitrario con este adaptador.

Los logs privados `events.jsonl` y `stderr.log` se conservan con permisos 0600 en el registro externo. No se publican automáticamente. `result.json` conserva estado, hash del contrato, hash del log, session ID, salida, señal y fechas; no guarda tokens. La configuración global del host y servicios MCP ajenos al archivo de usuario pueden seguir siendo aplicables. El supervisor debe comprobarlos en el entorno real antes de ampliar el alcance.

## Interrupción y publicación

| Interrupción                                              | Recuperación segura                                                                                                           |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Antes de crear `executor/`                                | Se puede iniciar el mismo ID reservado.                                                                                       |
| Directorio creado, sin intención completa                 | Estado incierto; inspección del supervisor, nunca repetir generación.                                                         |
| Durante Codex o después de producir candidato, sin recibo | Parar y comprobar la salida del proceso anterior; conservar candidato y logs. No asumir que matar el supervisor mata al hijo. |
| Resultado persistido                                      | Otro proceso recupera exactamente el resultado sin lanzar Codex.                                                              |
| Durante pruebas o publicación                             | Aplicar recuperación de #314; volver a certificar bytes o reconciliar GitHub, reutilizando el único Draft.                    |

Ante `uncertain` o `blocked`, el supervisor puede inspeccionar y certificar el candidato conservado después de comprobar que el ejecutor anterior ya no escribe. No se implementa `codex resume` automático: podría repetir una generación cuyo resultado ya existe. La prueba SIGKILL mata realmente el supervisor y, antes de certificar en otro proceso, detiene explícitamente al hijo.

Tras inspección, copiar únicamente los archivos permitidos a un checkout de verificación limpio del mismo SHA y usar `certify`, `publish-plan` y `complete` del piloto #314. Las pruebas no confiables deben ejecutarse sin red ni credenciales. La publicación continúa a cargo del supervisor, con lectura remota fresca de rama, commit y PR en todos los estados, antes de cada intento. La reserva y publicación de #314 siguen siendo locales: no usar dos publicadores con registros distintos. El consumo remoto de ejecución descrito abajo impide una segunda generación por ID entre supervisores actualizados, pero no convierte las copias locales en un registro operativo compartido ni resuelve el fencing de publicación.

## Corte histórico de la entrega original #319

- Main: `19fabb01d5d40c0b6aa75a3e9eb4be1eb60cde54`; CI de main `38989239587`, success.
- #314: Draft abierto, HEAD `3b48f1cb1abb2a2fb7c8776e0af1a2fac70661b5`; CI `38985119218`, success. #294 está retirado/cerrado; sus PR #296–#301 son históricos y no se reactivan. #317 y demás PR funcionales quedan separados.
- #315: solo run `38989415241`, evento `workflow_dispatch`, success; comentario del bot `6227744429` con `waiting`. No existe segundo run schedule al corte. Cron existente `19 8 * * *`: 02:19 America/Mexico_City. No se modifica ni se sustituye por una ejecución manual.
- Codex CLI `0.159.2`: `login status` indica ChatGPT, pero una llamada real sin herramientas ni modificaciones devuelve exit 1, `401 Unauthorized` y rechazo de renovación: “Your access token could not be refreshed because you have since logged out or signed in to another account. Please sign in again.” No hubo trabajo de modelo completado. No se cambió autenticación.
- No hay herramienta callable de inicio de Codex Cloud en esta sesión. El workflow histórico de #294 usaba `openai/codex-action` y `OPENAI_API_KEY`; está retirado y su consumo de API de pago no está autorizado en este encargo.
- Las pruebas del adaptador usan ejecutables falsos explícitos. Verifican procesos, persistencia, SIGKILL, timeout, recuperación, rechazo de evidencia y reutilización de un recibo remoto **simulado**. No acreditan generación real del modelo ni publicación autónoma.

Pendiente: observar segundo schedule auténtico y volver a verificar; restablecer una sesión Codex válida mediante el mecanismo autorizado del entorno; ejecutar una tarea inocua real, certificarla y reconciliar su Draft. Aún falta un disparador autorizado que inicie este adaptador en un entorno con registro durable y acceso válido a Codex. No se añaden cron de generación, credenciales, permisos privilegiados ni servicios permanentes. El PR de esta entrega contiene la implementación supervisada y su CI; no es evidencia de un PR creado autónomamente por el adaptador.

## Lanzamiento programado acotado — segundo bloque

La sonda de capacidades publicada en #318 con marcador `vianelis-launcher-capability-probe-v1` acreditó acceso del turno programado al checkout y recibo reales. No llamó al modelo. Mike autorizó después ampliar adaptador, pruebas y documentación para una tarea nueva y un único Draft.

El contrato `vianelis-launcher-318-v1` usa el mismo registro externo, reserva exclusiva, intento único, recuperación y certificación de #314. El disparador es una única automatización alojada, sin instalar servicios ni runners. Su tarea de modelo se limita al documento `docs/automation/launcher-scheduled-result.md` con bytes exactos revisados. Un segundo proceso consulta el estado y el replay debe devolver el resultado existente sin nueva generación. Un fallo incierto requiere inspección y no se reintenta.

La certificación del documento se realiza en otro checkout offline y sin credenciales. Los cambios del adaptador se revisan y prueban antes de preparar el SHA base fijo; se entregan junto con el documento en un único Draft dependiente de #319. No se modifica la rama de #319 ni la de #314. No se declara éxito programado antes de observar eventos reales y recibo, ni se promete supervivencia del host tras reinicio. Esta ampliación no habilita código arbitrario, una cola general o ejecución permanente.

## Consumo remoto de ejecución entre entornos

Antes de abrir logs y lanzar Codex, `executeOnce` consume un intento remoto mediante `execution-claim.mjs`, usando GitHub ya conectado en el supervisor. El hijo sigue recibiendo el entorno filtrado; no recibe la conexión GitHub. El registro local consume primero su directorio/intención de ejecución. Los tests inyectan explícitamente una autoridad falsa; la CLI no ofrece un flag para omitir la autoridad remota.

El supervisor comprueba `refs/tags/vianelis/execution-claims/<id>`. Solo un 404 explícito permite continuar. Cualquier ref existente consume ese ID, aunque coincida el contrato o cambie el dueño local. Una consulta de PR con `state=all` y rama determinista bloquea también los IDs históricos publicados antes de incorporar esta protección, aunque el PR esté cerrado. Solo hace falta detectar existencia; se consulta un resultado, no se infiere una lista vacía de un fallo.

Se prepara un objeto tag anotado con ID, SHA base, hash de contrato, autorización #318 y nonce del propietario. Crear ese objeto sin referencia no concede el intento. Se crea la referencia exacta mediante POST, nunca PATCH, force ni delete: dos peticiones concurrentes no pueden crearla ambas. El ganador verifica la lectura posterior y guarda su recibo de claim antes de invocar el modelo. El perdedor y cualquier error o respuesta perdida se bloquean; no adoptan una referencia existente, ni siquiera con el mismo nonce. Una caída entre adquirir y lanzar puede consumir un intento que nunca llamó al modelo: se elige evitar duplicación y requerir reconciliación.

La referencia permanece consumida después de terminar; no tiene TTL, heartbeat, liberación ni reintento de generación. No es otra cola, scheduler o publicador. El control remoto por sí solo no amplía los IDs autorizados del adaptador. Un ID nuevo exige un contrato y autorización revisados; la autorización acotada de código se detalla abajo.

La sonda remota usa únicamente `vianelis-authority-probe-318-v1` para probar la creación atómica desde dos procesos. No es una tarea admitida por reserveContinued, no ejecuta Codex y no se registra como trabajo de desarrollo ni PR publicado. Su referencia queda como evidencia de consumo y no debe eliminarse para repetirla.

### Límites

Esta protección aplica a supervisores que ejecuten esta revisión. Un ejecutable antiguo que ignore la autoridad, la eliminación/modificación manual de refs o una copia activa del publicador fuera del protocolo quedan fuera de la garantía. No se modifican protecciones de tags ni permisos. El registro histórico de solo lectura no se transforma automáticamente en uno operativo. La ejecución real del modelo tras adquirir una referencia sigue pendiente. La extensión del control a publicación y su prueba de concurrencia se describen en el apartado siguiente. No declarar autonomía general ni cierre de Governance a partir de una sonda de API.

## Governance 2.0: publicación de un único Draft por propietario

Vianelis es la empresa; Governance 2.0 es la metodología autónoma en construcción. Este incremento extiende el adaptador existente, reutilizando `publicationPlan` y `complete` de #314. La rama de #314 permanece intacta. No se crea otro scheduler, cola o servicio publicador.

`verifyExecutionOwner` comprueba la ref y el tag anotado remotos contra el recibo local adquirido: ID, contrato, autorización #318, nonce, objeto y SHA base. Una copia con propietario incorrecto o ref movida no obtiene permiso de escritura. El nonce es un identificador público del propietario, no una credencial ni una protección frente a un actor autorizado que ignore el protocolo.

`publishDraftOnce` exige el certificado de #314, una rama remota previamente subida, padre exactamente igual a la base reservada, target sin cambios, rutas modificadas exactas, modos y hashes de todos los blobs. Consulta todos los PR de la rama en todos los estados. No cambia el código, hace push, fusiona o despliega. El título, cuerpo y rama base son metadatos revisados por el supervisor.

```sh
node /supervisor/scripts/automation/codex-executor.mjs publish-draft /checkout-verificador /registro ID /metadatos-revisados.json
```

Los metadatos JSON contienen `baseBranch`, `title` y `body`. El checkout verificador debe permanecer sobre el SHA reservado con los cambios certificados; la rama remota de resultado debe estar ya en su commit final. El registro conserva `executor/remote-claim.json` del propietario. El control de publicación por sí solo no amplía los IDs autorizados de generación.

Antes del único POST de creación se consume atómicamente `refs/tags/vianelis/publication-claims/<id>`. El tag liga contrato, propietario de ejecución, digest de publicación (incluye commit/rutas/target) y propietario del intento de publicación. Dos procesos con copias locales, incluso con el mismo recibo de ejecución, no pueden adquirir ambos esa referencia. Solo el adquirente reconocido envía el POST. No se adoptan claims, borran refs, aplican TTL o reintentan creaciones inciertas.

Si el Draft ya existe y coincide, se reutiliza y `complete` finaliza o repite el mismo recibo, liberando solo la reserva pertinente. Una creación aceptada cuya respuesta se perdió puede recuperarse consultando el PR, sin otro POST. Si el intento está consumido y no aparece un PR, se devuelve `blocked-publication`: necesita reconciliación del supervisor y no se crea un reemplazo. Una caída antes del POST puede dejar consumido un intento sin PR. La prioridad es evitar duplicación, no prometer progreso ante cualquier caída.

Las pruebas unitarias usan GitHub explícitamente simulado y certificación local real. La prueba remota de entrega hace competir dos procesos con registros separados para publicar el único Draft de este incremento; no invoca al modelo ni simula resultados de Codex. La copia de prueba contiene solo esta reserva nueva; no activa el archivo histórico de los IDs anteriores. La recuperación contrasta el mismo Draft/recibo desde ambos registros y deja la copia de prueba sin reserva activa.

### Límite de la garantía de publicación

Aplica a procesos que usan esta revisión y una autoridad remota cuyas refs no se alteran fuera del protocolo. No bloquea un publicador antiguo o un usuario que invoque GitHub directamente, no cambia protecciones y no ofrece una operación transaccional entre ref y PR. Un cambio externo entre verificaciones obliga a inspección. No implementa transferencia automática de propietario ni restauración operativa general. La E2E de código real con el control nuevo sigue siendo el siguiente paso; esta prueba de publicación no declara terminado Governance 2.0.

## Corte histórico: E2E de código en validación antes de #326

Vianelis es la empresa; Governance 2.0 es su metodología autónoma. El contrato autorizado en https://github.com/mikevazquez/Demeter/issues/318 admite explícitamente `governance2-owned-code-318-v1`, con base `8ae371ec3f8884a1353aae6dd2ec9a0055d4cdfa`. Es una identidad de trabajo nueva, sin reciclar las anteriores ni admitir variantes por sufijo. Conserva la procedencia original `continuity-315-38989415241`: `startedBy=38989415241`, `completedBy=39031527323`, SHA de origen y recuperación `19fabb01d5d40c0b6aa75a3e9eb4be1eb60cde54` y comentarios `6227744429`, `6233729702`. Estos valores del contrato no sustituyen la verificación de evidencia del supervisor; el apartado de estado observado anterior describe el corte histórico de aquella entrega.

El alcance autorizado consta únicamente de estos cinco archivos:

- `scripts/automation/codex-executor.mjs`: constante y dos disyunciones para admitir el ID exacto.
- `tests/automation/codex-executor.test.mjs`: pruebas unitarias de identidad, procedencia, rechazos y ejecución única con CLI y claim explícitamente simulados.
- `scripts/automation/governance2-e2e-proof.mjs`: única exportación pura `uniqueTaskIds(values)`, sin I/O, dependencias ni servicios. Exige un array de strings, recorta espacios, valida `/^[a-z0-9][a-z0-9-]{2,79}$/`, lanza `TypeError` ante tipos o IDs inválidos y devuelve IDs únicos ordenados lexicográficamente sin modificar la entrada.
- `tests/automation/governance2-e2e-proof.test.mjs`: deduplicación, orden, recorte, vacío, inmutabilidad y rechazo de tipos e IDs inválidos.
- `docs/automation/codex-executor-318.md`: autorización y estado de esta validación.

El estado de la E2E de código es **EN VALIDACIÓN**. Esta implementación no acredita certificación ni publicación completadas. No se ejecutan pruebas en el sandbox anidado; el supervisor verificará los cinco archivos y ejecutará sus comprobaciones offline de forma independiente. No se autorizan commits, publicación, servicios, acceso a credenciales, llamadas de modelo/API, instalación de dependencias, worktrees ni cambios de aplicación. Se mantienen los límites de aislamiento, intento único, recuperación, autoridad y publicación descritos arriba; las pruebas con dobles no certifican autonomía general ni el cierre de Governance 2.0.

## Checkpoint durable antes de generar

El supervisor guarda un checkpoint remoto inmutable después de adquirir el claim de ejecución y antes de abrir el log o invocar Codex. Contiene exclusivamente el contrato revisado (con su hash), el propietario verificado y la intención, nunca credenciales, variables de proceso o eventos del modelo. La ref es `refs/tags/vianelis/execution-checkpoints/<id>` y apunta a un tag anotado cuyo objeto es la base autorizada. No se mueve, libera ni elimina. Una referencia existente debe coincidir exactamente; solo un 404 al consultar esa referencia establece ausencia. Si falla la escritura, hay conflicto, se pierde la respuesta o cambia el propietario, el intento local queda incierto y no genera.

El comando de inspección no requiere registro local:

```sh
node /supervisor/scripts/automation/codex-executor.mjs recover-remote ID BASE_SHA CONTRACT_SHA256
```

Lee GitHub y vuelve a verificar contrato, base y propietario. Devuelve `reserved` si aún no se declaró intención, o `uncertain` si existe intención; siempre `generationAllowed:false`, `registryRestored:false` y `inspect-original-only`. La intención previa no demuestra que Codex llegó a arrancar ni terminar. No crea un registro, `active.json`, sesión o PR; no ejecuta los comandos del contrato ni importa archivos del candidato. No admite generar desde el checkpoint, transferir al propietario o regenerar un ID consumido. La allowlist de IDs de modelo permanece intacta.

Este incremento hace durable el contexto previo al intento, incluso si desaparece el registro local. No guarda automáticamente el resultado/candidato después de una caída, no reanuda una generación ni habilita un registro operativo para tareas futuras. La recuperación de una tarea ya completada en otro entorno se acredita separadamente en #318. Vianelis es la empresa; Governance 2.0 sigue siendo la metodología autónoma en construcción.

## Resultado durable y recuperación del candidato

Tras una salida real correcta de Codex, el supervisor congela resultado, contrato, intención y archivos cambiados exactos. Solo admite archivos regulares 100644, rutas autorizadas, hasta 128 KiB por archivo y 512 KiB por paquete; rechaza symlinks, cambios ajenos, estados fallidos y hashes incoherentes. No guarda stdout/stderr del modelo, credenciales ni variables de proceso. El paquete se guarda como blob Git y una referencia de tag inmutable `refs/tags/vianelis/execution-results/<id>` lo vincula a base, contrato, checkpoint y propietario. Se confirma por lectura antes de devolver candidate-ready durable.

Si falla la confirmación, el intento conserva su resultado original y el paquete congelado; status queda uncertain/DURABILITY_PENDING. `seal-result` solo puede sellar esos mismos bytes, con el log original intacto; nunca llama al modelo. Un replay de execute conserva el intento consumido. Si el host desaparece antes de completar un sellado verificable, se bloquea y se informa: el checkpoint previo por sí solo no permite regenerar ni reconstruir un resultado incompleto.

```sh
node /supervisor/scripts/automation/codex-executor.mjs seal-result REPO REGISTRY ID
node /supervisor/scripts/automation/codex-executor.mjs restore-result REPO REGISTRY ID EXPECTED_JSON
```

EXPECTED_JSON contiene baseSha y contractSha256 revisados. La restauración consulta GitHub con GET, verifica propietario/checkpoint/paquete y exige un checkout de la base exacta. Conserva cambios del usuario y reservas de otras tareas; solo acepta un reintento parcial que ya coincida con los bytes sellados. Reconstruye reserva, intención y resultado de esa misma tarea, con executor/ ya consumido, y crea únicamente su lock local. No adopta un propietario nuevo ni ejecuta checks durante la restauración. Otra llamada a execute devuelve el resultado ya existente; no inicia sesión nueva. Una tarea con PR existente pasa a reconciliación, sin reactivarla. Las copias verificationOnly no pueden publicar ni convertirse en operativas.

El candidato recuperado todavía debe pasar por certify en un checkout independiente, sin red ni credenciales. Un artefacto completo no es un certificado ni un permiso de publicación. Se mantienen la ref de ejecución consumida y la exclusión del publicador: no se crea otro PR por perder un host o una respuesta.

Piloto nuevo acotado autorizado para esta capacidad: governance2-result-recovery-318-v1. Es el único ID adicional permitido; el modelo produce únicamente un módulo puro sumSafeIntegers y su prueba. El supervisor implementa y certifica antes este mecanismo. La verificación en otro host utiliza el runner GitHub existente y una instancia Docker sin red, rootfs de solo lectura, sin privilegios/capabilities ni credenciales montadas. El token efímero de CI solo se usa para descargar evidencia con permisos de lectura; no entra en el contenedor de certificación. La evidencia distingue ese runner del host Codex de origen y conserva el mismo ID/sesión del modelo. No se afirma reinicio real del host ni continuación de un modelo todavía ejecutándose.

Antes de congelar el paquete, el API del supervisor puede aplicar un prepareCandidate revisado (por ejemplo, formato con Prettier de las rutas autorizadas). No proviene de instrucciones del modelo y no se ejecuta desde los datos recuperados. Después de congelar artifact-intent.json no se vuelve a preparar ni cambiar el candidato; cualquier divergencia exige inspección. La evidencia distingue código generado y formato aplicado por el supervisor.

El publicador exige que un certificado de esta ruta coincida exactamente con las rutas/modos/hashes del resultado remoto inmutable, además de comprobar commit y blobs del PR. No permite publicar una reescritura posterior del candidato bajo el mismo resultado.

Estado de la prueba real governance2-result-recovery-318-v1: bloqueada por 401 al renovar la sesión de Codex CLI; thread.started seguido de turn.failed, sin turn.completed ni archivos generados. La reserva y el claim permanecen consumidos; no se relanza ese ID. Las pruebas con dobles validan la implementación y no se presentan como una recuperación real de candidato generada en este intento. La autenticación requiere volver a autorizar la cuenta y después un nuevo piloto expresamente delimitado.

### Terminal authentication failures

A failed ID remains consumed. `closeAuthBlocked` accepts only a clean original base and an explicit exit 1 with the exact pre-output authentication-refresh event sequence; it rejects successful/uncertain results, model items, changed logs/files, candidates, certificates, publication claims and PRs. It verifies the original remote owner/checkpoint and requires explicit 404s for absent result/publication authority. An immutable `terminal-attempts/ID` tag binds the original result/event hashes. Readback precedes local terminal persistence and release of only that task's lock. Lost responses retain the lock; replay reads the same terminal without model calls or another publication. No published receipt is fabricated.

Reserve, completion, recovery and terminal closure share a fail-closed `.mutation-lock` directory to prevent concurrent lock replacement. An interrupted mutator requires inspection; there is no time-based lock stealing. Terminal history is preserved and validated before another task may reserve. The bounded recovery pilot allowlist adds only `governance2-result-recovery-318-v2` after the original v1 authentication failure; arbitrary IDs are still rejected.
