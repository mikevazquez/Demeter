# Piloto supervisado completado — misma tarea #306

El propietario autorizó «Hagámoslo así en lo que resuelvo el inicio de sesion»: ejecutar la misma tarea con el agente Codex de la conversación. El intento anterior de CLI con HTTP 401 permanece conservado en el directorio padre y en el historial. No se reinició su presupuesto ni se lanzó otra CLI.

**Resultado:** [Draft #307](https://github.com/mikevazquez/Demeter/pull/307), SHA `784dbfae6ac8fe71289878192aa9f70a2b125b7a`. Base exclusiva: rama de integración de #304. Único cambio: `tests/automation/fixtures/governante-codex-local-proof.mjs`, 8 líneas añadidas y cero eliminaciones. No se fusiona ni despliega.

## Alcance acreditado

| Etapa local | Resultado y evidencia |
| --- | --- |
| Admisión | Adaptadores existentes de #304; issue, hash y updated_at revalidados. Ver `admission.json`, `queue.local.json`, `authorization.md` y `reservation.json`. |
| Selección | Selector original de #304 con `CODEX_PILOT_TASK_ID=governante-codex-local-20261015-v1` y máximo 1. Seleccionó exactamente ese ID entre cinco entradas. `selection-before.json`. |
| Ejecución | El agente Codex de esta conversación creó el único fixture permitido mediante apply_patch. Sintaxis y verificador determinista aprobados dentro de namespaces aislados. `generation.json`, `candidate.json`, `execute-verification.json`. |
| Certificación | Los mismos bytes fueron reconstruidos desde el candidato en un clon independiente, sin hardlinks ni alternates, del SHA fuente. Pasaron nuevamente sintaxis y verificador. El adaptador emitió `certified`. `independent-candidate.json`, `certify-verification.json`, `certificate.json`. |
| Publicación | Publicador separado del código del fixture, por CLI Git/GitHub autorizadas. El certificado ya estaba en GitHub antes de publicar. Un único Draft contra integración, no main/control. `publication.json`. |
| Auditoría remota | El SHA256 del blob recuperado por API coincide con el certificado. Diferencia del PR: un único archivo. Main/control intactos. `final-audit.json`. |
| Repetición | Cero tareas seleccionadas tras publicar; un solo PR en cualquier estado para el ID. No hubo otra generación ni duplicado. `selection-after.json`, `final-audit.json`. |

## Certificación y hashes

- Fuente: `2af9188523c5e18bed2d647092c3395c6f428cd9`.
- Contrato SHA256: `5596565edc161ac2ab0dcb028a6c701d9d10d1f2f7542e2e2a6357b577f171af`.
- Archivo SHA256: `3406e508638936898e52b965714a1d789874b25741777c0af096392af5f3d5ca`.
- Git blob publicado: `0b65950dff97db68b95f49a3837ff86db1516dd5`.
- Array de archivos SHA256: `62ea18579a6bc89dd1ecd67659cf92cdd5fbe8d9d5b42f9d97cd791c885c4bfc`.
- Reserva/autorización previa a generación persistida en `cf66c0c09e915f3cf53f8f108ec3b446524cf698`.
- Certificado anterior a publicación persistido en `4f8cc9dc007ae6366e38062ce12f09d56d3eed1b`.
- `SHA256SUMS.json` permite cotejar todos los archivos de este registro; no se incluye a sí mismo.

Pasaron dos checks (sintaxis y verificador) en cada checkout: cuatro ejecuciones exitosas de dos comprobaciones. El verificador usa el checker que ya estaba guardado antes de generar: export único, objeto congelado y valores exactos; ausencia de ruta de red; entorno limitado a PATH/PWD; sin `/home`, `/workspace` o `/root`; Git y repo de solo lectura; imports denegados y timeout de evaluación. No se ejecutó código generado con credenciales GitHub o de aplicación.

Las 33 pruebas de integración/coordinador del SHA fuente siguen como evidencia previa: [CI 38835220556](https://github.com/mikevazquez/Demeter/actions/runs/38835220556), con TAP local conservado en el directorio padre. No son pruebas nuevas ni CI del Draft #307.

## Límites y continuidad

Esta ejecución prueba el ciclo **supervisado** admitido, no la delegación automática Gobernante → otro Codex. No se ejecutaron nuevos jobs de Actions, no se reparó el inicio de sesión de la CLI ni se modificó el journal compartido de Actions. El proceso de certificación fue distinto y aislado; el agente supervisor fue el mismo, no otro agente independiente. No se atribuye UAT funcional de Studio Flow a este fixture sintético.

Las cuatro entradas anteriores de la cola permanecen idénticas y con sus entregas #296/#297/#298/#301; ninguna se seleccionó o ejecutó en este bloque. Main permanece `87749e84d324c6c5263c0f0128075cbe8c7e61b7`; control, `d3e113fb65d778f106c1ce574296123668567861`. #304 y #307 permanecen Draft. La cola general no fue editada ni se activó el workflow.

No se contrataron servicios, compraron créditos, usaron API keys del modelo ni solicitaron cambios/despliegues productivos. Se usaron las capacidades existentes de esta sesión y GitHub. No se inspeccionaron facturas ni se certifican las integraciones automáticas de Preview del repositorio. Toda promoción sigue exigiendo autorización específica del propietario.

Siguiente trabajo separado: resolver la autenticación incluida de la CLI y verificar la delegación automática cuando exista una vía habilitada sin cargos adicionales. Este ID ya fue consumido por el Draft; no debe regenerarse mientras se repara esa infraestructura. El resultado supervisado no desbloquea la promoción de #304.
