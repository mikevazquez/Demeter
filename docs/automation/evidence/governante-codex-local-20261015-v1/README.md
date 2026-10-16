# Piloto local Gobernante → Codex — intento real bloqueado

El propietario aceptó expresamente el modo local con evidencias GitHub, sin atribuir jobs de Actions a las etapas locales. Tarea única: [#306](https://github.com/mikevazquez/Demeter/issues/306), `governante-codex-local-20261015-v1`. Fuente inmutable de #304: `2af9188523c5e18bed2d647092c3395c6f428cd9`.

## Resultado observado

- **Selección PASS:** el selector original de #304, sin cambios de lógica, ejecutado con `COORDINATOR_CONFIG=queue.local.json` y `CODEX_PILOT_TASK_ID=governante-codex-local-20261015-v1`, seleccionó exactamente ese ID. El manifiesto conserva las cuatro tareas originales sin alterar y limita el lote a 1. La cola y la rama de control no cambiaron.
- **Transporte corregido:** `fetch` nativo de Node falló en este cloud. Se utilizó `gh-read-bridge.mjs`, que realiza consultas reales con `gh api`, solo permite GET al repositorio exacto y registra endpoints/status en `api-reads.jsonl`. No usa fixtures ni concede escrituras. La preparación original verificó el issue/hash/updated_at.
- **Reserva previa persistente:** commit `e78fc252e21a755570b8c755094dc1d3003f95e6`. La marca de invocación consumida, selección y orden preparada se publicaron en `df6bd7273bbe4f519ef8827265177a742a89c012` antes de llamar a Codex. Esta reserva es local; no se presenta como lease del journal de Actions ni se modificó ese journal.
- **Ejecución real BLOQUEADA:** una invocación de Codex CLI 0.159.2 con la sesión ChatGPT existente, sin API keys ni credenciales de publicación/aplicación. Aunque `codex login status` indicaba ChatGPT, las peticiones reales al proveedor devolvieron HTTP 401 y la CLI terminó con `turn.failed`: el token no pudo renovarse. No existe `model-output.json`; cero archivos generados y cero llamadas de herramientas del modelo. No se declara un modelo ejecutado satisfactoriamente.
- **Diagnóstico adicional:** la CLI informó que Code Mode no estaba disponible al deshabilitar su host. Esa restricción del lanzador necesita ajustarse con una configuración compatible antes de una continuación; no explica ni resuelve los errores independientes de autenticación 401. No se relanzó a ciegas ni se reinició la reserva.
- **Certificación y publicación NO EJECUTADAS:** sin candidato. Se ejecutaron únicamente las negativas de `certifyCodexCandidate(contract, null)` y `proposeCodexDraft`: rechazo por procedencia y bloqueo por certificación. No equivalen a certificación positiva. No se creó un Draft de resultado ni se comprobó deduplicación posterior a entrega, pues no hubo entrega.
- **Pruebas previas:** 33/33 en el SHA exacto de #304; TAP conservado. El preflight de namespaces local comprobó ausencia de ruta de red y entorno PATH/PWD. Se prepararon dos clones independientes, sin hardlinks, para ejecución/certificación; no se ejecutó código generado en ellos porque no hubo generación.

## Evidencias y límites

`outcome.json` recoge los estados; `execute.json`, el comando exacto y tiempos; `codex-events.jsonl` y `codex-stderr.txt`, los errores reales; `selection-before.json`, la selección; `prepared-task.json`, la orden y su contrato; `request.json`, `reviewed-intake.json` y `admission-evidence.json`, la admisión por el adaptador existente; `SHA256SUMS.json`, los hashes de los archivos archivados. Los scripts conservan las rutas absolutas usadas en este cloud y no deben relanzarse como un mecanismo de reset del presupuesto.

Main se comprobó en `87749e84d324c6c5263c0f0128075cbe8c7e61b7`; control en `d3e113fb65d778f106c1ce574296123668567861`. #304 sigue Draft en el mismo HEAD. Solo se crearon el issue de este contrato y la rama documental de evidencias; sin merges, despliegues solicitados, cambios productivos, de secretos/permisos o de la cola general. No se inspeccionaron facturas: sí se comprueba que no se compraron servicios/créditos y que no se usó una API key del modelo. Las integraciones automáticas del repositorio no se certifican en este registro.

## Intervención humana indispensable

1. En una terminal segura de este mismo entorno, ejecutar `codex login --device-auth` y completar el inicio de sesión con la cuenta ChatGPT que ya dispone de Codex. No usar `--with-api-key`, no comprar créditos y no compartir tokens/códigos en el chat.
2. Confirmar que la reconexión terminó. Ingeniería deberá reconciliar el intento fallido y su reserva, corregir la incompatibilidad del host del lanzador y reanudar **el mismo ID**, sin crear ni ejecutar otra tarea. `login status` por sí solo no acredita que el proveedor acepte la sesión.

El piloto permanece **BLOQUEADO por autenticación**, no completado ni UAT aprobado. Estas son etapas locales; no existen nuevos jobs select/execute/certify/publish de Actions acreditados por este intento.
