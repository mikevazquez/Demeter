# GOV-WORKER-006 · Host Codex conectado a la autoridad compartida

Seguimiento: [#400](https://github.com/mikevazquez/Demeter/issues/400). Continúa el adapter de #396.

## Modelo de operación

El host Demeter inicia **un tick acotado** contra `governance2/registry-318-v1`.
Usa `createGitHubSupervisorStore`, `tickSupervisor`, el dispatcher, el wrapper de procesos y
el observador/verificador existentes. No introduce otra cola, publisher de PR, servidor HTTP,
daemon ni cron. El entorno es on-demand: si se detiene, no se presume conectividad.

GitHub Actions conoce la identidad de Codex como **disconnected**. No tiene su sesión ChatGPT
y nunca anuncia el host disponible. Una señal del owner `available` no transforma una base
disconnected en conectividad. Sólo el tick local puede ofrecer el worker después del probe.
Las señales durables no_capacity/degraded/disconnected del owner siguen bloqueando nuevos launches.

Antes de reservar se exige:

- activación explícita en un archivo de operador externo al repo;
- SHA inmutable del executor y checkout del executor limpio;
- identidad GitHub configurada de `mikevazquez`, sólo en el proceso supervisor;
- task_id admitido en la misma autoridad y también permitido por la configuración del host;
- contrato read_only con recuperación read_only, permisos/capacidades/riesgo/quality floor suficientes;
- checkout limpio, rama y SHA locales y remotos exactos;
- directorio físico de receipts fuera del checkout, incluso si hay symlinks.

La allowlist de task_ids limita al host; no cambia el contrato ni fija el proveedor desde el intake.
El dispatcher conserva la selección y evita que otra tarea de la cola consuma este host fuera de scope.
Cada configuración apunta a un checkout preparado; no se resetean ni clonan ramas automáticamente.

## Lanzamiento y concurrencia

El intent reservado persiste `managed_host_id`. El wrapper sólo puede reclamarlo con el mismo
host_id y persiste un único managed_launch_claim antes del spawn. Durante los primeros 30 segundos
un observer conserva ese intent fresco; después sólo puede marcar incertidumbre. Nunca libera
el slot ni roba un lock ni autoriza otro launch al vencer esa ventana.

El subprocess usa el perfil codex-chatgpt de #396: selectores de autenticación y transporte,
sin claves API, tokens GitHub ni variables del producto. `receipt:write` pertenece al relay del
supervisor, no al entorno del modelo. Una sesión local reconocida no garantiza token vigente o cuota.

## Receipt y recuperación

El CLI escribe su último mensaje mediante `--output-last-message` en un directorio privado
fuera del checkout. Se pide al modelo un JSON V2 sin Markdown: mismo task/attempt/worker,
contract SHA y fingerprint; listas de comandos/checks realmente ejecutados; blocked si falta algo.
El host lee un archivo regular sin seguir symlinks, valida schema/campos exactos/identidad y
límites (archivo 128 KiB; receipt canónico 64 KiB), y vuelve a comprobar el checkout.

`turn.completed` no equivale a éxito de tarea. Tras exit 0 y cierre del process group, se conserva
en el intento canónico `codex_host_result`: prueba de proceso correlacionada y receipt del modelo.
Un claim CAS de publicación liga el hash canónico del receipt al mismo intento antes de hacer
un único POST a issue #341. Si se pierde el ACK, se busca por GET; el claim impide otro POST ciego.
El verificador GET-only existente comprueba fuente real, identidad, rama/SHA y CI independiente.

Un host reiniciado puede reconciliar esa evidencia y el comentario sin ejecutar de nuevo Codex.
Un claim sin prueba de cierre, un receipt inválido, drift o evidencia contradictoria permanecen
fail-closed. Un receipt blocked/failed o CI fallido no es success: se conserva el slot para revisión
según la política existente. Un fallo de autenticación detiene reintentos aunque quede presupuesto.
El archivo privado de salida se conserva. No se publican stdout/stderr completos ni campos
adicionales; sólo los campos V2 validados.

## Configuración y comando de activación

La plantilla [codex-host.example.json](codex-host.example.json) está deshabilitada y tiene un pin
imposible. No se puede usar tal cual. Tras revisión, promoción y autorización de activación propia:

1. Preparar un checkout separado en la rama/SHA exactos del contrato autorizado, sin credenciales
   ni variables de producto en archivos locales. No cambiar el checkout de otro bloque.
2. Crear configuración de operador fuera del repo con enabled=true, host_id estable, SHA del
   executor promovido, directorios absolutos, task_ids exactos ya admitidos y referencia de autorización.
3. Con GitHub CLI autenticado como owner y Codex autenticado con ChatGPT, ejecutar desde el executor limpio:

```sh
node scripts/automation/supervisor-codex-host.mjs tick /ruta/privada/codex-host.json
```

El comando realiza un solo tick. No crea tareas, no prolonga la vida del entorno y no publica
disponibilidad global. Una nueva invocación del comando observa primero el mismo intento activo;
no es una orden de regeneración. No se debe habilitar la plantilla ni disparar tareas como parte
de una revisión o un push del PR. Merge y activación operativa son gates independientes.

## Evidencia y límites de esta entrega

Los tests HOST-01…HOST-07 usan procesos Node reales con protocolo Codex sintético, store CAS y
API GitHub simulados. Prueban control, entorno, identidad, receipts, concurrencia y recuperación;
no acreditan una nueva llamada a un modelo ni una activación canónica.
El piloto autenticado previo de #396 conserva su propio SHA y receipts; no se reciclan sus IDs.
No se consume la cola operativa ni se modifica el scheduler al validar esta implementación.
