# Governance 2.0: supervisor y visibilidad de ejecución

Seguimiento: [GOV-SUPERVISOR-001, issue #353](https://github.com/mikevazquez/Demeter/issues/353).
Autorización de construcción: Mike, «Vamos a construirlo», 20 de octubre de 2026 a las 12:01 CDMX.

## Qué hace

El supervisor conserva la tarea fuera del chat, reserva cada intento antes de activar un worker y vuelve a leer el registro en cada observación. Decide si debe esperar, comprobar una entrega, continuar un proceso detenido de forma comprobable o solicitar intervención. El resultado y su evidencia se muestran en un tablero generado a partir del mismo registro.

La unidad de continuidad es la tarea: su ID y el hash del contrato completo permanecen iguales. Cada activación tiene un `attempt_id` distinto y consume su presupuesto. Un timeout de red, una respuesta 5xx o un chat sin señal no permiten lanzar otra copia.

## Dónde mirar

| Pregunta                        | Evidencia                                                                                                                                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ¿Qué worker tiene cada tarea?   | `status.md`: tabla por tarea, último intento, worker, sesión y acción siguiente.                                                                                                                                |
| ¿Cuándo hubo actividad real?    | Última señal del worker; se muestra separada del momento en que el supervisor consultó el estado.                                                                                                               |
| ¿El supervisor sigue revisando? | Últimas ejecuciones de [Governance Supervisor](https://github.com/mikevazquez/Demeter/actions/workflows/governance-supervisor.yml). Cada resumen y artifact contiene la hora de observación y la versión leída. |
| ¿El trabajo terminó?            | Estado **Verificado**, SHA completo, receipt correlacionado y checks independientes. **Enviado**, **Entregado** y **Verificando** no acreditan ese cierre.                                                      |
| ¿Falta algo de mi parte?        | Acción siguiente y estado **Bloqueado**, **Incierto** o **UAT pendiente**. La verificación técnica no autoriza producción.                                                                                      |
| ¿Qué ocurrió antes?             | Intentos en `registry.json` y eventos inmutables en `events/`, dentro de la referencia de autoridad.                                                                                                            |

El piloto tiene su [tablero aislado](https://github.com/mikevazquez/Demeter/blob/governance2/supervisor-proof-353-v1/status.md). El tablero operativo estará en la misma referencia canónica después de la migración explícita: [status.md de autoridad](https://github.com/mikevazquez/Demeter/blob/governance2/registry-318-v1/status.md).

El Markdown de la referencia refleja la última transición persistida. Un tick sin cambios no crea un commit; su hora queda acreditada en el resumen y el artifact de Actions. Un HTML descargado es una fotografía con fecha, no una conexión en vivo. Ningún tick renueva artificialmente la señal de un worker.

## Componentes y frontera de confianza

| Componente                      | Responsabilidad                                                                                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supervisor.mjs`                | Admisión, identidad estable, presupuesto, exclusión de ejecución, estados y recuperación.                                                                                    |
| `supervisor-store.mjs`          | Registro y journal Git con compare-and-swap, preservación legacy y tablero en el mismo commit.                                                                               |
| `supervisor-runner.mjs`         | Adaptador limitado a GitHub, recibos, puente Claude y comandos operativos.                                                                                                   |
| `supervisor-evidence.mjs`       | Verificación por GET: autor, intento, contrato, HEAD, diff, productor de CI y SHA. No ejecuta comandos recibidos del worker.                                                 |
| `supervisor-process.mjs`        | Proceso registrado, eventos JSONL, cancelación y comprobación del cierre de su grupo.                                                                                        |
| `supervisor-managed-worker.mjs` | Une el proceso administrado al registro; una reserva de lanzamiento evita duplicar el mismo intento y un reconciliador independiente controla la reanudación con escrituras. |
| `supervisor-dashboard.mjs`      | Proyección Markdown y HTML; no actúa como autoridad ni concede permisos.                                                                                                     |
| `governance-supervisor.yml`     | Observador independiente del chat, cada 15 minutos cuando esté activado; prueba aislada y verificación en otro job.                                                          |

El registro Git y el runner revisado son una frontera de confianza. No se entregan sus credenciales a los procesos administrados. Quien pueda reescribir la referencia de autoridad conserva capacidad para alterar el registro: el journal no es una firma externa ni una protección contra administradores del repositorio. Deben conservarse las restricciones de acceso de esa referencia.

## Decisiones de recuperación

| Señal comprobada                                          | Decisión                                                                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Acuse de creación de sesión Claude                        | Guardar enlace y esperar receipt. El acuse no es finalización.                                                                              |
| HTTP 429 explícito antes de crear sesión                  | Pausa persistida y reintento dentro del presupuesto.                                                                                        |
| Rechazo de autorización o contrato                        | Bloquear y suspender reintentos.                                                                                                            |
| Timeout, respuesta perdida o HTTP 5xx                     | Conservar el intento y el slot como inciertos. No repetir el POST.                                                                          |
| Falta de actividad reciente                               | Mostrar **Sin señal**, conservar exclusión y pedir reconciliación.                                                                          |
| Proceso administrado con salida observada y grupo cerrado | Guardar checkpoint. Continuar lectura según contrato; para escrituras exigir reconciliación independiente y ausencia de efectos pendientes. |
| Evento `turn.completed` sin evidencia de resultado        | Mostrar entrega/actividad; todavía falta comprobar SHA y CI.                                                                                |
| Receipt válido, diff permitido y CI correcto              | Verificar técnicamente; pasar a UAT si el contrato lo exige.                                                                                |

Las pausas siguen 15 → 30 → 60 minutos, limitadas por el presupuesto admitido de hasta tres intentos. El modo **WAITING_HUMAN** se representa como bloqueo con `requires_user_action`; no se reactiva solo. Una nueva identidad no sirve para eludir un intento consumido.

El observador de Claude usa el canal autorizado [issue #341](https://github.com/mikevazquez/Demeter/issues/341). Exige un receipt V2 del autor permitido, el mismo `task_id`, `attempt_id`, `worker_id`, `contract_sha256` y fingerprint. Vuelve a consultar el comentario real. Los recibos iguales son idempotentes; los contradictorios bloquean el cierre.

El SHA debe existir, coincidir con el HEAD remoto del contrato y descender de la base. El diff real debe coincidir con los archivos reportados y quedar dentro de las rutas permitidas. Los checks requeridos deben pertenecer al mismo SHA y al productor permitido. Después se revalida HEAD para detectar cambios durante la lectura. El resultado es una comprobación puntual; una promoción posterior revalida su propio SHA y sus gates.

## Preservación de Governance anterior

La autoridad sigue siendo `refs/heads/governance2/registry-318-v1`. El anchor revisado es `3ff186ab3975c15a0cdf7a524114be3c47d8294a`; el SHA256 del estado legacy es `6233dbc1436867781d476e6179be8020ce20a7d374bc4642396267527385c900`.

La migración explícita exige que la referencia siga en ese anchor y que su slot esté libre. Copia íntegramente su snapshot dentro del envelope `governance2-supervisor-v1`: nueve tareas importadas y una adicional cerrada permanecen consumidas. No borra ni reinicia el historial. Los ejecutores que solo entienden el schema anterior rechazarán el nuevo envelope; esto requiere un cambio coordinado, no compatibilidad implícita.

La rama `governance2/supervisor-proof-353-v1` es exclusivamente de prueba. Parte del mismo anchor y preserva su snapshot, pero no es una segunda autoridad operativa. El piloto usa una rama fuente congelada para que cambios posteriores del PR no cambien silenciosamente el contrato ya entregado.

## Activación y pausa

La construcción y el piloto no activan el supervisor operativo. Para activarlo se requiere aprobar el candidato concreto, completar los gates de revisión/UAT aplicables y:

1. Integrar el workflow revisado en `main`. En este repositorio, esa promoción tiene sus propios gates de despliegue.
2. Configurar `GOVERNANCE_SUPERVISOR_ENABLED=true` en las variables del repositorio.
3. Ejecutar **Governance Supervisor → Run workflow → migrate**, desde `main`, como el owner y con `legacy_head` igual al anchor completo anterior. Si la referencia cambió o tiene trabajo activo, la migración se detiene para reconciliar.
4. Admitir cada trabajo autorizado con **admit**, su contrato JSON y una issue de autorización. No se infieren tareas ejecutables a partir de todos los PR abiertos.
5. Comprobar el primer **tick**, su hora y el tablero. Pausar nuevas ejecuciones cambiando la variable a `false`; una pausa no significa que un worker ya activado se haya detenido.

El workflow anterior **Governance Claude Worker** queda inhibido cuando la variable está activa, para que ese camino manual no eluda el registro. El supervisor operativo inicial registra el puente Claude para tareas de revisión de lectura. Las tareas con permisos distintos requieren registrar el ejecutor correspondiente; una capacidad no declarada queda bloqueada.

Para observar Codex es necesario que el proceso se inicie a través del adaptador en un host registrado, con su autenticación existente comprobada. El adaptador no descubre chats personales, no copia credenciales de ChatGPT y no usa `resume --last`. No se acredita haber conectado los chats que fallaron originalmente ni resuelto el bloqueo de autenticación de C5 por haber hecho un piloto con Claude.

## Pruebas y alcance de la evidencia

```bash
node --test tests/automation/supervisor*.node.mjs
node scripts/automation/supervisor-process-proof.mjs --directory /tmp/governance-process-proof
```

Las pruebas de procesos usan workers sintéticos con procesos reales: comprueban checkpoint, cancelación, cierre del grupo, continuidad y no duplicación. No implican una llamada a un modelo ni una sesión autenticada de Codex.

La prueba externa tiene tres partes: tests en CI; compare-and-swap en GitHub y un único intento de Claude; observación desde otro job sin las credenciales de activación. Ese segundo job exige que el piloto llegue a **Verificado**; agotar la ventana sin receipt no cuenta como éxito. Su tablero y `observation.json` permanecen como evidencia del estado real.

Los resultados observados se registran en la issue/PR. El [contrato de aceptación](./supervisor-acceptance.md) distingue código comprobado, prueba remota y activación operativa.

## Referencias de comportamiento externo

- [Claude Routine API](https://platform.claude.com/docs/en/api/claude-code/routines-fire): crea sesiones; el token de la rutina no concede lectura de sesiones ni idempotencia del POST.
- [Eventos y schedule de GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule): el schedule depende de la rama predeterminada y puede retrasarse. Los 15 minutos son cadencia solicitada, no SLA.
- [Codex no interactivo](https://learn.chatgpt.com/docs/non-interactive-mode): salida JSONL y reanudación por sesión explícita. La sintaxis se debe contrastar con la versión instalada en cada host.
