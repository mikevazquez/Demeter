# Gobernante → Codex: flujo mínimo supervisado

Una solicitud explícita se convierte en una entrega revisable: **reservar → ejecutar en la sesión de Codex → certificar → publicar un único PR Draft**. No consume colas ni usa APIs de modelos. No requiere el governance retirado, intermediarios, lectores SQL o cambios en producción. Requiere Node 20+ y Git; no instala dependencias.

## Operación

El supervisor conserva esta herramienta y el registro fuera del checkout editable. Revisa el contrato antes de ejecutar código. El registro local es de confianza y debe conservarse entre sesiones; la issue de autorización es el registro remoto duradero. Ni este registro ni un recibo introducido a mano prueban por sí solos que GitHub haya publicado algo.

1. Crear una issue para **una** tarea autorizada, con ID nuevo, objetivo, commit base y archivos exactos permitidos. Antes de reservar, buscar ese ID en issues y PR de GitHub, incluidos los cerrados. Si ya existe, continuar esa ejecución o detenerse; nunca generar otra entrega para el mismo ID. Revisar PR abiertos por conflictos. Conservar la issue reservada antes de generar cambios.
2. Crear un checkout limpio del commit base y un contrato JSON fuera del repo. Los comandos de prueba son entradas revisadas por el supervisor, no órdenes extraídas de la salida generada.

```json
{
  "id": "una-tarea-v1",
  "goal": "Resultado concreto autorizado por el usuario",
  "authorization": "https://github.com/mikevazquez/Demeter/issues/313",
  "baseSha": "COMMIT_COMPLETO_DE_40_CARACTERES",
  "allowedPaths": ["archivo-autorizado.mjs"],
  "checks": [["node", "--check", "archivo-autorizado.mjs"]]
}
```

```sh
CODEX_PILOT_TASK_ID=una-tarea-v1 node /ruta/confiable/studio-flow-minimal.mjs reserve /checkout /registro /contrato.json
```

3. Codex realiza únicamente esa tarea durante la sesión actual. El supervisor conserva las diferencias y copia los mismos cambios a un **segundo checkout limpio del mismo SHA**. No copiar `.git`, credenciales ni registros. La certificación puede usar ese segundo checkout con la misma reserva, pues la identidad del candidato son sus rutas, modos y hashes, no su directorio.

```sh
node /ruta/confiable/studio-flow-minimal.mjs certify /checkout-separado /registro una-tarea-v1
```

Ejecutar la certificación de código no confiable en un entorno sin red ni credenciales, con límites de recursos; la herramienta no crea ese aislamiento. Los procesos de prueba reciben un entorno reducido y límite de dos minutos por comando, pero eso no sustituye un sandbox. El piloto de esta herramienta se comprueba con Bubblewrap sin red. La herramienta no evalúa que las pruebas elegidas sean suficientes: eso corresponde al supervisor.

4. Publicar con la conexión GitHub ya disponible, separada del proceso que verifica el código. Antes de **cada** plan o reintento, leer el SHA remoto base, la rama determinista y todos los PR para ese ID/rama, incluidos los cerrados. Conservar la respuesta y preparar fuera del repo un snapshot revisado por el supervisor:

```json
{
  "branch": "studio-flow/minimal/una-tarea-v1",
  "baseSha": "COMMIT_BASE_AUTORIZADO_DE_40_CARACTERES",
  "headSha": null,
  "pullRequests": []
}
```

`headSha: null` significa que la rama no existe. Si existe, usar su SHA real. Cada PR encontrado debe incluir `branch`, `commitSha`, `url`, `draft` y `state` (`OPEN`, `CLOSED` o `MERGED`). La consulta debe incluir todos los estados y paginar; un error de red, permisos o respuesta incompleta **no** equivale a una lista vacía. Buscar también el ID en issues y PR antes de la primera reserva, conforme al paso 1.

```sh
node /ruta/confiable/studio-flow-minimal.mjs publish-plan /checkout-separado /registro una-tarea-v1 /snapshot-remoto.json
```

El comando conserva `publication.json` antes de devolver un plan. Sin snapshot no autoriza ni el primer intento ni una repetición. Devuelve `action: create-draft` si no hay rama ni PR, `verify-existing-branch` si hay una rama sin PR, o `reuse-draft` si ya hay un único Draft abierto con el SHA de la rama. En `verify-existing-branch`, leer el commit, padre, rutas, modos y bytes remotos y compararlos con el certificado **antes** de usar esa rama; no sobrescribirla ni crear otra. En `reuse-draft`, verificar también los bytes y continuar el PR existente. Un PR cerrado, no Draft, incoherente o varios PR bloquean el plan; nunca crear un reemplazo. El snapshot es entrada confiable del supervisor: la herramienta valida su coherencia pero no consulta GitHub ni demuestra su frescura.

Usar los bytes, modos y eliminaciones exactos del plan certificado, con el commit base como padre. Crear **un solo Draft**, leer desde GitHub el commit, archivos y hashes y comprobar `draft: true`. Registrar evidencia en la issue y el PR. No fusionar ni desplegar.

Guardar fuera del repo un recibo verificado, con `branch` del plan, `commitSha`, `draft: true` y `url` real del PR:

```sh
node /ruta/confiable/studio-flow-minimal.mjs complete /checkout-separado /registro una-tarea-v1 /recibo.json
```

## Fallos y límites

Un fallo de pruebas conserva la reserva y permite corregir y recertificar **la misma tarea** antes de iniciar publicación. Otra tarea queda bloqueada por `active.json`; el ID consumido no se reutiliza. Dos procesos que intenten reservar a la vez compiten por creación exclusiva del bloqueo. El hash del contrato y el ID se comprueban en cada lectura de la reserva. Si se pierde `active.json` pero quedan reservas sin recibo válido, no se permite reservar otra tarea.

Los JSON se escriben completos en un temporal del mismo directorio y se publican atómicamente; se sincronizan los bytes antes de publicar. Esto protege frente a interrupción del proceso, sin prometer recuperación de pérdida de disco, corte eléctrico o corrupción del registro completo. Un temporal abandonado no prueba reserva ni publicación.

| Punto de interrupción                                                  | Continuación supervisada                                                                                                                                                                                    |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reserva completa, sin certificado                                      | Conservar ID, contrato, checkout y bloqueo; ejecutar `certify` sin reservar de nuevo.                                                                                                                       |
| Durante las pruebas                                                    | Al comenzar cada certificación se invalida cualquier éxito previo. Repetir `certify` en un proceso nuevo; no publicar con el certificado pendiente.                                                         |
| Después de obtener un plan o publicar remotamente, sin recibo local    | Leer GitHub de nuevo y repetir `publish-plan` con un snapshot actualizado. Reutilizar el Draft o verificar la rama existente según `action`; no crear otro PR por asumir que el intento anterior falló.     |
| Recibo persistido, bloqueo aún presente                                | Leer y verificar el mismo PR remoto y repetir `complete` con el mismo recibo. Libera solamente el bloqueo de ese ID; un recibo distinto se rechaza y un bloqueo de otra tarea se conserva.                  |
| JSON ausente, truncado, contrato alterado, bloqueo perdido/incoherente | Detener la publicación y reservas nuevas. Contrastar issue, respaldo confiable y GitHub; restaurar el registro de esa tarea bajo supervisión. No borrar historial ni inventar un nuevo ID para desbloquear. |

Una vez que existe `publication.json`, la herramienta bloquea recertificaciones para no cambiar el candidato durante una publicación incierta. Cualquier corrección posterior requiere reconciliar primero el resultado remoto y el registro bajo supervisión. La operación idempotente de `complete` conserva el recibo existente sin depender de que el checkout siga sin commit. Los recibos antiguos sin hash del contrato se inspeccionan y reconcilian manualmente; no hay migración automática.

El publicador sigue siendo el supervisor con la conexión existente; `publish-plan` no hace llamadas GitHub ni publica automáticamente. Un recibo y un snapshot requieren lectura remota previa; no protegen frente a un operador que falsifique o reutilice evidencia vieja. No hay exclusión distribuida entre máquinas con copias distintas del registro ni transacción atómica entre el registro local y GitHub. Usar un solo supervisor para publicar y conservar el mismo registro confiable. No hay leases ni recuperación automática de un registro incompleto.

La recuperación demostrada usa procesos CLI distintos y el mismo disco: una prueba mata con `SIGKILL` el proceso de certificación, verifica que el certificado anterior dejó de habilitar publicación y recertifica el mismo ID en un proceso nuevo. Otra lanza dos reservas simultáneas y comprueba que solo una gana. Los casos de reconciliación remota usan fixtures explícitos; las lecturas reales de GitHub y el único PR se documentan como evidencia en #313/#314. Esto **no** demuestra que Codex pueda iniciar tareas entre sesiones: falta un ejecutor persistente que reabra la sesión y el registro con autorización. No se añadió daemon, scheduler, otro orquestador ni automatización desatendida.

## Verificación de la herramienta

```sh
npm test -- tests/automation/studio-flow-minimal.test.mjs
```

La suite se integra con Vitest, el runner de `npm test` y de GitHub Actions. Incluye regresiones de concurrencia, interrupción real y registros inconsistentes. La herramienta CLI mantiene cero dependencias externas.

La primera tarea real del flujo es la entrega de esta herramienta, autorizada y reservada en [#313](https://github.com/mikevazquez/Demeter/issues/313). Su PR y los resultados verificables se registran allí. Ninguna tarea de las colas retiradas forma parte de esta ejecución.
