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
node /ruta/confiable/studio-flow-minimal.mjs publish-plan /checkout-separado /registro una-tarea-v1
```

Ejecutar la certificación de código no confiable en un entorno sin red ni credenciales, con límites de recursos; la herramienta no crea ese aislamiento. Los procesos de prueba reciben un entorno reducido y límite de dos minutos por comando, pero eso no sustituye un sandbox. El piloto de esta herramienta se comprueba con Bubblewrap sin red. La herramienta no evalúa que las pruebas elegidas sean suficientes: eso corresponde al supervisor.

4. Publicar con la conexión GitHub ya disponible, separada del proceso que verifica el código. Antes de crear la rama, volver a comprobar el SHA remoto base y la ausencia de otro PR para el ID, incluido un PR cerrado. Usar los bytes, modos y eliminaciones exactos del plan certificado, con el commit base como padre. Crear **un solo Draft**, leer desde GitHub el commit, archivos y hashes y comprobar `draft: true`. Registrar evidencia en la issue y el PR. No fusionar ni desplegar.

Guardar fuera del repo un recibo verificado, con `branch` del plan, `commitSha`, `draft: true` y `url` real del PR:

```sh
node /ruta/confiable/studio-flow-minimal.mjs complete /checkout-separado /registro una-tarea-v1 /recibo.json
```

## Fallos y límites

Un fallo de pruebas conserva la reserva y permite corregir y recertificar **la misma tarea** antes de publicar. Otra tarea queda bloqueada por `active.json`; el ID consumido no se reutiliza. Ante caída del proceso, inspeccionar la issue, el registro y GitHub antes de cualquier recuperación manual. No borrar el historial para desbloquear una ejecución. No hay leases, recuperación automática ni protección frente a un operador que altere el registro de confianza.

El publicador es el supervisor con el conector existente; `publish-plan` no hace llamadas GitHub ni publica automáticamente. Un recibo requiere lectura remota previa. Esta entrega proporciona un flujo supervisado reutilizable: no acredita un daemon, jobs de Actions, ejecución entre sesiones ni producción. La automatización desatendida queda diferida y requiere una entrega aparte.

## Verificación de la herramienta

```sh
node --test tests/automation/studio-flow-minimal.test.mjs
```

La primera tarea real del flujo es la entrega de esta herramienta, autorizada y reservada en [#313](https://github.com/mikevazquez/Demeter/issues/313). Su PR y los resultados verificables se registran allí. Ninguna tarea de las colas retiradas forma parte de esta ejecución.
