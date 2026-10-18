# Vianelis: adaptador de ejecución supervisada (#318)

Este incremento integra el laboratorio #315 con **la misma reserva, certificación e intención de publicación de #314**. No introduce otra cola, daemon, scheduler, base de datos ni publicador. Demeter aloja únicamente este piloto técnico; no se modifican funciones de Studio Flow.

## Dependencia reutilizada

Los archivos `scripts/studio-flow-minimal.mjs`, `tests/automation/studio-flow-minimal.test.mjs` y `docs/automation/studio-flow-minimal.md` son copias **sin cambios** del SHA `3b48f1cb1abb2a2fb7c8776e0af1a2fac70661b5` de #314, que sigue abierto Draft. Se incluyen como dependencia explícita porque todavía no están en main; no se modifica su rama ni se crea otro mecanismo equivalente. Revisar esta dependencia al integrar cualquiera de los dos PR. El adaptador se ejecuta desde la copia confiable del supervisor, fuera del checkout editable.

## Contrato y operación

El supervisor revisa un contrato con los campos de #314: ID, objetivo, autorización, SHA base, rutas exactas y comandos de prueba. Los únicos IDs admitidos son `continuity-315-38989415241` y `vianelis-launcher-318-v1`; la autorización es #318. El segundo es una tarea nueva autorizada por Mike tras la sonda AVAILABLE, no un reintento del ID consumido. Ambos conservan `continuity.taskId=continuity-315-38989415241` como procedencia verificada, separada de la identidad de trabajo. No se aceptan IDs arbitrarios ni sufijos nuevos por inferencia. El vínculo conserva IDs de runs, SHA y comentarios dentro del **mismo** `reservation.json` protegido por el hash del contrato. La evidencia no sustituye la autorización del objetivo y archivos.

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

## Estado realmente observado en esta entrega

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

La referencia permanece consumida después de terminar; no tiene TTL, heartbeat, liberación ni reintento de generación. No es otra cola, scheduler o publicador. El conjunto de IDs autorizados del adaptador no se amplía. Un ID nuevo exige un contrato y autorización revisados; esta entrega no inicia una nueva tarea de modelo.

La sonda remota usa únicamente `vianelis-authority-probe-318-v1` para probar la creación atómica desde dos procesos. No es una tarea admitida por reserveContinued, no ejecuta Codex y no se registra como trabajo de desarrollo ni PR publicado. Su referencia queda como evidencia de consumo y no debe eliminarse para repetirla.

### Límites

Esta protección aplica a supervisores que ejecuten esta revisión. Un ejecutable antiguo que ignore la autoridad, la eliminación/modificación manual de refs o una copia activa del publicador fuera del protocolo quedan fuera de la garantía. No se modifican protecciones de tags ni permisos. El registro histórico de solo lectura no se transforma automáticamente en uno operativo. Tampoco se ha probado ejecución real del modelo tras adquirir una referencia ni publicación concurrente cercada por propietario; siguen siendo siguientes pasos. No declarar autonomía general ni cierre de Governance a partir de una sonda de API.
